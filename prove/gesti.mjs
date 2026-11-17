// Prova di public/ologramma/gesti.js con mani sintetiche: una mano modello di 21 punti in mm in cui si muovono pollice
// e indice, messa nell'immagine come la vedrebbe la fotocamera. node prove/gesti.mjs → PASS o FAIL per ogni caso;
// esce con 0 solo se passa tutto.
// I casi principali (rotazione, afferra-sposta-lascia, lancio, zoom ed esplodi) girano due volte: con innesco_ms 0, cioè
// sempre pronti come prima del 10/11, e con le opzioni predefinite, passando dall'innesco del palmo aperto.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createGesti, mappa, testoMisure, PREDEFINITI as P } from '../public/ologramma/gesti.js';

const DT = 1000 / 30; // 30 fotogrammi al secondo, come la fotocamera
// L'immagine è alta 470 mm alla distanza della mano: 50 cm da una fotocamera con 50° in verticale (stima, non misurata
// sulla fotocamera di Tony). Serve solo a dare i mm/s alle sequenze: gesti.js li ricava dal palmo.
const MM = 470, ZM = P.zona_morta;
let passati = 0, falliti = 0, numeriCattivi = 0;
const prova = (nome, ok, dettagli = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${dettagli ? ` — ${dettagli}` : ''}`); ok ? passati++ : falliti++; };
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));
const f4 = (v) => (Number.isFinite(v) ? v.toFixed(4) : String(v));

// numeri casuali ripetibili (mulberry32) e gaussiani (Box-Muller)
let rng;
const semi = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

// La mano modello: destra, palmo verso la fotocamera, dita in su (y dell'immagine in giù), polso nell'origine.
// Palmo 0→9 di 92 mm, poi scalato a palmo_mm; indice 5→6→7→8 lungo 90 mm.
const BASE = [[0, 0], [-25, -20], [-45, -40], [-58, -58], [-68, -74], [-22, -88], [-26, -133], [-28, -158], [-29, -178],
  [0, -92], [0, -142], [0, -172], [0, -195], [20, -86], [23, -131], [25, -158], [26, -180], [38, -76], [43, -108], [46, -127], [48, -145]];
const K = P.palmo_mm / 92, PALMO_H = P.palmo_mm / MM; // il palmo in altezze d'immagine
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// s: { x, y } polso in coordinate normalizzate, r rapporto del pizzico voluto, lato, rumore (σ normalizzata),
// imb e bec: la mano girata di tanti gradi attorno all'asse verticale (imbardata) e poi a quello orizzontale (beccheggio).
// La z esce come quella di MediaPipe: origine al polso, con la scala della x (mm diviso la larghezza dell'immagine).
// pugno da 0 (mano aperta) a 1 (le quattro dita chiuse sul palmo); pr è il rapporto pollice-indice dentro il pugno.
// In seq() pugno va messo anche nello stato di partenza, se no l'interpolazione dà NaN e la mano resta aperta.
function mano({ x, y, r = 1.2, lato = 'Right', rumore = 0, imb = 0, bec = 0, pugno = 0, pr = 0.6 }) {
  const p = BASE.map(([a, b]) => [a * K, b * K]);
  // l'indice si piega verso il pollice mentre il pizzico si chiude: 7→8 gira attorno a 7, fino a 15°, la lunghezza resta
  const phi = -0.26 * (1 - Math.min(r, 1.2) / 1.2), c = Math.cos(phi), s = Math.sin(phi);
  const [x7, y7] = p[7], vx = p[8][0] - x7, vy = p[8][1] - y7;
  p[8] = [x7 + vx * c - vy * s, y7 + vx * s + vy * c];
  // il pollice: la punta va verso quella dell'indice finché distano r volte la lunghezza dell'indice
  const L = dist(p[5], p[6]) + dist(p[6], p[7]) + dist(p[7], p[8]), u = dist(p[4], p[8]);
  p[4] = [p[8][0] + ((p[4][0] - p[8][0]) / u) * r * L, p[8][1] + ((p[4][1] - p[8][1]) / u) * r * L];
  p[3] = [(p[2][0] + p[4][0]) / 2, (p[2][1] + p[4][1]) / 2];
  if (pugno > 0) { // le dita si chiudono verso il polso (l'origine); il pollice si appoggia sull'indice chiuso
    const lerp = (a, b) => [a[0] + (b[0] - a[0]) * pugno, a[1] + (b[1] - a[1]) * pugno];
    for (const k of [5, 9, 13, 17]) [0.98, 0.82, 0.72].forEach((f, j) => { p[k + 1 + j] = lerp(p[k + 1 + j], [p[k][0] * f, p[k][1] * f]); });
    const Lf = dist(p[5], p[6]) + dist(p[6], p[7]) + dist(p[7], p[8]);
    p[4] = lerp(p[4], [p[8][0] - pr * Lf, p[8][1]]);
    p[3] = [(p[2][0] + p[4][0]) / 2, (p[2][1] + p[4][1]) / 2];
  }
  const sx = lato === 'Left' ? -1 : 1; // la sinistra è lo specchio della destra
  const n = () => (rumore ? rumore * gauss() : 0);
  const ci = Math.cos((imb * Math.PI) / 180), si = Math.sin((imb * Math.PI) / 180), cb = Math.cos((bec * Math.PI) / 180), sb = Math.sin((bec * Math.PI) / 180);
  return { lato, punti: p.map(([a, b]) => {
    const X = a * ci, Z0 = -a * si, Y = b * cb - Z0 * sb, Z = b * sb + Z0 * cb;
    return { x: x + (sx * X) / MM / P.aspetto + n(), y: y + Y / MM + n(), z: Z / MM / P.aspetto };
  }) };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const schermo = (q) => ({ x: clamp01(mappa(q.x)), y: clamp01(mappa(q.y)) }); // la stessa mappa di gesti.js e di nexus.js
const puntaN = (s) => mano({ ...s, rumore: 0 }).punti[8];   // la punta dell'indice vera, normalizzata, senza filtro
const punta = (s) => schermo(puntaN(s));                   // il cursore vero, senza filtro né zona morta
// l'inversa della mappa (bisezione: è monotona), per tornare dallo schermo all'immagine
function inversa(v) { let a = -2, b = 3; for (let k = 0; k < 80; k++) { const m = (a + b) / 2; if (mappa(m) < v) a = m; else b = m; } return (a + b) / 2; }
// La zona morta a corda sulla traiettoria vera (in altezze d'immagine): il modello di quello che fa gesti.js dopo il filtro
function corda(punti) {
  let ax = punti[0][0], ay = punti[0][1];
  return punti.map(([x, y]) => { const dx = x - ax, dy = y - ay, d = Math.hypot(dx, dy); if (d > ZM) { ax += (dx * (d - ZM)) / d; ay += (dy * (d - ZM)) / d; } return [ax, ay]; });
}
const inAltezze = (q) => [q.x * P.aspetto, q.y];
const daAltezze = ([X, Y]) => ({ x: X / P.aspetto, y: Y });

// Una sequenza di stati per fotogramma, interpolati linearmente fra tappe [fotogrammi, {campi che cambiano}]
function seq(inizio, ...tappe) {
  const out = [{ ...inizio }];
  for (const [n, fine] of tappe) {
    const a = out[out.length - 1], b = { ...a, ...fine };
    for (let i = 1; i <= n; i++) out.push(Object.fromEntries(Object.keys(b).map((k) => [k, typeof b[k] === 'number' ? a[k] + ((b[k] - a[k]) * i) / n : b[k]])));
  }
  return out;
}
const unaMano = (stati) => stati.map((s) => [mano(s)]);
const dueMani = (A, B) => A.map((s, i) => [mano(s), mano(B[i])]);

// Fotogrammi da mettere davanti perché il palmo aperto del primo fotogramma faccia l'innesco: stabile, poi innesco_ms
const PRE = P.stabile + Math.ceil(P.innesco_ms / DT) + 2;
// Fa girare gesti.js e controlla che ogni numero in uscita sia finito, e x e y dentro lo schermo. pre: tanti fotogrammi
// uguali al primo, davanti, per passare dall'innesco; gli indici degli eventi restano quelli della sequenza.
function gira(fotogrammi, opzioni, g = createGesti(opzioni), t0 = 1000, pre = 0) {
  const ev = [], tutti = [...Array(pre).fill(fotogrammi[0]), ...fotogrammi];
  tutti.forEach((mani, i) => {
    for (const e of g.aggiorna(mani, t0 + i * DT)) {
      for (const [k, v] of Object.entries(e)) if (typeof v === 'number' && (!Number.isFinite(v) || ((k === 'x' || k === 'y') && (v < 0 || v > 1)))) numeriCattivi++;
      ev.push({ i: i - pre, t: t0 + i * DT, ...e });
    }
  });
  return { ev, g };
}
const gesti = (ev) => ev.filter((e) => e.tipo !== 'cursore' && e.tipo !== 'stato');
const nomi = (ev) => gesti(ev).map((e) => e.tipo);
const fasi = (ev) => ev.filter((e) => e.tipo === 'stato').map((e) => e.fase);
const somma = (ev, tipo, campo, filtro = () => true) => ev.filter((e) => e.tipo === tipo && filtro(e)).reduce((s, e) => s + e[campo], 0);
const conta = (ev, tipo) => ev.filter((e) => e.tipo === tipo).length;
const vel = (v) => (v * DT) / MM / P.aspetto; // v in m/s (= mm/ms) → x normalizzata per fotogramma
const SEMPRE = { innesco_ms: 0 };
const MODI = [['sempre pronti', SEMPRE, 0], ['predefinite, con l\'innesco', undefined, PRE]];

// 0. La mappa a S ---------------------------------------------------------------------------------------------------------
{
  const lin = 1 / (1 - 2 * P.margine), h = 1e-6, der = (n, c) => (mappa(n + h, P.margine, c) - mappa(n - h, P.margine, c)) / (2 * h);
  const centro = der(0.5, P.curva) / lin, bordo = der(P.margine + 1e-3, P.curva) / lin, fuori = der(P.margine - 0.05, P.curva) / lin;
  let monotona = true, salto = 0;
  for (let n = -0.5; n < 1.5; n += 1e-4) { const a = mappa(n), b = mappa(n + 1e-4); if (!(b > a)) monotona = false; salto = Math.max(salto, b - a); }
  prova(`mappa a S (curva ${P.curva}): al centro più precisa del lineare (guadagno ${1 - P.curva}), ai bordi più veloce (${1 + 2 * P.curva}), bordi raggiunti, monotona e continua`,
    centro < 1 && bordo > 1 && Math.abs(centro - (1 - P.curva)) < 1e-6 && Math.abs(bordo - (1 + 2 * P.curva)) < 1e-2 && Math.abs(fuori - (1 + 2 * P.curva)) < 1e-6 &&
    Math.abs(mappa(P.margine)) < 1e-12 && Math.abs(mappa(1 - P.margine) - 1) < 1e-12 && Math.abs(mappa(0.5) - 0.5) < 1e-12 && monotona && salto < 3 * lin * 1e-4,
    `guadagno sul lineare: centro ${centro.toFixed(4)}, bordo ${bordo.toFixed(4)}, fuori ${fuori.toFixed(4)}; mappa(${P.margine}) = ${mappa(P.margine).toFixed(6)}, mappa(${1 - P.margine}) = ${mappa(1 - P.margine).toFixed(6)}; passo massimo ${salto.toExponential(2)} su 1e-4`);
  // il cursore di gesti.js è proprio clamp(mappa(punta)): senza filtro e senza zona morta coincide coi pallini di nexus.js
  const stati = seq({ x: 0.2, y: 0.8, r: 1.2 }, [8, {}], [40, { x: 0.8, y: 0.5 }]);
  const cur = gira(unaMano(stati), { ...SEMPRE, mincutoff: 1e6, zona_morta: 0 }).ev.filter((e) => e.tipo === 'cursore');
  const err = Math.max(...cur.map((e) => { const v = punta(stati[e.i]); return Math.hypot(e.x - v.x, e.y - v.y); }));
  prova('il cursore è clamp(mappa(punta)), la stessa funzione dei pallini delle dita', cur.length > 40 && err < 1e-6, `${cur.length} cursori, scarto massimo ${err.toExponential(1)}`);
}

// 1. Pizzico con isteresi ------------------------------------------------------------------------------------------
{
  // senza filtro (taglio a 1 MHz), così il rapporto è proprio quello costruito
  const rs = [1.2, 1.2, 1.2, 1.2, 1.2, 0.6, 0.4, 0.3, 0.26, 0.24, 0.3, 0.5, 0.7, 0.74, 0.76, 0.7, 0.5, 0.3, 0.26, 0.24];
  const atteso = rs.map((r, i) => (i >= 9 && i <= 13) || i === 19);
  const g = createGesti({ mincutoff: 1e6 }), visto = [], rapporti = [];
  rs.forEach((r, i) => { g.aggiorna([mano({ x: 0.5, y: 0.75, r })], 1000 + i * DT); const m = g.stato().mani[0]; visto.push(m.pizzico); rapporti.push(m.rapporto); });
  const errR = Math.max(...rs.map((r, i) => Math.abs(rapporti[i] - r)));
  prova('pizzico: chiude sotto 0,25 e apre sopra 0,75, non in mezzo', atteso.every((v, i) => v === visto[i]) && errR < 1e-4,
    `stati ${visto.map((v) => (v ? 'C' : 'a')).join('')}, attesi ${atteso.map((v) => (v ? 'C' : 'a')).join('')}; rapporto calcolato contro costruito: errore massimo ${errR.toExponential(1)}`);

  // col filtro vero: il rapporto oscilla di ±0,04 attorno a ciascuna soglia per 2 s
  rng = semi(1);
  const stati = [...seq({ x: 0.5, y: 0.75, r: 1.2 }, [9, {}])];
  for (let i = 0; i < 60; i++) stati.push({ x: 0.5, y: 0.75, r: 0.25 + 0.08 * (rng() - 0.5) });
  for (let i = 0; i < 60; i++) stati.push({ x: 0.5, y: 0.75, r: 0.75 + 0.08 * (rng() - 0.5) });
  const g2 = createGesti(SEMPRE);
  let cambi = 0, prima = false, ev = [];
  stati.forEach((s, i) => { ev.push(...g2.aggiorna([mano(s)], 1000 + i * DT)); const p = g2.stato().mani[0].pizzico; if (p !== prima) cambi++; prima = p; });
  // per confronto, quante volte cambierebbe una soglia sola (0,25 nella prima metà, 0,75 nella seconda) sul rapporto grezzo
  let ingenui = 0;
  for (let i = 11; i < stati.length; i++) { const soglia = i < 70 ? 0.25 : 0.75; if ((stati[i].r < soglia) !== (stati[i - 1].r < soglia)) ingenui++; }
  const n = nomi(ev);
  prova('pizzico: niente sfarfallio vicino alle soglie', cambi === 2 && n.filter((t) => t !== 'sposta').join(',') === 'afferra,lascia',
    `${cambi} cambi di stato (attesi 2) e gesti ${[...new Set(n)].join(',') || 'nessuno'} (sposta perché nel modello l'indice si piega col pizzico); una soglia sola sul rapporto grezzo ne avrebbe fatti ${ingenui}`);
}

// 2. Rotazione dal trascinamento del pizzico ------------------------------------------------------------------------
// Atteso: la differenza fra le posizioni mappate della punta a corda all'inizio della rotazione e alla fine
for (const [modo, opz, pre] of MODI) {
  const stati = seq({ x: 0.4, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.6, y: 0.65 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(unaMano(stati), opz, undefined, 1000, pre);
  const traccia = corda(stati.map((s) => inAltezze(puntaN(s)))), primo = ev.find((e) => e.tipo === 'ruota');
  // la rotazione parte dal punto in cui il pizzico si è chiuso: il fotogramma prima del primo 'ruota' in cui la mano era ancora ferma
  const iChiuso = stati.findIndex((s, i) => i > 8 && s.r < 1.2 && s.x === 0.4 && stati[i + 1]?.x !== 0.4);
  const a = daAltezze(traccia[iChiuso]), b = daAltezze(traccia[stati.length - 9]);
  const adx = mappa(b.x) - mappa(a.x), ady = mappa(b.y) - mappa(a.y);
  const dx = somma(ev, 'ruota', 'dx'), dy = somma(ev, 'ruota', 'dy');
  const altri = nomi(ev).filter((t) => t !== 'ruota');
  prova(`ruota (${modo}): dx e dy dal trascinamento del pizzico`, Math.abs(dx - adx) < 0.01 && Math.abs(dy - ady) < 0.01 && altri.length === 0 && conta(ev, 'ruota') > 5 && !!primo,
    `Σdx ${f3(dx)} (atteso ${f3(adx)}), Σdy ${f3(dy)} (atteso ${f3(ady)}), ${conta(ev, 'ruota')} eventi, altri gesti: ${altri.join(',') || 'nessuno'}`);
}

// 3. Zoom a due mani ed esplodi coi palmi ----------------------------------------------------------------------------
// I centri dei palmi hanno la zona morta: alla fine di un allargamento ognuno resta indietro di zona_morta, quindi la
// distanza misurata è quella vera meno 2·zona_morta (e, stringendo, più 2·zona_morta).
for (const [modo, opz, pre] of MODI) {
  const D = seq({ x: 0.62, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.72 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const S = seq({ x: 0.38, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.28 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(dueMani(D, S), opz, undefined, 1000, pre);
  const rilascio = D.length - 8; // il primo fotogramma in cui le dita si riaprono
  const fattore = ev.filter((e) => e.tipo === 'zoom' && e.i < rilascio).reduce((p, e) => p * e.fattore, 1);
  const centro = (s) => { const p = mano(s).punti; return [0, 5, 9, 13, 17].reduce((c, i) => [c[0] + (p[i].x * P.aspetto) / 5, c[1] + p[i].y / 5], [0, 0]); };
  const d = (i) => { const a = centro(D[i]), b = centro(S[i]); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const atteso = (d(rilascio - 1) - 2 * ZM) / d(14);
  const altri = nomi(ev).filter((t) => t !== 'zoom');
  prova(`zoom (${modo}): il prodotto dei fattori è il rapporto delle distanze fra le mani`, Math.abs(fattore / atteso - 1) < 0.01 && altri.length === 0,
    `Π fattori ${fattore.toFixed(4)}, atteso ${atteso.toFixed(4)} (${((fattore / atteso - 1) * 100).toFixed(2)}%), altri gesti: ${altri.join(',') || 'nessuno'}`);

  rng = semi(3);
  const r = 0.002; // un po' di rumore: due mani aperte e ferme non devono esplodere
  const DE = seq({ x: 0.6, y: 0.75, r: 1.2, rumore: r }, [8, {}], [10, {}], [12, { x: 0.75 }], [10, {}], [12, { x: 0.65 }], [10, {}]);
  const SE = seq({ x: 0.4, y: 0.75, r: 1.2, rumore: r, lato: 'Left' }, [8, {}], [10, {}], [12, { x: 0.25 }], [10, {}], [12, { x: 0.35 }], [10, {}]);
  const ev2 = gira(dueMani(DE, SE), opz, undefined, 1000, pre).ev;
  const fermi = ev2.filter((e) => e.tipo === 'esplodi' && e.i <= 18).length;
  const apri = somma(ev2, 'esplodi', 'delta', (e) => e.i > 18 && e.i <= 40), chiudi = somma(ev2, 'esplodi', 'delta', (e) => e.i > 40);
  const attApri = ((0.75 - 0.25 - 0.2) * P.aspetto - 2 * ZM) / PALMO_H / P.esplodi_palmi, attChiudi = ((0.3 - 0.5) * P.aspetto + 4 * ZM) / PALMO_H / P.esplodi_palmi;
  prova(`esplodi (${modo}): due palmi aperti che si allargano e si stringono`, fermi === 0 && Math.abs(apri - attApri) < 0.03 && Math.abs(chiudi - attChiudi) < 0.03 && nomi(ev2).every((t) => t === 'esplodi'),
    `fermi: ${fermi} eventi; allargando Σdelta ${f3(apri)} (atteso ${f3(attApri)}), stringendo ${f3(chiudi)} (atteso ${f3(attChiudi)})`);
}

// 3b. L'esploso parte solo da mani aperte unite al centro (17/11, Tony: uscendo da uno zoom, staccando le mani, i pezzi
// esplodevano). Previsione: zero esplodi nei casi a, b e d; nel caso c l'esploso parte e si allarga.
for (const [modo, opz, pre] of MODI) {
  // a. zoom che allarga, poi le dita si riaprono e le mani si staccano in basso e di lato
  const Da = seq({ x: 0.62, y: 0.6, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.78 }], [5, {}], [3, { r: 1.2 }], [10, {}], [12, { x: 0.84, y: 0.85 }], [10, {}]);
  const Sa = seq({ x: 0.38, y: 0.6, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.22 }], [5, {}], [3, { r: 1.2 }], [10, {}], [12, { x: 0.16, y: 0.85 }], [10, {}]);
  const a = gira(dueMani(Da, Sa), opz, undefined, 1000, pre).ev;
  prova(`esplodi (${modo}): uno zoom e poi le mani che si staccano non esplodono`, conta(a, 'zoom') > 3 && conta(a, 'esplodi') === 0,
    `${conta(a, 'zoom')} zoom, ${conta(a, 'esplodi')} esplodi`);
  // b. zoom che stringe fino a unire le mani, dita riaperte e tenute 500 ms, poi le mani si allargano: ancora bloccato.
  // c. separate, le mani si riuniscono, restano aperte 500 ms e si allargano: adesso è il gesto, ed esplode
  const Db = seq({ x: 0.75, y: 0.6, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.6 }], [5, {}], [3, { r: 1.2 }], [15, {}], [12, { x: 0.75 }], [10, {}], [12, { x: 0.6 }], [15, {}], [12, { x: 0.75 }], [10, {}]);
  const Sb = seq({ x: 0.25, y: 0.6, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.4 }], [5, {}], [3, { r: 1.2 }], [15, {}], [12, { x: 0.25 }], [10, {}], [12, { x: 0.4 }], [15, {}], [12, { x: 0.25 }], [10, {}]);
  const b = gira(dueMani(Db, Sb), opz, undefined, 1000, pre).ev, separate = 8 + 3 + 5 + 12 + 5 + 3 + 15 + 12 + 10;
  const espB = b.filter((e) => e.tipo === 'esplodi' && e.i < separate), espC = somma(b, 'esplodi', 'delta', (e) => e.i >= separate);
  prova(`esplodi (${modo}): dopo uno zoom che unisce le mani, aprirle e allargarle non esplode; riunite e tenute aperte, sì`,
    conta(b, 'zoom') > 3 && espB.length === 0 && espC > 0.3, `${conta(b, 'zoom')} zoom, ${espB.length} esplodi prima di separarle, poi Σdelta ${f3(espC)}`);
  // d. due palmi aperti lontani (oltre esplodi_unite), fermi e poi allargati: non è il gesto
  const Dd = seq({ x: 0.74, y: 0.6, r: 1.2 }, [8, {}], [18, {}], [12, { x: 0.84 }], [10, {}]);
  const Sd = seq({ x: 0.26, y: 0.6, r: 1.2, lato: 'Left' }, [8, {}], [18, {}], [12, { x: 0.16 }], [10, {}]);
  const d = gira(dueMani(Dd, Sd), opz, undefined, 1000, pre).ev;
  prova(`esplodi (${modo}): due palmi aperti lontani che si allargano non esplodono`, conta(d, 'esplodi') === 0, `${conta(d, 'esplodi')} esplodi`);
}

// 3c. I salti dell'indice (17/11, Tony: «il cursore saltava»; 240 salti in una sessione) -------------------------------
// Mano ferma e aperta; l'indice (punti 6, 7 e 8) balza di quasi un palmo per un fotogramma (20 e 32) e per due (44–45),
// poi dal 56 si sposta davvero e resta lì. salto_fotogrammi 0 è il comportamento di prima: lo stesso codice senza scarto.
// Previsione: senza scarto il cursore fa passi oltre 0,05 dello schermo; con lo scarto resta entro 0,005, e lo spostamento
// vero arriva lo stesso (entro 0,02 dalla sua posizione dopo 20 fotogrammi).
{
  const stati = seq({ x: 0.5, y: 0.6, r: 1.2 }, [80, {}]);
  const balza = (p, k) => ({ ...p, x: p.x + 0.12 * ((k - 5) / 3), y: p.y + 0.05 * ((k - 5) / 3) });
  const fot = unaMano(stati).map((mani, i) => (i === 20 || i === 32 || i === 44 || i === 45 || i >= 56
    ? mani.map((m) => ({ ...m, punti: m.punti.map((p, k) => (k >= 6 && k <= 8 ? balza(p, k) : p)) })) : mani));
  const prova0 = (opz) => {
    const cur = gira(fot, { ...SEMPRE, ...opz }).ev.filter((e) => e.tipo === 'cursore');
    const passi = cur.slice(1).map((e, j) => ({ i: e.i, d: Math.hypot(e.x - cur[j].x, e.y - cur[j].y) }));
    const fermi = passi.filter((p) => p.i >= 10 && p.i < 56), fine = cur.at(-1);
    const vero = schermo(fot[79][0].punti[8]);
    return { passo: Math.max(...fermi.map((p) => p.d)), finale: Math.hypot(fine.x - vero.x, fine.y - vero.y), gesti: nomi(gira(fot, { ...SEMPRE, ...opz }).ev) };
  };
  const senza = prova0({ salto_fotogrammi: 0 }), con = prova0({});
  prova('salti: senza scarto il cursore salta (il comportamento di prima)', senza.passo > 0.05, `passo massimo ${f4(senza.passo)} dello schermo`);
  prova('salti: con lo scarto il cursore resta fermo, e lo spostamento vero arriva', con.passo < 0.005 && con.finale < 0.02 && con.gesti.length === 0,
    `passo massimo ${f4(con.passo)}; dopo lo spostamento vero il cursore è a ${f4(con.finale)} dalla punta; gesti ${con.gesti.join(',') || 'nessuno'}`);
  const g = createGesti(SEMPRE);
  fot.forEach((mani, i) => g.aggiorna(mani, 1000 + i * DT));
  const ms = g.misure();
  // 7 salti: 20, 32, 44, 45 e i tre dello spostamento vero (56 e 57 scartati, 58 creduto); il ritorno dopo un balzo non
  // conta, perché si confronta con la forma creduta. Scartati 6: i quattro balzi e i primi due fotogrammi dello spostamento
  prova('salti: le misure contano i salti e quelli scartati', ms.salti === 7 && ms.salti_tenuti === 6, `salti ${ms.salti}, scartati ${ms.salti_tenuti}`);
}

// 4. Afferra, sposta e lascia -----------------------------------------------------------------------------------------
for (const [modo, opz, pre] of MODI) {
  const stati = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [9, { x: 0.45 + 9 * vel(0.3) }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(unaMano(stati), opz, undefined, 1000, pre);
  const a = ev.find((e) => e.tipo === 'afferra'), mira = punta(stati[8]), presa = punta(stati[11]);
  const traccia = corda(stati.map((s) => inAltezze(puntaN(s)))), da = daAltezze(traccia[26]), fino = daAltezze(traccia[stati.length - 9]);
  const dx = somma(ev, 'sposta', 'dx'), adx = mappa(fino.x) - mappa(da.x);
  const n = nomi(ev);
  prova(`afferra dove l'indice puntava prima di chiudersi, poi sposta e lascia (${modo})`,
    a && Math.abs(a.x - mira.x) < 0.005 && Math.abs(a.y - mira.y) < 0.005 && Math.abs(dx - adx) < 0.01 && n[0] === 'afferra' && n[n.length - 1] === 'lascia' && !n.includes('lancia') && !n.includes('ruota'),
    `afferra a (${f3(a?.x)}, ${f3(a?.y)}) dopo ${a ? ((a.i - 11) * DT).toFixed(0) : '?'} ms di pizzico, mira (${f3(mira.x)}, ${f3(mira.y)}); a dita chiuse la punta era a (${f3(presa.x)}, ${f3(presa.y)}); Σdx ${f3(dx)} (atteso ${f3(adx)}); ultimo gesto ${n[n.length - 1]}`);
}

// 5. Lancio: la velocità al rilascio, con le soglie ai due lati ---------------------------------------------------------
function lancio(v, opzioni, pre = 0) {
  const x0 = 0.15, dx = vel(v); // la mano corre per 5 fotogrammi e apre le dita senza fermarsi
  const stati = seq({ x: x0, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [5, { x: x0 + 5 * dx }], [3, { x: x0 + 8 * dx, r: 1.2 }], [2, { x: x0 + 10 * dx }]);
  return { ev: gira(unaMano(stati), opzioni, undefined, 1000, pre).ev, stati };
}
// la velocità sullo schermo: la secante della mappa sul centro del palmo grezzo, nella finestra di lancio_ms (più un fotogramma)
function vAttesa(stati, i) {
  const c = (s) => { const p = mano(s).punti; return [0, 5, 9, 13, 17].reduce((a, k) => a + p[k].x / 5, 0); };
  const indietro = Math.floor(P.lancio_ms / DT) + 1;
  return (mappa(c(stati[i])) - mappa(c(stati[i - indietro]))) / ((indietro * DT) / 1000);
}
for (const [modo, opz, pre] of MODI) {
  const lento = nomi(lancio(0.3, opz, pre).ev);
  prova(`afferra, sposta e lascia lento (0,3 m/s) dà lascia e non lancia (${modo})`, lento.at(-1) === 'lascia' && !lento.includes('lancia'), `gesti: ${[...new Set(lento)].join(',')}`);
  const { ev, stati } = lancio(1.5, opz, pre), l = ev.find((e) => e.tipo === 'lancia'), atteso = l ? vAttesa(stati, l.i) : NaN;
  prova(`lancio veloce (1,5 m/s) dà lancia, con la velocità giusta (${modo})`, l && Math.abs(l.vx / atteso - 1) < 0.02 && Math.abs(l.vy) < 0.02 * atteso && !nomi(ev).includes('lascia'),
    `vx ${f3(l?.vx)} schermi/s (atteso ${f3(atteso)}, secante della mappa), vy ${f3(l?.vy)}, a (${f3(l?.x)}, ${f3(l?.y)})`);
  const sotto = nomi(lancio(0.8, opz, pre).ev), sopra = nomi(lancio(1.2, opz, pre).ev);
  prova(`soglia del lancio a 1 m/s: 0,8 m/s lascia, 1,2 m/s lancia (${modo})`, sotto.at(-1) === 'lascia' && !sotto.includes('lancia') && sopra.includes('lancia') && !sopra.includes('lascia'),
    `0,8 → ${sotto.at(-1)}, 1,2 → ${sopra.filter((t) => t === 'lancia' || t === 'lascia').join(',')}`);
}
{
  const alzata = nomi(lancio(1.5, { lancio_mm_s: 2000, ...SEMPRE }).ev);
  prova('la prova sa fallire: con la soglia a 2 m/s lo stesso colpo a 1,5 m/s lascia', alzata.at(-1) === 'lascia' && !alzata.includes('lancia'), `→ ${alzata.at(-1)}`);
}

// 5b. Regola 3.3 di Tony (300 ms fra due gesti impulsivi): due lanci il più vicini possibile ---------------------------------
// Ogni lancio vuole una presa nuova, cioè un pizzico riaperto e poi fermo per presa_ms: il tempo di ricarica c'è già.
function dueLanci(fermo, opzioni) {
  const v = vel(1.5), stati = [...seq({ x: 0.25, y: 0.7, r: 1.2 }, [8, {}], [1, { r: 0.15 }], [fermo, {}])];
  const corsa = () => { const a = stati.at(-1); stati.push(...seq(a, [5, { x: a.x + 5 * v }], [1, { x: a.x + 6 * v, r: 1.2 }], [1, { x: a.x + 6.5 * v }]).slice(1)); };
  corsa();
  stati.push(...seq(stati.at(-1), [1, { r: 0.15 }], [fermo, {}]).slice(1));
  corsa();
  stati.push(...seq(stati.at(-1), [5, {}]).slice(1));
  const l = gira(unaMano(stati), { ...SEMPRE, ...opzioni }).ev.filter((e) => e.tipo === 'lancia');
  return l.length === 2 ? l[1].t - l[0].t : null;
}
{
  const distanze = (opz) => { const d = []; for (let f = 4; f <= 16; f++) { const x = dueLanci(f, opz); if (x !== null) d.push(x); } return d; };
  const d = distanze({}), min = Math.min(...d), corti = distanze({ presa_ms: 100 }), minCorti = Math.min(...corti);
  prova('due lanci di fila stanno ad almeno 300 ms (la ricarica di Tony) senza un timer apposta', d.length > 3 && min >= 300 && min >= P.presa_ms,
    `${d.length} coppie di lanci, distanza minima ${min.toFixed(0)} ms; con presa_ms 100 sarebbe ${Number.isFinite(minCorti) ? minCorti.toFixed(0) : '—'} ms, cioè sotto i 300`);
}

// 6. Movimenti veloci senza presa: nessun lancio --------------------------------------------------------------------------
{
  const d = 4 * vel(2);
  const aperta = seq({ x: 0.3, y: 0.75, r: 1.2 }, [8, {}], [4, { x: 0.3 + d }], [4, { x: 0.3 }], [4, { x: 0.3 + d }], [4, { x: 0.3 }], [5, {}]);
  const ev = gira(unaMano(aperta), SEMPRE).ev;
  prova('mano aperta che corre a 2 m/s: nessun gesto, solo il cursore', nomi(ev).length === 0 && conta(ev, 'cursore') > 20, `gesti: ${nomi(ev).join(',') || 'nessuno'}`);
  const dr = vel(1.5);
  const ruota = seq({ x: 0.15, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [6, { x: 0.15 + 6 * dr }], [3, { x: 0.15 + 9 * dr, r: 1.2 }], [3, {}]);
  const n = nomi(gira(unaMano(ruota), SEMPRE).ev);
  prova('pizzico trascinato subito a 1,5 m/s e lasciato in corsa: ruota, nessun lancio', n.length > 0 && n.every((t) => t === 'ruota'), `gesti: ${[...new Set(n)].join(',')}`);
}

// 7. Tremolio: deviazione standard prima e dopo il filtro, e ritardo in movimento; taratura di beta ------------------------
// Il filtro si misura da solo (zona_morta 0): con la zona morta da fermo il cursore non si muove proprio (prova 7b).
// Il ritardo si misura tornando dallo schermo all'immagine con l'inversa della mappa: fino al 10/11 la prova supponeva la
// mappa lineare, e con la mappa a S quell'errore di modello sembrava un ritardo di 80 ms.
function filtro(opzioni) {
  rng = semi(7);
  const fermo = seq({ x: 0.5, y: 0.75, r: 1.2, rumore: 0.004 }, [299, {}]);
  const fot = unaMano(fermo), grezzi = fot.map((f) => schermo(f[0].punti[8]));
  const cur = new Map(gira(fot, { ...SEMPRE, ...opzioni }).ev.filter((e) => e.tipo === 'cursore').map((e) => [e.i, e]));
  const idx = [...cur.keys()].filter((i) => i >= 30);
  const ds = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
  const sdGx = ds(idx.map((i) => grezzi[i].x)), sdFx = ds(idx.map((i) => cur.get(i).x)), sdGy = ds(idx.map((i) => grezzi[i].y)), sdFy = ds(idx.map((i) => cur.get(i).y));
  // ritardo: mano senza rumore che corre a 0,5 m/s; si misura dopo 0,5 s di corsa, quando la velocità stimata è salita
  const dx = vel(0.5), corsa = seq({ x: 0.2, y: 0.75, r: 1.2 }, [10, {}], [20, { x: 0.2 + 20 * dx }]);
  const c2 = new Map(gira(unaMano(corsa), { ...SEMPRE, ...opzioni }).ev.filter((e) => e.tipo === 'cursore').map((e) => [e.i, e]));
  const rit = [], ritLin = [];
  for (let i = 25; i <= 30; i++) {
    rit.push(((puntaN(corsa[i]).x - inversa(c2.get(i).x)) / dx) * DT);
    // il conto di prima del 10/11: lo schermo come se la mappa fosse lineare
    ritLin.push(((clamp01((puntaN(corsa[i]).x - P.margine) / (1 - 2 * P.margine)) - c2.get(i).x) / (dx / (1 - 2 * P.margine))) * DT);
  }
  const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return { sdGx, sdFx, sdGy, sdFy, riduzione: (sdGx / sdFx + sdGy / sdFy) / 2, ritardo: media(rit), ritardoLineare: media(ritLin) };
}
{
  const righe = [0, 1, 2, 5, 10, 20].map((beta) => { const r = filtro({ beta, zona_morta: 0 }); return `β ${beta}: tremolio ÷${r.riduzione.toFixed(2)}, ritardo ${r.ritardo.toFixed(0)} ms`; });
  console.log(`     taratura (σ 0,004 a mano ferma; ritardo a 0,5 m/s; senza zona morta): ${righe.join(' | ')}`);
  const r = filtro({ zona_morta: 0 }), conZ = filtro(), lin = filtro({ curva: 0 });
  prova(`tremolio ridotto dal filtro (β ${P.beta}): almeno ÷2,5 da fermo e ritardo sotto 40 ms a 0,5 m/s`, r.riduzione >= 2.5 && r.ritardo < 40 && conZ.ritardo < 40,
    `deviazione standard x ${r.sdGx.toFixed(4)} → ${r.sdFx.toFixed(4)}, y ${r.sdGy.toFixed(4)} → ${r.sdFy.toFixed(4)} (schermi), cioè ÷${r.riduzione.toFixed(2)}; ritardo ${r.ritardo.toFixed(1)} ms senza zona morta, ` +
    `${conZ.ritardo.toFixed(1)} ms con la zona morta (atteso in più ${((ZM * MM) / 0.5).toFixed(1)} ms, raggio/velocità); col conto lineare di prima ${conZ.ritardoLineare.toFixed(1)} ms con la mappa a S e ${lin.ritardoLineare.toFixed(1)} ms con curva 0`);
}

// 7b. Zona morta a corda (regola 1.1 di Tony) ---------------------------------------------------------------------------
{
  // mano ferma con rumore: dopo l'assestamento il cursore quasi non cambia. σ 0,004 è 2,6 px in x e 1,9 in y su 640×480,
  // rumore della prova, non misurato su Tony. Non è zero: dopo essere stata trascinata la corda resta sul bordo del suo
  // raggio, e un'oscillazione del filtrato da quella parte la sposta di poco (sotto 1 px su uno schermo alto 1080).
  const mossi = (rumore, opz) => {
    rng = semi(11);
    const fot = unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, rumore }, [299, {}]));
    const c = gira(fot, { ...SEMPRE, ...opz }).ev.filter((e) => e.tipo === 'cursore' && e.i >= 30);
    let n = 0, max = 0;
    for (let k = 1; k < c.length; k++) { const d = Math.hypot(c[k].x - c[k - 1].x, c[k].y - c[k - 1].y); if (d) { n++; max = Math.max(max, d); } }
    return { n, tot: c.length - 1, max };
  };
  const con = mossi(0.004, {}), senza = mossi(0.004, { zona_morta: 0 }), piano = mossi(0.002, {});
  prova('zona morta: mano ferma con rumore σ 0,004 o 0,002, dopo 1 s il cursore si muove al massimo nel 2% dei fotogrammi (senza, in più della metà)',
    con.n <= 0.02 * con.tot && piano.n <= 0.02 * piano.tot && senza.n > con.tot / 2,
    `fotogrammi in cui il cursore si muove con σ 0,004: ${con.n} su ${con.tot} con la zona morta (passo massimo ${(con.max * 1080).toFixed(1)} px su uno schermo alto 1080), ${senza.n} su ${senza.tot} senza; con σ 0,002: ${piano.n} su ${piano.tot} (passo massimo ${(piano.max * 1080).toFixed(1)} px)`);

  // mano lenta senza rumore, 3 cm/s per 2 s: il cursore la segue a corda, entro il raggio dal punto filtrato e senza gradini
  const lenta = seq({ x: 0.4, y: 0.75, r: 1.2 }, [8, {}], [60, { x: 0.4 + 60 * vel(0.03) }]);
  const cursori = (opz) => new Map(gira(unaMano(lenta), { ...SEMPRE, ...opz }).ev.filter((e) => e.tipo === 'cursore').map((e) => [e.i, inversa(e.x) * P.aspetto]));
  // Il passo d'ingresso della zona morta è quello del punto filtrato: il One Euro, quando la velocità stimata sale,
  // recupera il ritardo e per qualche fotogramma va più veloce della mano (stampato sotto). La corda non aggiunge niente.
  const conC = cursori({}), filt = cursori({ zona_morta: 0 });
  let errMax = 0, gradino = 0, oltre = -Infinity, fermiC = 0, filtMax = 0;
  const passo = vel(0.03) * P.aspetto;
  for (let i = 9; i < lenta.length; i++) {
    errMax = Math.max(errMax, Math.abs(filt.get(i) - conC.get(i)));
    const s = conC.get(i) - conC.get(i - 1), sf = filt.get(i) - filt.get(i - 1);
    gradino = Math.max(gradino, s); filtMax = Math.max(filtMax, sf); oltre = Math.max(oltre, s - sf);
    if (i > 20 && Math.abs(s) < 1e-9) fermiC++;
  }
  prova('zona morta: mano lenta a 3 cm/s seguita entro il raggio, a ogni passo mai più del passo del punto filtrato',
    errMax <= ZM * (1 + 1e-6) && oltre <= 1e-9 && fermiC === 0,
    `scarto massimo dal punto filtrato ${(errMax * 480).toFixed(3)} px su 480 (raggio ${(ZM * 480).toFixed(1)}), passo massimo ${(gradino * 480).toFixed(3)} px, del filtrato ${(filtMax * 480).toFixed(3)}, della mano ${(passo * 480).toFixed(3)}; fotogrammi fermi dopo 0,4 s: ${fermiC}`);

  // la regola alla lettera: un punto che si sposta meno di 3 px dal fotogramma prima non si muove
  const px = lenta.map((s) => puntaN(s).x * P.aspetto * 480);
  let fermo = px[0], uscita = [];
  for (let i = 1; i < px.length; i++) { if (Math.abs(px[i] - px[i - 1]) >= 3) fermo = px[i]; uscita.push(fermo); }
  console.log(`     regola alla lettera (fermo sotto 3 px dal fotogramma prima): a 3 cm/s la mano fa ${(px[20] - px[19]).toFixed(2)} px a fotogramma, e in 2 s l'uscita resta indietro di ${(px.at(-1) - uscita.at(-1)).toFixed(1)} px (si muove ${uscita.filter((v, k) => k && v !== uscita[k - 1]).length} volte)`);
}

// 8. Mani che spariscono a metà gesto -------------------------------------------------------------------------------------
{
  // presa, poi la mano sparisce: un solo 'lascia' quando scade assente_ms, e poi niente
  const stati = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}]);
  const fot = [...unaMano(stati), ...Array.from({ length: 20 }, () => [])];
  const ev = gira(fot, SEMPRE).ev, n = nomi(ev), l = ev.find((e) => e.tipo === 'lascia');
  const attesoI = stati.length - 1 + Math.floor(P.assente_ms / DT) + 1;
  prova('presa e la mano sparisce: un lascia solo, quando scade l\'assenza', n.filter((t) => t !== 'sposta').join(',') === 'afferra,lascia' && l.i === attesoI && gesti(ev.filter((e) => e.i > attesoI)).length === 0 && conta(ev.filter((e) => e.i > attesoI), 'cursore') === 0,
    `gesti ${[...new Set(n)].join(',')}, lascia al fotogramma ${l?.i} (atteso ${attesoI}, cioè ${((attesoI - stati.length + 1) * DT).toFixed(0)} ms dopo l'ultima vista)`);

  // regola 2.3 di Tony: fino a 4 fotogrammi mancanti la presa resta, al quinto si chiude
  const buco = (k, opz) => {
    const prima = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [5, { x: 0.5 }]);
    const dopo = seq({ ...prima.at(-1), x: 0.52 }, [5, { x: 0.55 }], [15, {}], [3, { r: 1.2 }], [3, {}]);
    const ev = gira([...unaMano(prima), ...Array.from({ length: k }, () => []), ...unaMano(dopo)], { ...SEMPRE, ...opz }).ev, n = nomi(ev);
    return { tiene: n.filter((t) => t !== 'sposta').join(',') === 'afferra,lascia' && ev.filter((e) => e.tipo === 'sposta' && e.i > prima.length + k).length > 3, n };
  };
  const b2 = buco(2), b4 = buco(4), b5 = buco(5), b4vecchio = buco(4, { assente_ms: 150 });
  prova(`buchi nella presa: 2 e 4 fotogrammi mancanti non la chiudono, 5 sì (assente_ms ${P.assente_ms})`, b2.tiene && b4.tiene && !b5.tiene,
    `2 → ${b2.tiene ? 'tiene' : 'chiusa'}, 4 → ${b4.tiene ? 'tiene' : 'chiusa'}, 5 → ${b5.tiene ? 'tiene' : 'chiusa'} (${b5.n.filter((t) => t !== 'sposta').join(',')}); con i 150 ms di prima 4 → ${b4vecchio.tiene ? 'tiene' : 'chiusa'}`);

  // zoom, poi una mano sparisce: lo zoom si ferma; l'altra, ancora chiusa, non comincia a ruotare finché non si riapre
  const D = seq({ x: 0.62, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.7 }]);
  const S = seq({ x: 0.38, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.3 }]);
  const resta = seq({ ...D.at(-1) }, [20, { x: 0.55, y: 0.65 }], [3, { r: 1.2 }], [3, {}], [3, { r: 0.15 }], [15, {}]);
  const fot3 = [...dueMani(D, S), ...resta.map((s) => [mano(s)])];
  const ev3 = gira(fot3, SEMPRE).ev, via = D.length;
  const zoomDopo = ev3.filter((e) => e.tipo === 'zoom' && e.i >= via).length, primaDiAprire = nomi(ev3.filter((e) => e.i >= via && e.i < via + 21));
  const riparte = ev3.find((e) => e.tipo === 'afferra' && e.i > via + 26);
  prova('zoom e una mano sparisce: lo zoom si ferma, l\'altra resta ferma finché non si riapre', conta(ev3.filter((e) => e.i < via), 'zoom') > 3 && zoomDopo === 0 && primaDiAprire.length === 0 && !!riparte,
    `zoom dopo la sparizione: ${zoomDopo}; gesti con la mano ancora chiusa che si muove: ${primaDiAprire.join(',') || 'nessuno'}; dopo averla riaperta e richiusa: ${riparte ? 'afferra' : 'niente'}`);

  // rotazione, la mano sparisce e ricompare già chiusa: niente gesti finché non si apre
  const R1 = seq({ x: 0.3, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [8, { x: 0.45 }]);
  const R2 = seq({ x: 0.5, y: 0.7, r: 0.15 }, [20, { x: 0.6 }], [3, { r: 1.2 }], [3, {}], [3, { r: 0.15 }], [8, { x: 0.45 }]);
  const ev4 = gira([...unaMano(R1), ...Array.from({ length: 8 }, () => []), ...unaMano(R2)], SEMPRE).ev, torna = R1.length + 8;
  const n4 = nomi(ev4.filter((e) => e.i < torna)), chiusa = nomi(ev4.filter((e) => e.i >= torna && e.i < torna + 21)), poi = nomi(ev4.filter((e) => e.i >= torna + 21));
  prova('rotazione e la mano sparisce: nessun lancio; ricompare chiusa e non fa niente finché non si apre', n4.every((t) => t === 'ruota') && n4.length > 0 && chiusa.length === 0 && poi.includes('ruota'),
    `prima: ${[...new Set(n4)].join(',')}; ricomparsa chiusa: ${chiusa.join(',') || 'nessuno'}; riaperta e richiusa: ${[...new Set(poi)].join(',')}`);
}

// 8b. Regola 2.1 di Tony, la parte provabile: un salto di un fotogramma della punta dell'indice durante una presa ------------
{
  // la punta dell'indice (8) salta di J palmi lontano dal pollice per un fotogramma solo, poi torna: la presa deve restare.
  // Spostata così la punta allunga anche l'indice, che è il denominatore del rapporto: il caso peggiore è la punta del
  // pollice (4) che salta lontano dall'indice, e si misura anche quello.
  const regge = (J, opz, punto = 8) => {
    const stati = seq({ x: 0.45, y: 0.7, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [10, {}], [3, { r: 1.2 }], [3, {}]);
    const fot = unaMano(stati), m = fot[30][0].punti, a = inAltezze(m[4]), b = inAltezze(m[8]), l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const v = punto === 8 ? 1 : -1;
    fot[30] = [{ ...fot[30][0], punti: m.map((q, i) => (i === punto ? { ...q, x: q.x + (v * (b[0] - a[0]) / l) * J * PALMO_H / P.aspetto, y: q.y + (v * (b[1] - a[1]) / l) * J * PALMO_H } : q)) }];
    const g = createGesti({ ...SEMPRE, ...opz }), ev = gira(fot, undefined, g).ev, fine = ev.find((e) => e.tipo === 'lascia' || e.tipo === 'lancia');
    return { ok: !!fine && fine.i >= stati.length - 6, salti: g.misure().salti };
  };
  const massimo = (opz, punto) => { let m = 0; for (let k = 1; k <= 100; k++) { if (!regge(k / 10, opz, punto).ok) break; m = k / 10; } return m; };
  const conF = massimo({}, 8), senzaF = massimo({ mincutoff: 1e6 }, 8), polliceF = massimo({}, 4), polliceS = massimo({ mincutoff: 1e6 }, 4), uno = regge(1), pollice = regge(0.8, {}, 4);
  prova('un salto di un fotogramma della punta dell\'indice (1 palmo) o del pollice (0,8 palmi) non apre la presa', uno.ok && pollice.ok && uno.salti >= 1,
    `la presa regge salti dell'indice fino a ${conF.toFixed(1)} palmi col filtro (${senzaF.toFixed(1)} senza), del pollice fino a ${polliceF.toFixed(1)} (${polliceS.toFixed(1)} senza, solo l'isteresi); il salto di 1 palmo conta ${uno.salti} salti in misure() (andata e ritorno)`);
  if (process.env.GESTI_SENZA_FILTRO) prova('(dimostrazione) senza filtro il salto del pollice di 0,8 palmi non apre la presa', regge(0.8, { mincutoff: 1e6 }, 4).ok);
}

// 9. Stabilità: una mano nuova non dà gesti per i primi fotogrammi --------------------------------------------------------
{
  const ev = gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [10, {}])), SEMPRE).ev;
  const primo = ev.find((e) => e.tipo === 'cursore');
  prova(`una mano nuova dà il cursore solo dal fotogramma ${P.stabile}`, primo?.i === P.stabile - 1, `primo cursore al fotogramma ${primo ? primo.i + 1 : 'mai'}`);
}

// 10. Zona attiva (regola 3.1 di Tony): un gesto parte solo col palmo nel 70% centrale ---------------------------------------
{
  // pizzico chiuso fuori (centro del palmo a x 0,11), portato dentro ancora chiuso, poi riaperto e richiuso dentro
  const fuori = (opz) => {
    const stati = seq({ x: 0.1, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [6, { x: 0.13 }], [10, { x: 0.4 }], [10, {}], [3, { r: 1.2 }], [3, {}], [3, { r: 0.15 }], [8, { x: 0.5 }], [3, { r: 1.2 }]);
    const ev = gira(unaMano(stati), { ...SEMPRE, ...opz }).ev;
    return { primaDiAprire: nomi(ev.filter((e) => e.i < 46)), dopo: nomi(ev.filter((e) => e.i >= 46)) };
  };
  const z = fuori({}), z1 = fuori({ zona: 1 });
  prova('zona attiva: un pizzico chiuso fuori non vale, nemmeno portato dentro, finché non si riapre', z.primaDiAprire.length === 0 && z.dopo.includes('ruota') && z1.primaDiAprire.length > 0,
    `chiuso fuori e portato dentro: ${z.primaDiAprire.join(',') || 'nessun gesto'}; riaperto e richiuso dentro: ${[...new Set(z.dopo)].join(',')}; con zona 1: ${[...new Set(z1.primaDiAprire)].join(',')}`);

  // un gesto partito dentro continua fuori, anche oltre il bordo dello schermo
  const oltre = seq({ x: 0.6, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [20, { x: 1.0 }], [3, { r: 1.2 }]);
  const ev = gira(unaMano(oltre), SEMPRE).ev, centro = (s) => s.x + 0.011;
  const fuoriR = ev.filter((e) => e.tipo === 'ruota' && centro(oltre[e.i]) > 0.5 + P.zona / 2), cursoreBordo = ev.filter((e) => e.tipo === 'cursore' && e.x === 1).length;
  prova('zona attiva: una rotazione partita dentro continua fuori, e oltre il bordo dello schermo', fuoriR.length > 3 && fuoriR.every((e) => e.dx > 0) && cursoreBordo > 0,
    `${fuoriR.length} ruota col palmo fuori dalla zona, Σdx lì ${f3(fuoriR.reduce((s, e) => s + e.dx, 0))}; cursore fermo al bordo in ${cursoreBordo} fotogrammi`);

  // due mani: lo zoom parte solo con tutte e due dentro
  const zoom = (xs, opz) => {
    const D = seq({ x: 0.62, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.72 }], [5, {}]);
    const S = seq({ x: xs, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: xs - 0.05 }], [5, {}]);
    return conta(gira(dueMani(D, S), { ...SEMPRE, ...opz }).ev, 'zoom');
  };
  const dentro = zoom(0.38), unaFuori = zoom(0.12), unaFuoriZ1 = zoom(0.12, { zona: 1 });
  prova('zona attiva: lo zoom a due mani parte solo con tutte e due dentro', dentro > 3 && unaFuori === 0 && unaFuoriZ1 > 3,
    `zoom con due mani dentro: ${dentro} eventi; con la sinistra fuori: ${unaFuori}; con la sinistra fuori e zona 1: ${unaFuoriZ1}`);

  // l'innesco vale solo dentro
  const ev2 = gira(unaMano(seq({ x: 0.1, y: 0.75, r: 1.2 }, [60, {}]))).ev, ev3 = gira(unaMano(seq({ x: 0.1, y: 0.75, r: 1.2 }, [60, {}])), { zona: 1 }).ev;
  prova('zona attiva: un palmo aperto fuori non fa l\'innesco', fasi(ev2).join(',') === 'riposo' && fasi(ev3).includes('pronto'), `fuori: ${fasi(ev2).join(' → ')}; con zona 1: ${fasi(ev3).join(' → ')}`);
}

// 11. Profilo (regola 2.2 di Tony): l'inclinazione del palmo dalla normale di polso, nocca dell'indice e nocca del mignolo -----
{
  const angolo = (imb, bec) => { const g = createGesti(SEMPRE); gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, imb, bec }, [40, {}])), undefined, g); return g.stato().mani[0]; };
  const casi = [[0, 0], [30, 0], [60, 0], [70, 0], [80, 0], [89, 0], [0, 45], [40, 50], [-65, 20]];
  const righe = casi.map(([i, b]) => { const m = angolo(i, b), atteso = (Math.acos(Math.cos((i * Math.PI) / 180) * Math.cos((b * Math.PI) / 180)) * 180) / Math.PI; return { i, b, m, atteso, err: Math.abs(m.inclinazione - atteso) }; });
  const errMax = Math.max(...righe.map((r) => r.err));
  prova('profilo: l\'inclinazione del palmo misurata entro 3°, e la soglia a 75°', errMax < 3 && righe.every((r) => r.m.profilo === r.atteso > P.profilo_gradi),
    righe.map((r) => `${r.i}°/${r.b}° → ${r.m.inclinazione.toFixed(1)}° (${r.m.profilo ? 'profilo' : 'di fronte'})`).join(', '));

  // di profilo una mano aperta non fa l'innesco, né esplode con l'altra
  const ev = gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, imb: 80 }, [60, {}]))).ev, ev90 = gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, imb: 80 }, [60, {}])), { profilo_gradi: 90 }).ev;
  const DE = seq({ x: 0.6, y: 0.75, r: 1.2, imb: 80 }, [18, {}], [12, { x: 0.75 }], [10, {}]), SE = seq({ x: 0.4, y: 0.75, r: 1.2, lato: 'Left', imb: 80 }, [18, {}], [12, { x: 0.25 }], [10, {}]);
  const esp = conta(gira(dueMani(DE, SE), SEMPRE).ev, 'esplodi');
  prova('profilo: una mano aperta di taglio (80°) non fa l\'innesco e due non esplodono', fasi(ev).join(',') === 'riposo' && esp === 0 && fasi(ev90).includes('pronto'),
    `fasi: ${fasi(ev).join(' → ')}; esplodi con due mani di taglio: ${esp}; con profilo_gradi 90: ${fasi(ev90).join(' → ')}`);

  // il pizzico invece resta, anche di profilo: davanti a un portatile si pizzica col palmo in giù
  const g = createGesti(SEMPRE);
  const pz = nomi(gira(unaMano(seq({ x: 0.4, y: 0.75, r: 1.2, bec: 80 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.55 }], [3, { r: 1.2 }])), undefined, g).ev);
  prova('profilo: il pizzico col palmo in giù (80°) ruota lo stesso, e misure() lo conta di profilo', pz.includes('ruota') && g.misure().pizzichi_profilo === 1 && g.misure().profilo > 0.9,
    `gesti: ${[...new Set(pz)].join(',') || 'nessuno'}; pizzichi di profilo ${g.misure().pizzichi_profilo}, frazione di profilo ${f3(g.misure().profilo)}`);
}

// 12. La macchina a tre fasi (regola 4.2 di Tony): riposo → pronto → azione ----------------------------------------------------
{
  // a riposo pizzico e trascinamento non danno niente, nemmeno il cursore; le tracce però si aggiornano
  const breve = seq({ x: 0.45, y: 0.75, r: 1.2 }, [6, {}], [3, { r: 0.15 }], [15, { x: 0.6 }], [3, { r: 1.2 }]);
  const g0 = createGesti(), ev0 = gira(unaMano(breve), undefined, g0).ev;
  prova('riposo: un pizzico trascinato senza innesco non dà niente, nemmeno il cursore', ev0.length === 1 && ev0[0].tipo === 'stato' && ev0[0].fase === 'riposo' && g0.stato().mani.length === 1 && g0.stato().fase === 'riposo',
    `eventi: ${ev0.map((e) => e.tipo + (e.fase ? ':' + e.fase : '')).join(',')}; tracce ${g0.stato().mani.length}`);

  // l'innesco: dopo innesco_ms di palmo aperto e stabile, non prima; anche con rumore σ 0,004
  const pronto = (rumore, seme) => { rng = semi(seme); const ev = gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, rumore }, [40, {}]))).ev; return ev.find((e) => e.fase === 'pronto'); };
  const p0 = pronto(0, 1), tStabile = 1000 + (P.stabile - 1) * DT;
  const rumorosi = [5, 6, 7, 8, 9].map((s) => pronto(0.004, s));
  prova(`innesco: pronto ${P.innesco_ms} ms dopo il primo palmo aperto stabile, non prima; anche con rumore`,
    p0 && p0.t - tStabile >= P.innesco_ms - 1e-6 && p0.t - tStabile < P.innesco_ms + DT && rumorosi.every((p) => p && p.t - tStabile < P.innesco_ms + 3 * DT),
    `senza rumore ${p0 ? (p0.t - tStabile).toFixed(1) : '—'} ms; con σ 0,004 (5 semi): ${rumorosi.map((p) => (p ? (p.t - tStabile).toFixed(0) : 'mai')).join(', ')} ms`);

  // un fotogramma storto in mezzo non azzera il conto, due di fila sì
  const conBuchi = (storti) => {
    const st = seq({ x: 0.5, y: 0.75, r: 1.2 }, [20, {}]);
    for (const i of storti) st[i] = { ...st[i], imb: 85 }; // un fotogramma di taglio: per gesti.js non è un palmo aperto
    return gira(unaMano(st), { mincutoff: 1e6 }).ev.find((e) => e.fase === 'pronto')?.i;
  };
  const uno = conBuchi([8]), dueF = conBuchi([8, 9]), mai = conBuchi([]);
  prova('innesco: tollera un fotogramma falso, due di fila ricominciano il conto', uno === mai && dueF > mai, `pronto al fotogramma ${mai} pulito, ${uno} con un falso, ${dueF} con due`);

  // la scadenza: riposo_ms dopo l'ultimo palmo o gesto; poi un palmo nuovo innesca di nuovo
  const g1 = createGesti();
  const sc = [...unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [20, {}])), ...Array.from({ length: 150 }, () => []), ...unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [20, {}]))];
  const ev1 = gira(sc, undefined, g1).ev, riposo = ev1.filter((e) => e.fase === 'riposo')[1], ultimoPalmo = 1000 + 20 * DT;
  prova(`scadenza: torna a riposo ${P.riposo_ms} ms dopo l'ultimo palmo aperto, e un palmo nuovo lo risveglia`,
    riposo && riposo.t - ultimoPalmo >= P.riposo_ms - 1e-6 && riposo.t - ultimoPalmo < P.riposo_ms + DT && fasi(ev1).join(',') === 'riposo,pronto,riposo,pronto' && g1.misure().inneschi === 2 && g1.misure().scaduti === 1,
    `fasi ${fasi(ev1).join(' → ')}; riposo ${riposo ? (riposo.t - ultimoPalmo).toFixed(0) : '—'} ms dopo l'ultimo palmo; inneschi ${g1.misure().inneschi}, scaduti ${g1.misure().scaduti}`);

  // una mano presente ma fuori dalla zona non tiene sveglio niente; da azione non si scade mai
  const g2 = createGesti();
  const lunga = [...unaMano(seq({ x: 0.45, y: 0.75, r: 1.2 }, [20, {}], [3, { r: 0.15 }], [5, { x: 0.5 }], [150, { x: 0.6 }], [3, { r: 1.2 }]))];
  const ev2 = gira(lunga, undefined, g2).ev;
  prova('da azione non si scade: una rotazione di 5 s resta viva', !ev2.some((e) => e.fase === 'riposo' && e.i > 0) && conta(ev2, 'ruota') > 100, `fasi ${fasi(ev2).join(' → ')}, ${conta(ev2, 'ruota')} ruota`);

  // e riposo_ms si conta dalla fine del gesto: uno zoom allargato fin fuori dalla zona, tenuto fermo 10 s (non manda più
  // niente), poi lasciato, resta pronto. Prima dell'11/11 tornava a riposo 33 ms dopo il rilascio (prova del revisore)
  const Dz = seq({ x: 0.6, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [20, { x: 0.95 }], [300, {}], [3, { r: 1.2 }], [60, {}]);
  const Sz = seq({ x: 0.4, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [20, { x: 0.05 }], [300, {}], [3, { r: 1.2 }], [60, {}]);
  const evz = gira(dueMani(Dz, Sz), undefined, undefined, 1000, PRE).ev, rz = evz.find((e) => e.fase === 'riposo' && e.i > 0);
  prova('riposo_ms dalla fine del gesto: uno zoom tenuto fermo 10 s e lasciato con le mani fuori zona resta pronto', conta(evz, 'zoom') > 10 && !rz,
    `fasi ${fasi(evz).join(' → ')}; riposo ${rz ? `${Math.round((rz.i - (Dz.length - 63)) * DT)} ms dopo l'inizio del rilascio` : 'non nei 2 s dopo il rilascio'}`);

  // l'ordine: 'azione' prima dei gesti del suo fotogramma, 'pronto' dopo; un clic sta tutto in un fotogramma
  const clic = gira(unaMano(seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [2, { r: 0.15 }], [3, {}], [2, { r: 1.2 }], [5, {}])), undefined, undefined, 1000, PRE).ev;
  const iA = clic.find((e) => e.tipo === 'afferra')?.i, q = clic.filter((e) => e.i === iA).map((e) => e.tipo + (e.fase ? ':' + e.fase : ''));
  const rot = gira(unaMano(seq({ x: 0.4, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.6 }], [3, { r: 1.2 }], [3, {}])), undefined, undefined, 1000, PRE).ev.filter((e) => e.i >= 0 && e.tipo !== 'cursore');
  const rotNomi = rot.map((e) => e.tipo + (e.fase ? ':' + e.fase : ''));
  prova('ordine: stato azione prima del gesto, stato pronto dopo', q.join(',') === 'stato:azione,cursore,afferra,lascia,stato:pronto' && rotNomi[0] === 'stato:azione' && rotNomi[1] === 'ruota' && rotNomi.at(-1) === 'stato:pronto' && rotNomi.filter((t) => t.startsWith('stato')).length === 2,
    `clic: ${q.join(', ')}; rotazione: ${rotNomi[0]}, ${rotNomi[1]} … ${rotNomi.at(-1)}`);

  // un pizzico chiuso prima dell'innesco non parte: la destra si chiude mentre la sinistra fa l'innesco
  const prePizzico = (opz) => {
    const D = seq({ x: 0.6, y: 0.75, r: 1.2 }, [4, {}], [3, { r: 0.15 }], [10, {}], [20, { x: 0.75 }]);
    const S = seq({ x: 0.35, y: 0.75, r: 1.2, lato: 'Left' }, [37, {}]);
    const ev = gira(dueMani(D, S), opz).ev;
    return { fasi: fasi(ev), gesti: nomi(ev) };
  };
  const pp = prePizzico(), pp0 = prePizzico(SEMPRE);
  prova('innesco: un pizzico già chiuso quando arriva l\'innesco non parte', pp.fasi.includes('pronto') && pp.gesti.length === 0 && pp0.gesti.length > 0,
    `fasi ${pp.fasi.join(' → ')}, gesti ${pp.gesti.join(',') || 'nessuno'}; con innesco_ms 0: ${[...new Set(pp0.gesti)].join(',')}`);

  // due palmi che fanno l'innesco e poi si allargano: esplodono
  const DE = seq({ x: 0.6, y: 0.75, r: 1.2 }, [18, {}], [12, { x: 0.75 }], [10, {}]), SE = seq({ x: 0.4, y: 0.75, r: 1.2, lato: 'Left' }, [18, {}], [12, { x: 0.25 }], [10, {}]);
  const ex = gira(dueMani(DE, SE)).ev;
  prova('innesco con due palmi, poi si allargano: esplodi', fasi(ex)[0] === 'riposo' && fasi(ex)[1] === 'pronto' && fasi(ex).includes('azione') && somma(ex, 'esplodi', 'delta') > 0.3,
    `fasi ${fasi(ex).join(' → ')}, Σdelta ${f3(somma(ex, 'esplodi', 'delta'))}`);

  // azzera() torna a riposo e lo ridice; innesco_ms 0 è sempre pronto e non scade
  const g3 = createGesti();
  gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [20, {}])), undefined, g3);
  const primaAz = g3.stato().fase; g3.azzera();
  const dopoAz = g3.aggiorna([], 5000);
  const g4 = createGesti(SEMPRE), ev4 = gira([...unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [10, {}])), ...Array.from({ length: 200 }, () => [])], undefined, g4).ev;
  prova('azzera() torna a riposo; con innesco_ms 0 sempre pronto, senza scadenza', primaAz === 'pronto' && dopoAz.length === 1 && dopoAz[0].fase === 'riposo' && fasi(ev4).join(',') === 'pronto',
    `prima ${primaAz}, dopo azzera ${dopoAz.map((e) => e.fase).join(',')}; con innesco 0 in 7 s: ${fasi(ev4).join(' → ')}`);
}

// 13. Le misure d'uso vero e il pezzo di riga del registro -------------------------------------------------------------------
{
  const g = createGesti();
  const parte1 = seq({ x: 0.45, y: 0.75, r: 1.2 }, [20, {}], [2, { r: 0.15 }], [4, {}], [2, { r: 1.2 }], [6, {}]); // innesco, poi un clic
  const parte2 = seq({ x: 0.45, y: 0.75, r: 1.2 }, [5, {}], [2, { r: 0.15 }], [15, {}]);                          // un buco di 2, poi una presa…
  const fot = [...unaMano(parte1), [], [], ...unaMano(parte2), ...Array.from({ length: 8 }, () => []), ...Array.from({ length: 130 }, () => [])]; // …e la mano sparisce
  gira(fot, undefined, g);
  // pollice e indice a 0,15 lunghezze dell'indice (che nel modello resta lungo uguale anche piegato), in palmi
  const m = g.misure(), atteso = (0.15 * (dist(BASE[5], BASE[6]) + dist(BASE[6], BASE[7]) + dist(BASE[7], BASE[8]))) / 92;
  prova('misure(): inneschi, scaduti, pizzichi, buchi, gesti persi e la distanza minima del pizzico',
    m.inneschi === 1 && m.scaduti === 1 && m.pizzichi === 2 && m.buchi === 1 && m.gesti_persi === 1 && m.lanci === 0 && Math.abs(m.pizzico_min - atteso) < 0.03 && m.secondi > 1.5 && m.profilo === 0,
    `inneschi ${m.inneschi}, scaduti ${m.scaduti}, pizzichi ${m.pizzichi}, minimo ${f3(m.pizzico_min)} U (atteso circa ${f3(atteso)}), buchi ${m.buchi}, gesti persi ${m.gesti_persi}, secondi ${m.secondi.toFixed(2)}, profilo ${m.profilo}`);
  // azzera() dimentica le mani ma tiene le misure (mani.js lo chiama a ogni ferma); azzeraMisure() le rimette a zero
  const faseG = g.stato().fase; g.azzera();
  const tenute = g.misure().inneschi; g.azzeraMisure();
  const zero = g.misure();
  prova('azzera() tiene le misure, azzeraMisure() le rimette a zero', tenute === 1 && zero.inneschi === 0 && zero.pizzichi === 0 && zero.secondi === 0 && zero.tremolio === null && zero.pizzico_min === null && faseG === 'riposo',
    `dopo azzera inneschi ${tenute}; dopo azzeraMisure ${JSON.stringify(zero)}`);

  // il tremolio: con rumore σ 0,004 a palmo fermo è circa lo scarto del rumore stesso (il filtrato quasi non si muove)
  rng = semi(21);
  const gt = createGesti(SEMPRE);
  gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2, rumore: 0.004 }, [299, {}])), undefined, gt);
  const mt = gt.misure(), attesoT = 0.004 * Math.hypot(P.aspetto, 1);
  prova('misure(): il tremolio della punta a palmo fermo, in altezze d\'immagine', Math.abs(mt.tremolio / attesoT - 1) < 0.1 && mt.tremolio_n > 200 && mt.salti === 0,
    `${f4(mt.tremolio)} (atteso circa ${f4(attesoT)}, cioè ${(mt.tremolio * 480).toFixed(2)} px su 480) su ${mt.tremolio_n} campioni; salti ${mt.salti}`);

  // il pezzo di riga per il registro del server: solo numeri finiti nei loro limiti, tutti facoltativi
  const buona = { secondi: 61.4, tremolio_px: 1.27, tremolio_n: 900, inneschi: 5, scaduti: 2, pizzichi: 31, pizzico_min: 0.163, pizzichi_profilo: 12, buchi: 4, gesti_persi: 1, lanci: 2, prese_sparite_veloci: 0, salti: 3, profilo: 0.22 };
  const riga = testoMisure(buona);
  const atteseRiga = '; mani viste 61 s; tremolio 1,3 px; inneschi 5 (scaduti 2); pizzichi 31 (minimo 0,16 U, 12 di profilo); buchi 4, gesti persi 1, lanci 2, prese sparite in corsa 0, salti 3, profilo 22%';
  const storte = [null, [], 'x', { pizzichi: -1 }, { pizzichi: NaN }, { pizzichi: '3' }, { profilo: 1.5 }, { altro: 1 }, { tremolio_px: Infinity }];
  prova('testoMisure: la riga leggibile, e null per ogni misura storta', riga === atteseRiga && testoMisure(undefined) === '' && testoMisure({}) === '' && storte.every((s) => testoMisure(s) === null) && testoMisure({ pizzichi: 3 }) === '; pizzichi 3',
    `«${riga}»; storte rifiutate ${storte.filter((s) => testoMisure(s) === null).length} su ${storte.length}`);
}

// 14. Ingressi sbagliati: nessuna eccezione e nessun numero non finito --------------------------------------------------------
{
  const buona = mano({ x: 0.5, y: 0.75 });
  const conNaN = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 8 ? { ...p, x: NaN } : p)) };
  const conInf = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 4 ? { ...p, y: Infinity } : p)) };
  const conStringa = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 0 ? { ...p, x: '0.5' } : p)) };
  const lontana = { lato: 'Right', punti: buona.punti.map((p) => ({ ...p, x: p.x * 1e9 })) };
  const piatta = { lato: 'Right', punti: buona.punti.map(() => ({ x: 0.5, y: 0.5, z: 0 })) };
  const zStorta = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 5 ? { ...p, z: NaN } : i === 17 ? { ...p, z: 1e300 } : p)) };
  const ingressi = [null, undefined, 'mano', 42, {}, [{}], [null], [{ punti: [] }], [{ punti: buona.punti.slice(0, 20) }], [conNaN], [conInf], [conStringa], [lontana], [piatta], [{ ...buona, punti: [...buona.punti.slice(0, 20), null] }]];
  const g = createGesti(SEMPRE);
  let eccezioni = 0, usciti = 0, t = 1000;
  for (const m of ingressi) for (let k = 0; k < 6; k++) { try { usciti += gesti(gira([m], undefined, g, (t += DT)).ev).length + conta(gira([m], undefined, g, (t += DT)).ev, 'cursore'); } catch { eccezioni++; } }
  let tempiCattivi = 0;
  for (const tt of [NaN, Infinity, '2000', t - 500, t]) { try { tempiCattivi += g.aggiorna([buona], tt).length; } catch { eccezioni++; } }
  const dopo = gira(Array.from({ length: 8 }, () => [{ ...buona, lato: 'Su' }, buona, buona]), undefined, g, t + DT).ev;
  const gz = createGesti(SEMPRE), evz = gira(Array.from({ length: 10 }, () => [zStorta]), undefined, gz).ev;
  let opzioniRifiutate = 0;
  const cattive = [{ chiuso: 0.8 }, { beta: NaN }, { margine: 0.6 }, { aspetto: 0 }, { stabile: 0 }, { lancio_mm_s: '1000' }, { curva: 1 }, { zona: 1.5 }, { zona: 0 }, { profilo_gradi: 100 }, { innesco_ms: -1 }, { riposo_ms: 0 }];
  for (const o of cattive) { try { createGesti(o); } catch { opzioniRifiutate++; } }
  prova('ingressi sbagliati: nessuna eccezione e nessun gesto; poi una mano buona funziona', eccezioni === 0 && usciti === 0 && tempiCattivi === 0 && conta(dopo, 'cursore') > 0 && g.stato().mani.length === 2 && g.stato().mani[0].lato === null && conta(evz, 'cursore') > 0 && Number.isFinite(gz.stato().mani[0].inclinazione),
    `${ingressi.length * 12} fotogrammi sbagliati → ${usciti} gesti, ${eccezioni} eccezioni; tempi non validi o all'indietro → ${tempiCattivi} gesti; tre mani → ${g.stato().mani.length} tracce, lato 'Su' → ${g.stato().mani[0].lato}; z storte → inclinazione ${f3(gz.stato().mani[0]?.inclinazione)}°`);
  prova('opzioni non valide: createGesti le rifiuta', opzioniRifiutate === cattive.length, `${opzioniRifiutate} di ${cattive.length} rifiutate`);
}

prova('ogni numero in uscita è finito, e x e y stanno fra 0 e 1', numeriCattivi === 0, `${numeriCattivi} numeri fuori posto in tutte le prove`);

// 15. mani.js si importa in Node (MediaPipe si carica solo in avvia) e la sua costante coincide col modello su disco ----------
{
  const { MODELLO_MANI } = await import('../public/ologramma/mani.js');
  const file = new URL('../runtime/modelli/hand_landmarker.task', import.meta.url);
  let dettagli = 'file assente: controllato solo il formato';
  let ok = MODELLO_MANI.byte === 7819105 && /^[0-9a-f]{64}$/.test(MODELLO_MANI.sha256) && MODELLO_MANI.url === '/modelli/hand_landmarker.task';
  if (fs.existsSync(file)) {
    const dati = fs.readFileSync(file), impronta = crypto.createHash('sha256').update(dati).digest('hex');
    ok = ok && dati.length === MODELLO_MANI.byte && impronta === MODELLO_MANI.sha256;
    dettagli = `${dati.length} B, sha256 ${impronta.slice(0, 16)}…`;
  }
  prova('mani.js si importa in Node e MODELLO_MANI coincide col file', ok, dettagli);
}

// Ricomponi: due pugni chiusi tenuti per ricomponi_ms (16/11, richiesta di Tony) -------------------------------------
{
  const pugni = (tieni, opz = {}, sx = {}) => dueMani(
    seq({ x: 0.6, y: 0.75, r: 1.2, pugno: 0, ...opz }, [8, {}], [4, { pugno: 1 }], [tieni, {}], [4, { pugno: 0 }], [10, {}]),
    seq({ x: 0.4, y: 0.75, r: 1.2, pugno: 0, lato: 'Left', ...opz, ...sx }, [8, {}], [4, { pugno: 1 }], [tieni, {}], [4, { pugno: 0 }], [10, {}]));
  const tieni = Math.ceil(700 / DT), breve = Math.ceil(300 / DT);
  let ev = gira(pugni(tieni), SEMPRE).ev;
  const g = gesti(ev).filter((e) => e.tipo !== 'sposta');
  prova('due pugni tenuti 0,7 s: un ricomponi solo, e niente altro', conta(ev, 'ricomponi') === 1 && g.every((e) => e.tipo === 'ricomponi'), `gesti: ${nomi(ev).join(',') || 'nessuno'}`);
  const iR = ev.find((e) => e.tipo === 'ricomponi')?.i, chiusi = 8 + 4;
  prova('arriva mezzo secondo dopo che i pugni si chiudono', iR >= chiusi + Math.floor(P.ricomponi_ms / DT) - 3 && iR <= chiusi + Math.ceil(P.ricomponi_ms / DT) + 2, `al fotogramma ${iR}, pugni chiusi al ${chiusi}`);
  ev = gira(pugni(breve), SEMPRE).ev;
  prova('due pugni per 0,3 s non ricompongono', conta(ev, 'ricomponi') === 0, `gesti: ${nomi(ev).join(',') || 'nessuno'}`);
  ev = gira(pugni(tieni, { pr: 0.15 }), SEMPRE).ev;
  prova('pugni che valgono anche come pizzico: ricomponi e non zoom', conta(ev, 'ricomponi') === 1 && conta(ev, 'zoom') === 0, `gesti: ${[...new Set(nomi(ev))].join(',')}`);
  const unoSolo = dueMani(seq({ x: 0.6, y: 0.75, r: 1.2, pugno: 0 }, [8, {}], [4, { pugno: 1 }], [tieni, {}]), seq({ x: 0.4, y: 0.75, r: 1.2, pugno: 0, lato: 'Left' }, [8, {}], [4, {}], [tieni, {}]));
  ev = gira(unoSolo, SEMPRE).ev;
  prova('un pugno e una mano aperta non ricompongono', conta(ev, 'ricomponi') === 0, `gesti: ${nomi(ev).join(',') || 'nessuno'}`);
  // con l'innesco: mani che arrivano già chiuse non mostrano il palmo, quindi restano a riposo e non fanno niente
  ev = gira(dueMani(seq({ x: 0.6, y: 0.75, r: 1.2, pugno: 1 }, [tieni + 8, {}]), seq({ x: 0.4, y: 0.75, r: 1.2, pugno: 1, lato: 'Left' }, [tieni + 8, {}]))).ev;
  prova('a riposo i pugni non ricompongono', conta(ev, 'ricomponi') === 0 && fasi(ev).every((f) => f === 'riposo'), `fasi: ${fasi(ev).join(' → ')}`);
  ev = gira(pugni(tieni), undefined, undefined, 1000, PRE).ev; // prima il palmo, poi i pugni
  prova('dopo il palmo mostrato, i pugni ricompongono', conta(ev, 'ricomponi') === 1, `fasi: ${fasi(ev).join(' → ')}; gesti: ${nomi(ev).join(',')}`);
  ev = gira(pugni(tieni), { ...SEMPRE, ricomponi_ms: 2000 }).ev;
  prova('la prova sa fallire: con ricomponi_ms 2 s gli stessi 0,7 s non ricompongono', conta(ev, 'ricomponi') === 0);
}

console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exit(falliti ? 1 : 0);
