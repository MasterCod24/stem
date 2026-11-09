// I gesti delle mani, calcolati dai 21 punti di MediaPipe senza DOM: gira nell'HUD (mani.js) e in Node (prove/gesti.mjs).
// Ingresso: mani = [{ lato: 'Left'|'Right', punti: [{x, y, z}] × 21 }], x e y normalizzate 0..1 dell'immagine già
// specchiata. Dentro si conta in «altezze d'immagine» (x·aspetto, y): le distanze sono pixel veri a meno di un fattore,
// così pizzico e palmo non dipendono dalle proporzioni. In uscita x, y, dx, dy, vx, vy sono frazioni dello schermo
// (vx e vy al secondo), come il mouse in scena.js.
//
// Una mano, col pizzico di pollice e indice:
// - pizzico e subito trascinamento: 'ruota';
// - pizzico fermo per presa_ms: 'afferra' dove l'indice puntava prima di chiudersi, poi 'sposta', e aprendo le dita
//   'lascia', oppure 'lancia' se in quel momento la mano corre oltre lancio_mm_s;
// - pizzico breve e fermo: 'afferra' e 'lascia' insieme, cioè un clic che seleziona.
// Due mani: due pizzichi fanno 'zoom', due palmi aperti 'esplodi'. scena.js non sa dire se sotto il cursore c'è un
// pezzo, quindi ruotare e afferrare si distinguono dal tempo: chi vuole ruotare si muove subito.

export const PREDEFINITI = Object.freeze({
  aspetto: 4 / 3,       // larghezza / altezza dell'immagine: la fotocamera a 640×480
  chiuso: 0.25,         // pizzico come MRTK3: d(pollice 4, indice 8) / lunghezza dell'indice 5→6→7→8
  aperto: 0.75,         // fra le due soglie non cambia niente: è l'isteresi
  mincutoff: 1,         // One Euro, Hz a mano ferma (Casiez, Roussel e Vogel, CHI 2012: si parte da 1 Hz)
  beta: 5,              // quanto sale il taglio con la velocità, per altezza d'immagine al secondo (tarato in prove/gesti.mjs)
  dcutoff: 1,           // Hz del filtro sulla velocità, come nelle implementazioni di riferimento
  stabile: 4,           // fotogrammi di fila prima che una mano nuova dia gesti
  assente_ms: 150,      // una mano sparita da più tempo chiude il suo gesto; un buco di un fotogramma no
  salto_palmi: 3,       // una mano ricomparsa più lontano di così è un'altra mano
  margine: 0.1,         // ai bordi dell'immagine la mano esce: la fascia 0,1–0,9 copre tutto lo schermo
  presa_ms: 350,        // pizzico fermo così a lungo: afferra
  fermo_palmi: 0.25,    // «fermo»: la punta dell'indice resta entro un quarto di palmo da dove si è chiusa
  mira_ms: 300,         // si afferra dove l'indice puntava prima di chiudersi, se è successo così di recente
  palmo_mm: 90,         // polso→nocca del medio (punti 0→9) di un adulto, stima anatomica: dà i mm alla velocità del
                        // lancio. I punti del mondo di MediaPipe dicono 61 mm, ma sono una mano di scala fissa
  lancio_mm_s: 1000,    // Leap Motion SDK v2: un colpo è almeno 150 mm a 1000 mm/s
  lancio_ms: 150,       // la finestra della velocità al rilascio: 150 mm a 1 m/s
  dito_steso: 1.5,      // dito steso: la punta dista dal polso più di 1,5 volte la sua nocca (piegato è sotto 1,1)
  esplodi_palmi: 3,     // allargare i palmi di 3 palmi porta l'esploso da 0 a 1
  esplodi_soglia: 0.2,  // palmi prima di partire: due mani aperte e ferme non esplodono
});

const DITA = [[5, 8], [9, 12], [13, 16], [17, 20]]; // nocca e punta di indice, medio, anulare e mignolo
const PALMO = [0, 5, 9, 13, 17];                     // polso e nocche: restano fermi quando le dita si aprono
const alfa = (fc, dt) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function leggiOpzioni(opzioni) {
  const o = { ...PREDEFINITI };
  for (const k of Object.keys(PREDEFINITI)) {
    const v = opzioni?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`gesti: l'opzione ${k} vuole un numero ≥ 0`);
    o[k] = v;
  }
  if (!(o.chiuso < o.aperto) || !(o.margine < 0.5) || !(o.stabile >= 1)
    || ['aspetto', 'mincutoff', 'dcutoff', 'palmo_mm', 'lancio_ms', 'esplodi_palmi', 'salto_palmi'].some((k) => !(o[k] > 0)))
    throw new Error('gesti: opzioni incoerenti (chiuso < aperto, margine < 0,5, stabile ≥ 1, scale > 0)');
  return o;
}

export function createGesti(opzioni) {
  const o = leggiOpzioni(opzioni), k = 1 / (1 - 2 * o.margine);
  let tracce = [], due = null, ultimo = -Infinity, nuovoId = 1;

  const schermo = (X, Y) => ({ x: clamp01((X / o.aspetto - o.margine) * k), y: clamp01((Y - o.margine) * k) });
  const spostamento = (dX, dY) => ({ dx: (dX / o.aspetto) * k, dy: dY * k });

  // Solo mani con 21 punti numerici dentro un'immagine allargata: NaN, Infinity e stringhe non passano. Al massimo due.
  function leggi(mani) {
    const v = [];
    if (!Array.isArray(mani)) return v;
    for (const m of mani) {
      if (v.length === 2) break;
      const p = m && m.punti;
      if (!Array.isArray(p) || p.length !== 21) continue;
      const X = new Float64Array(21), Y = new Float64Array(21);
      let ok = true;
      for (let i = 0; i < 21 && ok; i++) {
        const x = p[i] && p[i].x, y = p[i] && p[i].y;
        ok = typeof x === 'number' && typeof y === 'number' && x >= -1 && x <= 2 && y >= -1 && y <= 2;
        X[i] = x * o.aspetto; Y[i] = y;
      }
      const palmo = ok ? Math.hypot(X[9] - X[0], Y[9] - Y[0]) : 0;
      if (!(palmo >= 0.01)) continue; // un palmo sotto l'1% dell'altezza è un errore, e farebbe divisioni enormi
      let cx = 0, cy = 0;
      for (const i of PALMO) { cx += X[i] / 5; cy += Y[i] / 5; }
      v.push({ lato: m.lato === 'Left' || m.lato === 'Right' ? m.lato : null, X, Y, palmo, cx, cy, tr: null });
    }
    return v;
  }

  const nuovaTraccia = (m) => ({
    id: nuovoId++, lato: m.lato, n: 0, visto: -Infinity, pronta: false,
    X: new Float64Array(21), Y: new Float64Array(21), dX: new Float64Array(21), dY: new Float64Array(21),
    palmo: m.palmo, r: 1, pizzico: false, aperta: false, consumato: false, modo: null,
    ix: 0, iy: 0, fx: 0, fy: 0, cx: m.cx, cy: m.cy, storia: [], mira: null, tMira: -Infinity,
  });

  // One Euro su ogni punto: il taglio sale con la velocità del punto (una sola per punto, non per asse), così la mano
  // ferma non trema e quella veloce non resta indietro.
  function nutri(tr, m, t) {
    const dt = (t - tr.visto) / 1000, ad = alfa(o.dcutoff, dt);
    for (let i = 0; i < 21; i++) {
      if (!tr.pronta) { tr.X[i] = m.X[i]; tr.Y[i] = m.Y[i]; continue; }
      tr.dX[i] += ad * ((m.X[i] - tr.X[i]) / dt - tr.dX[i]);
      tr.dY[i] += ad * ((m.Y[i] - tr.Y[i]) / dt - tr.dY[i]);
      const a = alfa(o.mincutoff + o.beta * Math.hypot(tr.dX[i], tr.dY[i]), dt);
      tr.X[i] += a * (m.X[i] - tr.X[i]); tr.Y[i] += a * (m.Y[i] - tr.Y[i]);
    }
    tr.pronta = true;
    const d = (a, b) => Math.hypot(tr.X[a] - tr.X[b], tr.Y[a] - tr.Y[b]);
    tr.palmo = Math.max(d(0, 9), 1e-3);
    tr.r = d(4, 8) / Math.max(d(5, 6) + d(6, 7) + d(7, 8), 1e-6);
    if (tr.pizzico ? tr.r > o.aperto : tr.r < o.chiuso) tr.pizzico = !tr.pizzico;
    tr.aperta = !tr.pizzico && DITA.every(([n, p]) => d(0, p) > o.dito_steso * d(0, n));
    tr.ix = tr.X[8]; tr.iy = tr.Y[8];
    tr.fx = 0; tr.fy = 0;
    for (const i of PALMO) { tr.fx += tr.X[i] / 5; tr.fy += tr.Y[i] / 5; }
    // la velocità del lancio si misura sul centro del palmo grezzo: all'inizio di un colpo il filtro è ancora indietro
    tr.cx = m.cx; tr.cy = m.cy;
    tr.storia.push([t, m.cx, m.cy]);
    while (tr.storia.length > 2 && tr.storia[1][0] <= t - o.lancio_ms) tr.storia.shift(); // ne resta uno prima della finestra
    if (!tr.pizzico && tr.r >= o.aperto) { tr.mira = [tr.ix, tr.iy]; tr.tMira = t; }
    if (!tr.pizzico) tr.consumato = false;
    else if (tr.n < o.stabile) tr.consumato = true; // comparsa già chiusa: prima di un gesto deve aprirsi
    if (!tr.lato) tr.lato = m.lato;
    tr.n++; tr.visto = t;
  }

  function chiudiUna(tr, out) {
    if (tr.modo === 'presa') out.push({ tipo: 'lascia' });
    tr.modo = null; // un'attesa si annulla senza clic, una rotazione si ferma
  }

  function fineDue() {
    if (due.tipo === 'zoom') due.a.consumato = due.b.consumato = true; // la mano ancora chiusa non comincia a ruotare
    due = null;
  }

  // Fra i centri dei palmi, non fra le punte: mentre il pizzico si chiude le punte si muovono ancora, e misurate lì
  // davano il 3,7% di zoom indietro finto (prove/gesti.mjs). Per esplodi in palmi; per lo zoom conta solo il rapporto.
  const misuraDue = (tipo, A, B) => {
    const palmo = (A.palmo + B.palmo) / 2, d = Math.hypot(A.fx - B.fx, A.fy - B.fy);
    return tipo === 'zoom' ? Math.max(d, palmo / 2) : d / palmo; // mani a contatto non fanno fattori enormi
  };

  function dueMani(A, B, out) {
    const zoom = A.pizzico && B.pizzico, esplodi = A.aperta && B.aperta;
    if (due && !(due.tipo === 'zoom' ? zoom : esplodi)) fineDue();
    if (!due) {
      if (!zoom && !esplodi) return;
      chiudiUna(A, out); chiudiUna(B, out);
      const tipo = zoom ? 'zoom' : 'esplodi';
      due = { tipo, a: A, b: B, rif: misuraDue(tipo, A, B), partito: zoom };
      return;
    }
    const m = misuraDue(due.tipo, A, B);
    if (!due.partito) {
      if (Math.abs(m - due.rif) < o.esplodi_soglia) return;
      due.partito = true; // il primo passo porta anche la soglia: niente movimento perso
    }
    if (m === due.rif) return;
    out.push(due.tipo === 'zoom' ? { tipo: 'zoom', fattore: m / due.rif } : { tipo: 'esplodi', delta: (m - due.rif) / o.esplodi_palmi });
    due.rif = m;
  }

  function rilascio(tr) {
    const s = tr.storia, a = s[0], b = s[s.length - 1], dt = (b[0] - a[0]) / 1000;
    if (!(dt >= o.lancio_ms / 2000)) return { tipo: 'lascia' }; // troppo poca storia per dire
    const vX = (b[1] - a[1]) / dt, vY = (b[2] - a[2]) / dt;     // altezze d'immagine al secondo
    if (Math.hypot(vX, vY) * (o.palmo_mm / tr.palmo) < o.lancio_mm_s) return { tipo: 'lascia' };
    const v = spostamento(vX, vY);
    return { tipo: 'lancia', ...schermo(tr.ix, tr.iy), vx: v.dx, vy: v.dy };
  }

  function unaMano(tr, t, out) {
    if (!tr.modo) {
      if (!tr.pizzico || tr.consumato) return;
      const mira = tr.mira && t - tr.tMira <= o.mira_ms ? tr.mira : [tr.ix, tr.iy];
      Object.assign(tr, { modo: 'attesa', t0: t, x0: tr.ix, y0: tr.iy, px: mira[0], py: mira[1] });
      return;
    }
    if (!tr.pizzico) { // le dita si sono aperte
      if (tr.modo === 'attesa') out.push({ tipo: 'afferra', ...schermo(tr.px, tr.py) }, { tipo: 'lascia' });
      else if (tr.modo === 'presa') out.push(rilascio(tr));
      tr.modo = null;
      return;
    }
    if (tr.modo === 'attesa') {
      if (Math.hypot(tr.ix - tr.x0, tr.iy - tr.y0) > o.fermo_palmi * tr.palmo) {
        tr.modo = 'ruota'; tr.ux = tr.x0; tr.uy = tr.y0; // il tratto fatto per decidere ruota anche lui
      } else {
        if (t - tr.t0 < o.presa_ms) return;
        tr.modo = 'presa'; tr.ux = tr.ix; tr.uy = tr.iy;
        out.push({ tipo: 'afferra', ...schermo(tr.px, tr.py) });
        return;
      }
    }
    const d = spostamento(tr.ix - tr.ux, tr.iy - tr.uy);
    tr.ux = tr.ix; tr.uy = tr.iy;
    if (d.dx || d.dy) out.push({ tipo: tr.modo === 'ruota' ? 'ruota' : 'sposta', ...d });
  }

  function chiudi(tr, out) { // una mano sparita da più di assente_ms
    chiudiUna(tr, out);
    if (due && (due.a === tr || due.b === tr)) fineDue();
  }

  function aggiorna(mani, t_ms) {
    if (typeof t_ms !== 'number' || !Number.isFinite(t_ms) || t_ms <= ultimo) return [];
    const t = (ultimo = t_ms), prima = [], dopo = [];
    tracce = tracce.filter((tr) => t - tr.visto <= o.assente_ms || (chiudi(tr, prima), false));

    // ogni mano alla traccia più vicina per centro del palmo, meglio se dello stesso lato (MediaPipe a volte lo scambia)
    const nuove = leggi(mani), coppie = [], prese = new Set();
    nuove.forEach((m, i) => tracce.forEach((tr) => {
      const c = Math.hypot(m.cx - tr.cx, m.cy - tr.cy) / tr.palmo + (m.lato && tr.lato && m.lato !== tr.lato ? 1 : 0);
      if (c <= o.salto_palmi) coppie.push([c, i, tr]);
    }));
    coppie.sort((a, b) => a[0] - b[0]);
    for (const [, i, tr] of coppie) if (!nuove[i].tr && !prese.has(tr)) { nuove[i].tr = tr; prese.add(tr); }
    for (const m of nuove) {
      if (!m.tr) tracce.push((m.tr = nuovaTraccia(m)));
      nutri(m.tr, m, t);
    }

    const stabili = tracce.filter((tr) => tr.visto === t && tr.n >= o.stabile);
    // con una delle due mani assente da poco il gesto a due aspetta; se scade, chiudi() l'ha già finito
    if (!due || (stabili.includes(due.a) && stabili.includes(due.b))) {
      const [A, B] = due ? [due.a, due.b] : stabili;
      if (B) dueMani(A, B, dopo);
    }
    for (const tr of stabili) if (!due || (tr !== due.a && tr !== due.b)) unaMano(tr, t, dopo);

    const c = stabili.find((tr) => tr.modo) || stabili[0]; // un cursore solo: scena.js ne disegna uno
    if (c) prima.push({ tipo: 'cursore', ...schermo(c.ix, c.iy), mano: c.lato });
    return prima.concat(dopo);
  }

  function azzera() { tracce = []; due = null; ultimo = -Infinity; }

  // per le prove e per il lab: lo stato di ogni mano, senza i punti
  function stato() {
    return {
      due: due ? due.tipo : null,
      mani: tracce.map((tr) => ({ id: tr.id, lato: tr.lato, rapporto: tr.r, pizzico: tr.pizzico, aperta: tr.aperta, stabile: tr.n >= o.stabile, modo: tr.modo, consumato: tr.consumato })),
    };
  }

  return { aggiorna, azzera, stato };
}
