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
//
// Sopra i gesti c'è una macchina a tre fasi, una sola per tutte le mani (evento 'stato'):
// - 'riposo': non esce niente, nemmeno il cursore. Una mano davanti alla fotocamera per caso non muove il modello;
// - 'pronto': dopo un palmo aperto mostrato per innesco_ms dentro la zona attiva. Cursore e gesti;
// - 'azione': finché un gesto continuo è in corso (ruota, presa, zoom o esplodi partiti), o nel fotogramma di un clic.
// Da 'pronto' si torna a 'riposo' dopo riposo_ms senza gesti e senza palmi aperti. Da 'riposo' ad 'azione' non si passa mai.
//
// Delle 12 regole chieste da Tony il 10/11 qui c'è quello che si è potuto provare; cosa non si è fatto e perché sta nel
// contratto (LEGGIMI-ologramma.md, «I gesti»). Le soglie nuove sono numeri suoi, non misurati: misure() conta nell'uso
// vero quello che serve a tararle.

export const PREDEFINITI = Object.freeze({
  aspetto: 4 / 3,       // larghezza / altezza dell'immagine: la fotocamera a 640×480
  chiuso: 0.25,         // pizzico come MRTK3: d(pollice 4, indice 8) / lunghezza dell'indice 5→6→7→8
  aperto: 0.75,         // fra le due soglie non cambia niente: è l'isteresi
  mincutoff: 1,         // One Euro, Hz a mano ferma (Casiez, Roussel e Vogel, CHI 2012: si parte da 1 Hz)
  beta: 5,              // quanto sale il taglio con la velocità, per altezza d'immagine al secondo (tarato in prove/gesti.mjs)
  dcutoff: 1,           // Hz del filtro sulla velocità, come nelle implementazioni di riferimento
  stabile: 4,           // fotogrammi di fila prima che una mano nuova dia gesti
  assente_ms: 170,      // una mano sparita da più tempo chiude il suo gesto. Numero di Tony, non misurato: «meno di 5
                        // fotogrammi», cioè fino a 4 mancanti a 30 al secondo (167 ms). Quanti buchi ci sono lo conta misure()
  salto_palmi: 3,       // una mano ricomparsa più lontano di così è un'altra mano
  margine: 0.1,         // ai bordi dell'immagine la mano esce: la fascia 0,1–0,9 copre tutto lo schermo
  curva: 0.5,           // la mappa a S di mappa(): 0 è lineare, com'era. A 0,5 il centro dello schermo va a metà velocità
                        // e i bordi al doppio. Numero scelto il 10/11 sulla richiesta di Tony, non misurato su di lui
  zona_morta: 0.00625,  // raggio, in altezze d'immagine, entro cui cursore e centro del palmo non seguono il punto
                        // filtrato: 3 pixel su 480. Numero di Tony, non misurato
  zona: 0.7,            // la zona attiva: un gesto parte, e l'innesco vale, solo col centro del palmo in questa parte
                        // centrale dell'immagine, in x e in y. Numero di Tony, non misurato
  profilo_gradi: 75,    // oltre questa inclinazione fra la normale del palmo e l'asse della fotocamera la mano è di
                        // profilo, e non vale come palmo aperto. Numero di Tony, non misurato su di lui
  innesco_ms: 300,      // palmo aperto mostrato così a lungo: da 'riposo' a 'pronto'. 0 vuol dire sempre pronto.
                        // Numero scelto il 10/11, non misurato
  riposo_ms: 4000,      // senza gesti e senza palmi aperti così a lungo: da 'pronto' a 'riposo'. Scelto il 10/11, non misurato
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
const FERMO_V = 0.05;   // altezze d'immagine al secondo: sotto, il palmo è «fermo» e il tremolio si misura (24 px/s su 480)
const SALTO_U = 0.5;    // in palmi: una punta che si sposta di più rispetto al palmo in un fotogramma è un salto, non un dito
const MINIMI_MAX = 2000; // pizzichi tenuti per la mediana della distanza minima
const alfa = (fc, dt) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// La mappa dalla mano allo schermo, una sola per cursore, gesti e pallini delle dita (nexus.js). n è una coordinata
// normalizzata 0..1 dell'immagine; ne esce la posizione sullo schermo, 0..1 dentro la fascia margine…1−margine e oltre
// fuori (chi vuole un punto sullo schermo la limita). Con u da −1 a 1 la posizione lineare, f(u) = (1−c)·u + c·u³:
// al centro il guadagno è 1−c (più preciso), ai bordi 1+2c, e i bordi restano dove sono. Fuori da ±1 prosegue dritta con
// la pendenza del bordo. Tony aveva chiesto una curva «sigmoidale»: una sigmoide vera sulla posizione è ripida al centro
// e piatta ai bordi, il contrario di quello che descriveva, quindi la forma è questa.
export function mappa(n, margine = PREDEFINITI.margine, curva = PREDEFINITI.curva) {
  const u = (2 * (n - margine)) / (1 - 2 * margine) - 1, a = Math.abs(u);
  const f = a <= 1 ? (1 - curva) * u + curva * u * u * u : Math.sign(u) * (1 + (1 + 2 * curva) * (a - 1));
  return (f + 1) / 2;
}

// La normale del triangolo a, b, c ([x, y, z] nella stessa unità), lunga 1; un triangolo senza area guarda la fotocamera.
export function normale(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : [0, 0, 1];
}
// L'angolo in gradi fra una normale e l'asse della fotocamera: 0 il palmo (o il dorso) di fronte, 90 di taglio.
// Palmo e dorso non si distinguono apposta: dipenderebbe dal lato che dice MediaPipe, che a volte lo scambia.
export function inclinazione(n) {
  const l = Math.hypot(n[0], n[1], n[2]);
  return l > 1e-12 ? (Math.acos(Math.min(1, Math.abs(n[2]) / l)) * 180) / Math.PI : 0;
}

function leggiOpzioni(opzioni) {
  const o = { ...PREDEFINITI };
  for (const k of Object.keys(PREDEFINITI)) {
    const v = opzioni?.[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`gesti: l'opzione ${k} vuole un numero ≥ 0`);
    o[k] = v;
  }
  if (!(o.chiuso < o.aperto) || !(o.margine < 0.5) || !(o.stabile >= 1) || !(o.curva < 1) || !(o.zona <= 1) || !(o.profilo_gradi <= 90)
    // riposo_ms 0 con l'innesco faceva sfarfallare riposo e pronto ogni innesco_ms (prova del revisore dell'11/11)
    || ['aspetto', 'mincutoff', 'dcutoff', 'palmo_mm', 'lancio_ms', 'esplodi_palmi', 'salto_palmi', 'zona', 'riposo_ms'].some((k) => !(o[k] > 0)))
    throw new Error('gesti: opzioni incoerenti (chiuso < aperto, margine < 0,5, stabile ≥ 1, curva < 1, zona ≤ 1, profilo ≤ 90°, scale e riposo_ms > 0)');
  return o;
}

export function createGesti(opzioni) {
  const o = leggiOpzioni(opzioni), FASE0 = o.innesco_ms > 0 ? 'riposo' : 'pronto';
  let tracce = [], due = null, ultimo = -Infinity, nuovoId = 1;
  let fase = FASE0, detta = false, tAttivo = -Infinity; // detta: la fase è già uscita come evento
  // Le misure d'uso vero: solo conti e somme, mai punti né posizioni
  const vuote = () => ({ ms: 0, trem2: 0, tremN: 0, buchi: 0, gesti_persi: 0, inneschi: 0, scaduti: 0, pizzichi: 0, pizzichi_profilo: 0,
    lanci: 0, prese_sparite_veloci: 0, salti: 0, quadri: 0, quadriProfilo: 0, minimi: [] });
  let M = vuote();

  const sx = (X) => mappa(X / o.aspetto, o.margine, o.curva), sy = (Y) => mappa(Y, o.margine, o.curva);
  const schermo = (X, Y) => ({ x: clamp01(sx(X)), y: clamp01(sy(Y)) });

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
      // La normale del palmo da polso, nocca dell'indice e nocca del mignolo. La z di MediaPipe ha la scala della x
      // (documentazione di MediaPipe Hands); una z che manca o non è un numero vale 0, cioè palmo di fronte.
      const q = (i) => { const z = p[i].z; return [X[i], Y[i], typeof z === 'number' && Number.isFinite(z) ? Math.max(-2, Math.min(2, z)) * o.aspetto : 0]; };
      v.push({ lato: m.lato === 'Left' || m.lato === 'Right' ? m.lato : null, X, Y, palmo, cx, cy, N: normale(q(0), q(5), q(17)), tr: null });
    }
    return v;
  }

  const nuovaTraccia = (m) => ({
    id: nuovoId++, lato: m.lato, n: 0, visto: -Infinity, pronta: false,
    X: new Float64Array(21), Y: new Float64Array(21), dX: new Float64Array(21), dY: new Float64Array(21),
    palmo: m.palmo, r: 1, pizzico: false, aperta: false, consumato: false, modo: null,
    ix: 0, iy: 0, fx: 0, fy: 0, gx: m.cx, gy: m.cy, cx: m.cx, cy: m.cy, storia: [], mira: null, tMira: -Infinity,
    nx: 0, ny: 0, nz: 1, inclinazione: 0, profilo: false, dentro: false, tPalmo: null, falsi: 0, pMin: null, rel: null,
  });

  // La zona morta «a corda»: l'àncora resta ferma finché il punto filtrato le sta entro zona_morta; oltre, lo segue
  // restandogli a quella distanza. Da ferma la mano non fa tremare niente, e un movimento lento non va a gradini.
  // La regola alla lettera («sotto 3 px dal fotogramma prima, fermo») bloccava per sempre una mano a 3 cm/s, che fa
  // 1 px a fotogramma (prove/gesti.mjs).
  function segui(tr, kx, ky, x, y) {
    const dx = x - tr[kx], dy = y - tr[ky], d = Math.hypot(dx, dy);
    if (d > o.zona_morta) { const s = (d - o.zona_morta) / d; tr[kx] += dx * s; tr[ky] += dy * s; }
  }

  function fineMinimo(tr) {
    if (M.minimi.length < MINIMI_MAX) M.minimi.push(tr.pMin);
    tr.pMin = null;
  }

  // One Euro su ogni punto: il taglio sale con la velocità del punto (una sola per punto, non per asse), così la mano
  // ferma non trema e quella veloce non resta indietro.
  function nutri(tr, m, t, prec) {
    const dt = (t - tr.visto) / 1000, ad = alfa(o.dcutoff, dt), nuova = !tr.pronta;
    // per il tremolio di misure(): la punta grezza contro il filtrato di prima. Dopo l'aggiornamento il filtrato ha già fatto
    // un passo verso il grezzo e lo scarto usciva più piccolo del rumore (0,82 volte con σ 0,004, prove/gesti.mjs)
    const eX = m.X[8] - tr.X[8], eY = m.Y[8] - tr.Y[8];
    for (let i = 0; i < 21; i++) {
      if (nuova) { tr.X[i] = m.X[i]; tr.Y[i] = m.Y[i]; continue; }
      tr.dX[i] += ad * ((m.X[i] - tr.X[i]) / dt - tr.dX[i]);
      tr.dY[i] += ad * ((m.Y[i] - tr.Y[i]) / dt - tr.dY[i]);
      const a = alfa(o.mincutoff + o.beta * Math.hypot(tr.dX[i], tr.dY[i]), dt);
      tr.X[i] += a * (m.X[i] - tr.X[i]); tr.Y[i] += a * (m.Y[i] - tr.Y[i]);
    }
    tr.pronta = true;
    const d = (a, b) => Math.hypot(tr.X[a] - tr.X[b], tr.Y[a] - tr.Y[b]);
    tr.palmo = Math.max(d(0, 9), 1e-3); // 1U: polso→nocca del medio, rimisurato a ogni fotogramma perché cambia con la distanza
    tr.r = d(4, 8) / Math.max(d(5, 6) + d(6, 7) + d(7, 8), 1e-6);
    const chiusoPrima = tr.pizzico;
    if (tr.pizzico ? tr.r > o.aperto : tr.r < o.chiuso) tr.pizzico = !tr.pizzico;
    // La normale lisciata a mincutoff, senza il termine di velocità: la z di MediaPipe è la più rumorosa delle tre
    const an = nuova ? 1 : alfa(o.mincutoff, dt);
    tr.nx += an * (m.N[0] - tr.nx); tr.ny += an * (m.N[1] - tr.ny); tr.nz += an * (m.N[2] - tr.nz);
    tr.inclinazione = inclinazione([tr.nx, tr.ny, tr.nz]);
    tr.profilo = tr.inclinazione > o.profilo_gradi;
    // Di profilo le dita si coprono l'una con l'altra e MediaPipe le indovina: non si contano, quindi niente palmo
    // aperto. Il pizzico invece resta: davanti a un portatile si pizzica col palmo in giù, cioè di profilo, e pollice
    // e indice si vedono bene.
    tr.aperta = !tr.pizzico && !tr.profilo && DITA.every(([n, p]) => d(0, p) > o.dito_steso * d(0, n));
    // Le due àncore che escono verso lo schermo, con la zona morta: la punta dell'indice e il centro del palmo
    let gx = 0, gy = 0;
    for (const i of PALMO) { gx += tr.X[i] / 5; gy += tr.Y[i] / 5; }
    if (nuova) { tr.ix = tr.X[8]; tr.iy = tr.Y[8]; tr.fx = gx; tr.fy = gy; }
    else { segui(tr, 'ix', 'iy', tr.X[8], tr.Y[8]); segui(tr, 'fx', 'fy', gx, gy); }
    tr.gx = gx; tr.gy = gy;
    tr.dentro = Math.abs(gx / o.aspetto - 0.5) <= o.zona / 2 && Math.abs(gy - 0.5) <= o.zona / 2;
    // la velocità del lancio si misura sul centro del palmo grezzo: all'inizio di un colpo il filtro è ancora indietro
    tr.cx = m.cx; tr.cy = m.cy;
    tr.storia.push([t, m.cx, m.cy]);
    while (tr.storia.length > 2 && tr.storia[1][0] <= t - o.lancio_ms) tr.storia.shift(); // ne resta uno prima della finestra
    if (!tr.pizzico && tr.r >= o.aperto) { tr.mira = [tr.ix, tr.iy]; tr.tMira = t; }
    if (!tr.pizzico) tr.consumato = false;
    else if (tr.n < o.stabile) tr.consumato = true; // comparsa già chiusa: prima di un gesto deve aprirsi
    if (!tr.lato) tr.lato = m.lato;

    // Misure, solo sulle mani stabili
    const rel = [(m.X[4] - m.cx) / m.palmo, (m.Y[4] - m.cy) / m.palmo, (m.X[8] - m.cx) / m.palmo, (m.Y[8] - m.cy) / m.palmo];
    if (tr.n >= o.stabile) {
      M.quadri++; if (tr.profilo) M.quadriProfilo++;
      let vX = 0, vY = 0;
      for (const i of PALMO) { vX += tr.dX[i] / 5; vY += tr.dY[i] / 5; }
      if (Math.hypot(vX, vY) < FERMO_V) { M.trem2 += eX * eX + eY * eY; M.tremN++; }
      if (tr.rel && tr.visto === prec && Math.max(Math.hypot(rel[0] - tr.rel[0], rel[1] - tr.rel[1]), Math.hypot(rel[2] - tr.rel[2], rel[3] - tr.rel[3])) > SALTO_U) M.salti++;
      // un pizzico si conta quando si chiude fuori dal riposo; la sua distanza minima, in palmi, quando si riapre
      if (tr.pizzico && !chiusoPrima && fase !== 'riposo') { M.pizzichi++; if (tr.profilo) M.pizzichi_profilo++; tr.pMin = Infinity; }
      if (tr.pMin !== null) { if (tr.pizzico) tr.pMin = Math.min(tr.pMin, d(4, 8) / tr.palmo); else fineMinimo(tr); }
    }
    tr.rel = rel;
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
      if ((!zoom && !esplodi) || !A.dentro || !B.dentro) return; // un gesto a due mani parte solo con tutte e due nella zona attiva
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

  // Quanto corre la mano nella finestra del lancio: v in mm/s con la scala del palmo; vx e vy in schermi al secondo,
  // attraverso la mappa, come 'sposta' (il pezzo lanciato continua alla velocità che aveva sullo schermo)
  function corsa(tr) {
    const s = tr.storia, a = s[0], b = s[s.length - 1], dt = (b[0] - a[0]) / 1000;
    if (!(dt >= o.lancio_ms / 2000)) return null; // troppo poca storia per dire
    return { v: (Math.hypot(b[1] - a[1], b[2] - a[2]) / dt) * (o.palmo_mm / tr.palmo), vx: (sx(b[1]) - sx(a[1])) / dt, vy: (sy(b[2]) - sy(a[2])) / dt };
  }

  // Niente tempo di ricarica a parte per il lancio (la regola 3.3 di Tony): ogni lancio vuole una presa nuova, e una
  // presa vuole un pizzico riaperto e poi fermo per presa_ms. Due lanci non stanno più vicini di così (prove/gesti.mjs).
  function rilascio(tr) {
    const c = corsa(tr);
    if (!c || c.v < o.lancio_mm_s) return { tipo: 'lascia' };
    M.lanci++;
    return { tipo: 'lancia', ...schermo(tr.ix, tr.iy), vx: c.vx, vy: c.vy };
  }

  function unaMano(tr, t, out) {
    if (!tr.modo) {
      if (!tr.pizzico || tr.consumato) return;
      if (!tr.dentro) { tr.consumato = true; return; } // chiuso fuori dalla zona attiva: non vale finché non si riapre
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
    // differenze di posizioni mappate, non limitate allo schermo: una mano oltre il bordo ruota ancora
    const dx = sx(tr.ix) - sx(tr.ux), dy = sy(tr.iy) - sy(tr.uy);
    tr.ux = tr.ix; tr.uy = tr.iy;
    if (dx || dy) out.push({ tipo: tr.modo === 'ruota' ? 'ruota' : 'sposta', dx, dy });
  }

  function chiudi(tr, out) { // una mano sparita da più di assente_ms
    const inDue = due && (due.a === tr || due.b === tr);
    if (tr.modo === 'ruota' || tr.modo === 'presa' || (inDue && due.partito)) M.gesti_persi++;
    // sparita mentre correva oltre la soglia del lancio: forse un lancio perso perché la mano veloce viene mossa
    if (tr.modo === 'presa' && (corsa(tr)?.v ?? 0) >= o.lancio_mm_s) M.prese_sparite_veloci++;
    if (tr.pMin !== null) fineMinimo(tr);
    chiudiUna(tr, out);
    if (inDue) fineDue();
  }

  function aggiorna(mani, t_ms) {
    if (typeof t_ms !== 'number' || !Number.isFinite(t_ms) || t_ms <= ultimo) return [];
    const prec = ultimo, t = (ultimo = t_ms), testa = [], prima = [], dopo = [];
    if (!detta) { detta = true; testa.push({ tipo: 'stato', fase }); }
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
      else if (m.tr.visto < prec) M.buchi++; // rivista dopo almeno un fotogramma mancante
      nutri(m.tr, m, t, prec);
    }

    const stabili = tracce.filter((tr) => tr.visto === t && tr.n >= o.stabile);
    if (stabili.length && prec > -Infinity) M.ms += Math.min(t - prec, o.assente_ms);

    // Il palmo mostrato: una mano stabile, aperta (quindi non di profilo) e dentro la zona attiva. Tenuto per
    // innesco_ms sveglia i gesti, e finché c'è li tiene svegli. Un fotogramma storto in mezzo non azzera il conto, due sì.
    let palmo = false, innesco = false;
    for (const tr of tracce) {
      if (tr.visto === t && tr.n >= o.stabile && tr.aperta && tr.dentro) {
        if (tr.tPalmo === null) tr.tPalmo = t;
        tr.falsi = 0; palmo = true;
        if (t - tr.tPalmo >= o.innesco_ms) innesco = true;
      } else if (++tr.falsi > 1) tr.tPalmo = null;
    }
    if (palmo) tAttivo = t;
    if (fase === 'riposo') {
      if (!innesco) return testa; // a riposo le tracce si aggiornano, ma non esce niente: nemmeno il cursore
      fase = 'pronto'; tAttivo = t; M.inneschi++;
      for (const tr of tracce) if (tr.pizzico) tr.consumato = true; // un pizzico chiuso prima dell'innesco non parte
      testa.push({ tipo: 'stato', fase });
    }

    // con una delle due mani assente da poco il gesto a due aspetta; se scade, chiudi() l'ha già finito
    if (!due || (stabili.includes(due.a) && stabili.includes(due.b))) {
      const [A, B] = due ? [due.a, due.b] : stabili;
      if (B) dueMani(A, B, dopo);
    }
    for (const tr of stabili) if (!due || (tr !== due.a && tr !== due.b)) unaMano(tr, t, dopo);

    // 'azione' esce prima dei gesti del suo fotogramma, il ritorno a 'pronto' dopo: un clic sta tutto fra i due
    const nGesti = prima.length + dopo.length, inCorso = Boolean(due?.partito) || tracce.some((tr) => tr.modo === 'ruota' || tr.modo === 'presa');
    // anche un gesto in corso che non manda niente (uno zoom tenuto fermo) è attività: senza, lasciandolo dopo più di
    // riposo_ms con le mani fuori zona si tornava a riposo al fotogramma dopo (33 ms, prova del revisore dell'11/11)
    if (nGesti || inCorso) tAttivo = t;
    if (fase === 'pronto' && !nGesti && !inCorso && o.innesco_ms > 0 && t - tAttivo >= o.riposo_ms && !tracce.some((tr) => tr.modo)) {
      fase = 'riposo'; due = null; M.scaduti++; // un esplodi mai partito, con le mani uscite dalla zona, finisce qui
      for (const tr of tracce) tr.tPalmo = null;
      testa.push({ tipo: 'stato', fase });
      return testa;
    }
    if (fase === 'pronto' && (nGesti || inCorso)) { fase = 'azione'; testa.push({ tipo: 'stato', fase }); }
    const c = stabili.find((tr) => tr.modo) || stabili[0]; // un cursore solo: scena.js ne disegna uno
    if (c) prima.push({ tipo: 'cursore', ...schermo(c.ix, c.iy), mano: c.lato });
    if (fase === 'azione' && !inCorso) { fase = 'pronto'; dopo.push({ tipo: 'stato', fase }); }
    return testa.concat(prima, dopo);
  }

  // Dimentica le mani e torna alla fase di partenza; la prossima aggiorna() la ridice. Le misure restano.
  function azzera() { tracce = []; due = null; ultimo = -Infinity; fase = FASE0; detta = false; tAttivo = -Infinity; }

  // per le prove e per il lab: la fase e lo stato di ogni mano, senza i punti
  function stato() {
    return {
      fase, due: due ? due.tipo : null,
      mani: tracce.map((tr) => ({ id: tr.id, lato: tr.lato, rapporto: tr.r, pizzico: tr.pizzico, aperta: tr.aperta, stabile: tr.n >= o.stabile, modo: tr.modo, consumato: tr.consumato,
        inclinazione: tr.inclinazione, profilo: tr.profilo, dentro: tr.dentro })),
    };
  }

  // Le misure d'uso vero, dall'inizio: solo numeri (o null dove non c'è ancora un campione). Servono a tarare sulle
  // mani di Tony le soglie che oggi sono numeri non misurati; mani.js le passa a nexus.js, che le manda al registro.
  function misure() {
    const v = [...M.minimi].sort((a, b) => a - b);
    return {
      secondi: M.ms / 1000,                                    // con almeno una mano stabile
      tremolio: M.tremN ? Math.sqrt(M.trem2 / M.tremN) : null, // scarto quadratico medio fra la punta dell'indice grezza e
      tremolio_n: M.tremN,                                     // filtrata a palmo fermo, in altezze d'immagine, e i suoi campioni
      buchi: M.buchi,                                          // mani riviste dopo almeno un fotogramma mancante
      gesti_persi: M.gesti_persi,                              // mani sparite oltre assente_ms con un gesto in corso
      inneschi: M.inneschi, scaduti: M.scaduti,                // riposo → pronto, e pronto → riposo
      pizzichi: M.pizzichi,                                    // chiusi fuori dal riposo
      pizzico_min: v.length ? v[v.length >> 1] : null,         // mediana della distanza minima pollice-indice, in palmi (1U)
      pizzichi_profilo: M.pizzichi_profilo,                    // chiusi con la mano di profilo
      lanci: M.lanci,
      prese_sparite_veloci: M.prese_sparite_veloci,            // prese finite perché la mano è sparita mentre correva oltre lancio_mm_s
      salti: M.salti,                                          // fotogrammi con la punta di pollice o indice spostata di più di 0,5 palmi rispetto al palmo
      profilo: M.quadri ? M.quadriProfilo / M.quadri : null,   // frazione dei fotogrammi con la mano di profilo
    };
  }

  // Le misure ripartono da zero (all'apertura di un ologramma); le mani e la fase restano
  function azzeraMisure() { M = vuote(); }

  return { aggiorna, azzera, stato, misure, azzeraMisure };
}

// Le misure dei gesti che l'HUD manda al server con l'azione 'misura', e il pezzo di riga che il server ne scrive nel
// registro. Tutte facoltative (un HUD vecchio non le manda), ma quelle che ci sono devono essere numeri finiti dentro
// questi limiti: null se qualcosa non va, '' se non c'è niente da dire. Sta qui, senza DOM, perché si provi in Node.
const LIMITI_MISURE = Object.freeze({ secondi: 86400, tremolio_px: 1000, tremolio_n: 1e7, buchi: 1e7, gesti_persi: 1e7, inneschi: 1e7, scaduti: 1e7,
  pizzichi: 1e7, pizzico_min: 10, pizzichi_profilo: 1e7, lanci: 1e7, prese_sparite_veloci: 1e7, salti: 1e7, profilo: 1 });
export function testoMisure(g) {
  if (g === undefined) return '';
  if (g === null || typeof g !== 'object' || Array.isArray(g)) return null;
  for (const [k, v] of Object.entries(g))
    if (!Object.hasOwn(LIMITI_MISURE, k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > LIMITI_MISURE[k]) return null;
  const c = (v, d) => v.toFixed(d).replace('.', ','), r = Math.round, ha = (k) => g[k] !== undefined;
  const pezzi = [];
  if (ha('secondi')) pezzi.push(`mani viste ${r(g.secondi)} s`);
  if (ha('tremolio_px')) pezzi.push(`tremolio ${c(g.tremolio_px, 1)} px`);
  if (ha('inneschi')) pezzi.push(`inneschi ${r(g.inneschi)}${ha('scaduti') ? ` (scaduti ${r(g.scaduti)})` : ''}`);
  if (ha('pizzichi')) {
    const dentro = [ha('pizzico_min') && `minimo ${c(g.pizzico_min, 2)} U`, ha('pizzichi_profilo') && `${r(g.pizzichi_profilo)} di profilo`].filter(Boolean);
    pezzi.push(`pizzichi ${r(g.pizzichi)}${dentro.length ? ` (${dentro.join(', ')})` : ''}`);
  }
  const conti = [['buchi', 'buchi'], ['gesti_persi', 'gesti persi'], ['lanci', 'lanci'], ['prese_sparite_veloci', 'prese sparite in corsa'], ['salti', 'salti']]
    .filter(([k]) => ha(k)).map(([k, nome]) => `${nome} ${r(g[k])}`);
  if (ha('profilo')) conti.push(`profilo ${r(100 * g.profilo)}%`);
  if (conti.length) pezzi.push(conti.join(', '));
  return pezzi.map((p) => `; ${p}`).join('');
}
