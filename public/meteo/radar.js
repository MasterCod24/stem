// Il radar della vista meteo: le piogge vere di RainViewer (ultime 2 ore, una mappa ogni 10 minuti) ricolorate coi colori
// dell'HUD a fasce di 5 dBZ con il bordo acceso, come curve di livello, sopra la mappa di Natural Earth (mappa.json), in un
// cerchio centrato sul luogo. È riflettività (dove piove e quanto), non Doppler: RainViewer non dà la velocità del vento.
// Le mattonelle arrivano dirette da RainViewer (CORS aperto, cache di 2 giorni): l'unica cosa che la vista chiede fuori da Nexus.
// Due canvas: eco (le piogge, ridisegnato a ogni cambio di mappa o di vista) e base (mappa, anelli, città, sopra le piogge).

const MAPPE = 'https://api.rainviewer.com/public/weather-maps.json';
const Z_MAX = 7;          // misurato il 12/11: dallo zoom 8 RainViewer risponde con «Zoom Level Not Supported»
const LATO = 256;
const KM_TERRA = 40075.016686;
const PARALLELI = 8;      // mattonelle scaricate insieme
export const RAGGIO = Object.freeze({ base: 150, min: 25, max: 1500 }); // km dal centro al bordo del cerchio

// Lo schema Universal Blue, l'unico che RainViewer serve (misurato il 12/11: gli schemi 0, 2 e 4 danno gli stessi byte).
// Dal CSV ufficiale: un colore pieno per dBZ da 15 a 65; da −10 a 14 cambia solo la trasparenza.
const UB = ('88ddee 6cd1eb 51c5e8 36bae5 1baee2 00a3e0 009ad5 0091ca 0088bf 007fb4 0077aa 0070a3 00699c 006295 005b8e 005588 005180 004e78 004a70 004768 ' +
  'ffee00 ffe000 ffd200 ffc500 ffb700 ffaa00 ff9f00 ff9500 ff8b00 ff8100 ff4400 f23600 e62800 d91b00 cd0d00 c10000 a80000 8f0000 760000 5d0000 ' +
  'ffaaff ff9fff ff95ff ff8bff ff81ff ff77ff ff6cff ff62ff ff58ff ff4eff ffffff').split(' ').map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
const ALFA_UB = [0x14, 0x19, 0x1e, 0x24, 0x29, 0x2e, 0x34, 0x39, 0x3e, 0x44, 0x49, 0x4e, 0x54, 0x59, 0x5e, 0x64, 0x6e, 0x78, 0x82, 0x8c, 0x96, 0xa0, 0xaa, 0xb4, 0xbe];

// Le fasce dell'HUD: ciano fino alla pioggia molto forte, poi arancione da 38 dBZ (circa 8 mm/h con Marshall-Palmer, il
// «very heavy» del Met Office) e rosso da 50 dBZ (circa 50 mm/h, «violent»): le stesse soglie degli avvisi.
export const BANDE = [ // [dBZ minimo, r, g, b, alfa]
  [10, 62, 230, 255, 0.1], [15, 62, 230, 255, 0.22], [20, 62, 230, 255, 0.34], [25, 62, 230, 255, 0.48],
  [30, 120, 240, 255, 0.64], [35, 182, 248, 255, 0.8], [38, 255, 155, 51, 0.88], [50, 255, 67, 67, 0.95],
];
const pixel = (r, g, b, a) => ((Math.round(a * 255) << 24) | (b << 16) | (g << 8) | r) >>> 0; // RGBA in un Uint32 little-endian
const COLORE = [0, ...BANDE.map(([, r, g, b, a]) => pixel(r, g, b, a))];
const BORDO = [0, ...BANDE.map(([, r, g, b, a], i) => (i < 6 ? pixel(182, 248, 255, Math.min(1, a + 0.35)) : pixel(r, g, b, 1)))];
const BANDA = new Uint8Array(128); // dBZ + 32 → fascia (0 nessuna)
for (let v = 0; v < 128; v++) BANDA[v] = BANDE.filter(([min]) => v - 32 >= min).length;

const decodificati = new Map(); // colore della mattonella → dBZ + 32
function decodifica(p) {
  let v = decodificati.get(p);
  if (v !== undefined) return v;
  const r = p & 255, g = (p >>> 8) & 255, b = (p >>> 16) & 255, a = p >>> 24;
  let best = 0, dm = Infinity;
  if (a < 250) ALFA_UB.forEach((x, i) => { const d = Math.abs(x - a); if (d < dm) { dm = d; best = i - 10; } });
  else UB.forEach(([R, G, B], i) => { const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2; if (d < dm) { dm = d; best = i + 15; } });
  v = Math.max(1, Math.min(127, best + 32));
  if (decodificati.size < 65536) decodificati.set(p, v);
  return v;
}

// Mercatore normalizzato: il mondo è il quadrato 0..1, come le mattonelle
export const merc = (lon, lat) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
};
const latDi = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

// La mappa: ogni linea in Float32Array di punti del mercatore, col suo riquadro per saltare quelle fuori vista
let mappa = null;
function caricaMappa() {
  return (mappa ||= fetch('/meteo/mappa.json').then((r) => r.json()).then((m) => {
    const linee = {};
    for (const [tipo, ls] of Object.entries(m.linee)) linee[tipo] = ls.map((a) => {
      const p = new Float32Array(a.length);
      let lon = 0, lat = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i < a.length; i += 2) {
        lon += a[i]; lat += a[i + 1];
        const [x, y] = merc(lon / 100, lat / 100);
        p[i] = x; p[i + 1] = y;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { p, x0, y0, x1, y1 };
    });
    const citta = m.citta.map(([nome, lon, lat, k]) => { const [x, y] = merc(lon / 100, lat / 100); return { nome: nome.toUpperCase(), x, y, k }; });
    return { linee, citta };
  }).catch((e) => { mappa = null; throw e; }));
}

// Le mattonelle già scaricate, per non rifarle tornando indietro con la vista
const immagini = new Map();
function mattonella(url) {
  let p = immagini.get(url);
  if (!p) {
    p = new Promise((ok, no) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => ok(img); img.onerror = () => no(new Error(url)); img.src = url; });
    p.catch(() => immagini.delete(url));
    immagini.set(url, p);
    if (immagini.size > 900) immagini.delete(immagini.keys().next().value);
  }
  return p;
}

// onInfo(info) quando cambia la mappa mostrata o lo stato dello scaricamento
export function createRadar({ eco, base, onInfo = () => {} }) {
  const ce = eco.getContext('2d'), cb = base.getContext('2d');
  let luogo = null, u = [0, 0];                        // il luogo e il suo punto nel mercatore
  let centro = [0, 0], raggio = RAGGIO.base;           // la vista
  let lista = [], host = '', mostrata = -1, tempoScelto = null, errore = '';
  let set = null, gen = 0, giro = 0, aggiornaTimer = 0, scaricate = 0, totali = 0, attivo = false, analisi = null, carta = null;
  let W = 1, Hh = 1, dpr = 1;

  const kmPerNorm = () => KM_TERRA * Math.cos((latDi(centro[1]) * Math.PI) / 180);
  const pxPerNorm = () => (Math.min(W, Hh) / 2 / raggio) * kmPerNorm(); // pixel del canvas per unità del mercatore
  const schermo = (x, y, k = pxPerNorm()) => [(x - centro[0]) * k + W / 2, (y - centro[1]) * k + Hh / 2];

  // Le mattonelle che servono alla vista: zoom e riquadro, con un margine del 30% per spostarsi senza riscaricare.
  // Al massimo 4×4 per mappa: oltre, lo zoom scende di uno (13 mappe da 1024×1024 px sono già 54 MB).
  function serve() {
    const k = pxPerNorm(), mezzo = (Math.min(W, Hh) / 2) * 1.3 / k, ampio = Math.max(W, Hh) / Math.min(W, Hh);
    const span = 2 * mezzo * ampio;
    const z = Math.max(1, Math.min(Z_MAX, Math.floor(Math.log2(3 / span)), Math.round(Math.log2(k / LATO))));
    const n = 2 ** z, a = Math.floor((centro[0] - mezzo * ampio) * n), b = Math.floor((centro[0] + mezzo * ampio) * n);
    const c = Math.max(0, Math.floor((centro[1] - mezzo * ampio) * n)), d = Math.min(n - 1, Math.floor((centro[1] + mezzo * ampio) * n));
    return { z, x0: a, nx: b - a + 1, y0: c, ny: d - c + 1, chiave: `${z}/${a}/${b}/${c}/${d}` };
  }

  // Una mappa del radar: le mattonelle in un canvas, poi ricolorate a fasce; dbz tiene dBZ + 32 per pixel (0 nessuna eco)
  async function caricaMappaRadar(fr, s, mio) {
    const tela = document.createElement('canvas');
    tela.width = s.nx * LATO; tela.height = s.ny * LATO;
    const c = tela.getContext('2d', { willReadFrequently: true });
    const lavori = [];
    for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
      const tx = (((s.x0 + i) % 2 ** s.z) + 2 ** s.z) % 2 ** s.z, ty = s.y0 + j;
      lavori.push(() => mattonella(`${host}${fr.path}/${LATO}/${s.z}/${tx}/${ty}/2/1_0.png`)
        .then((img) => { if (mio === gen) c.drawImage(img, i * LATO, j * LATO); }, () => {}));
    }
    await coda(lavori);
    if (mio !== gen) return;
    const img = c.getImageData(0, 0, tela.width, tela.height), px = new Uint32Array(img.data.buffer), n = px.length, w = tela.width;
    const dbz = new Uint8Array(n), banda = new Uint8Array(n), out = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const p = px[i]; if (p >>> 24) { const v = decodifica(p); dbz[i] = v; banda[i] = BANDA[v]; } }
    for (let i = 0; i < n; i++) { // il bordo di una fascia, verso una più bassa: la curva di livello
      const b = banda[i];
      if (!b) continue;
      const x = i % w, bordo = (x + 1 < w && banda[i + 1] < b) || (x > 0 && banda[i - 1] < b) || (i + w < n && banda[i + w] < b) || (i >= w && banda[i - w] < b);
      out[i] = bordo ? BORDO[b] : COLORE[b];
    }
    img.data.set(new Uint8ClampedArray(out.buffer));
    c.putImageData(img, 0, 0);
    Object.assign(fr, { tela, dbz, w, h: tela.height, s, pronta: true });
    scaricate++;
  }
  async function coda(lavori) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLELI, lavori.length) }, async () => { while (i < lavori.length) await lavori[i++](); }));
  }

  // Scarica (o riscarica, se la vista ha bisogno di altre mattonelle) tutte le mappe: prima l'ultima, che si vede subito.
  // Le mappe vecchie restano a schermo finché arrivano le nuove: ognuna sa dove stanno le sue mattonelle (fr.s).
  async function carica(forza = false) {
    if (!attivo || !lista.length) return;
    const s = serve();
    if (!forza && set && set.chiave === s.chiave) return;
    const mio = ++gen;
    set = s; scaricate = 0; totali = lista.length;
    informa();
    for (let i = lista.length - 1; i >= 0 && mio === gen; i--) {
      await caricaMappaRadar(lista[i], s, mio);
      if (mio === gen) { if (i === lista.length - 1 || mostrata === i) mostra(mostrata < 0 ? i : mostrata, true); informa(); }
    }
  }

  async function leggiMappe() {
    try {
      const r = await fetch(MAPPE, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const past = Array.isArray(d?.radar?.past) ? d.radar.past : [];
      if (typeof d?.host !== 'string' || !/^https:\/\/[a-z0-9.-]+$/i.test(d.host) || !past.length) throw new Error('risposta senza mappe');
      const vecchie = new Map(lista.map((f) => [f.path, f]));
      host = d.host;
      lista = past.filter((f) => /^\/v2\/radar\/[a-z0-9]+$/i.test(f.path) && Number.isFinite(f.time))
        .map((f) => vecchie.get(f.path) || { t: f.time * 1000, path: f.path, pronta: false });
      errore = '';
      return true;
    } catch (e) {
      errore = 'radar non disponibile';
      console.warn('[meteo] RainViewer', e);
      informa();
      return false;
    }
  }

  // ---------------------------------------------------------------- disegno
  function disegnaEco() {
    ce.setTransform(1, 0, 0, 1, 0, 0);
    ce.clearRect(0, 0, W, Hh);
    const fr = lista[mostrata];
    if (!fr?.pronta) return;
    const k = pxPerNorm(), n = 2 ** fr.s.z, [x, y] = schermo(fr.s.x0 / n, fr.s.y0 / n, k);
    ce.imageSmoothingEnabled = true;
    ce.drawImage(fr.tela, x, y, (fr.w / LATO / n) * k, (fr.h / LATO / n) * k);
  }

  function scritta(t, x, y, colore) { // con un alone scuro sotto: sopra le piogge si legge
    cb.lineWidth = 3 * dpr; cb.strokeStyle = 'rgba(0, 8, 12, .8)'; cb.lineJoin = 'round';
    cb.strokeText(t, x, y); cb.fillStyle = colore; cb.fillText(t, x, y);
  }
  // Mappa, anelli e città: si rifà solo quando cambia la vista
  function disegnaBase() {
    cb.setTransform(1, 0, 0, 1, 0, 0);
    cb.clearRect(0, 0, W, Hh);
    const k = pxPerNorm(), R = Math.min(W, Hh) / 2, cx = W / 2, cy = Hh / 2, s = dpr;
    if (carta) disegnaMappa(carta, k);
    // anelli a un quarto, metà, tre quarti e bordo, con i km
    cb.lineWidth = 1 * s;
    for (let i = 1; i <= 4; i++) {
      cb.strokeStyle = `rgba(62, 230, 255, ${i === 4 ? 0.55 : 0.16})`;
      cb.setLineDash(i === 4 ? [] : [2 * s, 5 * s]);
      cb.beginPath(); cb.arc(cx, cy, (R - 1 * s) * i / 4, 0, 2 * Math.PI); cb.stroke();
    }
    cb.setLineDash([]);
    cb.font = `400 ${8.5 * s}px Menlo, monospace`;
    cb.fillStyle = 'rgba(150, 222, 238, .75)';
    cb.textAlign = 'left'; cb.textBaseline = 'bottom';
    for (let i = 1; i <= 4; i++) { const km = (raggio * i) / 4; scritta(`${km >= 100 ? Math.round(km) : km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} KM`, cx + 4 * s, cy - (R * i) / 4 + 12 * s, 'rgba(150, 222, 238, .8)'); }
    // tacche ogni 10°, lunghe ai punti cardinali
    for (let g = 0; g < 360; g += 10) {
      const a = (g * Math.PI) / 180, l = g % 90 ? 5 * s : 11 * s, c = Math.sin(a), d = -Math.cos(a);
      cb.strokeStyle = g % 90 ? 'rgba(62, 230, 255, .35)' : 'rgba(182, 248, 255, .9)';
      cb.beginPath(); cb.moveTo(cx + c * (R - 1 * s), cy + d * (R - 1 * s)); cb.lineTo(cx + c * (R - l), cy + d * (R - l)); cb.stroke();
    }
    cb.font = `400 ${10 * s}px Menlo, monospace`; cb.fillStyle = 'rgba(182, 248, 255, .95)'; cb.textAlign = 'center'; cb.textBaseline = 'middle';
    [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['O', -1, 0]].forEach(([t, a, b]) => cb.fillText(t, cx + a * (R - 22 * s), cy + b * (R - 22 * s)));
    // il luogo: un mirino dove sta, anche se la vista si è spostata
    const [ux, uy] = schermo(u[0], u[1], k);
    if (Math.hypot(ux - cx, uy - cy) < R) {
      cb.strokeStyle = 'rgba(61, 255, 208, .95)'; cb.lineWidth = 1.5 * s;
      cb.beginPath(); cb.arc(ux, uy, 6 * s, 0, 2 * Math.PI); cb.stroke();
      cb.beginPath(); cb.moveTo(ux - 13 * s, uy); cb.lineTo(ux - 8 * s, uy); cb.moveTo(ux + 8 * s, uy); cb.lineTo(ux + 13 * s, uy);
      cb.moveTo(ux, uy - 13 * s); cb.lineTo(ux, uy - 8 * s); cb.moveTo(ux, uy + 8 * s); cb.lineTo(ux, uy + 13 * s); cb.stroke();
      cb.font = `400 ${9 * s}px Menlo, monospace`; cb.fillStyle = 'rgba(61, 255, 208, .95)'; cb.textAlign = 'left'; cb.textBaseline = 'middle';
      scritta((luogo?.nome || '').toUpperCase(), ux + 16 * s, uy - 9 * s, 'rgba(61, 255, 208, .95)');
    }
  }
  function disegnaMappa(m, k) {
    const s = dpr, mx = W / 2 / k, my = Hh / 2 / k, x0 = centro[0] - mx, x1 = centro[0] + mx, y0 = centro[1] - my, y1 = centro[1] + my;
    const tratti = [['laghi', 'rgba(62, 230, 255, .32)', []], ['confini', 'rgba(62, 230, 255, .3)', [3 * s, 4 * s]], ['coste', 'rgba(62, 230, 255, .6)', []]];
    for (const [tipo, colore, trat] of tratti) {
      cb.strokeStyle = colore; cb.lineWidth = 1.1 * s; cb.setLineDash(trat); cb.beginPath();
      for (const l of m.linee[tipo]) {
        if (l.x1 < x0 || l.x0 > x1 || l.y1 < y0 || l.y0 > y1) continue;
        const p = l.p;
        cb.moveTo((p[0] - centro[0]) * k + W / 2, (p[1] - centro[1]) * k + Hh / 2);
        for (let i = 2; i < p.length; i += 2) cb.lineTo((p[i] - centro[0]) * k + W / 2, (p[i + 1] - centro[1]) * k + Hh / 2);
      }
      cb.stroke();
    }
    cb.setLineDash([]);
    // al massimo 14 città, le più grandi, senza scritte una sopra l'altra
    cb.font = `400 ${8.5 * s}px Menlo, monospace`; cb.textAlign = 'left'; cb.textBaseline = 'middle';
    const prese = [], R = Math.min(W, Hh) / 2;
    for (const c of m.citta) {
      if (prese.length >= 14) break;
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      const x = (c.x - centro[0]) * k + W / 2, y = (c.y - centro[1]) * k + Hh / 2;
      if (Math.hypot(x - W / 2, y - Hh / 2) > R - 30 * s || (luogo && c.nome === luogo.nome.toUpperCase())) continue;
      const w = cb.measureText(c.nome).width + 10 * s, r = [x - 4 * s, y - 7 * s, x + w, y + 7 * s];
      if (prese.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      prese.push(r);
      cb.fillStyle = 'rgba(210, 251, 255, .9)'; cb.fillRect(x - 1.5 * s, y - 1.5 * s, 3 * s, 3 * s);
      scritta(c.nome, x + 5 * s, y, 'rgba(210, 251, 255, .88)');
    }
  }

  // ---------------------------------------------------------------- cosa dice la mappa mostrata, attorno al luogo
  // L'eco sopra il luogo e la più vicina (almeno 15 dBZ, pioggia debole) dentro il cerchio, con distanza e direzione
  function analizza(fr) {
    if (!fr?.pronta) return null;
    const n = 2 ** fr.s.z, px = u[0] * n * LATO - fr.s.x0 * LATO, py = u[1] * n * LATO - fr.s.y0 * LATO;
    const kmPx = (KM_TERRA * Math.cos((luogo.lat * Math.PI) / 180)) / (n * LATO), rPx = raggio / kmPx;
    const ix = Math.round(px), iy = Math.round(py);
    const dentro = ix >= 0 && iy >= 0 && ix < fr.w && iy < fr.h;
    const sopra = dentro && fr.dbz[iy * fr.w + ix] ? fr.dbz[iy * fr.w + ix] - 32 : null;
    let best = Infinity, bx = 0, by = 0;
    const ya = Math.max(0, Math.floor(py - rPx)), yb = Math.min(fr.h - 1, Math.ceil(py + rPx)), xa = Math.max(0, Math.floor(px - rPx)), xb = Math.min(fr.w - 1, Math.ceil(px + rPx));
    for (let y = ya; y <= yb; y++) {
      const dy = y - py, riga = y * fr.w;
      if (dy * dy >= best) continue;
      for (let x = xa; x <= xb; x++) {
        if (fr.dbz[riga + x] < 47) continue; // 15 dBZ + 32
        const dx = x - px, d = dx * dx + dy * dy;
        if (d < best) { best = d; bx = x; by = y; }
      }
    }
    const km = Math.sqrt(best) * kmPx;
    const vicina = best < Infinity && km <= raggio ? { km, gradi: ((Math.atan2(bx - px, -(by - py)) * 180) / Math.PI + 360) % 360, dbz: fr.dbz[by * fr.w + bx] - 32 } : null;
    return { sopra, vicina };
  }

  function mostra(i, forza = false) {
    if (i < 0 || i >= lista.length || (i === mostrata && !forza)) return;
    mostrata = i;
    disegnaEco();
    analisi = analizza(lista[i]);
    informa();
  }
  function informa() {
    const fr = lista[mostrata];
    onInfo({ t: fr?.t ?? null, indice: mostrata, n: lista.length, ultima: lista[lista.length - 1]?.t ?? null, scaricate, totali, errore, analisi, raggio, live: tempoScelto === null });
  }

  // Il giro delle ultime 2 ore: mezzo secondo per mappa, un secondo e mezzo fermo sull'ultima. Solo con le mappe pronte.
  function anima() {
    clearTimeout(giro);
    if (!attivo || tempoScelto !== null) return;
    const pronte = lista.map((f, i) => (f.pronta ? i : -1)).filter((i) => i >= 0);
    if (pronte.length) {
      const dopo = pronte.find((i) => i > mostrata), prossima = mostrata === pronte[pronte.length - 1] ? pronte[0] : dopo ?? pronte[pronte.length - 1];
      mostra(prossima);
    }
    giro = setTimeout(anima, mostrata === lista.length - 1 ? 1500 : 500);
  }

  function ridimensiona() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const r = eco.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width * dpr)); Hh = Math.max(1, Math.round(r.height * dpr));
    for (const c of [eco, base]) { if (c.width !== W) c.width = W; if (c.height !== Hh) c.height = Hh; }
    disegnaEco(); disegnaBase();
  }

  let ritardo = 0;
  const dopoVista = () => { disegnaEco(); disegnaBase(); clearTimeout(ritardo); ritardo = setTimeout(() => carica(), 300); };

  return {
    async avvia(l) {
      const nuovo = !luogo || l.lat !== luogo.lat || l.lon !== luogo.lon;
      luogo = l; u = merc(l.lon, l.lat);
      if (nuovo || !attivo) { centro = [...u]; raggio = RAGGIO.base; }
      attivo = true;
      ridimensiona();
      caricaMappa().then((m) => { carta = m; disegnaBase(); }, (e) => console.warn('[meteo] mappa', e));
      if (await leggiMappe()) { if (mostrata < 0 || mostrata >= lista.length) mostrata = lista.length - 1; carica(nuovo); }
      anima(); // gira sulle mappe già pronte, che arrivano dall'ultima alla prima
      clearInterval(aggiornaTimer);
      aggiornaTimer = setInterval(async () => { if (await leggiMappe()) { mostrata = Math.min(mostrata, lista.length - 1); carica(true); } }, 5 * 60_000);
    },
    ferma() { attivo = false; gen++; clearTimeout(giro); clearInterval(aggiornaTimer); clearTimeout(ritardo); },
    ridimensiona,
    // null: il giro delle ultime 2 ore. Un istante: la mappa più vicina prima di lui (o la prima)
    tempo(t) {
      tempoScelto = t;
      if (t === null) { anima(); return; }
      clearTimeout(giro);
      let i = 0;
      lista.forEach((f, j) => { if (f.t <= t) i = j; });
      mostra(i);
      informa();
    },
    sposta(dx, dy) { // in pixel CSS: la mappa segue la mano o il mouse
      const k = pxPerNorm() / dpr;
      centro = [centro[0] - dx / k, Math.max(0.02, Math.min(0.98, centro[1] - dy / k))];
      dopoVista();
    },
    zoom(f) {
      if (!(f > 0) || !Number.isFinite(f)) return;
      raggio = Math.max(RAGGIO.min, Math.min(RAGGIO.max, raggio / f));
      dopoVista(); analisi = analizza(lista[mostrata]); informa();
    },
    reimposta() { centro = [...u]; raggio = RAGGIO.base; dopoVista(); analisi = analizza(lista[mostrata]); informa(); },
    get stato() { return { raggio, centro: [...centro], mostrata, n: lista.length, scaricate, set: set?.chiave ?? null, errore }; },
  };
}
