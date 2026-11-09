// Prova di public/ologramma/gesti.js con mani sintetiche: una mano modello di 21 punti in mm in cui si muovono pollice
// e indice, messa nell'immagine come la vedrebbe la fotocamera. node prove/gesti.mjs → PASS o FAIL per ogni caso;
// esce con 0 solo se passa tutto.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createGesti, PREDEFINITI as P } from '../public/ologramma/gesti.js';

const DT = 1000 / 30; // 30 fotogrammi al secondo, come la fotocamera
// L'immagine è alta 470 mm alla distanza della mano: 50 cm da una fotocamera con 50° in verticale (stima, non misurata
// sulla fotocamera di Tony). Serve solo a dare i mm/s alle sequenze: gesti.js li ricava dal palmo.
const MM = 470, K_SCHERMO = 1 / (1 - 2 * P.margine);
let passati = 0, falliti = 0, numeriCattivi = 0;
const prova = (nome, ok, dettagli = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${dettagli ? ` — ${dettagli}` : ''}`); ok ? passati++ : falliti++; };
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : String(v));

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

// s: { x, y } polso in coordinate normalizzate, r rapporto del pizzico voluto, lato, rumore (σ normalizzata)
function mano({ x, y, r = 1.2, lato = 'Right', rumore = 0 }) {
  const p = BASE.map(([a, b]) => [a * K, b * K]);
  // l'indice si piega verso il pollice mentre il pizzico si chiude: 7→8 gira attorno a 7, fino a 15°, la lunghezza resta
  const phi = -0.26 * (1 - Math.min(r, 1.2) / 1.2), c = Math.cos(phi), s = Math.sin(phi);
  const [x7, y7] = p[7], vx = p[8][0] - x7, vy = p[8][1] - y7;
  p[8] = [x7 + vx * c - vy * s, y7 + vx * s + vy * c];
  // il pollice: la punta va verso quella dell'indice finché distano r volte la lunghezza dell'indice
  const L = dist(p[5], p[6]) + dist(p[6], p[7]) + dist(p[7], p[8]), u = dist(p[4], p[8]);
  p[4] = [p[8][0] + ((p[4][0] - p[8][0]) / u) * r * L, p[8][1] + ((p[4][1] - p[8][1]) / u) * r * L];
  p[3] = [(p[2][0] + p[4][0]) / 2, (p[2][1] + p[4][1]) / 2];
  const sx = lato === 'Left' ? -1 : 1; // la sinistra è lo specchio della destra
  const n = () => (rumore ? rumore * gauss() : 0);
  return { lato, punti: p.map(([a, b]) => ({ x: x + (sx * a) / MM / P.aspetto + n(), y: y + b / MM + n(), z: 0 })) };
}
const schermo = (q) => ({ x: Math.max(0, Math.min(1, (q.x - P.margine) * K_SCHERMO)), y: Math.max(0, Math.min(1, (q.y - P.margine) * K_SCHERMO)) });
const punta = (s) => schermo(mano({ ...s, rumore: 0 }).punti[8]); // il cursore vero, senza filtro

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

// Fa girare gesti.js e controlla che ogni numero in uscita sia finito, e x e y dentro lo schermo
function gira(fotogrammi, opzioni, g = createGesti(opzioni), t0 = 1000) {
  const ev = [];
  fotogrammi.forEach((mani, i) => {
    for (const e of g.aggiorna(mani, t0 + i * DT)) {
      for (const [k, v] of Object.entries(e)) if (typeof v === 'number' && (!Number.isFinite(v) || ((k === 'x' || k === 'y') && (v < 0 || v > 1)))) numeriCattivi++;
      ev.push({ i, ...e });
    }
  });
  return { ev, g };
}
const gesti = (ev) => ev.filter((e) => e.tipo !== 'cursore');
const nomi = (ev) => gesti(ev).map((e) => e.tipo);
const somma = (ev, tipo, campo, filtro = () => true) => ev.filter((e) => e.tipo === tipo && filtro(e)).reduce((s, e) => s + e[campo], 0);
const conta = (ev, tipo) => ev.filter((e) => e.tipo === tipo).length;
const vel = (v) => (v * DT) / MM / P.aspetto; // v in m/s (= mm/ms) → x normalizzata per fotogramma

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
  const g2 = createGesti();
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
{
  const stati = seq({ x: 0.4, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.6, y: 0.65 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(unaMano(stati));
  const dx = somma(ev, 'ruota', 'dx'), dy = somma(ev, 'ruota', 'dy'), adx = 0.2 * K_SCHERMO, ady = -0.1 * K_SCHERMO;
  const altri = nomi(ev).filter((t) => t !== 'ruota');
  prova('ruota: dx e dy dal trascinamento del pizzico', Math.abs(dx - adx) < 0.01 && Math.abs(dy - ady) < 0.01 && altri.length === 0 && conta(ev, 'ruota') > 5,
    `Σdx ${f3(dx)} (atteso ${f3(adx)}), Σdy ${f3(dy)} (atteso ${f3(ady)}), ${conta(ev, 'ruota')} eventi, altri gesti: ${altri.join(',') || 'nessuno'}`);
}

// 3. Zoom a due mani ed esplodi coi palmi ----------------------------------------------------------------------------
{
  const D = seq({ x: 0.62, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.72 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const S = seq({ x: 0.38, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [5, {}], [12, { x: 0.28 }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(dueMani(D, S));
  const rilascio = D.length - 8; // il primo fotogramma in cui le dita si riaprono
  const fattore = ev.filter((e) => e.tipo === 'zoom' && e.i < rilascio).reduce((p, e) => p * e.fattore, 1);
  const centro = (s) => { const p = mano(s).punti; return [0, 5, 9, 13, 17].reduce((c, i) => [c[0] + (p[i].x * P.aspetto) / 5, c[1] + p[i].y / 5], [0, 0]); };
  const d = (i) => { const a = centro(D[i]), b = centro(S[i]); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const atteso = d(rilascio - 1) / d(14);
  const altri = nomi(ev).filter((t) => t !== 'zoom');
  prova('zoom: il prodotto dei fattori è il rapporto delle distanze fra le mani', Math.abs(fattore / atteso - 1) < 0.01 && altri.length === 0,
    `Π fattori ${fattore.toFixed(4)}, atteso ${atteso.toFixed(4)} (${((fattore / atteso - 1) * 100).toFixed(2)}%), altri gesti: ${altri.join(',') || 'nessuno'}`);

  rng = semi(3);
  const r = 0.002; // un po' di rumore: due mani aperte e ferme non devono esplodere
  const DE = seq({ x: 0.6, y: 0.75, r: 1.2, rumore: r }, [8, {}], [10, {}], [12, { x: 0.75 }], [10, {}], [12, { x: 0.65 }], [10, {}]);
  const SE = seq({ x: 0.4, y: 0.75, r: 1.2, rumore: r, lato: 'Left' }, [8, {}], [10, {}], [12, { x: 0.25 }], [10, {}], [12, { x: 0.35 }], [10, {}]);
  const ev2 = gira(dueMani(DE, SE)).ev;
  const fermi = ev2.filter((e) => e.tipo === 'esplodi' && e.i <= 18).length;
  const apri = somma(ev2, 'esplodi', 'delta', (e) => e.i > 18 && e.i <= 40), chiudi = somma(ev2, 'esplodi', 'delta', (e) => e.i > 40);
  const attApri = ((0.75 - 0.25 - 0.2) * P.aspetto) / PALMO_H / P.esplodi_palmi, attChiudi = ((0.3 - 0.5) * P.aspetto) / PALMO_H / P.esplodi_palmi;
  prova('esplodi: due palmi aperti che si allargano e si stringono', fermi === 0 && Math.abs(apri - attApri) < 0.03 && Math.abs(chiudi - attChiudi) < 0.03 && nomi(ev2).every((t) => t === 'esplodi'),
    `fermi: ${fermi} eventi; allargando Σdelta ${f3(apri)} (atteso ${f3(attApri)}), stringendo ${f3(chiudi)} (atteso ${f3(attChiudi)})`);
}

// 4. Afferra, sposta e lascia -----------------------------------------------------------------------------------------
{
  const stati = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [9, { x: 0.45 + 9 * vel(0.3) }], [15, {}], [3, { r: 1.2 }], [5, {}]);
  const { ev } = gira(unaMano(stati));
  const a = ev.find((e) => e.tipo === 'afferra'), mira = punta(stati[8]), presa = punta(stati[11]);
  const dx = somma(ev, 'sposta', 'dx'), adx = 9 * vel(0.3) * K_SCHERMO;
  const n = nomi(ev);
  prova('afferra dove l\'indice puntava prima di chiudersi, poi sposta e lascia',
    a && Math.abs(a.x - mira.x) < 0.005 && Math.abs(a.y - mira.y) < 0.005 && Math.abs(dx - adx) < 0.01 && n[0] === 'afferra' && n[n.length - 1] === 'lascia' && !n.includes('lancia') && !n.includes('ruota'),
    `afferra a (${f3(a?.x)}, ${f3(a?.y)}) dopo ${a ? ((a.i - 11) * DT).toFixed(0) : '?'} ms di pizzico, mira (${f3(mira.x)}, ${f3(mira.y)}); a dita chiuse la punta era a (${f3(presa.x)}, ${f3(presa.y)}); Σdx ${f3(dx)} (atteso ${f3(adx)}); ultimo gesto ${n[n.length - 1]}`);
}

// 5. Lancio: la velocità al rilascio, con le soglie ai due lati ---------------------------------------------------------
function lancio(v, opzioni) {
  const x0 = 0.15, dx = vel(v); // la mano corre per 5 fotogrammi e apre le dita senza fermarsi
  const stati = seq({ x: x0, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [5, { x: x0 + 5 * dx }], [3, { x: x0 + 8 * dx, r: 1.2 }], [2, { x: x0 + 10 * dx }]);
  return gira(unaMano(stati), opzioni).ev;
}
{
  const lento = nomi(lancio(0.3));
  prova('afferra, sposta e lascia lento (0,3 m/s) dà lascia e non lancia', lento.at(-1) === 'lascia' && !lento.includes('lancia'), `gesti: ${[...new Set(lento)].join(',')}`);
  const ev = lancio(1.5), l = ev.find((e) => e.tipo === 'lancia'), atteso = (1.5 * 1000) / MM / P.aspetto * K_SCHERMO;
  prova('lancio veloce (1,5 m/s) dà lancia, con la velocità giusta', l && Math.abs(l.vx / atteso - 1) < 0.02 && Math.abs(l.vy) < 0.02 * atteso && !nomi(ev).includes('lascia'),
    `vx ${f3(l?.vx)} schermi/s (atteso ${f3(atteso)}), vy ${f3(l?.vy)}, a (${f3(l?.x)}, ${f3(l?.y)})`);
  const sotto = nomi(lancio(0.8)), sopra = nomi(lancio(1.2));
  prova('soglia del lancio a 1 m/s: 0,8 m/s lascia, 1,2 m/s lancia', sotto.at(-1) === 'lascia' && !sotto.includes('lancia') && sopra.includes('lancia') && !sopra.includes('lascia'),
    `0,8 → ${sotto.at(-1)}, 1,2 → ${sopra.filter((t) => t === 'lancia' || t === 'lascia').join(',')}`);
  const alzata = nomi(lancio(1.5, { lancio_mm_s: 2000 }));
  prova('la prova sa fallire: con la soglia a 2 m/s lo stesso colpo a 1,5 m/s lascia', alzata.at(-1) === 'lascia' && !alzata.includes('lancia'), `→ ${alzata.at(-1)}`);
}

// 6. Movimenti veloci senza presa: nessun lancio --------------------------------------------------------------------------
{
  const d = 4 * vel(2);
  const aperta = seq({ x: 0.3, y: 0.75, r: 1.2 }, [8, {}], [4, { x: 0.3 + d }], [4, { x: 0.3 }], [4, { x: 0.3 + d }], [4, { x: 0.3 }], [5, {}]);
  const ev = gira(unaMano(aperta)).ev;
  prova('mano aperta che corre a 2 m/s: nessun gesto, solo il cursore', nomi(ev).length === 0 && conta(ev, 'cursore') > 20, `gesti: ${nomi(ev).join(',') || 'nessuno'}`);
  const dr = vel(1.5);
  const ruota = seq({ x: 0.15, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [6, { x: 0.15 + 6 * dr }], [3, { x: 0.15 + 9 * dr, r: 1.2 }], [3, {}]);
  const n = nomi(gira(unaMano(ruota)).ev);
  prova('pizzico trascinato subito a 1,5 m/s e lasciato in corsa: ruota, nessun lancio', n.length > 0 && n.every((t) => t === 'ruota'), `gesti: ${[...new Set(n)].join(',')}`);
}

// 7. Tremolio: deviazione standard prima e dopo il filtro, e ritardo in movimento; taratura di beta ------------------------
function filtro(opzioni) {
  rng = semi(7);
  const fermo = seq({ x: 0.5, y: 0.75, r: 1.2, rumore: 0.004 }, [299, {}]);
  const fot = unaMano(fermo), grezzi = fot.map((f) => schermo(f[0].punti[8]));
  const cur = new Map(gira(fot, opzioni).ev.filter((e) => e.tipo === 'cursore').map((e) => [e.i, e]));
  const idx = [...cur.keys()].filter((i) => i >= 30);
  const ds = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
  const sdGx = ds(idx.map((i) => grezzi[i].x)), sdFx = ds(idx.map((i) => cur.get(i).x)), sdGy = ds(idx.map((i) => grezzi[i].y)), sdFy = ds(idx.map((i) => cur.get(i).y));
  // ritardo: mano senza rumore che corre a 0,5 m/s; si misura dopo 0,5 s di corsa, quando la velocità stimata è salita
  const dx = vel(0.5), corsa = seq({ x: 0.2, y: 0.75, r: 1.2 }, [10, {}], [20, { x: 0.2 + 20 * dx }]);
  const c2 = new Map(gira(unaMano(corsa), opzioni).ev.filter((e) => e.tipo === 'cursore').map((e) => [e.i, e]));
  const rit = [];
  for (let i = 25; i <= 30; i++) rit.push(((punta(corsa[i]).x - c2.get(i).x) / (dx * K_SCHERMO)) * DT);
  return { sdGx, sdFx, sdGy, sdFy, riduzione: (sdGx / sdFx + sdGy / sdFy) / 2, ritardo: rit.reduce((s, v) => s + v, 0) / rit.length };
}
{
  const righe = [0, 1, 2, 5, 10, 20].map((beta) => { const r = filtro({ beta }); return `β ${beta}: tremolio ÷${r.riduzione.toFixed(2)}, ritardo ${r.ritardo.toFixed(0)} ms`; });
  console.log(`     taratura (σ 0,004 a mano ferma; ritardo a 0,5 m/s): ${righe.join(' | ')}`);
  const r = filtro();
  prova(`tremolio ridotto dal filtro (β ${P.beta}): almeno ÷2,5 da fermo e ritardo sotto 40 ms a 0,5 m/s`, r.riduzione >= 2.5 && r.ritardo < 40,
    `deviazione standard x ${r.sdGx.toFixed(4)} → ${r.sdFx.toFixed(4)}, y ${r.sdGy.toFixed(4)} → ${r.sdFy.toFixed(4)} (schermi), cioè ÷${r.riduzione.toFixed(2)}; ritardo ${r.ritardo.toFixed(1)} ms`);
}

// 8. Mani che spariscono a metà gesto -------------------------------------------------------------------------------------
{
  // presa, poi la mano sparisce: un solo 'lascia' quando scade assente_ms, e poi niente
  const stati = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}]);
  const fot = [...unaMano(stati), ...Array.from({ length: 20 }, () => [])];
  const ev = gira(fot).ev, n = nomi(ev), l = ev.find((e) => e.tipo === 'lascia');
  const attesoI = stati.length - 1 + Math.floor(P.assente_ms / DT) + 1;
  prova('presa e la mano sparisce: un lascia solo, quando scade l\'assenza', n.filter((t) => t !== 'sposta').join(',') === 'afferra,lascia' && l.i === attesoI && ev.filter((e) => e.i > attesoI).length === 0,
    `gesti ${[...new Set(n)].join(',')}, lascia al fotogramma ${l?.i} (atteso ${attesoI}, cioè ${((attesoI - stati.length + 1) * DT).toFixed(0)} ms dopo l'ultima vista)`);

  // un buco di due fotogrammi durante la presa non la chiude
  const prima = seq({ x: 0.45, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [15, {}], [5, { x: 0.5 }]);
  const dopo = seq({ ...prima.at(-1), x: 0.52 }, [5, { x: 0.55 }], [15, {}], [3, { r: 1.2 }], [3, {}]);
  const ev2 = gira([...unaMano(prima), [], [], ...unaMano(dopo)]).ev, n2 = nomi(ev2);
  const dopoBuco = ev2.filter((e) => e.tipo === 'sposta' && e.i > prima.length + 1).length;
  prova('un buco di 2 fotogrammi (67 ms) non chiude la presa', n2.filter((t) => t !== 'sposta').join(',') === 'afferra,lascia' && n2.at(-1) === 'lascia' && dopoBuco > 3,
    `gesti ${[...new Set(n2)].join(',')}, ${dopoBuco} sposta dopo il buco, lascia solo alla fine`);

  // zoom, poi una mano sparisce: lo zoom si ferma; l'altra, ancora chiusa, non comincia a ruotare finché non si riapre
  const D = seq({ x: 0.62, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.7 }]);
  const S = seq({ x: 0.38, y: 0.75, r: 1.2, lato: 'Left' }, [8, {}], [3, { r: 0.15 }], [10, { x: 0.3 }]);
  const resta = seq({ ...D.at(-1) }, [20, { x: 0.55, y: 0.65 }], [3, { r: 1.2 }], [3, {}], [3, { r: 0.15 }], [15, {}]);
  const fot3 = [...dueMani(D, S), ...resta.map((s) => [mano(s)])];
  const ev3 = gira(fot3).ev, via = D.length;
  const zoomDopo = ev3.filter((e) => e.tipo === 'zoom' && e.i >= via).length, primaDiAprire = nomi(ev3.filter((e) => e.i >= via && e.i < via + 21));
  const riparte = ev3.find((e) => e.tipo === 'afferra' && e.i > via + 26);
  prova('zoom e una mano sparisce: lo zoom si ferma, l\'altra resta ferma finché non si riapre', conta(ev3.filter((e) => e.i < via), 'zoom') > 3 && zoomDopo === 0 && primaDiAprire.length === 0 && !!riparte,
    `zoom dopo la sparizione: ${zoomDopo}; gesti con la mano ancora chiusa che si muove: ${primaDiAprire.join(',') || 'nessuno'}; dopo averla riaperta e richiusa: ${riparte ? 'afferra' : 'niente'}`);

  // rotazione, la mano sparisce e ricompare già chiusa: niente gesti finché non si apre
  const R1 = seq({ x: 0.3, y: 0.75, r: 1.2 }, [8, {}], [3, { r: 0.15 }], [8, { x: 0.45 }]);
  const R2 = seq({ x: 0.5, y: 0.7, r: 0.15 }, [20, { x: 0.6 }], [3, { r: 1.2 }], [3, {}], [3, { r: 0.15 }], [8, { x: 0.45 }]);
  const ev4 = gira([...unaMano(R1), ...Array.from({ length: 8 }, () => []), ...unaMano(R2)]).ev, torna = R1.length + 8;
  const n4 = nomi(ev4.filter((e) => e.i < torna)), chiusa = nomi(ev4.filter((e) => e.i >= torna && e.i < torna + 21)), poi = nomi(ev4.filter((e) => e.i >= torna + 21));
  prova('rotazione e la mano sparisce: nessun lancio; ricompare chiusa e non fa niente finché non si apre', n4.every((t) => t === 'ruota') && n4.length > 0 && chiusa.length === 0 && poi.includes('ruota'),
    `prima: ${[...new Set(n4)].join(',')}; ricomparsa chiusa: ${chiusa.join(',') || 'nessuno'}; riaperta e richiusa: ${[...new Set(poi)].join(',')}`);
}

// 9. Stabilità: una mano nuova non dà gesti per i primi fotogrammi --------------------------------------------------------
{
  const ev = gira(unaMano(seq({ x: 0.5, y: 0.75, r: 1.2 }, [10, {}]))).ev;
  const primo = ev.find((e) => e.tipo === 'cursore');
  prova(`una mano nuova dà il cursore solo dal fotogramma ${P.stabile}`, primo?.i === P.stabile - 1, `primo cursore al fotogramma ${primo ? primo.i + 1 : 'mai'}`);
}

// 10. Ingressi sbagliati: nessuna eccezione e nessun numero non finito --------------------------------------------------------
{
  const buona = mano({ x: 0.5, y: 0.75 });
  const conNaN = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 8 ? { ...p, x: NaN } : p)) };
  const conInf = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 4 ? { ...p, y: Infinity } : p)) };
  const conStringa = { lato: 'Right', punti: buona.punti.map((p, i) => (i === 0 ? { ...p, x: '0.5' } : p)) };
  const lontana = { lato: 'Right', punti: buona.punti.map((p) => ({ ...p, x: p.x * 1e9 })) };
  const piatta = { lato: 'Right', punti: buona.punti.map(() => ({ x: 0.5, y: 0.5, z: 0 })) };
  const ingressi = [null, undefined, 'mano', 42, {}, [{}], [null], [{ punti: [] }], [{ punti: buona.punti.slice(0, 20) }], [conNaN], [conInf], [conStringa], [lontana], [piatta], [{ ...buona, punti: [...buona.punti.slice(0, 20), null] }]];
  const g = createGesti();
  let eccezioni = 0, usciti = 0, t = 1000;
  for (const m of ingressi) for (let k = 0; k < 6; k++) { try { usciti += gira([m], undefined, g, (t += DT)).ev.length; } catch { eccezioni++; } }
  let tempiCattivi = 0;
  for (const tt of [NaN, Infinity, '2000', t - 500, t]) { try { tempiCattivi += g.aggiorna([buona], tt).length; } catch { eccezioni++; } }
  const dopo = gira(Array.from({ length: 8 }, () => [{ ...buona, lato: 'Su' }, buona, buona]), undefined, g, t + DT).ev;
  let opzioniRifiutate = 0;
  for (const o of [{ chiuso: 0.8 }, { beta: NaN }, { margine: 0.6 }, { aspetto: 0 }, { stabile: 0 }, { lancio_mm_s: '1000' }]) { try { createGesti(o); } catch { opzioniRifiutate++; } }
  prova('ingressi sbagliati: nessuna eccezione e nessun gesto; poi una mano buona funziona', eccezioni === 0 && usciti === 0 && tempiCattivi === 0 && conta(dopo, 'cursore') > 0 && g.stato().mani.length === 2 && g.stato().mani[0].lato === null,
    `${ingressi.length * 6} fotogrammi sbagliati → ${usciti} gesti, ${eccezioni} eccezioni; tempi non validi o all'indietro → ${tempiCattivi} gesti; tre mani → ${g.stato().mani.length} tracce, lato 'Su' → ${g.stato().mani[0].lato}`);
  prova('opzioni non valide: createGesti le rifiuta', opzioniRifiutate === 6, `${opzioniRifiutate} di 6 rifiutate`);
}

prova('ogni numero in uscita è finito, e x e y stanno fra 0 e 1', numeriCattivi === 0, `${numeriCattivi} numeri fuori posto in tutte le prove`);

// 11. mani.js si importa in Node (MediaPipe si carica solo in avvia) e la sua costante coincide col modello su disco ----------
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

console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exit(falliti ? 1 : 0);
