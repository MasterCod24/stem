// forme.js — le forme degli ologrammi: misure, predefiniti, limiti, ingombro, volume, test «dentro»
// e trasformazioni. Puro (niente three.js, DOM o API di Node): lo usano il server, il calcolo degli
// sforzi e l'HUD, così disegno, massa e voxel vengono dagli stessi numeri.
//
// Unità: mm; angoli in gradi nei dati e in radianti nel codice. Asse Y in alto: le forme con un asse
// (cilindro, tubo, cono, toro, rivoluzione, ingranaggio) l'hanno lungo Y locale.
// mondo = T(posizione) · Rx · Ry · Rz · locale, cioè l'ordine 'XYZ' di THREE.Euler.
//
// I pezzi normalizzati si trattano come immutabili. dentro() prepara una volta sola, per ogni
// oggetto `misure`, poligoni e campioni del cavo: un pezzo cambiato si rifà con normalizzaPezzo,
// che crea oggetti nuovi, invece di toccare le misure di quello vecchio.

import { MATERIALI } from './materiali.js';

export const FORME = Object.freeze(['scatola', 'cilindro', 'tubo', 'sfera', 'cono', 'toro', 'piastra', 'estrusione', 'rivoluzione', 'ingranaggio', 'cavo', 'file']);

export const LIMITI = Object.freeze({
  pezzi: 200, carichi: 20, vincoli: 20, punti_profilo: 200, fori: 20, fori_tondi: 50, punti_cavo: 100,
  coordinata: 1e5, misura_max: 1e5, misura_min: 0.01,
});

export const FACCE = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);
export const MODI = Object.freeze(['ologramma', 'solido', 'raggi-x', 'densita', 'sforzi']);
export const FLUSSI = Object.freeze(['elettrico', 'fluido', 'aria', 'dati']);

// Campioni per tratto fra due punti del cavo: test, volume e disegno devono usare la stessa curva,
// con n = (punti − 1)·PASSI_CAVO + 1 campioni di campionaCavo.
export const PASSI_CAVO = 16;

function congela(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) congela(v);
  }
  return o;
}

// Congelati perché sono condivisi: chi li usa ne fa una copia, e i pezzi non li riferiscono mai.
export const PREDEFINITI = congela({
  pezzo: { posizione: [0, 0, 0], rotazione: [0, 0, 0], materiale: 'generico', materiale_vero: null, fattura: null, gruppo: null, esplodi: null, interno: false, colore: null, flusso: null, calcolo: true },
  senza_calcolo: ['cavo', 'file'], // per queste forme calcolo vale false se non è detto
  misure: {
    cono: { r_cima: 0 },
    piastra: { raggio: null }, // null: piana
    estrusione: { fori: [], fori_tondi: [] },
    ingranaggio: { foro: 0 }, // 0: senza foro
    file: { scala: 1, centra: true },
  },
  vista: { esploso: 0, sezione: null, modo: 'ologramma', selezionato: null, isolato: null },
});
// esplodi null vuol dire direzione non detta: la sceglie la scena. gruppo null: il pezzo esplode da solo.
// materiale_vero e fattura null: non detti. colore null: il ciano dell'ologramma.

const TESTO_MAX = { titolo: 80, descrizione: 300, nome: 60, gruppo: 40, materiale_vero: 60, fattura: 140 };
// Quello che una ricerca ha trovato sul pezzo vero: testo libero, solo da leggere nella scheda. `materiale` resta la
// chiave del calcolo (le 9 di materiali.js): vetro, litio o rame non ci sono, e senza questi campi un «MacBook Air» di
// 37 pezzi usciva tutto 'generico' (10/11). Corti perché il cervello li scrive per ogni pezzo: limiti scelti, non misurati.
// La fonte per pezzo c'era e l'11/11 è stata tolta (scelta di Tony): controllate a mano, ne reggevano 2 su 5, e una fonte
// sbagliata fa fidare di un dato che nessuno ha controllato. Un `fonte` che arriva ancora è un campo sconosciuto, ignorato.
export const CAMPI_RICERCA = Object.freeze(['materiale_vero', 'fattura']);
const FORZA_MAX = 1e7; // N
const ESPLODI_MAX = 5;
const DENTI_MIN = 6, DENTI_MAX = 200;
const SCALA_MIN = 1e-3, SCALA_MAX = 1e6; // mm per unità del file: dai micrometri ai chilometri
const PERCORSO_MAX = 1024; // PATH_MAX di macOS
const ESTENSIONI = ['glb', 'stl', 'obj', '3mf', 'ply'];
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const GRADI = Math.PI / 180; // lo stesso DEG2RAD di three.js: matrice e geometrie devono coincidere
const ZERO = Object.freeze([0, 0, 0]);
// Dente dell'ingranaggio: semiampiezza angolare al piede e alla testa, in passi angolari. Con i fianchi
// dritti, al primitivo il dente prende da 0,35 (6 denti) a 0,46 (200 denti) del passo: il resto è gioco,
// così due ruote dello stesso modulo ingranano senza compenetrarsi.
const DENTE_PIEDE = 0.4, DENTE_TESTA = 0.1;
const PASSO_ARCO = 2 * GRADI; // lato massimo degli archi di testa e di piede

// ---------------------------------------------------------------- poligoni

/** Area con segno di un poligono [[x, y], …] chiuso da solo: positiva in senso antiorario. */
export function areaPoligono(punti) {
  const n = punti.length;
  if (n < 3) return 0;
  const x0 = punti[0][0], y0 = punti[0][1]; // a ventaglio dal primo punto: meno cancellazioni con coordinate grandi
  let a = 0;
  for (let i = 1; i < n - 1; i++) a += (punti[i][0] - x0) * (punti[i + 1][1] - y0) - (punti[i + 1][0] - x0) * (punti[i][1] - y0);
  return a / 2;
}

/** Punto dentro il poligono, con la regola pari-dispari (PNPOLY). Sul bordo vale l'uno o l'altro. */
export function puntoInPoligono(punti, x, y) {
  let dentro = false;
  for (let i = 0, n = punti.length, j = n - 1; i < n; j = i++) {
    const xi = punti[i][0], yi = punti[i][1], xj = punti[j][0], yj = punti[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Vero se il poligono [[x, y], …] ha almeno 3 punti veri, nessun lato nullo e nessun lato che ne tocca un altro. */
export function poligonoSemplice(punti) {
  if (!Array.isArray(punti) || punti.length < 3) return false;
  for (const p of punti) if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
  return incrocio(punti) === null;
}

function orienta(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

// c, già allineato con a-b, sta fra a e b?
function fra(ax, ay, bx, by, cx, cy) {
  return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
}

// I segmenti chiusi a-b e c-d si toccano, anche solo in un punto?
function segmentiToccano(ax, ay, bx, by, cx, cy, dx, dy) {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) ||
    Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const o1 = orienta(ax, ay, bx, by, cx, cy), o2 = orienta(ax, ay, bx, by, dx, dy);
  const o3 = orienta(cx, cy, dx, dy, ax, ay), o4 = orienta(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && fra(ax, ay, bx, by, cx, cy)) || (o2 === 0 && fra(ax, ay, bx, by, dx, dy)) ||
    (o3 === 0 && fra(cx, cy, dx, dy, ax, ay)) || (o4 === 0 && fra(cx, cy, dx, dy, bx, by));
}

// Due lati che escono dallo stesso vertice v verso p e verso q si sovrappongono?
function indietro(vx, vy, px, py, qx, qy) {
  const ux = px - vx, uy = py - vy, wx = qx - vx, wy = qy - vy;
  return ux * wy - uy * wx === 0 && ux * wx + uy * wy > 0;
}

// Il primo paio di lati [a, b] che si toccano (il lato k va dal punto k al k+1), o null se è semplice.
function incrocio(punti) {
  const n = punti.length;
  for (let a = 0; a < n; a++) {
    const p = punti[a], q = punti[(a + 1) % n];
    if (p[0] === q[0] && p[1] === q[1]) return [a, a];
  }
  for (let a = 0; a < n; a++) {
    const ax = punti[a][0], ay = punti[a][1], bx = punti[(a + 1) % n][0], by = punti[(a + 1) % n][1];
    for (let b = a + 1; b < n; b++) {
      const cx = punti[b][0], cy = punti[b][1], dx = punti[(b + 1) % n][0], dy = punti[(b + 1) % n][1];
      if (b === a + 1) { if (indietro(bx, by, ax, ay, dx, dy)) return [a, b]; } // consecutivi, vertice comune a+1
      else if (a === 0 && b === n - 1) { if (indietro(ax, ay, bx, by, cx, cy)) return [a, b]; } // il primo e l'ultimo
      else if (segmentiToccano(ax, ay, bx, by, cx, cy, dx, dy)) return [a, b];
    }
  }
  return null;
}

// Un lato di A tocca un lato di B? Con gli ingombri staccati no, senza provare lato per lato: 20 fori da 200 punti
// sono 190 coppie da 40.000 lati, e un modello vicino ai limiti fermava il server 554 ms e l'HUD 1,35 s (misurato).
function latiSiToccano(A, B) {
  let a0 = Infinity, a1 = -Infinity, a2 = Infinity, a3 = -Infinity, b0 = Infinity, b1 = -Infinity, b2 = Infinity, b3 = -Infinity;
  for (const p of A) { if (p[0] < a0) a0 = p[0]; if (p[0] > a1) a1 = p[0]; if (p[1] < a2) a2 = p[1]; if (p[1] > a3) a3 = p[1]; }
  for (const p of B) { if (p[0] < b0) b0 = p[0]; if (p[0] > b1) b1 = p[0]; if (p[1] < b2) b2 = p[1]; if (p[1] > b3) b3 = p[1]; }
  if (a1 < b0 || b1 < a0 || a3 < b2 || b3 < a2) return false;
  for (let i = 0, n = A.length; i < n; i++) {
    const ax = A[i][0], ay = A[i][1], bx = A[(i + 1) % n][0], by = A[(i + 1) % n][1];
    for (let j = 0, m = B.length; j < m; j++) {
      if (segmentiToccano(ax, ay, bx, by, B[j][0], B[j][1], B[(j + 1) % m][0], B[(j + 1) % m][1])) return true;
    }
  }
  return false;
}

function distanzaSegmento2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

// Il cerchio (x, y, r) sta lontano da tutti i lati del poligono, senza toccarli?
function cerchioLontanoDaiLati(P, x, y, r) {
  const r2 = r * r;
  for (let i = 0, n = P.length; i < n; i++) if (distanzaSegmento2(x, y, P[i][0], P[i][1], P[(i + 1) % n][0], P[(i + 1) % n][1]) <= r2) return false;
  return true;
}

// PNPOLY con i lati divisi in fasce orizzontali: si provano solo i lati della fascia del punto.
// Le operazioni sono quelle di puntoInPoligono, quindi il risultato è lo stesso, solo più in fretta.
function preparaPoligono(punti) {
  const n = punti.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of punti) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  const nf = Math.max(1, Math.min(n, 256)), h = (y1 - y0) / nf || 1;
  const fascia = (y) => Math.min(nf - 1, Math.floor((y - y0) / h));
  const inizio = new Uint32Array(nf + 1), lati = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = punti[i][1], yj = punti[j][1];
    if (yi === yj) continue; // orizzontale: per PNPOLY non attraversa mai
    const f0 = fascia(Math.min(yi, yj)), f1 = fascia(Math.max(yi, yj));
    for (let f = f0; f <= f1; f++) inizio[f + 1]++;
    lati.push(punti[i][0], yi, punti[j][0], yj, f0, f1);
  }
  for (let f = 0; f < nf; f++) inizio[f + 1] += inizio[f];
  const L = new Float64Array(4 * inizio[nf]), cursore = inizio.slice(0, nf);
  for (let k = 0; k < lati.length; k += 6) {
    for (let f = lati[k + 4]; f <= lati[k + 5]; f++) {
      const o = 4 * cursore[f]++;
      L[o] = lati[k]; L[o + 1] = lati[k + 1]; L[o + 2] = lati[k + 2]; L[o + 3] = lati[k + 3];
    }
  }
  return { x0, x1, y0, y1, h, nf, inizio, L };
}

function dentroPreparato(P, x, y) {
  if (y < P.y0 || y > P.y1 || x < P.x0 || x > P.x1) return false; // fuori dal rettangolo PNPOLY dà sempre falso
  let f = Math.floor((y - P.y0) / P.h);
  if (f >= P.nf) f = P.nf - 1;
  const L = P.L;
  let dentro = false;
  for (let o = 4 * P.inizio[f], fine = 4 * P.inizio[f + 1]; o < fine; o += 4) {
    const xi = L[o], yi = L[o + 1], xj = L[o + 2], yj = L[o + 3];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// ---------------------------------------------------------------- profili generati

/**
 * Profilo di una ruota a denti dritti nel piano XZ: [[x, z], …], in senso antiorario da +x verso +z.
 * Denti trapezoidali fra il cerchio di piede (modulo·denti/2 − 1,25·modulo) e quello di testa
 * (+modulo), con archi di lati fino a 2° e fianchi dritti. Ogni raggio dal centro taglia il bordo una volta.
 */
export function profiloIngranaggio({ denti, modulo }) {
  const { ra, rf, tau, ta, tf, na, nf } = dente(denti, modulo), punti = [];
  const metti = (r, a) => punti.push([r * Math.cos(a), r * Math.sin(a)]);
  for (let k = 0; k < denti; k++) {
    const c = k * tau;
    metti(rf, c - tf);
    for (let i = 0; i <= na; i++) metti(ra, c - ta + (2 * ta * i) / na);
    metti(rf, c + tf);
    for (let i = 1; i < nf; i++) metti(rf, c + tf + ((tau - 2 * tf) * i) / nf);
  }
  return punti;
}

// Raggi di testa e di piede, passo angolare, semiampiezze del dente e lati degli archi.
function dente(denti, modulo) {
  const tau = (2 * Math.PI) / denti, ta = DENTE_TESTA * tau, tf = DENTE_PIEDE * tau;
  return {
    ra: (modulo * denti) / 2 + modulo, rf: (modulo * denti) / 2 - 1.25 * modulo, tau, ta, tf,
    na: Math.max(1, Math.ceil((2 * ta) / PASSO_ARCO)), nf: Math.max(1, Math.ceil((tau - 2 * tf) / PASSO_ARCO)),
  };
}

// Il raggio sotto cui tutto è pieno: le corde dell'arco di piede scendono a rf·cos(lato/2); i fianchi
// no, perché da (rf, tf) a (ra, ta) la distanza dal centro cresce sempre (ra·cos(tf − ta) > rf da 6 denti in su).
function raggioPieno({ denti, modulo }) {
  const { rf, tau, tf, nf } = dente(denti, modulo);
  return rf * Math.cos((tau - 2 * tf) / nf / 2);
}

/**
 * Il poligono (r, y) che gira attorno a Y. Di solito il profilo si chiude dall'asse: [0, y] in testa e in coda se mancano.
 * Un anello (la parete di un ugello, una campana cava) è un profilo tutto fuori dall'asse che gira su sé stesso:
 * chiuso a mano (il primo punto ripetuto in fondo), oppure non chiuso ma che dall'asse si incrocerebbe e su sé stesso no.
 * Prima un anello era un errore: il 10/11 il cervello ha dovuto riscrivere un turbofan intero per la parete dell'ugello.
 */
export function poligonoRivoluzione(profilo) {
  const out = profilo.map((p) => [p[0], p[1]]);
  const a = out[0], b = out[out.length - 1], fuori = out.every((p) => p[0] > 0);
  if (fuori && out.length > 3 && a[0] === b[0] && a[1] === b[1]) return out.slice(0, -1);
  const asse = [...out];
  if (a[0] !== 0) asse.unshift([0, a[1]]);
  if (b[0] !== 0) asse.push([0, b[1]]);
  if (fuori && out.length >= 3 && incrocio(asse) !== null && incrocio(out) === null) return out;
  return asse;
}
/** Vero se il poligono di una rivoluzione è un anello: nessun punto sull'asse. */
export const anelloRivoluzione = (Q) => Q.every((p) => p[0] > 0);

// Estrapolati come in three.js: (primo − secondo) + primo, nello stesso ordine di conti.
const estrapola = (a, b) => [a[0] - b[0] + a[0], a[1] - b[1] + a[1], a[2] - b[2] + a[2]];
const distanza2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);

/**
 * n punti della Catmull-Rom centripeta per punti [[x, y, z], …] (almeno 2), uniformi nel parametro t:
 * gli stessi di new THREE.CatmullRomCurve3(punti, false, 'centripetal').getPoints(n − 1), conto per conto.
 * Con due soli punti three.js usa lo stesso vettore per i due punti estrapolati (il suo tmp è condiviso):
 * la curva resta sul segmento ma i campioni si addensano all'inizio. Lo rifacciamo uguale, perché
 * disegno e calcolo devono coincidere.
 */
export function campionaCavo(punti, n) {
  const l = punti.length, out = [];
  if (n === 1) out.push([punti[0][0], punti[0][1], punti[0][2]]);
  for (let d = 0; n > 1 && d < n; d++) {
    const p = (l - 1) * (d / (n - 1));
    let i = Math.floor(p), w = p - i;
    if (w === 0 && i === l - 1) { i = l - 2; w = 1; }
    let p0 = i > 0 ? punti[i - 1] : estrapola(punti[0], punti[1]), p3;
    if (i + 2 < l) p3 = punti[i + 2];
    else { p3 = estrapola(punti[l - 1], punti[l - 2]); if (i === 0) p0 = p3; } // il tmp condiviso di three.js
    const p1 = punti[i], p2 = punti[i + 1];
    let dt0 = Math.pow(distanza2(p0, p1), 0.25), dt1 = Math.pow(distanza2(p1, p2), 0.25), dt2 = Math.pow(distanza2(p2, p3), 0.25);
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const q = [0, 0, 0], w2 = w * w, w3 = w2 * w;
    for (let c = 0; c < 3; c++) {
      const x0 = p0[c], x1 = p1[c], x2 = p2[c], x3 = p3[c];
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1;
      t2 *= dt1;
      q[c] = x1 + t1 * w + (-3 * x1 + 3 * x2 - 2 * t1 - t2) * w2 + (2 * x1 - 2 * x2 + t1 + t2) * w3;
    }
    out.push(q);
  }
  return out;
}

// ---------------------------------------------------------------- trasformazioni

/** Matrice 4×4 del pezzo in colonne, come THREE.Matrix4.elements: mondo = T · Rx · Ry · Rz · locale. */
export function matrice(pezzo) {
  const t = pezzo.posizione || ZERO, g = pezzo.rotazione || ZERO;
  const a = Math.cos(g[0] * GRADI), b = Math.sin(g[0] * GRADI);
  const c = Math.cos(g[1] * GRADI), d = Math.sin(g[1] * GRADI);
  const e = Math.cos(g[2] * GRADI), f = Math.sin(g[2] * GRADI);
  const ae = a * e, af = a * f, be = b * e, bf = b * f; // come makeRotationFromEuler con 'XYZ'
  return [c * e, af + be * d, bf - ae * d, 0, -c * f, ae - bf * d, be + af * d, 0, d, -b * c, a * c, 0, t[0], t[1], t[2], 1];
}

/** Il punto locale [x, y, z] del pezzo, nel mondo. */
export function aMondo(pezzo, p) {
  const m = matrice(pezzo), x = p[0], y = p[1], z = p[2];
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

/** Il punto del mondo [x, y, z] nelle coordinate del pezzo: Rzᵀ · Ryᵀ · Rxᵀ · (mondo − posizione). */
export function aLocale(pezzo, p) {
  const m = matrice(pezzo), x = p[0] - m[12], y = p[1] - m[13], z = p[2] - m[14];
  return [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
}

// ---------------------------------------------------------------- le forme

const scatolaCentrata = (a, b, c) => ({ min: [-a, -b, -c], max: [a, b, c] });

// Per ogni forma: le chiavi delle misure, come leggerle (con gli errori) e cosa preparare una volta sola:
// il test dentro, l'ingombro locale e il volume in mm³.
const SPECIE = {
  scatola: {
    chiavi: ['x', 'y', 'z'],
    leggi: (C, m) => ({ x: misura(C, m, 'x'), y: misura(C, m, 'y'), z: misura(C, m, 'z') }),
    prepara(m) {
      const a = m.x / 2, b = m.y / 2, c = m.z / 2;
      return { test: (x, y, z) => Math.abs(x) <= a && Math.abs(y) <= b && Math.abs(z) <= c, ingombro: scatolaCentrata(a, b, c), volume: m.x * m.y * m.z };
    },
  },
  cilindro: {
    chiavi: ['r', 'h'],
    leggi: (C, m) => ({ r: misura(C, m, 'r'), h: misura(C, m, 'h') }),
    prepara(m) {
      const r2 = m.r * m.r, hy = m.h / 2;
      return { test: (x, y, z) => Math.abs(y) <= hy && x * x + z * z <= r2, ingombro: scatolaCentrata(m.r, hy, m.r), volume: Math.PI * r2 * m.h };
    },
  },
  tubo: {
    chiavi: ['r', 'r_interno', 'h'],
    leggi(C, m) {
      const r = misura(C, m, 'r'), r_interno = misura(C, m, 'r_interno'), h = misura(C, m, 'h');
      if (r !== undefined && r_interno !== undefined && r_interno >= r) C.err('misure.r_interno', `(${r_interno}) deve essere minore di misure.r (${r})`);
      return { r, r_interno, h };
    },
    prepara(m) {
      const r2 = m.r * m.r, ri2 = m.r_interno * m.r_interno, hy = m.h / 2;
      return {
        test: (x, y, z) => { if (Math.abs(y) > hy) return false; const q = x * x + z * z; return q <= r2 && q >= ri2; },
        ingombro: scatolaCentrata(m.r, hy, m.r), volume: Math.PI * (r2 - ri2) * m.h,
      };
    },
  },
  sfera: {
    chiavi: ['r'],
    leggi: (C, m) => ({ r: misura(C, m, 'r') }),
    prepara(m) {
      const r2 = m.r * m.r;
      return { test: (x, y, z) => x * x + y * y + z * z <= r2, ingombro: scatolaCentrata(m.r, m.r, m.r), volume: (4 / 3) * Math.PI * r2 * m.r };
    },
  },
  cono: {
    chiavi: ['r', 'r_cima', 'h'],
    leggi: (C, m) => ({
      r: misura(C, m, 'r'),
      r_cima: leggiNumero(C, m.r_cima, 'misure.r_cima', { min: 0, max: LIMITI.misura_max, unita: 'mm', facoltativo: true, predefinito: 0 }),
      h: misura(C, m, 'h'),
    }),
    prepara(m) {
      const r = m.r, rc = m.r_cima, h = m.h, hy = h / 2, rm = Math.max(r, rc);
      return {
        test: (x, y, z) => { if (Math.abs(y) > hy) return false; const rr = r + ((rc - r) * (y + hy)) / h; return x * x + z * z <= rr * rr; },
        ingombro: scatolaCentrata(rm, hy, rm), volume: (Math.PI * h * (r * r + r * rc + rc * rc)) / 3,
      };
    },
  },
  toro: {
    chiavi: ['R', 'r'],
    leggi(C, m) {
      const R = misura(C, m, 'R'), r = misura(C, m, 'r');
      if (R !== undefined && r !== undefined && r >= R) C.err('misure.r', `(${r}) deve essere minore di misure.R (${R}), se no l'anello si chiude nel centro`);
      return { R, r };
    },
    prepara(m) {
      const R = m.R, r2 = m.r * m.r;
      return {
        test: (x, y, z) => { const q = Math.sqrt(x * x + z * z) - R; return q * q + y * y <= r2; },
        ingombro: scatolaCentrata(R + m.r, m.r, R + m.r), volume: 2 * Math.PI * Math.PI * R * r2,
      };
    },
  },
  piastra: {
    chiavi: ['x', 'z', 'spessore', 'raggio'],
    leggi(C, m) {
      const x = misura(C, m, 'x'), z = misura(C, m, 'z'), spessore = misura(C, m, 'spessore');
      let raggio = null;
      if (m.raggio != null) {
        raggio = leggiNumero(C, m.raggio, 'misure.raggio', { min: -LIMITI.misura_max, max: LIMITI.misura_max, unita: 'mm' });
        if (raggio !== undefined && spessore !== undefined && Math.abs(raggio) <= spessore / 2) {
          C.err('misure.raggio', `(${raggio}) deve valere in assoluto più di metà spessore (${spessore / 2} mm), positivo per piegare verso +Y e negativo verso −Y`);
        } else if (raggio !== undefined && x !== undefined && x > 2 * Math.PI * Math.abs(raggio)) {
          C.err('misure.x', `(${x}) con misure.raggio ${raggio} fa un arco di ${giu((x / Math.abs(raggio)) / GRADI)}°: al massimo 360°, cioè x fino a ${giu(2 * Math.PI * Math.abs(raggio))} mm`);
        }
      }
      return { x, z, spessore, raggio };
    },
    prepara(m) {
      const hz = m.z / 2, hs = m.spessore / 2;
      if (m.raggio === null) {
        const hx = m.x / 2;
        return { test: (x, y, z) => Math.abs(x) <= hx && Math.abs(y) <= hs && Math.abs(z) <= hz, ingombro: scatolaCentrata(hx, hs, hz), volume: m.x * m.z * m.spessore };
      }
      // Arco di raggio |R| nel piano XY, tangente all'asse X nell'origine, centro in (0, R, 0).
      // φ è l'angolo dal raggio che passa per l'origine, ρ la distanza dal centro.
      const R = m.raggio, Ra = Math.abs(R), s = Math.sign(R), ri = Ra - hs, ro = Ra + hs;
      const ri2 = ri * ri, ro2 = ro * ro, alfa = m.x / (2 * Ra);
      const xmax = ro * (alfa >= Math.PI / 2 ? 1 : Math.sin(alfa)), ca = Math.cos(alfa);
      const lontano = R - s * (ca >= 0 ? ri : ro) * ca, vicino = R - s * ro; // y = R − s·ρ·cos φ agli estremi
      return {
        test(x, y, z) {
          if (Math.abs(z) > hz) return false;
          const q = x * x + (y - R) * (y - R);
          return q >= ri2 && q <= ro2 && Math.abs(Math.atan2(x, s * (R - y))) <= alfa;
        },
        ingombro: { min: [-xmax, Math.min(lontano, vicino), -hz], max: [xmax, Math.max(lontano, vicino), hz] },
        volume: m.x * m.z * m.spessore, // settore di corona: 2α·(ro² − ri²)/2·z = x·spessore·z
      };
    },
  },
  estrusione: {
    chiavi: ['profilo', 'profondita', 'fori', 'fori_tondi'],
    leggi: leggiEstrusione,
    prepara(m) {
      const P = preparaPoligono(m.profilo), H = m.fori.map(preparaPoligono), hz = m.profondita / 2;
      const T = new Float64Array(3 * m.fori_tondi.length);
      m.fori_tondi.forEach((f, i) => { T[3 * i] = f.x; T[3 * i + 1] = f.y; T[3 * i + 2] = f.r * f.r; });
      let area = Math.abs(areaPoligono(m.profilo));
      for (const f of m.fori) area -= Math.abs(areaPoligono(f));
      for (const f of m.fori_tondi) area -= Math.PI * f.r * f.r;
      return {
        test(x, y, z) {
          if (z < -hz || z > hz || !dentroPreparato(P, x, y)) return false;
          for (let i = 0; i < H.length; i++) if (dentroPreparato(H[i], x, y)) return false;
          for (let k = 0; k < T.length; k += 3) { const dx = x - T[k], dy = y - T[k + 1]; if (dx * dx + dy * dy < T[k + 2]) return false; }
          return true;
        },
        ingombro: { min: [P.x0, P.y0, -hz], max: [P.x1, P.y1, hz] },
        volume: area * m.profondita,
      };
    },
  },
  rivoluzione: {
    chiavi: ['profilo'],
    leggi: leggiRivoluzione,
    prepara(m) {
      const Q = poligonoRivoluzione(m.profilo), P = preparaPoligono(Q);
      // Pappus: V = 2π·∫∫ r dA, con il momento del poligono Σ (rᵢ + rᵢ₊₁)(rᵢ yᵢ₊₁ − rᵢ₊₁ yᵢ) / 6.
      let momento = 0;
      for (let i = 0, n = Q.length; i < n; i++) {
        const a = Q[i], b = Q[(i + 1) % n];
        momento += (a[0] + b[0]) * (a[0] * b[1] - b[0] * a[1]);
      }
      return {
        test: (x, y, z) => dentroPreparato(P, Math.sqrt(x * x + z * z), y),
        ingombro: { min: [-P.x1, P.y0, -P.x1], max: [P.x1, P.y1, P.x1] },
        volume: (2 * Math.PI * Math.abs(momento)) / 6,
      };
    },
  },
  ingranaggio: {
    chiavi: ['denti', 'modulo', 'spessore', 'foro'],
    leggi(C, m) {
      const denti = leggiNumero(C, m.denti, 'misure.denti', { min: DENTI_MIN, max: DENTI_MAX, intero: true });
      const modulo = misura(C, m, 'modulo'), spessore = misura(C, m, 'spessore');
      const foro = leggiNumero(C, m.foro, 'misure.foro', { min: 0, max: LIMITI.misura_max, unita: 'mm', facoltativo: true, predefinito: 0 });
      if (denti === undefined || modulo === undefined) return { denti, modulo, spessore, foro };
      const ra = modulo * (denti / 2 + 1);
      if (ra > LIMITI.misura_max) C.err('misure.modulo', `(${modulo}) con ${denti} denti fa un raggio di testa di ${giu(ra)} mm: al massimo ${LIMITI.misura_max}`);
      else if (foro !== undefined && foro > 0 && foro < LIMITI.misura_min) C.err('misure.foro', `(${foro}) deve essere 0 (senza foro) o almeno ${LIMITI.misura_min} mm`);
      else if (foro !== undefined && foro >= raggioPieno({ denti, modulo })) C.err('misure.foro', `(${foro}) deve essere minore del raggio di piede, ${giu(raggioPieno({ denti, modulo }))} mm`);
      return { denti, modulo, spessore, foro };
    },
    prepara(m) {
      const profilo = profiloIngranaggio(m), P = preparaPoligono(profilo), hy = m.spessore / 2;
      const ra = m.modulo * (m.denti / 2 + 1), ra2 = ra * ra, f2 = m.foro * m.foro;
      const pieno = raggioPieno(m) * (1 - 1e-12), pieno2 = pieno * pieno;
      return {
        test(x, y, z) {
          if (Math.abs(y) > hy) return false;
          const q = x * x + z * z;
          if (q < f2 || q > ra2) return false;
          return q < pieno2 || dentroPreparato(P, x, z);
        },
        ingombro: { min: [P.x0, -hy, P.y0], max: [P.x1, hy, P.y1] }, // dai vertici: con pochi denti ±ra sarebbe largo del 9%
        volume: (Math.abs(areaPoligono(profilo)) - Math.PI * f2) * m.spessore,
      };
    },
  },
  cavo: {
    chiavi: ['punti', 'r'],
    leggi(C, m) {
      const r = misura(C, m, 'r');
      let punti = leggiPunti(C, m.punti, 'misure.punti', 3, 2, LIMITI.punti_cavo);
      if (punti) {
        punti = senzaDoppi(C, punti, 'misure.punti');
        if (punti.length < 2) { C.err('misure.punti', 'deve avere almeno 2 punti diversi'); punti = undefined; }
      }
      return { punti, r };
    },
    prepara: preparaCavo,
  },
  file: {
    chiavi: ['file', 'scala', 'centra'],
    leggi: (C, m) => ({
      file: leggiPercorso(C, m.file),
      scala: leggiNumero(C, m.scala, 'misure.scala', { min: SCALA_MIN, max: SCALA_MAX, unita: 'mm per unità del file', facoltativo: true, predefinito: 1 }),
      centra: leggiBooleano(C, m.centra, 'misure.centra', true),
    }),
    // Il server non apre i file: niente test, ingombro né volume.
    prepara: () => ({ test: null, ingombro: null, volume: null }),
  },
};

// Il cavo è l'insieme dei punti a distanza ≤ r dalla curva campionata, con le due estremità tagliate
// piatte come un tubo: così il volume è davvero πr² per la lunghezza (le calotte tonde aggiungerebbero
// 4r/3L). Ogni taglio è un piano perpendicolare al primo (o all'ultimo) segmento e vale per tutti i
// segmenti a meno di 2r di curva da quell'estremo: lì i campioni sono più fitti di r, e le sfere delle
// giunzioni sporgerebbero oltre il taglio (misurato: +0,6% sul cavo dritto). Nelle curve l'errore
// che resta è del terzo ordine nell'angolo fra due campioni.
function preparaCavo(m) {
  const S = campionaCavo(m.punti, (m.punti.length - 1) * PASSI_CAVO + 1), ns = S.length - 1, r = m.r, r2 = r * r;
  const A = new Float64Array(3 * ns), D = new Float64Array(3 * ns), INV = new Float64Array(ns), LUNGO = new Float64Array(ns);
  const ng = Math.ceil(ns / PASSI_CAVO), G = new Float64Array(6 * ng); // scatole dei gruppi di segmenti, allargate di r
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let lunghezza = 0;
  for (let g = 0; g < ng; g++) for (let c = 0; c < 3; c++) { G[6 * g + c] = Infinity; G[6 * g + 3 + c] = -Infinity; }
  for (let s = 0; s < ns; s++) {
    const g = Math.floor(s / PASSI_CAVO);
    let l2 = 0;
    for (let c = 0; c < 3; c++) {
      const a = S[s][c], b = S[s + 1][c];
      A[3 * s + c] = a;
      D[3 * s + c] = b - a;
      l2 += (b - a) * (b - a);
      G[6 * g + c] = Math.min(G[6 * g + c], a - r, b - r);
      G[6 * g + 3 + c] = Math.max(G[6 * g + 3 + c], a + r, b + r);
      min[c] = Math.min(min[c], a - r, b - r);
      max[c] = Math.max(max[c], a + r, b + r);
    }
    INV[s] = l2 > 0 ? 1 / l2 : 0;
    LUNGO[s] = Math.sqrt(l2);
    lunghezza += LUNGO[s];
  }
  // I due piani di taglio, con la normale verso fuori, dai primi segmenti non nulli.
  let i0 = 0, i1 = ns - 1;
  while (i0 < ns - 1 && INV[i0] === 0) i0++;
  while (i1 > 0 && INV[i1] === 0) i1--;
  const n0 = [0, 1, 2].map((c) => -D[3 * i0 + c] / (LUNGO[i0] || 1)), n1 = [0, 1, 2].map((c) => D[3 * i1 + c] / (LUNGO[i1] || 1));
  const p0 = S[0], p1 = S[ns], vicinoInizio = new Uint8Array(ns), vicinoFine = new Uint8Array(ns);
  for (let s = 0, d = 0; s < ns; d += LUNGO[s], s++) vicinoInizio[s] = d < 2 * r ? 1 : 0;
  for (let s = ns - 1, d = 0; s >= 0; d += LUNGO[s], s--) vicinoFine[s] = d < 2 * r ? 1 : 0;
  return {
    test(x, y, z) {
      if (x < min[0] || x > max[0] || y < min[1] || y > max[1] || z < min[2] || z > max[2]) return false;
      const primaInizio = (x - p0[0]) * n0[0] + (y - p0[1]) * n0[1] + (z - p0[2]) * n0[2] > 0;
      const dopoFine = (x - p1[0]) * n1[0] + (y - p1[1]) * n1[1] + (z - p1[2]) * n1[2] > 0;
      for (let g = 0; g < ng; g++) {
        const o = 6 * g;
        if (x < G[o] || x > G[o + 3] || y < G[o + 1] || y > G[o + 4] || z < G[o + 2] || z > G[o + 5]) continue;
        for (let s = g * PASSI_CAVO, fine = Math.min(ns, s + PASSI_CAVO); s < fine; s++) {
          if ((primaInizio && vicinoInizio[s]) || (dopoFine && vicinoFine[s])) continue; // oltre un taglio piatto
          const k = 3 * s, px = x - A[k], py = y - A[k + 1], pz = z - A[k + 2], dx = D[k], dy = D[k + 1], dz = D[k + 2];
          let t = (px * dx + py * dy + pz * dz) * INV[s];
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz;
          if (ex * ex + ey * ey + ez * ez <= r2) return true;
        }
      }
      return false;
    },
    ingombro: { min, max },
    volume: Math.PI * r2 * lunghezza,
  };
}

// Preparazione una volta per oggetto misure (WeakMap: si libera da sola con il pezzo).
const PREPARATI = new WeakMap();
function preparato(pezzo) {
  if (!pezzo || !pezzo.misure || typeof pezzo.misure !== 'object' || !Object.hasOwn(SPECIE, pezzo.forma)) return null;
  let c = PREPARATI.get(pezzo.misure);
  if (!c || c.forma !== pezzo.forma) {
    c = { forma: pezzo.forma, ...SPECIE[pezzo.forma].prepara(pezzo.misure) };
    PREPARATI.set(pezzo.misure, c);
  }
  return c;
}

// La matrice del pezzo, rifatta solo se cambiano posizione o rotazione.
const POSE = new WeakMap();
function posa(pezzo) {
  const t = pezzo.posizione || ZERO, g = pezzo.rotazione || ZERO;
  let c = POSE.get(pezzo);
  if (!c || c[0] !== t[0] || c[1] !== t[1] || c[2] !== t[2] || c[3] !== g[0] || c[4] !== g[1] || c[5] !== g[2]) {
    c = [t[0], t[1], t[2], g[0], g[1], g[2], matrice(pezzo)];
    POSE.set(pezzo, c);
  }
  return c[6];
}

/** Il punto (x, y, z) locale sta nel pezzo? Per 'file' è sempre falso. */
export function dentroLocale(pezzo, x, y, z) {
  const c = preparato(pezzo);
  return c !== null && c.test !== null && c.test(x, y, z);
}

/** Il punto (x, y, z) del mondo sta nel pezzo? */
export function dentro(pezzo, x, y, z) {
  const c = preparato(pezzo);
  if (c === null || c.test === null) return false;
  const m = posa(pezzo), dx = x - m[12], dy = y - m[13], dz = z - m[14];
  return c.test(m[0] * dx + m[1] * dy + m[2] * dz, m[4] * dx + m[5] * dy + m[6] * dz, m[8] * dx + m[9] * dy + m[10] * dz);
}

/** { min: [x, y, z], max: [x, y, z] } in coordinate locali: esatto o un poco più largo, mai più stretto. null per 'file'. */
export function ingombroLocale(pezzo) {
  const c = preparato(pezzo);
  return c && c.ingombro ? { min: [...c.ingombro.min], max: [...c.ingombro.max] } : null;
}

/** L'ingombro nel mondo, dagli 8 angoli di quello locale trasformati. null per 'file'. */
export function ingombro(pezzo) {
  const b = ingombroLocale(pezzo);
  if (!b) return null;
  const m = posa(pezzo), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? b.max[0] : b.min[0], y = k & 2 ? b.max[1] : b.min[1], z = k & 4 ? b.max[2] : b.min[2];
    for (let c = 0; c < 3; c++) {
      const v = m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

/** Volume in mm³ con le formule esatte della forma; null per 'file'. */
export function volume(pezzo) {
  const c = preparato(pezzo);
  return c && c.volume !== null ? c.volume : null;
}

// ---------------------------------------------------------------- lettura dei dati del cervello

const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const giu = (v) => Math.floor(v * 100) / 100; // arrotondato per difetto: un limite mostrato non va mai superato

// Il valore ricevuto, corto, per i messaggi: le stringhe tra virgolette, così si vede che non sono numeri.
function mostra(v) {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v);
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length > 4) return `una lista di ${v.length} elementi`;
    try { const s = JSON.stringify(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; } catch { return 'una lista'; }
  }
  return typeof v === 'object' ? 'un oggetto' : typeof v;
}

const coppia = (p) => `[${p[0]}, ${p[1]}]`;

// Errori e avvisi di un oggetto, con chi li riguarda e il campo: il cervello li legge per correggersi.
function contesto(chi) {
  const errori = [], avvisi = [];
  const riga = (campo, msg) => (campo ? `${chi}: ${campo} ${msg}` : `${chi}: ${msg}`);
  return { errori, avvisi, err: (campo, msg) => errori.push(riga(campo, msg)), avv: (campo, msg) => avvisi.push(riga(campo, msg)) };
}

function sconosciuti(C, o, note, dove = '') {
  const altri = Object.keys(o).filter((k) => !note.includes(k));
  if (!altri.length) return;
  const nomi = altri.slice(0, 5).map(mostra).join(', ') + (altri.length > 5 ? ` e altri ${altri.length - 5}` : '');
  C.avv(dove, `${altri.length === 1 ? 'ha un campo sconosciuto, ignorato' : 'ha campi sconosciuti, ignorati'}: ${nomi}`);
}

// Un numero vero entro [min, max] (o ]min, max]); se manca vale il predefinito, se c'è, o è un errore.
function leggiNumero(C, v, campo, { min, max, unita = '', intero = false, facoltativo = false, predefinito, minEscluso = false }) {
  const cosa = `${intero ? 'un intero' : 'un numero'}${unita ? ' in ' + unita : ''} ${minEscluso ? `maggiore di ${min} e fino a ${max}` : `fra ${min} e ${max}`}`;
  if (v === undefined || v === null) {
    if (facoltativo) return predefinito;
    C.err(campo, `manca: serve ${cosa}`);
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || (intero && !Number.isInteger(v)) || v > max || (minEscluso ? v <= min : v < min)) {
    C.err(campo, `deve essere ${cosa}, non ${mostra(v)}`);
    return undefined;
  }
  return v;
}

const misura = (C, m, k) => leggiNumero(C, m[k], 'misure.' + k, { min: LIMITI.misura_min, max: LIMITI.misura_max, unita: 'mm' });

function leggiBooleano(C, v, campo, predefinito) {
  if (v === undefined || v === null) return predefinito;
  if (typeof v !== 'boolean') { C.err(campo, `deve essere true o false, non ${mostra(v)}`); return undefined; }
  return v;
}

// Un testo pulito dai caratteri di controllo; i testi lunghi si tagliano con un avviso, gli identificatori no.
function leggiTesto(C, v, campo, max, { facoltativo = false, predefinito = '', taglia = true } = {}) {
  if (v === undefined || v === null) {
    if (facoltativo) return predefinito;
    C.err(campo, 'manca: serve un testo');
    return undefined;
  }
  if (typeof v !== 'string') { C.err(campo, `deve essere un testo, non ${mostra(v)}`); return undefined; }
  let s = v.slice(0, 4 * max + 16).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (!s) {
    if (facoltativo) return predefinito;
    C.err(campo, 'è vuoto: serve un testo');
    return undefined;
  }
  const lettere = Array.from(s);
  if (lettere.length > max) {
    if (!taglia) { C.err(campo, `è più lungo di ${max} caratteri`); return undefined; }
    s = lettere.slice(0, max).join('').trimEnd();
    C.avv(campo, `era più lungo di ${max} caratteri: tagliato`);
  }
  return s;
}

function leggiVettore(C, v, campo, max, unita) {
  if (!Array.isArray(v) || v.length !== 3) { C.err(campo, `deve essere [x, y, z] con tre numeri${unita ? ' in ' + unita : ''}, non ${mostra(v)}`); return undefined; }
  const out = [0, 1, 2].map((i) => leggiNumero(C, v[i], `${campo}[${i}]`, { min: -max, max, unita }));
  return out.includes(undefined) ? undefined : out;
}

// Una lista di punti [x, y] o [x, y, z] dentro ±coordinata, copiata.
function leggiPunti(C, v, campo, dim, minimo, massimo) {
  const forma = dim === 2 ? '[x, y]' : '[x, y, z]';
  if (!Array.isArray(v)) { C.err(campo, `${v == null ? 'manca' : 'non è una lista'}: servono da ${minimo} a ${massimo} punti ${forma} in mm`); return undefined; }
  if (v.length < minimo || v.length > massimo) { C.err(campo, `vuole da ${minimo} a ${massimo} punti ${forma}, ne ha ${v.length}`); return undefined; }
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (!Array.isArray(p) || p.length !== dim || !p.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= LIMITI.coordinata)) {
      C.err(`${campo}[${i}]`, `deve essere ${forma} con ${dim} numeri in mm entro ±${LIMITI.coordinata}, non ${mostra(p)}`);
      return undefined;
    }
    out.push(p.slice());
  }
  return out;
}

const uguali = (p, q) => p.every((v, i) => v === q[i]);

// Toglie i punti uguali al precedente; con chiuso anche l'ultimo uguale al primo (poligono chiuso a mano).
function senzaDoppi(C, punti, campo, chiuso = false) {
  const out = [];
  for (const p of punti) if (!out.length || !uguali(p, out[out.length - 1])) out.push(p);
  if (chiuso) while (out.length > 1 && uguali(out[0], out[out.length - 1])) out.pop();
  const tolti = punti.length - out.length;
  if (tolti) C.avv(campo, tolti === 1 ? 'aveva un punto ripetuto di seguito: tolto' : `aveva ${tolti} punti ripetuti di seguito: tolti`);
  return out;
}

// Il poligono è semplice e ha area? Se no, l'errore dice dove si tocca, con le coordinate dei due tratti.
function controllaPoligono(C, P, campo) {
  if (P.length < 3) { C.err(campo, `ha ${P.length} punti diversi: ne servono almeno 3`); return false; }
  const x = incrocio(P);
  if (x) {
    const [a, b] = x, n = P.length;
    C.err(campo, `si incrocia: il tratto da ${coppia(P[a])} a ${coppia(P[(a + 1) % n])} tocca quello da ${coppia(P[b])} a ${coppia(P[(b + 1) % n])}`);
    return false;
  }
  if (areaPoligono(P) === 0) { C.err(campo, 'ha area nulla'); return false; }
  return true;
}

function leggiEstrusione(C, m) {
  const profondita = misura(C, m, 'profondita');
  let profilo = leggiPunti(C, m.profilo, 'misure.profilo', 2, 3, LIMITI.punti_profilo);
  if (profilo) {
    profilo = senzaDoppi(C, profilo, 'misure.profilo', true);
    if (!controllaPoligono(C, profilo, 'misure.profilo')) profilo = undefined;
  }
  const fori = [], tondi = [];
  let foriOk = true;
  if (m.fori != null) {
    if (!Array.isArray(m.fori)) { C.err('misure.fori', `deve essere una lista di poligoni, non ${mostra(m.fori)}`); foriOk = false; }
    else if (m.fori.length > LIMITI.fori) { C.err('misure.fori', `sono ${m.fori.length}: al massimo ${LIMITI.fori}`); foriOk = false; }
    else m.fori.forEach((f, i) => {
      const campo = `misure.fori[${i}]`;
      let P = leggiPunti(C, f, campo, 2, 3, LIMITI.punti_profilo);
      if (P) P = senzaDoppi(C, P, campo, true);
      if (P && controllaPoligono(C, P, campo)) fori.push(P);
      else foriOk = false;
    });
  }
  if (m.fori_tondi != null) {
    if (!Array.isArray(m.fori_tondi)) { C.err('misure.fori_tondi', `deve essere una lista di { x, y, r }, non ${mostra(m.fori_tondi)}`); foriOk = false; }
    else if (m.fori_tondi.length > LIMITI.fori_tondi) { C.err('misure.fori_tondi', `sono ${m.fori_tondi.length}: al massimo ${LIMITI.fori_tondi}`); foriOk = false; }
    else m.fori_tondi.forEach((f, i) => {
      const campo = `misure.fori_tondi[${i}]`;
      if (!oggetto(f)) { C.err(campo, `deve essere { x, y, r } in mm, non ${mostra(f)}`); foriOk = false; return; }
      sconosciuti(C, f, ['x', 'y', 'r'], campo);
      const x = leggiNumero(C, f.x, campo + '.x', { min: -LIMITI.coordinata, max: LIMITI.coordinata, unita: 'mm' });
      const y = leggiNumero(C, f.y, campo + '.y', { min: -LIMITI.coordinata, max: LIMITI.coordinata, unita: 'mm' });
      const r = leggiNumero(C, f.r, campo + '.r', { min: LIMITI.misura_min, max: LIMITI.misura_max, unita: 'mm' });
      if (x === undefined || y === undefined || r === undefined) foriOk = false;
      else tondi.push({ x, y, r });
    });
  }
  // I fori stanno dentro il profilo senza toccarne il bordo e non si toccano fra loro: così il volume
  // è l'area del profilo meno quella dei fori, e il disegno non ha pareti di spessore zero.
  if (profilo && foriOk) {
    fori.forEach((F, i) => {
      if (!puntoInPoligono(profilo, F[0][0], F[0][1]) || latiSiToccano(F, profilo)) C.err(`misure.fori[${i}]`, 'esce dal profilo o ne tocca il bordo');
    });
    tondi.forEach((f, i) => {
      if (!puntoInPoligono(profilo, f.x, f.y) || !cerchioLontanoDaiLati(profilo, f.x, f.y, f.r)) C.err(`misure.fori_tondi[${i}]`, 'esce dal profilo o ne tocca il bordo');
    });
    for (let i = 0; i < fori.length; i++) {
      for (let j = i + 1; j < fori.length; j++) {
        if (latiSiToccano(fori[i], fori[j]) || puntoInPoligono(fori[j], fori[i][0][0], fori[i][0][1]) || puntoInPoligono(fori[i], fori[j][0][0], fori[j][0][1])) {
          C.err(`misure.fori[${i}]`, `tocca misure.fori[${j}]: i fori non si possono sovrapporre`);
        }
      }
      tondi.forEach((f, j) => {
        if (puntoInPoligono(fori[i], f.x, f.y) || !cerchioLontanoDaiLati(fori[i], f.x, f.y, f.r)) C.err(`misure.fori_tondi[${j}]`, `tocca misure.fori[${i}]: i fori non si possono sovrapporre`);
      });
    }
    for (let i = 0; i < tondi.length; i++) {
      for (let j = i + 1; j < tondi.length; j++) {
        const a = tondi[i], b = tondi[j], dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy <= (a.r + b.r) * (a.r + b.r)) C.err(`misure.fori_tondi[${i}]`, `tocca misure.fori_tondi[${j}]: i fori non si possono sovrapporre`);
      }
    }
  }
  return { profilo, profondita, fori, fori_tondi: tondi };
}

function leggiRivoluzione(C, m) {
  let profilo = leggiPunti(C, m.profilo, 'misure.profilo', 2, 2, LIMITI.punti_profilo);
  if (!profilo) return { profilo };
  for (let i = 0; i < profilo.length; i++) {
    if (profilo[i][0] < 0) { C.err(`misure.profilo[${i}]`, `ha r = ${profilo[i][0]}: r è la distanza dall'asse Y e non può essere negativa`); return { profilo: undefined }; }
  }
  profilo = senzaDoppi(C, profilo, 'misure.profilo');
  const a = profilo[0], b = profilo[profilo.length - 1];
  if (profilo.length > 1 && uguali(a, b)) {
    // Chiuso a mano sull'asse è lo stesso profilo: l'ultimo si toglie. Fuori dall'asse è un anello e il punto resta, perché
    // è lui che lo dice a poligonoRivoluzione; un anello però non può toccare l'asse
    if (a[0] === 0) profilo.pop();
    else if (profilo.some((p) => p[0] === 0)) {
      C.err('misure.profilo', "finisce dove comincia, come un anello, ma tocca l'asse Y: un anello sta tutto fuori dall'asse (r > 0)");
      return { profilo: undefined };
    }
  }
  const Q = poligonoRivoluzione(profilo);
  if (Q.length < 3) { C.err('misure.profilo', "deve avere almeno un punto fuori dall'asse Y"); return { profilo: undefined }; }
  // Il poligono deve essere semplice: un punto sull'asse a metà profilo farebbe due solidi uniti in un punto.
  if (!controllaPoligono(C, Q, anelloRivoluzione(Q) ? 'misure.profilo, chiuso su sé stesso come anello,' : 'misure.profilo, chiuso dall\'asse,')) return { profilo: undefined };
  return { profilo };
}

function leggiPercorso(C, v) {
  const campo = 'misure.file';
  if (typeof v !== 'string' || !v.trim()) { C.err(campo, `${v == null ? 'manca' : `non va bene (${mostra(v)})`}: serve il percorso assoluto del file, ${ESTENSIONI.join(', ')}`); return undefined; }
  const s = v.trim();
  if (s.length > PERCORSO_MAX || s.includes('\0')) { C.err(campo, `non è un percorso valido (al massimo ${PERCORSO_MAX} caratteri)`); return undefined; }
  if (!s.startsWith('/')) { C.err(campo, `deve essere un percorso assoluto, che comincia con /: non ${mostra(s)}`); return undefined; }
  if (s.split('/').some((p) => p.startsWith('.'))) { C.err(campo, 'non può passare da cartelle nascoste, né da . o ..'); return undefined; }
  const punto = s.lastIndexOf('.'), est = punto > s.lastIndexOf('/') ? s.slice(punto + 1).toLowerCase() : '';
  if (!ESTENSIONI.includes(est)) { C.err(campo, `ha l'estensione ${mostra(est)}: vanno bene ${ESTENSIONI.join(', ')}`); return undefined; }
  return s;
}

// Il colore dell'oggetto vero (11/11, richiesta di Tony): l'ossigeno rosso e gli idrogeni bianchi di una molecola. Prima
// arrivava come campo sconosciuto e si ignorava. Solo esadecimale, «#rrggbb» o «#rgb», normalizzato in «#rrggbb» minuscolo:
// la scena lo legge come numero e non lo passa mai a un parser CSS. Come si disegna (e in quali modi) lo decide scena.js.
const COLORE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function leggiColore(C, v) {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return null; // vuoto: nessun colore, e in cambia lo toglie
  const s = typeof v === 'string' ? v.trim() : '';
  if (!COLORE.test(s)) { C.err('colore', `${mostra(v)} non è un colore: serve un esadecimale come "#e53935" o "#e53"; vuoto o null lo toglie`); return undefined; }
  const h = s.slice(1).toLowerCase();
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
}

const CAMPI_PEZZO = ['id', 'nome', 'forma', 'misure', 'posizione', 'rotazione', 'materiale', ...CAMPI_RICERCA, 'gruppo', 'esplodi', 'interno', 'colore', 'flusso', 'calcolo'];

function normalizzaPezzoIn(p, posto) {
  if (!oggetto(p)) return { pezzo: null, errori: [`${posto}: deve essere un oggetto { id, forma, misure, … }, non ${mostra(p)}`], avvisi: [] };
  const idOk = typeof p.id === 'string' && ID.test(p.id);
  const C = contesto(idOk ? `pezzo «${p.id}»` : posto);
  if (!idOk) {
    C.err('id', `${p.id == null ? 'manca' : `${mostra(p.id)} non va bene`}: servono da 1 a 40 fra minuscole, cifre, - e _, e il primo carattere è una minuscola o una cifra`);
  }
  sconosciuti(C, p, CAMPI_PEZZO);
  const forma = p.forma, sp = typeof forma === 'string' && Object.hasOwn(SPECIE, forma) ? SPECIE[forma] : null;
  if (!sp) C.err('forma', `${forma == null ? 'manca' : `${mostra(forma)} è sconosciuta`}: le forme sono ${FORME.join(', ')}`);
  let misure;
  if (sp && !oggetto(p.misure)) C.err('misure', `${p.misure == null ? 'mancano' : `devono essere un oggetto, non ${mostra(p.misure)}`}: per ${forma} servono ${sp.chiavi.join(', ')}`);
  else if (sp) {
    sconosciuti(C, p.misure, sp.chiavi, 'misure');
    misure = sp.leggi(C, p.misure);
  }
  const nome = leggiTesto(C, p.nome, 'nome', TESTO_MAX.nome, { facoltativo: true, predefinito: idOk ? p.id : '' });
  const posizione = p.posizione == null ? [0, 0, 0] : leggiVettore(C, p.posizione, 'posizione', LIMITI.coordinata, 'mm');
  const rotazione = p.rotazione == null ? [0, 0, 0] : leggiVettore(C, p.rotazione, 'rotazione', LIMITI.coordinata, 'gradi');
  let materiale = 'generico';
  if (p.materiale != null) {
    if (typeof p.materiale === 'string' && Object.hasOwn(MATERIALI, p.materiale)) materiale = p.materiale;
    else C.err('materiale', `${mostra(p.materiale)} è sconosciuto: i materiali sono ${Object.keys(MATERIALI).join(', ')}`);
  }
  // Come nome: testo, spazi puliti, i più lunghi tagliati con un avviso. Vuoto vale non detto, e in cambia toglie il campo.
  const ricerca = {};
  for (const k of CAMPI_RICERCA) ricerca[k] = leggiTesto(C, p[k], k, TESTO_MAX[k], { facoltativo: true, predefinito: null });
  const gruppo = leggiTesto(C, p.gruppo, 'gruppo', TESTO_MAX.gruppo, { facoltativo: true, predefinito: null, taglia: false });
  let esplodi = null;
  if (p.esplodi != null) {
    esplodi = leggiVettore(C, p.esplodi, 'esplodi', ESPLODI_MAX, '');
    if (esplodi && Math.hypot(...esplodi) > ESPLODI_MAX) { C.err('esplodi', `è lungo ${giu(Math.hypot(...esplodi))}: al massimo ${ESPLODI_MAX}`); esplodi = undefined; }
  }
  const interno = leggiBooleano(C, p.interno, 'interno', false);
  const colore = leggiColore(C, p.colore);
  let flusso = null;
  if (p.flusso != null) {
    if (forma !== 'cavo') C.avv('flusso', 'vale solo per i cavi: ignorato');
    else if (FLUSSI.includes(p.flusso)) flusso = p.flusso;
    else C.err('flusso', `${mostra(p.flusso)} è sconosciuto: i flussi sono ${FLUSSI.join(', ')}`);
  }
  let calcolo = leggiBooleano(C, p.calcolo, 'calcolo', !PREDEFINITI.senza_calcolo.includes(forma));
  if (forma === 'file' && calcolo === true) { C.avv('calcolo', "resta false: il server non apre i file, quindi un pezzo 'file' non entra nel calcolo"); calcolo = false; }
  if (C.errori.length) return { pezzo: null, errori: C.errori, avvisi: C.avvisi };
  return { pezzo: { id: p.id, nome, forma, misure, posizione, rotazione, materiale, ...ricerca, gruppo, esplodi, interno, colore, flusso, calcolo }, errori: [], avvisi: C.avvisi };
}

/** Un pezzo dal cervello → { pezzo, errori, avvisi }: con i predefiniti, i numeri controllati e oggetti tutti nuovi; pezzo è null se ci sono errori. */
export function normalizzaPezzo(p) {
  return normalizzaPezzoIn(p, 'pezzo');
}

// id → pezzo (o null se si conosce solo l'id), da una lista di pezzi o di id.
function mappaPezzi(pezzi) {
  const m = new Map();
  for (const p of pezzi || []) {
    if (typeof p === 'string') m.set(p, null);
    else if (p && typeof p.id === 'string') m.set(p.id, p);
  }
  return m;
}

const elenco = (ids) => { const a = [...ids]; return a.slice(0, 12).join(', ') + (a.length > 12 ? ` e altri ${a.length - 12}` : ''); };

function riferimento(C, v, mappa, cosa) {
  if (typeof v !== 'string' || !mappa.has(v)) {
    C.err('pezzo', `${v == null ? 'manca' : `${mostra(v)} non esiste`}: ${mappa.size ? 'i pezzi sono ' + elenco(mappa.keys()) : 'non ci sono pezzi'}`);
    return undefined;
  }
  const p = mappa.get(v);
  if (p && p.calcolo === false) C.avv('pezzo', `«${v}» non entra nel calcolo (calcolo: false): questo ${cosa} non conterà`);
  return v;
}

function leggiFaccia(C, v) {
  if (FACCE.includes(v)) return v;
  C.err('faccia', `${v == null ? 'manca' : `${mostra(v)} è sconosciuta`}: le facce sono ${FACCE.join(', ')}, con gli assi del mondo`);
  return undefined;
}

function lista(nome, v, massimo) {
  if (v == null) return { lista: [] };
  if (!Array.isArray(v)) return { errore: `${nome}: deve essere una lista, non ${mostra(v)}` };
  if (v.length > massimo) return { errore: `${nome}: sono ${v.length}, al massimo ${massimo}` };
  return { lista: v };
}

/** Carichi { pezzo, faccia, forza_N, direzione } → { carichi, errori, avvisi }, con la direzione normalizzata; pezzi è la lista dei pezzi (o dei loro id). */
export function normalizzaCarichi(lista_, pezzi) {
  const l = lista('carichi', lista_, LIMITI.carichi);
  if (l.errore) return { carichi: null, errori: [l.errore], avvisi: [] };
  const mappa = mappaPezzi(pezzi), carichi = [], errori = [], avvisi = [];
  l.lista.forEach((c, i) => {
    const C = contesto(`carichi[${i}]`);
    if (!oggetto(c)) C.err('', `deve essere un oggetto { pezzo, faccia, forza_N, direzione }, non ${mostra(c)}`);
    else {
      sconosciuti(C, c, ['pezzo', 'faccia', 'forza_N', 'direzione']);
      const pezzo = riferimento(C, c.pezzo, mappa, 'carico');
      const faccia = leggiFaccia(C, c.faccia);
      const forza_N = leggiNumero(C, c.forza_N, 'forza_N', { min: 0, minEscluso: true, max: FORZA_MAX, unita: 'N' });
      let direzione = leggiVettore(C, c.direzione, 'direzione', LIMITI.coordinata, '');
      if (direzione) {
        const n = Math.hypot(...direzione);
        if (n === 0) { C.err('direzione', 'è nulla: serve un vettore [x, y, z] diverso da zero, per esempio [0, -1, 0] verso il basso'); direzione = undefined; }
        else direzione = direzione.map((v) => v / n);
      }
      if (!C.errori.length) carichi.push({ pezzo, faccia, forza_N, direzione });
    }
    errori.push(...C.errori);
    avvisi.push(...C.avvisi);
  });
  return { carichi: errori.length ? null : carichi, errori, avvisi };
}

/** Vincoli { pezzo, faccia, tipo: 'incastro' } → { vincoli, errori, avvisi }; tipo, se manca, è 'incastro'. */
export function normalizzaVincoli(lista_, pezzi) {
  const l = lista('vincoli', lista_, LIMITI.vincoli);
  if (l.errore) return { vincoli: null, errori: [l.errore], avvisi: [] };
  const mappa = mappaPezzi(pezzi), vincoli = [], errori = [], avvisi = [];
  l.lista.forEach((v, i) => {
    const C = contesto(`vincoli[${i}]`);
    if (!oggetto(v)) C.err('', `deve essere un oggetto { pezzo, faccia, tipo: 'incastro' }, non ${mostra(v)}`);
    else {
      sconosciuti(C, v, ['pezzo', 'faccia', 'tipo']);
      const pezzo = riferimento(C, v.pezzo, mappa, 'vincolo');
      const faccia = leggiFaccia(C, v.faccia);
      if (v.tipo != null && v.tipo !== 'incastro') C.err('tipo', `${mostra(v.tipo)} è sconosciuto: c'è solo 'incastro', che blocca i tre spostamenti`);
      if (!C.errori.length) vincoli.push({ pezzo, faccia, tipo: 'incastro' });
    }
    errori.push(...C.errori);
    avvisi.push(...C.avvisi);
  });
  return { vincoli: errori.length ? null : vincoli, errori, avvisi };
}

function leggiSezione(C, s, attuale) {
  if (s === null) return null;
  if (!oggetto(s)) { C.err('sezione', `deve essere null oppure { asse, posizione, verso }, non ${mostra(s)}`); return attuale; }
  sconosciuti(C, s, ['asse', 'posizione', 'verso'], 'sezione');
  const prima = attuale || { asse: undefined, posizione: 0, verso: 1 }; // si cambia anche un campo solo
  const asse = s.asse !== undefined ? s.asse : prima.asse;
  if (asse !== 'x' && asse !== 'y' && asse !== 'z') C.err('sezione.asse', `${asse === undefined ? 'manca' : `${mostra(asse)} è sconosciuto`}: 'x', 'y' o 'z'`);
  const posizione = s.posizione !== undefined
    ? leggiNumero(C, s.posizione, 'sezione.posizione', { min: -LIMITI.coordinata, max: LIMITI.coordinata, unita: 'mm del mondo' })
    : prima.posizione;
  const verso = s.verso !== undefined ? s.verso : prima.verso;
  if (verso !== 1 && verso !== -1) C.err('sezione.verso', `deve essere 1 o -1, non ${mostra(verso)}`);
  return { asse, posizione, verso };
}

/**
 * Vista parziale → { vista, errori, avvisi }, completata da base (la vista attuale, o i predefiniti).
 * idValidi sono gli id dei pezzi (lista o Set); se è null gli id non si controllano. Un pezzo
 * selezionato o isolato che nella base non c'è più torna a null, con un avviso.
 */
export function normalizzaVista(v, idValidi, base) {
  const C = contesto('vista'), P = PREDEFINITI.vista, b = oggetto(base) ? base : P;
  const ids = idValidi == null ? null : new Set([...idValidi].map((x) => (typeof x === 'string' ? x : x && x.id)));
  const vista = {};
  for (const k of Object.keys(P)) vista[k] = b[k] !== undefined ? b[k] : P[k];
  if (vista.sezione) vista.sezione = { ...vista.sezione };
  if (v != null && !oggetto(v)) C.err('', `deve essere un oggetto { ${Object.keys(P).join(', ')} }, non ${mostra(v)}`);
  else if (v != null) {
    sconosciuti(C, v, Object.keys(P));
    if (v.esploso !== undefined) {
      const e = leggiNumero(C, v.esploso, 'esploso', { min: 0, max: 1 });
      if (e !== undefined) vista.esploso = e;
    }
    if (v.sezione !== undefined) vista.sezione = leggiSezione(C, v.sezione, vista.sezione);
    if (v.modo !== undefined) {
      if (MODI.includes(v.modo)) vista.modo = v.modo;
      else C.err('modo', `${mostra(v.modo)} è sconosciuto: i modi sono ${MODI.join(', ')}`);
    }
    for (const k of ['selezionato', 'isolato']) {
      if (v[k] === undefined) continue;
      if (v[k] === null || (typeof v[k] === 'string' && (!ids || ids.has(v[k])))) vista[k] = v[k];
      else C.err(k, `${mostra(v[k])} non è un pezzo${ids ? ': i pezzi sono ' + elenco(ids) : ''}`);
    }
  }
  if (ids) for (const k of ['selezionato', 'isolato']) {
    if (vista[k] !== null && !ids.has(vista[k])) { C.avv(k, `«${vista[k]}» non c'è più: torna a null`); vista[k] = null; }
  }
  return { vista: C.errori.length ? null : vista, errori: C.errori, avvisi: C.avvisi };
}

/**
 * Titolo e descrizione cambiati con modifica, con le stesse regole di normalizzaModello (≤ 80 e ≤ 300 caratteri,
 * i più lunghi tagliati con un avviso): { testi, errori, avvisi }. testi ha solo i campi dati, ed è null se c'è un errore.
 */
export function normalizzaTesti({ titolo, descrizione } = {}) {
  const C = contesto('modello'), testi = {};
  if (titolo !== undefined) testi.titolo = leggiTesto(C, titolo, 'titolo', TESTO_MAX.titolo);
  if (descrizione !== undefined) testi.descrizione = leggiTesto(C, descrizione, 'descrizione', TESTO_MAX.descrizione, { facoltativo: true, predefinito: '' });
  return { testi: C.errori.length ? null : testi, errori: C.errori, avvisi: C.avvisi };
}

// La massa a parole, una regola sola per il testo del cervello e per l'HUD: tre cifre significative, in g sotto 1 kg
// e in mg sotto 1 g. Prima il testo diceva 2470 kg e l'HUD 2475 KG per lo stesso turbofan.
const CIFRE3 = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 3, useGrouping: false });
export function massaTesto(kg) {
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg < 0) return '';
  const r = Number(kg.toPrecision(3)); // prima si arrotonda, poi si sceglie l'unità: 0,9996 kg è 1 kg, non 1000 g
  if (r >= 1 || r === 0) return `${CIFRE3.format(r)} kg`;
  return r >= 1e-3 ? `${CIFRE3.format(r * 1e3)} g` : `${CIFRE3.format(r * 1e6)} mg`;
}

/**
 * Un modello dal cervello → { modello, errori, avvisi }: titolo, descrizione, pezzi con id unici,
 * carichi, vincoli e vista completa. modello è null se c'è anche un solo errore.
 */
export function normalizzaModello(m) {
  const C = contesto('modello');
  if (!oggetto(m)) {
    C.err('', `deve essere un oggetto { titolo, pezzi, carichi?, vincoli?, vista? }, non ${mostra(m)}`);
    return { modello: null, errori: C.errori, avvisi: C.avvisi };
  }
  sconosciuti(C, m, ['titolo', 'descrizione', 'pezzi', 'carichi', 'vincoli', 'vista']);
  const titolo = leggiTesto(C, m.titolo, 'titolo', TESTO_MAX.titolo);
  const descrizione = leggiTesto(C, m.descrizione, 'descrizione', TESTO_MAX.descrizione, { facoltativo: true, predefinito: '' });
  const pezzi = [], noti = new Map(); // id → pezzo normalizzato, o l'id solo se il pezzo ha errori: niente errori a catena
  if (!Array.isArray(m.pezzi)) C.err('pezzi', `${m.pezzi == null ? 'mancano' : `devono essere una lista, non ${mostra(m.pezzi)}`}: da 1 a ${LIMITI.pezzi} pezzi`);
  else if (m.pezzi.length < 1) C.err('pezzi', 'è vuoto: serve almeno un pezzo');
  else if (m.pezzi.length > LIMITI.pezzi) C.err('pezzi', `sono ${m.pezzi.length}: al massimo ${LIMITI.pezzi}`);
  else {
    const primo = new Map();
    m.pezzi.forEach((p, i) => {
      const r = normalizzaPezzoIn(p, `pezzi[${i}]`);
      C.errori.push(...r.errori);
      C.avvisi.push(...r.avvisi);
      const id = oggetto(p) && typeof p.id === 'string' && ID.test(p.id) ? p.id : null;
      if (id !== null && primo.has(id)) C.err(`pezzi[${i}].id`, `«${id}» è doppio, c'è già in pezzi[${primo.get(id)}]: ogni pezzo vuole un id diverso`);
      else if (id !== null) { primo.set(id, i); noti.set(id, r.pezzo || id); }
      if (r.pezzo) pezzi.push(r.pezzo);
    });
  }
  const riferimenti = [...noti.values()];
  const car = normalizzaCarichi(m.carichi, riferimenti), vin = normalizzaVincoli(m.vincoli, riferimenti);
  const vis = normalizzaVista(m.vista, noti.keys(), PREDEFINITI.vista);
  for (const r of [car, vin, vis]) { C.errori.push(...r.errori); C.avvisi.push(...r.avvisi); }
  if (C.errori.length) return { modello: null, errori: C.errori, avvisi: C.avvisi };
  return { modello: { titolo, descrizione, pezzi, carichi: car.carichi, vincoli: vin.vincoli, vista: vis.vista }, errori: [], avvisi: C.avvisi };
}
