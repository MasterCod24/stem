// Il radar della vista meteo: le piogge vere di RainViewer (ultime 2 ore, una mappa ogni 10 minuti) ricolorate coi colori
// dell'HUD a fasce di 5 dBZ con il bordo acceso, come curve di livello. È riflettività (dove piove e quanto), non Doppler:
// RainViewer non dà la velocità del vento. Le mattonelle arrivano dirette da RainViewer (CORS aperto, cache di 2 giorni):
// l'unica cosa che la vista chiede fuori da O.S.C.A.R.
// Qui solo i dati: quali mattonelle servono alla vista del globo, scaricarle, ricolorarle, l'eco attorno al luogo e il giro
// delle ultime 2 ore. Ogni mappa pronta è un canvas in Mercatore (fr.tela) con il suo riquadro (fr.s): globo.js la proietta
// sulla sfera. Fino al 12/11 qui c'era anche il disegno del radar piatto.

const MAPPE = 'https://api.rainviewer.com/public/weather-maps.json';
const Z_MAX = 7;          // misurato il 12/11: dallo zoom 8 RainViewer risponde con «Zoom Level Not Supported»
const LATO = 256;
const KM_TERRA = 40075.016686;
const PARALLELI = 8;      // mattonelle scaricate insieme
const ECO_MAX_KM = 1500;  // l'eco più vicina si cerca entro il raggio della vista, al massimo questo

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

// onInfo(info) quando cambia la mappa mostrata o lo stato dello scaricamento; onMappa(fr) quando cambia la mappa da mostrare
// (fr.tela, il canvas ricolorato, e fr.s, le sue mattonelle), o null se non ce n'è una pronta
export function createRadar({ onInfo = () => {}, onMappa = () => {} }) {
  let luogo = null, u = [0, 0];                        // il luogo e il suo punto nel mercatore
  // la vista del globo: il punto guardato, i km da lì al bordo alto del riquadro, larghezza su altezza, i pixel del canvas
  // da lì al bordo, e quanto è inclinata (0 dall'alto, 1 la massima: si vede lontano verso nord)
  let vista = { lon: 0, lat: 0, raggio: 150, aspetto: 1, pxMezzo: 600, inclina: 0 };
  let lista = [], host = '', mostrata = -1, tempoScelto = null, errore = '';
  let set = null, gen = 0, giro = 0, aggiornaTimer = 0, scaricate = 0, totali = 0, attivo = false, analisi = null;
  const raggioEco = () => Math.min(ECO_MAX_KM, vista.raggio);

  // Le mattonelle che servono alla vista: zoom e riquadro, con un margine per spostarsi senza riscaricare. Inclinata, la
  // camera vede fino a circa 2,2 volte il raggio verso nord e più larga in alto. Al massimo 4×4 per mappa: oltre, lo zoom
  // scende di uno (13 mappe da 1024×1024 px sono già 54 MB). Da lontano il mondo intero allo zoom 2, 16 mattonelle.
  function serve() {
    const { lon, lat, raggio, aspetto, pxMezzo, inclina } = vista;
    const kmNorm = KM_TERRA * Math.cos((lat * Math.PI) / 180);        // km per unità del mercatore a quella latitudine
    const mezzoKm = raggio * Math.max(1, aspetto) * (1.3 + 1.1 * inclina);
    const span = (2 * mezzoKm) / kmNorm;
    if (span >= 0.75 || raggio > 3000) return { z: 2, x0: 0, nx: 4, y0: 0, ny: 4, chiave: 'mondo' };
    const [cx, cy] = merc(lon, Math.min(85, lat + (raggio * 0.5 * inclina) / 111.195));
    const pxNorm = (pxMezzo / raggio) * kmNorm;                       // pixel del canvas per unità del mercatore
    const z = Math.max(2, Math.min(Z_MAX, Math.floor(Math.log2(3 / span)), Math.round(Math.log2(pxNorm / LATO))));
    const n = 2 ** z, mezzo = span / 2, a = Math.floor((cx - mezzo) * n), b = Math.floor((cx + mezzo) * n);
    const c = Math.max(0, Math.floor((cy - mezzo) * n)), d = Math.min(n - 1, Math.floor((cy + mezzo) * n));
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

  // ---------------------------------------------------------------- cosa dice la mappa mostrata, attorno al luogo
  // L'eco sopra il luogo e la più vicina (almeno 15 dBZ, pioggia debole) dentro il cerchio, con distanza e direzione
  function analizza(fr) {
    if (!fr?.pronta) return null;
    const n = 2 ** fr.s.z, px = u[0] * n * LATO - fr.s.x0 * LATO, py = u[1] * n * LATO - fr.s.y0 * LATO;
    const kmPx = (KM_TERRA * Math.cos((luogo.lat * Math.PI) / 180)) / (n * LATO), raggio = raggioEco(), rPx = raggio / kmPx;
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
    onMappa(lista[i]?.pronta ? lista[i] : null);
    analisi = analizza(lista[i]);
    informa();
  }
  function informa() {
    const fr = lista[mostrata];
    onInfo({ t: fr?.t ?? null, indice: mostrata, n: lista.length, ultima: lista[lista.length - 1]?.t ?? null, scaricate, totali, errore, analisi, raggio: raggioEco(), live: tempoScelto === null });
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

  let ritardo = 0;

  return {
    // v: la vista da cui partire (la stessa forma di vista()), già quella d'arrivo se il globo ci sta volando
    async avvia(l, v) {
      const nuovo = !luogo || l.lat !== luogo.lat || l.lon !== luogo.lon;
      luogo = l; u = merc(l.lon, l.lat);
      if (v) vista = { ...vista, ...v };
      attivo = true;
      if (await leggiMappe()) { if (mostrata < 0 || mostrata >= lista.length) mostrata = lista.length - 1; carica(nuovo); }
      anima(); // gira sulle mappe già pronte, che arrivano dall'ultima alla prima
      clearInterval(aggiornaTimer);
      aggiornaTimer = setInterval(async () => { if (await leggiMappe()) { mostrata = Math.min(mostrata, lista.length - 1); carica(true); } }, 5 * 60_000);
    },
    ferma() { attivo = false; gen++; clearTimeout(giro); clearInterval(aggiornaTimer); clearTimeout(ritardo); },
    // La vista del globo è cambiata: le mattonelle si riscaricano 300 ms dopo l'ultimo cambio, e solo se servono altre
    vista(v) {
      const r0 = raggioEco();
      vista = { ...vista, ...v };
      clearTimeout(ritardo); ritardo = setTimeout(() => carica(), 300);
      if (raggioEco() !== r0) { analisi = analizza(lista[mostrata]); informa(); }
    },
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
    get stato() { return { mostrata, n: lista.length, scaricate, set: set?.chiave ?? null, errore }; },
  };
}
