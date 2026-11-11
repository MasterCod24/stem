// ologramma-forme.mjs — prova forme.js e materiali.js: volumi contro Monte Carlo, ingombri, matrici e
// cavi contro three.js, validazione dei dati del cervello e tempo del test «dentro».
// node prove/ologramma-forme.mjs → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import * as THREE from 'three';
import * as F from '../public/ologramma/forme.js';
import { MATERIALI, materiale } from '../public/ologramma/materiali.js';

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
function titolo(t) { console.log(`\n== ${t}`); }

// Generatore con seme (mulberry32): le prove danno sempre gli stessi numeri.
function casuale(seme) {
  let a = seme >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = casuale(20261105);
const fra = (a, b) => a + (b - a) * rnd();

function pezzo(p) {
  const r = F.normalizzaPezzo(p);
  if (!r.pezzo) throw new Error(`pezzo di prova non valido: ${r.errori.join('; ')}`);
  return r.pezzo;
}
const pct = (v) => `${(100 * v).toFixed(3)}%`;
const poligonoRegolare = (n, r, cx = 0, cy = 0, fase = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(fase + (2 * Math.PI * i) / n), cy + r * Math.sin(fase + (2 * Math.PI * i) / n)]);

// ------------------------------------------------------------------ 0. materiali
titolo('0. Materiali come nel contratto');
{
  const attesi = {
    'acciaio-s235': [210000, 0.3, 7850, 235, true], 'acciaio-s355': [210000, 0.3, 7850, 355, true],
    'alluminio-6061': [68900, 0.33, 2700, 240, true], 'titanio-ti6al4v': [113800, 0.342, 4430, 880, true],
    pla: [3600, 0.35, 1240, 60, true], petg: [1500, 0.38, 1270, 47, true], abs: [1960, 0.35, 1045, 27.5, true],
    'nylon-pa12': [1650, 0.4, 930, 48, true], 'fibra-carbonio': [70000, 0.1, 1600, undefined, false],
    generico: [null, null, null, null, false],
  };
  const chiavi = Object.keys(MATERIALI);
  esito(JSON.stringify(chiavi.sort()) === JSON.stringify(Object.keys(attesi).sort()), 'le dieci chiavi del contratto', chiavi.join(', '));
  const sbagliati = [];
  for (const [k, [E, nu, densita, snervamento, affidabile]] of Object.entries(attesi)) {
    const m = MATERIALI[k];
    if (!m || m.E !== E || m.nu !== nu || m.densita !== densita || (snervamento !== undefined && m.snervamento !== snervamento) || m.affidabile !== affidabile) sbagliati.push(k);
    if (!m || typeof m.fonte !== 'string' || !m.fonte || typeof m.nota !== 'string' || !m.nota || typeof m.nome !== 'string') sbagliati.push(k + ' (fonte, nota o nome)');
  }
  esito(sbagliati.length === 0, 'E, ν, ρ, snervamento e affidabile come nel contratto, con fonte e nota', sbagliati.join(', ') || 'tutti');
  esito(MATERIALI['acciaio-s235'].classe === 'metallo', "S235 ha classe 'metallo'");
  esito(materiale('pla') === MATERIALI.pla && materiale('oro') === null && materiale('constructor') === null && materiale('__proto__') === null && materiale(3) === null,
    'materiale(): la chiave giusta, null per le altre (anche constructor e __proto__)');
  esito(Object.isFrozen(MATERIALI) && Object.isFrozen(MATERIALI.pla), 'la tabella è congelata');
}

// ------------------------------------------------------------------ casi geometrici
// Ogni forma piena con almeno due misure. stretto: l'ingombro deve essere esatto (entro il 5% del lato).
const CASI = [
  ['scatola 10×20×30', { forma: 'scatola', misure: { x: 10, y: 20, z: 30 } }],
  ['scatola sottile 0,5×80×3', { forma: 'scatola', misure: { x: 0.5, y: 80, z: 3 } }],
  ['cilindro r 5 h 20', { forma: 'cilindro', misure: { r: 5, h: 20 } }],
  ['cilindro a disco r 40 h 2', { forma: 'cilindro', misure: { r: 40, h: 2 } }],
  ['tubo 8/10 h 30', { forma: 'tubo', misure: { r: 10, r_interno: 8, h: 30 } }],
  ['tubo 5/50 h 4', { forma: 'tubo', misure: { r: 50, r_interno: 5, h: 4 } }],
  ['sfera r 7', { forma: 'sfera', misure: { r: 7 } }],
  ['sfera r 1000', { forma: 'sfera', misure: { r: 1000 } }],
  ['cono a punta r 10 h 20', { forma: 'cono', misure: { r: 10, h: 20 } }],
  ['tronco di cono 10→4 h 15', { forma: 'cono', misure: { r: 10, r_cima: 4, h: 15 } }],
  ['tronco rovescio 3→12 h 8', { forma: 'cono', misure: { r: 3, r_cima: 12, h: 8 } }],
  ['toro R 30 r 10', { forma: 'toro', misure: { R: 30, r: 10 } }],
  ['toro quasi chiuso R 5 r 4,9', { forma: 'toro', misure: { R: 5, r: 4.9 } }],
  ['piastra piana 100×40×3', { forma: 'piastra', misure: { x: 100, z: 40, spessore: 3 } }],
  ['piastra curva R +50, 2 mm, 115°', { forma: 'piastra', misure: { x: 100, z: 40, spessore: 2, raggio: 50 } }],
  ['piastra curva R −50, 2 mm, 115°', { forma: 'piastra', misure: { x: 100, z: 40, spessore: 2, raggio: -50 } }],
  ['piastra curva R +20, 4 mm, 344°', { forma: 'piastra', misure: { x: 120, z: 10, spessore: 4, raggio: 20 } }],
  ['piastra curva R −200, 5 mm, 29°', { forma: 'piastra', misure: { x: 100, z: 30, spessore: 5, raggio: -200 } }],
  ['piastra a cilindro chiuso R 10, 360°', { forma: 'piastra', misure: { x: 2 * Math.PI * 10, z: 20, spessore: 1, raggio: 10 } }],
  ['estrusione a L', { forma: 'estrusione', misure: { profilo: [[0, 0], [40, 0], [40, 8], [8, 8], [8, 30], [0, 30]], profondita: 12 } }],
  ['estrusione con fori e fori tondi', { forma: 'estrusione', misure: {
    profilo: [[-50, -30], [50, -30], [50, 30], [-50, 30]], profondita: 6,
    fori: [poligonoRegolare(6, 8, -30, 0), [[10, -20], [30, -20], [20, -5]]],
    fori_tondi: [{ x: 0, y: 15, r: 6 }, { x: 35, y: 15, r: 5 }, { x: 0, y: -15, r: 4 }],
  } }],
  ['estrusione a stella concava con fori', { forma: 'estrusione', misure: {
    profilo: Array.from({ length: 20 }, (_, i) => { const r = i % 2 ? 22 : 50, a = (Math.PI * i) / 10; return [r * Math.cos(a), r * Math.sin(a)]; }),
    profondita: 3, fori: [poligonoRegolare(12, 8)], fori_tondi: [{ x: 35, y: 0, r: 3 }],
  } }],
  ['rivoluzione a vaso', { forma: 'rivoluzione', misure: { profilo: [[20, 0], [26, 20], [14, 45], [18, 60]] } }],
  ['rivoluzione a coppa con pareti', { forma: 'rivoluzione', misure: { profilo: [[0, 0], [30, 0], [34, 40], [31, 40], [27, 3], [0, 3]] } }],
  ['rivoluzione a cilindro di 2 punti', { forma: 'rivoluzione', misure: { profilo: [[10, -5], [10, 5]] } }],
  // Anelli: la parete di un ugello conico (il profilo vero del cervello, rifiutato il 10/11) e uno chiuso a mano
  ['rivoluzione ad anello (ugello)', { forma: 'rivoluzione', misure: { profilo: [[215, -125], [170, 125], [160, 125], [205, -125]] } }],
  ['rivoluzione ad anello chiuso a mano', { forma: 'rivoluzione', misure: { profilo: [[200, 0], [220, 0], [220, 50], [200, 50], [200, 0]] } }],
  ['ingranaggio 20 denti m 2 con foro 5', { forma: 'ingranaggio', misure: { denti: 20, modulo: 2, spessore: 10, foro: 5 } }],
  ['ingranaggio 6 denti m 5 con foro 2', { forma: 'ingranaggio', misure: { denti: 6, modulo: 5, spessore: 3, foro: 2 } }],
  ['ingranaggio 200 denti m 0,5 con foro 20', { forma: 'ingranaggio', misure: { denti: 200, modulo: 0.5, spessore: 2, foro: 20 } }],
  ['cavo dritto r 2 lungo 100', { forma: 'cavo', misure: { punti: [[0, 0, 0], [100, 0, 0]], r: 2 } }],
  ['cavo corto e grosso r 3 lungo 1', { forma: 'cavo', misure: { punti: [[0, 0, 0], [0.6, 0.8, 0]], r: 3 } }],
  ['cavo curvo nello spazio r 3', { forma: 'cavo', misure: { punti: [[0, 0, 0], [30, 20, 0], [60, 0, 15], [80, -20, 5], [100, 0, 30]], r: 3 } }],
  ['cavo a elica r 1,5', { forma: 'cavo', misure: { punti: Array.from({ length: 13 }, (_, i) => [20 * Math.cos(i / 2), 4 * i, 20 * Math.sin(i / 2)]), r: 1.5 } }],
];
const NON_STRETTI = new Set(['cavo dritto r 2 lungo 100', 'cavo corto e grosso r 3 lungo 1', 'cavo curvo nello spazio r 3', 'cavo a elica r 1,5']); // ±r anche lungo la tangente
const pezzi = CASI.map(([nome, p], i) => [nome, pezzo({ id: `p${i}`, ...p })]);

// ------------------------------------------------------------------ 1. volume contro Monte Carlo
titolo('1. Volume contro Monte Carlo stratificato (un punto a caso per cella, nell\'ingombro locale)');
// Previsione: errore sotto lo 0,3% su tutti; il più rumoroso è il cavo a elica, sottile nel suo ingombro.
function monteCarlo(p, N) {
  const b = F.ingombroLocale(p), n = Math.ceil(Math.cbrt(N));
  const [x0, y0, z0] = b.min, lx = b.max[0] - x0, ly = b.max[1] - y0, lz = b.max[2] - z0;
  const sx = lx / n, sy = ly / n, sz = lz / n;
  let dentro = 0;
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) if (F.dentroLocale(p, x0 + (i + rnd()) * sx, y0 + (j + rnd()) * sy, z0 + (k + rnd()) * sz)) dentro++;
  const punti = n * n * n, fr = dentro / punti;
  return { stima: fr * lx * ly * lz, punti, fr, sigma: Math.sqrt((1 - fr) / (fr * punti)) }; // sigma: limite del Monte Carlo semplice
}
const t1 = performance.now();
let erroreMax = 0, casoMax = '';
const stime = new Map();
for (const [nome, p] of pezzi) {
  const V = F.volume(p), b = F.ingombroLocale(p);
  const vb = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]), fr = V / vb;
  // Punti quanti ne servono perché 3σ del Monte Carlo semplice resti sotto lo 0,6%, fra 1 e 20 milioni.
  const N = Math.min(2e7, Math.max(1e6, Math.ceil((9 * (1 - fr)) / (fr * 0.006 ** 2))));
  const mc = monteCarlo(p, N), err = (V - mc.stima) / mc.stima;
  stime.set(nome, mc);
  if (Math.abs(err) > erroreMax) { erroreMax = Math.abs(err); casoMax = nome; }
  // Oltre all'1% del compito, l'errore deve stare entro 4σ: un difetto dello 0,6% sul cavo dritto
  // (10σ) passava sotto l'1% e l'ha trovato solo questo controllo.
  esito(Math.abs(err) < 0.01 && Math.abs(err) <= 4 * mc.sigma + 1e-9 && mc.punti >= 200000, `volume ${nome}`,
    `formula ${V.toFixed(2)} mm³, Monte Carlo ${mc.stima.toFixed(2)} (${(mc.punti / 1e6).toFixed(2)} M punti, pieno ${pct(mc.fr)}), errore ${pct(err)}, σ ≤ ${pct(mc.sigma)}`);
}
console.log(`     errore massimo ${pct(erroreMax)} (${casoMax}), ${((performance.now() - t1) / 1000).toFixed(1)} s`);
{
  // Un test che non può fallire non è un test: un volume sbagliato del 2% deve essere scoperto.
  const [nome, p] = pezzi.find(([n]) => n.startsWith('piastra curva R +50'));
  const err = (F.volume(p) * 1.02 - stime.get(nome).stima) / stime.get(nome).stima;
  esito(Math.abs(err) >= 0.01, 'controllo: un volume sbagliato del 2% supera la soglia dell\'1%', `errore ${pct(err)} su ${nome}`);
}
esito(F.volume(pezzo({ id: 'f', forma: 'file', misure: { file: '/Users/tony/modello.glb' } })) === null, "volume di un pezzo 'file': null");

// Il test accelerato a fasce deve dare esattamente PNPOLY su tutti i lati.
{
  const conta = { punti: 0, diversi: 0 };
  for (const [nome, p] of pezzi) {
    if (!['estrusione', 'rivoluzione', 'ingranaggio'].includes(p.forma)) continue;
    const m = p.misure, b = F.ingombroLocale(p);
    let riferimento;
    if (p.forma === 'estrusione') riferimento = (x, y, z) => Math.abs(z) <= m.profondita / 2 && F.puntoInPoligono(m.profilo, x, y) &&
      !m.fori.some((f) => F.puntoInPoligono(f, x, y)) && !m.fori_tondi.some((f) => (x - f.x) ** 2 + (y - f.y) ** 2 < f.r * f.r);
    else if (p.forma === 'rivoluzione') { const Q = F.poligonoRivoluzione(m.profilo); riferimento = (x, y, z) => F.puntoInPoligono(Q, Math.hypot(x, z), y); }
    else { const Q = F.profiloIngranaggio(m); riferimento = (x, y, z) => Math.abs(y) <= m.spessore / 2 && x * x + z * z >= m.foro ** 2 && F.puntoInPoligono(Q, x, z); }
    for (let q = 0; q < 100000; q++) {
      const x = fra(b.min[0], b.max[0]), y = fra(b.min[1], b.max[1]), z = fra(b.min[2], b.max[2]);
      conta.punti++;
      if (F.dentroLocale(p, x, y, z) !== riferimento(x, y, z)) conta.diversi++;
    }
  }
  esito(conta.diversi === 0, 'il test a fasce coincide con puntoInPoligono (estrusioni, rivoluzioni, ingranaggi)', `${conta.diversi} diversi su ${conta.punti} punti`);
}

// ------------------------------------------------------------------ 2. ingombro
// Anelli: un volume vero che non passa dal poligono, π(R² − r²)·h, e il centro vuoto. Più il pezzo vero del cervello:
// l'ugello del turbofan del 10/11, rifiutato perché chiuso dall'asse si incrociava, ora entra senza errori.
{
  const p = pezzo({ id: 'anello', forma: 'rivoluzione', misure: { profilo: [[200, 0], [220, 0], [220, 50], [200, 50], [200, 0]] } });
  const vero = Math.PI * (220 ** 2 - 200 ** 2) * 50, v = F.volume(p);
  esito(Math.abs(v - vero) / vero < 1e-9, 'anello chiuso a mano: volume uguale a π(R² − r²)·h', `${v.toFixed(1)} contro ${vero.toFixed(1)} mm³`);
  const Q = F.poligonoRivoluzione(p.misure.profilo);
  esito(F.anelloRivoluzione(Q) && Q.length === 4 && !F.dentroLocale(p, 0, 25, 0) && !F.dentroLocale(p, 150, 25, 0) && F.dentroLocale(p, 210, 25, 0),
    "anello: 4 vertici senza il punto ripetuto, centro e foro vuoti, parete piena", JSON.stringify(Q));
  const r = F.normalizzaModello({ titolo: 'ugello', pezzi: [{ id: 'ugello', forma: 'rivoluzione', misure: { profilo: [[215, -125], [170, 125], [160, 125], [205, -125]] } }] });
  const U = r.modello && F.poligonoRivoluzione(r.modello.pezzi[0].misure.profilo);
  esito(r.modello && r.errori.length === 0 && F.anelloRivoluzione(U), "l'ugello del cervello (10/11) è un anello valido", r.errori.join('; ') || JSON.stringify(U));
  const pieno = F.poligonoRivoluzione([[0, 0], [30, 0], [34, 40], [31, 40], [27, 3], [0, 3]]);
  esito(!F.anelloRivoluzione(pieno), 'una coppa che tocca l\'asse resta chiusa dall\'asse, non diventa un anello', JSON.stringify(pieno));
}

titolo('2. Ingombro: nessun punto dentro fuori dall\'ingombro, anche con i pezzi ruotati');
// Si cerca dentro una scatola allargata del 25% per lato e in sei fette sottili appena fuori dalle facce.
function cercaFuori(test, b) {
  const L = [0, 1, 2].map((c) => b.max[c] - b.min[c]), tol = 1e-9 * Math.max(...L);
  const lo = b.min.map((v, c) => v - 0.25 * L[c]), hi = b.max.map((v, c) => v + 0.25 * L[c]);
  const fuori = (p) => p.some((v, c) => v < b.min[c] - tol || v > b.max[c] + tol);
  let violazioni = 0, dentro = 0, provati = 0;
  const prova = (p) => { provati++; if (test(p[0], p[1], p[2])) { dentro++; if (fuori(p)) violazioni++; } };
  for (let q = 0; q < 150000; q++) prova([fra(lo[0], hi[0]), fra(lo[1], hi[1]), fra(lo[2], hi[2])]);
  for (let c = 0; c < 3; c++) for (const lato of [-1, 1]) {
    for (let q = 0; q < 15000; q++) {
      const p = [fra(lo[0], hi[0]), fra(lo[1], hi[1]), fra(lo[2], hi[2])];
      p[c] = lato > 0 ? b.max[c] + fra(0, 0.02) * L[c] : b.min[c] - fra(0, 0.02) * L[c];
      prova(p);
    }
  }
  return { violazioni, dentro, provati };
}
// Quanto l'ingombro è più largo del pezzo: dai punti dentro del Monte Carlo più punti in fette appena dentro le facce.
function larghezzaInPiu(p) {
  const b = F.ingombroLocale(p), L = [0, 1, 2].map((c) => b.max[c] - b.min[c]);
  let peggio = 0;
  for (let c = 0; c < 3; c++) for (const lato of [-1, 1]) {
    let migliore = Infinity;
    for (let q = 0; q < 60000; q++) {
      const s = fra(0, 0.05) * L[c], v = [fra(b.min[0], b.max[0]), fra(b.min[1], b.max[1]), fra(b.min[2], b.max[2])];
      v[c] = lato > 0 ? b.max[c] - s : b.min[c] + s;
      if (F.dentroLocale(p, v[0], v[1], v[2]) && s < migliore) migliore = s;
    }
    peggio = Math.max(peggio, migliore / L[c]);
  }
  return peggio;
}
let ruotatiFuori = 0, ruotatiDentro = 0;
for (const [nome, p] of pezzi) {
  const loc = cercaFuori((x, y, z) => F.dentroLocale(p, x, y, z), F.ingombroLocale(p));
  const ruotato = { ...p, posizione: [fra(-500, 500), fra(-500, 500), fra(-500, 500)], rotazione: [fra(-180, 180), fra(-180, 180), fra(-180, 180)] };
  const mon = cercaFuori((x, y, z) => F.dentro(ruotato, x, y, z), F.ingombro(ruotato));
  ruotatiFuori += mon.violazioni; ruotatiDentro += mon.dentro;
  const largo = NON_STRETTI.has(nome) ? null : larghezzaInPiu(p);
  esito(loc.violazioni === 0 && mon.violazioni === 0 && loc.dentro > 0 && mon.dentro > 0 && (largo === null || largo < 0.05), `ingombro ${nome}`,
    `fuori: ${loc.violazioni} su ${loc.dentro} punti dentro (locale), ${mon.violazioni} su ${mon.dentro} (ruotato)` +
    (largo === null ? ', più largo di r lungo la tangente per costruzione' : `, più largo del pezzo al massimo del ${pct(largo)} del lato`));
}
esito(F.ingombro(pezzo({ id: 'f', forma: 'file', misure: { file: '/Users/tony/modello.stl' } })) === null && F.ingombroLocale(pezzo({ id: 'f', forma: 'file', misure: { file: '/Users/tony/modello.stl' } })) === null,
  "ingombro di un pezzo 'file': null");
{
  const p = pezzi[0][1], b = F.ingombroLocale(p);
  b.min[0] = 999;
  esito(F.ingombroLocale(p).min[0] === -5, "ingombroLocale restituisce una copia: cambiarla non tocca quella preparata");
}

// ------------------------------------------------------------------ 3. matrice contro three.js
titolo('3. Trasformazioni contro THREE.Matrix4 e THREE.Euler XYZ');
{
  let dmax = 0, giro = 0, applica = 0, coerenza = 0;
  const D = THREE.MathUtils.DEG2RAD;
  const p = pezzi.find(([n]) => n.startsWith('estrusione con fori'))[1];
  for (let q = 0; q < 2000; q++) {
    const pos = [fra(-1e5, 1e5), fra(-1e5, 1e5), fra(-1e5, 1e5)], rot = [fra(-720, 720), fra(-720, 720), fra(-720, 720)];
    if (q < 30) { pos.fill(0); rot[q % 3] = [0, 90, -90, 180, 45][q % 5]; } // anche angoli esatti e assi soli
    const pz = { ...p, posizione: pos, rotazione: rot };
    const m4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0] * D, rot[1] * D, rot[2] * D, 'XYZ')).setPosition(pos[0], pos[1], pos[2]);
    const m = F.matrice(pz);
    for (let i = 0; i < 16; i++) dmax = Math.max(dmax, Math.abs(m[i] - m4.elements[i]));
    const loc = [fra(-1000, 1000), fra(-1000, 1000), fra(-1000, 1000)];
    const w = F.aMondo(pz, loc), indietro = F.aLocale(pz, w);
    giro = Math.max(giro, ...indietro.map((v, c) => Math.abs(v - loc[c])));
    const v3 = new THREE.Vector3(...loc).applyMatrix4(m4);
    applica = Math.max(applica, Math.abs(v3.x - w[0]), Math.abs(v3.y - w[1]), Math.abs(v3.z - w[2]));
    // dentro nel mondo deve dire quello che dice dentroLocale nelle coordinate del pezzo
    const b = F.ingombroLocale(p), l2 = [fra(b.min[0], b.max[0]), fra(b.min[1], b.max[1]), fra(b.min[2], b.max[2])], w2 = F.aMondo(pz, l2);
    if (F.dentro(pz, w2[0], w2[1], w2[2]) !== F.dentroLocale(p, ...F.aLocale(pz, w2))) coerenza++;
  }
  esito(dmax < 1e-9, 'matrice uguale a makeRotationFromEuler(XYZ) più setPosition, 2000 pose', `differenza massima ${dmax.toExponential(2)}`);
  esito(giro < 1e-9, 'aLocale(aMondo(p)) ridà p', `errore massimo ${giro.toExponential(2)} mm con posizioni fino a 1e5`);
  esito(applica < 1e-9, 'aMondo uguale a Vector3.applyMatrix4', `differenza massima ${applica.toExponential(2)} mm`);
  esito(coerenza === 0, 'dentro nel mondo coincide con dentroLocale nelle coordinate del pezzo', `${coerenza} diversi su 2000`);
  // Con la matrice vecchia (posizione [1, 2, 3]) l'origine del mondo sarebbe dentro e (500, 0, 0) fuori: il contrario.
  const cambiato = { ...p, posizione: [1, 2, 3] };
  const prima = F.dentro(cambiato, 0, 0, 0);
  cambiato.posizione = [500, 0, 0];
  esito(prima === true && F.dentro(cambiato, 500, 0, 0) === true && F.dentro(cambiato, 0, 0, 0) === false, 'la matrice si rifà quando cambia la posizione dello stesso pezzo');
}

// ------------------------------------------------------------------ 4. cavo contro three.js
titolo('4. campionaCavo contro THREE.CatmullRomCurve3 centripeta, getPoints');
{
  let dmax = 0, confronti = 0;
  const prova = (punti, n) => {
    const curva = new THREE.CatmullRomCurve3(punti.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const a = curva.getPoints(n - 1), b = F.campionaCavo(punti, n);
    if (a.length !== b.length) return Infinity;
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i].x - b[i][0]), Math.abs(a[i].y - b[i][1]), Math.abs(a[i].z - b[i][2]));
    confronti++;
    return d;
  };
  for (const l of [2, 3, 4, 7, 20, 100]) for (const scala of [1, 1e3, 1e5]) {
    const punti = Array.from({ length: l }, () => [fra(-scala, scala), fra(-scala, scala), fra(-scala, scala)]);
    for (const n of [2, 3, 17, 100, (l - 1) * F.PASSI_CAVO + 1]) dmax = Math.max(dmax, prova(punti, n));
  }
  // punti ripetuti e quasi ripetuti: three.js ha un controllo sotto 1e-4
  dmax = Math.max(dmax, prova([[0, 0, 0], [0, 0, 0], [10, 0, 0], [10, 1e-9, 0], [20, 5, 5]], 65));
  esito(dmax < 1e-6, 'stessi punti di three.js, anche con due soli punti e punti ripetuti', `${confronti} curve, differenza massima ${dmax.toExponential(2)}`);
  const due = F.campionaCavo([[0, 0, 0], [10, 0, 0]], 5).map((p) => p[0].toFixed(4)).join(' ');
  esito(due === '0.0000 1.0938 3.7500 7.0312 10.0000' || due === '0.0000 1.0937 3.7500 7.0313 10.0000', 'con due punti i campioni si addensano all\'inizio, come in three.js 0.160', due);
}

// ------------------------------------------------------------------ 5. validazione
titolo('5. Validazione: ogni caso sbagliato ha un errore che cita il campo');
const sc = (id, extra = {}) => ({ id, forma: 'scatola', misure: { x: 10, y: 10, z: 10 }, ...extra });
const con = (p, extra = {}) => ({ titolo: 'prova', pezzi: [p], ...extra });
const quadrato = [[0, 0], [10, 0], [10, 10], [0, 10]];
const carico = (extra) => con(sc('base'), { carichi: [{ pezzo: 'base', faccia: '+y', forza_N: 100, direzione: [0, -1, 0], ...extra }] });
const SBAGLIATI = [
  ['id doppi', { titolo: 't', pezzi: [sc('a'), sc('a')] }, 'pezzi[1].id'],
  ['id con maiuscole e spazio', con(sc('Base 1')), 'id'],
  ['id troppo lungo', con(sc('a'.repeat(41))), 'id'],
  ['id mancante', con({ forma: 'sfera', misure: { r: 1 } }), 'id'],
  ['forma sconosciuta', con({ id: 'a', forma: 'cubo', misure: { x: 1 } }), 'forma'],
  ['misure che non sono un oggetto', con({ id: 'a', forma: 'sfera', misure: [1] }), 'misure'],
  ['misura mancante', con({ id: 'a', forma: 'scatola', misure: { x: 1, y: 2 } }), 'misure.z'],
  ['misura negativa', con({ id: 'a', forma: 'cilindro', misure: { r: -5, h: 2 } }), 'misure.r'],
  ['misura enorme', con({ id: 'a', forma: 'scatola', misure: { x: 1e6, y: 1, z: 1 } }), 'misure.x'],
  ['misura sotto 0,01 mm', con({ id: 'a', forma: 'scatola', misure: { x: 0.001, y: 1, z: 1 } }), 'misure.x'],
  ['NaN', con({ id: 'a', forma: 'sfera', misure: { r: NaN } }), 'misure.r'],
  ['infinito', con({ id: 'a', forma: 'cilindro', misure: { r: 1, h: Infinity } }), 'misure.h'],
  ['stringa al posto del numero', con({ id: 'a', forma: 'scatola', misure: { x: '10', y: 1, z: 1 } }), 'misure.x'],
  ['r_interno uguale a r', con({ id: 'a', forma: 'tubo', misure: { r: 5, r_interno: 5, h: 2 } }), 'misure.r_interno'],
  ['toro con r ≥ R', con({ id: 'a', forma: 'toro', misure: { R: 10, r: 12 } }), 'misure.r'],
  ['piastra con |R| ≤ spessore/2', con({ id: 'a', forma: 'piastra', misure: { x: 10, z: 10, spessore: 4, raggio: -2 } }), 'misure.raggio'],
  ['piastra con l\'arco oltre 360°', con({ id: 'a', forma: 'piastra', misure: { x: 400, z: 10, spessore: 2, raggio: 50 } }), 'misure.x'],
  ['profilo con 2 punti', con({ id: 'a', forma: 'estrusione', misure: { profilo: [[0, 0], [1, 0]], profondita: 2 } }), 'misure.profilo'],
  ['profilo che si incrocia', con({ id: 'a', forma: 'estrusione', misure: { profilo: [[0, 0], [10, 10], [10, 0], [0, 10]], profondita: 2 } }), 'misure.profilo'],
  ['profilo con tre punti in fila', con({ id: 'a', forma: 'estrusione', misure: { profilo: [[0, 0], [5, 0], [10, 0]], profondita: 2 } }), 'misure.profilo'],
  ['punto del profilo non numerico', con({ id: 'a', forma: 'estrusione', misure: { profilo: [[0, 0], [5, 'a'], [10, 5]], profondita: 2 } }), 'misure.profilo[1]'],
  ['foro fuori dal profilo', con({ id: 'a', forma: 'estrusione', misure: { profilo: quadrato, profondita: 2, fori: [[[20, 20], [30, 20], [30, 30]]] } }), 'misure.fori[0]'],
  ['foro che taglia il bordo', con({ id: 'a', forma: 'estrusione', misure: { profilo: quadrato, profondita: 2, fori: [[[5, 5], [15, 5], [5, 8]]] } }), 'misure.fori[0]'],
  ['foro tondo che esce dal profilo', con({ id: 'a', forma: 'estrusione', misure: { profilo: quadrato, profondita: 2, fori_tondi: [{ x: 9, y: 5, r: 2 }] } }), 'misure.fori_tondi[0]'],
  ['due fori tondi che si toccano', con({ id: 'a', forma: 'estrusione', misure: { profilo: quadrato, profondita: 2, fori_tondi: [{ x: 3, y: 5, r: 2 }, { x: 6, y: 5, r: 2 }] } }), 'misure.fori_tondi[0]'],
  ['troppi fori', con({ id: 'a', forma: 'estrusione', misure: { profilo: quadrato, profondita: 2, fori: Array.from({ length: 21 }, () => [[1, 1], [2, 1], [1, 2]]) } }), 'misure.fori'],
  ['troppi pezzi', { titolo: 't', pezzi: Array.from({ length: 201 }, (_, i) => sc(`p${i}`)) }, 'pezzi'],
  ['nessun pezzo', { titolo: 't', pezzi: [] }, 'pezzi'],
  ['posizione fuori limite', con(sc('a', { posizione: [2e5, 0, 0] })), 'posizione[0]'],
  ['posizione con due numeri', con(sc('a', { posizione: [1, 2] })), 'posizione'],
  ['rotazione con una stringa', con(sc('a', { rotazione: [0, 0, '90'] })), 'rotazione[2]'],
  ['materiale sconosciuto', con(sc('a', { materiale: 'oro' })), 'materiale'],
  ['interno non booleano', con(sc('a', { interno: 'sì' })), 'interno'],
  ['esplodi troppo lungo', con(sc('a', { esplodi: [4, 4, 0] })), 'esplodi'],
  ['flusso sconosciuto su un cavo', con({ id: 'c', forma: 'cavo', misure: { punti: [[0, 0, 0], [1, 0, 0]], r: 0.2 }, flusso: 'magia' }), 'flusso'],
  ['ingranaggio con denti non interi', con({ id: 'g', forma: 'ingranaggio', misure: { denti: 20.5, modulo: 2, spessore: 5 } }), 'misure.denti'],
  ['ingranaggio con 5 denti', con({ id: 'g', forma: 'ingranaggio', misure: { denti: 5, modulo: 2, spessore: 5 } }), 'misure.denti'],
  ['ingranaggio con il foro oltre il piede', con({ id: 'g', forma: 'ingranaggio', misure: { denti: 20, modulo: 2, spessore: 5, foro: 18 } }), 'misure.foro'],
  ['rivoluzione con r negativo', con({ id: 'v', forma: 'rivoluzione', misure: { profilo: [[5, 0], [-1, 5]] } }), 'misure.profilo[1]'],
  ['rivoluzione tutta sull\'asse', con({ id: 'v', forma: 'rivoluzione', misure: { profilo: [[0, 0], [0, 5]] } }), 'misure.profilo'],
  ['rivoluzione che tocca l\'asse a metà', con({ id: 'v', forma: 'rivoluzione', misure: { profilo: [[10, 0], [0, 5], [10, 10]] } }), 'misure.profilo'],
  ['anello chiuso a mano che tocca l\'asse', con({ id: 'v', forma: 'rivoluzione', misure: { profilo: [[10, 0], [20, 0], [0, 5], [10, 0]] } }), 'misure.profilo'],
  ['anello che si incrocia', con({ id: 'v', forma: 'rivoluzione', misure: { profilo: [[10, 0], [20, 10], [20, 0], [10, 10], [10, 0]] } }), 'misure.profilo'],
  ['cavo con un punto solo', con({ id: 'c', forma: 'cavo', misure: { punti: [[0, 0, 0]], r: 1 } }), 'misure.punti'],
  ['cavo con troppi punti', con({ id: 'c', forma: 'cavo', misure: { punti: Array.from({ length: 101 }, (_, i) => [i, 0, 0]), r: 1 } }), 'misure.punti'],
  ['file con percorso relativo', con({ id: 'f', forma: 'file', misure: { file: 'Downloads/motore.glb' } }), 'misure.file'],
  ['file con estensione sbagliata', con({ id: 'f', forma: 'file', misure: { file: '/Users/tony/motore.exe' } }), 'misure.file'],
  ['file con ..', con({ id: 'f', forma: 'file', misure: { file: '/Users/tony/../etc/motore.glb' } }), 'misure.file'],
  ['titolo mancante', { pezzi: [sc('a')] }, 'titolo'],
  ['carico su un pezzo inesistente', con(sc('base'), { carichi: [{ pezzo: 'fantasma', faccia: '+x', forza_N: 100, direzione: [1, 0, 0] }] }), 'carichi[0]: pezzo'],
  ['direzione nulla', carico({ direzione: [0, 0, 0] }), 'carichi[0]: direzione'],
  ['faccia sbagliata', carico({ faccia: 'sopra' }), 'carichi[0]: faccia'],
  ['forza nulla', carico({ forza_N: 0 }), 'carichi[0]: forza_N'],
  ['forza oltre 1e7 N', carico({ forza_N: 2e7 }), 'carichi[0]: forza_N'],
  ['troppi carichi', con(sc('base'), { carichi: Array.from({ length: 21 }, () => ({ pezzo: 'base', faccia: '+y', forza_N: 1, direzione: [0, -1, 0] })) }), 'carichi'],
  ['vincolo di tipo sconosciuto', con(sc('base'), { vincoli: [{ pezzo: 'base', faccia: '-y', tipo: 'appoggio' }] }), 'vincoli[0]: tipo'],
  ['vincolo senza faccia', con(sc('base'), { vincoli: [{ pezzo: 'base' }] }), 'vincoli[0]: faccia'],
  ['vista con un modo sconosciuto', con(sc('base'), { vista: { modo: 'wireframe' } }), 'vista: modo'],
  ['vista con esploso oltre 1', con(sc('base'), { vista: { esploso: 2 } }), 'vista: esploso'],
  ['vista con sezione su un asse sconosciuto', con(sc('base'), { vista: { sezione: { asse: 'w', posizione: 0 } } }), 'vista: sezione.asse'],
  ['vista con verso della sezione sbagliato', con(sc('base'), { vista: { sezione: { asse: 'x', posizione: 0, verso: 2 } } }), 'vista: sezione.verso'],
  ['vista che seleziona un pezzo inesistente', con(sc('base'), { vista: { selezionato: 'fantasma' } }), 'vista: selezionato'],
  ['vista con rotazione_auto non booleana', con(sc('base'), { vista: { rotazione_auto: 1 } }), 'vista: rotazione_auto'],
  ['modello che non è un oggetto', 'mostrami un motore', 'modello'],
];
for (const [nome, m, campo] of SBAGLIATI) {
  const r = F.normalizzaModello(m);
  const trovato = r.errori.find((e) => e.includes(campo));
  esito(r.modello === null && trovato !== undefined, nome, trovato ? trovato.slice(0, 160) : `nessun errore con «${campo}»: ${JSON.stringify(r.errori).slice(0, 200)}`);
}
console.log(`     ${SBAGLIATI.length} casi sbagliati`);

titolo('5b. Casi giusti: nessun errore, predefiniti applicati');
{
  const modello = {
    titolo: 'banco di prova', descrizione: 'una forma per tipo',
    pezzi: [
      sc('base', { materiale: 'acciaio-s235' }),
      { id: 'albero', forma: 'cilindro', misure: { r: 5, h: 40 }, posizione: [0, 25, 0], materiale: 'alluminio-6061', gruppo: 'asse' },
      { id: 'boccola', forma: 'tubo', misure: { r: 8, r_interno: 5, h: 10 }, posizione: [0, 25, 0], gruppo: 'asse', esplodi: [0, 1, 0] },
      { id: 'pomello', forma: 'sfera', misure: { r: 6 }, posizione: [0, 50, 0] },
      { id: 'punta', forma: 'cono', misure: { r: 4, h: 8 }, rotazione: [180, 0, 0] },
      { id: 'anello', forma: 'toro', misure: { R: 20, r: 2 }, interno: true },
      { id: 'lamiera', forma: 'piastra', misure: { x: 60, z: 20, spessore: 2 } },
      { id: 'lamiera-curva', forma: 'piastra', misure: { x: 60, z: 20, spessore: 2, raggio: -40 } },
      { id: 'staffa', forma: 'estrusione', misure: { profilo: [...quadrato, [0, 0]], profondita: 5, fori_tondi: [{ x: 5, y: 5, r: 2 }] } },
      { id: 'vaso', forma: 'rivoluzione', misure: { profilo: [[0, 0], [10, 0], [12, 20], [0, 20], [0, 0]] } },
      { id: 'ruota', forma: 'ingranaggio', misure: { denti: 24, modulo: 1.5, spessore: 6 } },
      { id: 'filo', forma: 'cavo', misure: { punti: [[0, 0, 0], [0, 0, 0], [20, 10, 0], [40, 0, 0]], r: 1 }, flusso: 'elettrico' },
      { id: 'motore', forma: 'file', misure: { file: '/Users/tony/Downloads/motore.GLB', scala: 1000 }, calcolo: true },
    ],
    carichi: [{ pezzo: 'albero', faccia: '+y', forza_N: 250, direzione: [3, -4, 0] }],
    vincoli: [{ pezzo: 'base', faccia: '-y' }],
    vista: { esploso: 0.5, sezione: { asse: 'z', posizione: 0 } },
  };
  const r = F.normalizzaModello(modello);
  esito(r.modello !== null && r.errori.length === 0, 'un modello con una forma per tipo, carichi, vincoli e vista', r.errori.join('; ') || `${r.modello.pezzi.length} pezzi, ${r.avvisi.length} avvisi`);
  const M = r.modello, P = Object.fromEntries((M ? M.pezzi : []).map((p) => [p.id, p]));
  const controlli = M && [
    [P.base.posizione.join() === '0,0,0' && P.base.rotazione.join() === '0,0,0', 'posizione e rotazione [0, 0, 0]'],
    [P.pomello.materiale === 'generico' && P.base.materiale === 'acciaio-s235', "materiale predefinito 'generico'"],
    [P.base.nome === 'base', 'nome predefinito = id'],
    [P.filo.calcolo === false && P.motore.calcolo === false && P.base.calcolo === true, "calcolo false per 'cavo' e 'file', true per gli altri"],
    [P.base.gruppo === null && P.albero.gruppo === 'asse' && P.base.esplodi === null && P.boccola.esplodi.join() === '0,1,0', 'gruppo ed esplodi'],
    [P.anello.interno === true && P.base.interno === false, 'interno'],
    [P.filo.flusso === 'elettrico' && P.base.flusso === null, 'flusso'],
    [P.punta.misure.r_cima === 0 && P.lamiera.misure.raggio === null && P['lamiera-curva'].misure.raggio === -40, 'r_cima 0, piastra piana con raggio null, curva col suo raggio'],
    [P.staffa.misure.fori.length === 0 && P.staffa.misure.profilo.length === 4, 'fori predefiniti vuoti e profilo chiuso a mano ripulito'],
    [P.vaso.misure.profilo.length === 4, 'rivoluzione chiusa a mano sull\'asse ripulita'],
    [P.ruota.misure.foro === 0, 'ingranaggio senza foro: foro 0'],
    [P.filo.misure.punti.length === 3, 'cavo: il punto ripetuto è tolto'],
    [P.motore.misure.scala === 1000 && P.motore.misure.centra === true, 'file: scala e centra'],
    [Math.abs(Math.hypot(...M.carichi[0].direzione) - 1) < 1e-15 && M.carichi[0].direzione[0] === 0.6, 'direzione del carico normalizzata'],
    [M.vincoli[0].tipo === 'incastro', "tipo del vincolo predefinito 'incastro'"],
    [M.vista.esploso === 0.5 && M.vista.modo === 'ologramma' && M.vista.sezione.verso === 1 && M.vista.selezionato === null && M.vista.rotazione_auto === false, 'vista completata con i predefiniti'],
    [r.avvisi.some((a) => a.includes('«motore»') && a.includes('calcolo')), "avviso: un pezzo 'file' non entra nel calcolo"],
    [r.avvisi.some((a) => a.includes('«staffa»') && a.includes('ripetut')), 'avviso: punti ripetuti tolti'],
  ];
  for (const [ok, nome] of controlli || []) esito(ok, nome);
  modello.pezzi[0].misure.x = 99;
  modello.pezzi[1].posizione[0] = 99;
  esito(P.base.misure.x === 10 && P.albero.posizione[0] === 0 && P.base.posizione !== F.PREDEFINITI.pezzo.posizione, 'il modello normalizzato non condivide oggetti con quello ricevuto né con PREDEFINITI');
  // Il server, a ogni «cambia», fonde i campi nel pezzo normalizzato e lo rivalida: deve tornare uguale.
  const ancora = F.normalizzaModello(JSON.parse(JSON.stringify(M)));
  esito(ancora.modello !== null && JSON.stringify(ancora.modello) === JSON.stringify(M) && ancora.avvisi.length === 0, 'normalizzare un modello già normalizzato lo lascia uguale, senza avvisi',
    ancora.errori.concat(ancora.avvisi).join(' | ') || `${JSON.stringify(M).length} caratteri uguali`);

  const sconosciuti = F.normalizzaModello({ titolo: 'x', colore: 'blu', pezzi: [sc('a', { peso: 3, misure: { x: 1, y: 1, z: 1, w: 4 } })] });
  esito(sconosciuti.modello !== null && sconosciuti.avvisi.length === 3, 'i campi sconosciuti si ignorano con un avviso', sconosciuti.avvisi.join(' | '));
  const lungo = F.normalizzaModello({ titolo: 'T'.repeat(100), pezzi: [sc('a', { nome: 'n'.repeat(70) })] });
  esito(lungo.modello && lungo.modello.titolo.length === 80 && lungo.modello.pezzi[0].nome.length === 60 && lungo.avvisi.length === 2, 'titoli e nomi troppo lunghi si tagliano con un avviso');
  const duecento = F.normalizzaModello({ titolo: 'x', pezzi: Array.from({ length: 200 }, (_, i) => sc(`p${i}`)) });
  esito(duecento.modello !== null && duecento.modello.pezzi.length === 200, '200 pezzi, il limite, vanno bene');
  const bordo = F.normalizzaPezzo({ id: 'b', forma: 'scatola', misure: { x: 0.01, y: 1e5, z: 1 }, posizione: [-1e5, 1e5, 0] });
  esito(bordo.pezzo !== null, 'misure e posizione proprio ai limiti vanno bene');

  const v1 = F.normalizzaVista({ sezione: { posizione: 12 } }, ['a'], { ...F.PREDEFINITI.vista, sezione: { asse: 'y', posizione: 0, verso: -1 }, selezionato: 'tolto' });
  esito(v1.vista && v1.vista.sezione.asse === 'y' && v1.vista.sezione.posizione === 12 && v1.vista.sezione.verso === -1 && v1.vista.selezionato === null && v1.avvisi.length === 1,
    'vista parziale: cambia solo la posizione della sezione, e un pezzo selezionato che non c\'è più torna a null', v1.avvisi.join(' | '));
  const v2 = F.normalizzaVista(undefined, null, undefined);
  esito(JSON.stringify(v2.vista) === JSON.stringify(F.PREDEFINITI.vista) && v2.vista !== F.PREDEFINITI.vista, 'vista assente: i predefiniti, in un oggetto nuovo');
  const c1 = F.normalizzaCarichi([{ pezzo: 'filo', faccia: '-x', forza_N: 1e7, direzione: [0, 0, 1e-3] }], [{ id: 'filo', calcolo: false }]);
  esito(c1.carichi && c1.carichi[0].direzione[2] === 1 && c1.avvisi.length === 1, 'carico su un pezzo fuori dal calcolo: va bene, con un avviso', c1.avvisi.join(''));
  const vv = F.normalizzaVincoli([{ pezzo: 'a', faccia: '+z', tipo: 'incastro' }], ['a']);
  esito(vv.vincoli && vv.vincoli.length === 1 && vv.errori.length === 0, 'vincoli con una lista di id');
  esito(F.poligonoSemplice(quadrato) && !F.poligonoSemplice([[0, 0], [10, 10], [10, 0], [0, 10]]) && !F.poligonoSemplice([[0, 0], [1, NaN], [2, 2]]) && F.areaPoligono(quadrato) === 100 && F.areaPoligono([...quadrato].reverse()) === -100,
    'poligonoSemplice e areaPoligono con segno');
}

// ------------------------------------------------------------------ 5c. ricerca sui pezzi
titolo('5c. Ricerca sui pezzi: materiale_vero e fattura');
{
  const R = { materiale_vero: 'alluminio 6063 riciclato, anodizzato', fattura: 'fresato da un blocco estruso' };
  const pieno = F.normalizzaPezzo(sc('a', R));
  esito(pieno.pezzo && F.CAMPI_RICERCA.length === 2 && F.CAMPI_RICERCA.every((k) => pieno.pezzo[k] === R[k]) && pieno.avvisi.length === 0 && pieno.pezzo.materiale === 'generico',
    'i due campi passano così come sono, e la chiave del calcolo resta generico', JSON.stringify(pieno.avvisi.concat(pieno.errori)));
  const senza = F.normalizzaPezzo(sc('a'));
  esito(senza.pezzo && F.CAMPI_RICERCA.every((k) => senza.pezzo[k] === null && F.PREDEFINITI.pezzo[k] === null), 'non detti valgono null, come nei predefiniti');
  const vuoti = F.normalizzaPezzo(sc('a', { materiale_vero: '', fattura: '   ' }));
  esito(vuoti.pezzo && F.CAMPI_RICERCA.every((k) => vuoti.pezzo[k] === null) && vuoti.errori.length === 0, 'vuoto, solo spazi e null valgono non detto, senza errori');
  for (const k of F.CAMPI_RICERCA) {
    const r = F.normalizzaPezzo(sc('a', { [k]: 42 })), r2 = F.normalizzaPezzo(sc('a', { [k]: ['vetro'] }));
    esito(r.pezzo === null && r.errori.length === 1 && r.errori[0].includes(k) && r2.pezzo === null, `${k} che non è un testo: errore che cita il campo`, r.errori.join(' | '));
  }
  const MAX = { materiale_vero: 60, fattura: 140 };
  for (const k of F.CAMPI_RICERCA) {
    const giusto = F.normalizzaPezzo(sc('a', { [k]: 'x'.repeat(MAX[k]) })), lungo = F.normalizzaPezzo(sc('a', { [k]: 'è'.repeat(MAX[k] + 1) }));
    esito(giusto.pezzo && giusto.pezzo[k].length === MAX[k] && giusto.avvisi.length === 0 && lungo.pezzo && Array.from(lungo.pezzo[k]).length === MAX[k] && lungo.avvisi.length === 1 && lungo.avvisi[0].includes(k),
      `${k}: ${MAX[k]} caratteri passano, uno in più si taglia con un avviso`, lungo.avvisi.join(' | '));
  }
  const sporco = F.normalizzaPezzo(sc('a', { materiale_vero: '  vetro\n\tal\u0000luminosilicato  ', fattura: 'a\u007fb <img src=x onerror=alert(1)>' }));
  esito(sporco.pezzo && sporco.pezzo.materiale_vero === 'vetro al luminosilicato' && sporco.pezzo.fattura === 'a b <img src=x onerror=alert(1)>',
    'a capo e caratteri di controllo diventano uno spazio; il resto è testo e basta (nell\'HUD entra con textContent)', JSON.stringify(sporco.pezzo && [sporco.pezzo.materiale_vero, sporco.pezzo.fattura]));
  const ancora = F.normalizzaPezzo(JSON.parse(JSON.stringify(pieno.pezzo)));
  esito(ancora.pezzo && JSON.stringify(ancora.pezzo) === JSON.stringify(pieno.pezzo) && ancora.avvisi.length === 0, 'un pezzo con i due campi, rinormalizzato, resta uguale e senza avvisi');
  // Come fa il server in «cambia»: il pezzo di prima fuso con i campi nuovi. Un testo vuoto toglie il campo, gli altri restano.
  const tolto = F.normalizzaPezzo({ ...pieno.pezzo, fattura: '' });
  esito(tolto.pezzo && tolto.pezzo.fattura === null && tolto.pezzo.materiale_vero === R.materiale_vero, 'fuso con fattura vuota: la fattura va via, il materiale resta');
  // La fonte per pezzo è stata tolta l'11/11: una conversazione di prima che la manda ancora non deve far fallire il modello
  const vecchio = F.normalizzaPezzo(sc('a', { ...R, fonte: 'iFixit 2022' }));
  esito(vecchio.pezzo && !('fonte' in vecchio.pezzo) && vecchio.errori.length === 0 && vecchio.avvisi.length === 1 && vecchio.avvisi[0].includes('fonte'),
    'fonte non c\'è più: arriva come campo sconosciuto, ignorato con un avviso, e il pezzo passa', vecchio.avvisi.join(' | '));
  const chiave = F.normalizzaPezzo(sc('a', { materiale: 'vetro' }));
  esito(chiave.pezzo === null && chiave.errori[0].includes('materiale'), 'la chiave del calcolo non si allarga: «vetro» in materiale resta un errore', chiave.errori.join(' | '));
}

// ------------------------------------------------------------------ 6. prestazioni
titolo('6. Prestazioni: dentro() su 1 milione di punti, estrusione da 200 punti con 20 fori');
{
  // Criterio scritto prima: sotto 1 s. Previsione: 0,1–0,3 s, cioè 100–300 ns a punto.
  const profilo = poligonoRegolare(200, 100);
  const fori = Array.from({ length: 20 }, (_, i) => poligonoRegolare(16, 7, 60 * Math.cos((2 * Math.PI * i) / 20), 60 * Math.sin((2 * Math.PI * i) / 20)));
  const p = pezzo({ id: 'flangia', forma: 'estrusione', misure: { profilo, profondita: 20, fori }, posizione: [100, 200, 300], rotazione: [30, 45, 60] });
  const b = F.ingombro(p), N = 1e6, punti = new Float64Array(3 * N);
  for (let i = 0; i < 3 * N; i++) punti[i] = fra(b.min[i % 3], b.max[i % 3]);
  let dentro = 0;
  for (let i = 0; i < 30000; i++) F.dentro(p, punti[3 * i], punti[3 * i + 1], punti[3 * i + 2]); // riscaldamento del JIT
  const t0 = performance.now();
  for (let i = 0; i < N; i++) if (F.dentro(p, punti[3 * i], punti[3 * i + 1], punti[3 * i + 2])) dentro++;
  const ms = performance.now() - t0;
  esito(ms < 1000, 'dentro() su 1.000.000 di punti nell\'ingombro del mondo, pezzo ruotato', `${ms.toFixed(0)} ms, ${((ms * 1e6) / N).toFixed(0)} ns a punto, ${(100 * dentro / N).toFixed(1)}% dentro`);

  // Il caso più duro: punti nell'ingombro locale, dove quasi tutti passano dalle fasce e dai rettangoli dei fori.
  // Poi PNPOLY su tutti i 520 lati, sugli stessi punti, per vedere quanto valgono le fasce (e che diano lo stesso).
  const bl = F.ingombroLocale(p), loc = new Float64Array(3 * N);
  for (let i = 0; i < 3 * N; i++) loc[i] = fra(bl.min[i % 3], bl.max[i % 3]);
  let dentroLoc = 0;
  const t2 = performance.now();
  for (let i = 0; i < N; i++) if (F.dentroLocale(p, loc[3 * i], loc[3 * i + 1], loc[3 * i + 2])) dentroLoc++;
  const msLoc = performance.now() - t2;
  const m = p.misure, t3 = performance.now();
  let dentroLento = 0;
  for (let i = 0; i < N; i++) {
    const x = loc[3 * i], y = loc[3 * i + 1], z = loc[3 * i + 2];
    if (Math.abs(z) <= 10 && F.puntoInPoligono(m.profilo, x, y) && !m.fori.some((f) => F.puntoInPoligono(f, x, y))) dentroLento++;
  }
  const msLento = performance.now() - t3;
  esito(msLoc < 1000 && dentroLento === dentroLoc, 'dentroLocale() su 1.000.000 di punti nell\'ingombro locale',
    `${msLoc.toFixed(0)} ms, ${((msLoc * 1e6) / N).toFixed(0)} ns a punto, ${(100 * dentroLoc / N).toFixed(1)}% dentro; PNPOLY su tutti i lati ${msLento.toFixed(0)} ms, ${dentroLento === dentroLoc ? 'stesso conteggio' : 'conteggio DIVERSO'}`);

  // Validazione nel caso peggiore ammesso: profilo e 20 fori da 200 punti, più 50 fori tondi.
  const grandi = Array.from({ length: 20 }, (_, i) => poligonoRegolare(200, 6, 70 * Math.cos((2 * Math.PI * i) / 20), 70 * Math.sin((2 * Math.PI * i) / 20)));
  const tondi = Array.from({ length: 50 }, (_, i) => ({ x: 40 * Math.cos((2 * Math.PI * i) / 50), y: 40 * Math.sin((2 * Math.PI * i) / 50), r: 2 }));
  const t4 = performance.now();
  const r = F.normalizzaPezzo({ id: 'peggio', forma: 'estrusione', misure: { profilo: poligonoRegolare(200, 100), profondita: 5, fori: grandi, fori_tondi: tondi } });
  const msVal = performance.now() - t4;
  esito(r.pezzo !== null && msVal < 1000, 'validazione di un\'estrusione con 200 punti, 20 fori da 200 punti e 50 fori tondi', `${msVal.toFixed(0)} ms${r.pezzo ? '' : ': ' + r.errori.join('; ')}`);

  // Il modello più grande che entra in 1 MiB: estrusioni ai limiti, coi fori lontani fra loro. Senza il confronto degli
  // ingombri prima dei lati, qui 493 ms (server fermo a «mostra», HUD fermo a ogni versione); con, 131 ms (8/11).
  const giro = (n, raggio, cx = 0, cy = 0) => Array.from({ length: n }, (_, k) => [Math.round(cx + raggio * Math.cos((2 * Math.PI * k) / n)), Math.round(cy + raggio * Math.sin((2 * Math.PI * k) / n))]);
  const estrusione = (i) => ({ id: `e${i}`, forma: 'estrusione', posizione: [0, 0, 60 * i], materiale: 'alluminio-6061', misure: { profilo: giro(200, 9000), profondita: 50,
    fori: Array.from({ length: 20 }, (_, k) => giro(200, 900, Math.round(6000 * Math.cos((2 * Math.PI * k) / 20)), Math.round(6000 * Math.sin((2 * Math.PI * k) / 20)))),
    fori_tondi: Array.from({ length: 50 }, (_, k) => ({ x: Math.round(3000 * Math.cos((2 * Math.PI * k) / 50)), y: Math.round(3000 * Math.sin((2 * Math.PI * k) / 50)), r: 150 })) } });
  const pezziGrandi = [];
  for (let i = 0; pezziGrandi.length < 200; i++) {
    if (JSON.stringify([...pezziGrandi, estrusione(i)]).length > 2 ** 20 - 30000) break;
    pezziGrandi.push(estrusione(i));
  }
  const nEstr = pezziGrandi.length;
  while (pezziGrandi.length < 200) { const k = pezziGrandi.length; pezziGrandi.push({ id: `s${k}`, forma: 'scatola', misure: { x: 100, y: 100, z: 100 }, posizione: [20000 + 150 * (k % 20), 150 * Math.floor(k / 20), 0] }); }
  const t5 = performance.now(), rg = F.normalizzaModello({ titolo: 'grande', pezzi: pezziGrandi }), msGrande = performance.now() - t5;
  esito(rg.modello !== null && msGrande < 400, `il modello più grande che entra in 1 MiB (${nEstr} estrusioni ai limiti e ${200 - nEstr} scatole) si valida in meno di 400 ms`, `${msGrande.toFixed(0)} ms`);
}

console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exit(falliti ? 1 : 0);
