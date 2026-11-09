// struttura.mjs — dal modello dell'ologramma agli sforzi, con voxel-fea.mjs: griglia, voxel parziali, isole,
// facce di carichi e vincoli, soluzione e risultati per pezzo. analizza() è sincrona e dura secondi: nel
// server gira nel worker di lavoratore.mjs, che calcolaInWorker() lancia uno alla volta.
// Unità: mm, N, MPa. Voxel cubici di lato h: il voxel v = i + nx·(j + ny·k) va da origine + (i, j, k)·h a
// origine + (i + 1, j + 1, k + 1)·h, e i nodi della griglia sono i suoi angoli.
import { Worker } from 'node:worker_threads';
import { FACCE, LIMITI, dentro, ingombro, volume, profiloIngranaggio, poligonoRivoluzione } from '../public/ologramma/forme.js';
import { creaModello, risolvi, sforzi } from './voxel-fea.mjs';

const ora = () => performance.now();
const CAMPIONI = 64;                   // campioni per voxel di bordo
// Livelli di frazione, E·q/Q: uno per campione. Lo studio arrotondava a 16 perché i suoi indici erano a
// 8 bit; con 16 bit (200 pezzi × 64 = 12800 materiali) non serve, e 51/64 non diventa più 13/16.
const Q = CAMPIONI;
// Una griglia ruotata: il campione (a, b, c) sta nella sua cella 4×4×4, ma i 64 campioni hanno 64 coordinate
// diverse su ogni asse. Con la griglia 4×4×4 dritta una parete parallela a un asse si leggeva a quarti di
// voxel: la trave 100×10×10 risultava spessa 10,08 mm o 9,92 mm, e la freccia sbagliava da −2,0% a +1,8%.
const OX = new Float64Array(CAMPIONI), OY = new Float64Array(CAMPIONI), OZ = new Float64Array(CAMPIONI);
for (let a = 0, s = 0; a < 4; a++) {
  for (let b = 0; b < 4; b++) {
    for (let c = 0; c < 4; c++, s++) {
      OX[s] = (16 * a + 4 * b + c + 0.5) / 64;
      OY[s] = (16 * b + 4 * c + a + 0.5) / 64;
      OZ[s] = (16 * c + 4 * a + b + 0.5) / 64;
    }
  }
}
const CELLE_MAX = 3e6;                 // la griglia intera, vuoti compresi: ogni nodo costa 3 gradi di libertà
const TOL = 1e-6;
const VICINO = 2;                      // in voxel: un massimo così vicino a un nodo incastrato è una stima
const OPZIONI = { voxel_max: [40000, 100, 1e6], tempo_max_s: [45, 0, 600] }; // predefinito, minimo, massimo
const N2 = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 2, useGrouping: false });
const N3 = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 3, useGrouping: false });
const mm = (v) => N3.format(v);
const meno = (v) => `−${N2.format(Math.abs(v))}%`;
const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const breve = (v) => { try { const s = JSON.stringify(v) ?? String(v); return s.length > 40 ? s.slice(0, 39) + '…' : s; } catch { return typeof v; } };
// Come in ologramma.mjs, che fonde gli avvisi uguali: quello degli esclusi deve uscire identico.
const elenco = (ids) => ids.slice(0, 12).map((id) => `«${id}»`).join(', ') + (ids.length > 12 ? ` e altri ${ids.length - 12}` : '');
const sbaglio = (s) => new Error(`calcolo degli sforzi: ${s}`);

// ---------------------------------------------------------------- il lavoro
// Arriva da ologramma.mjs già normalizzato, ma passa da un worker: forme e numeri si ricontrollano.
function leggiLavoro(l) {
  if (!oggetto(l)) throw sbaglio('il lavoro deve essere un oggetto { pezzi, carichi, vincoli, opzioni }');
  const pezzi = l.pezzi;
  if (!Array.isArray(pezzi) || !pezzi.length || pezzi.length > LIMITI.pezzi) throw sbaglio(`servono da 1 a ${LIMITI.pezzi} pezzi, non ${breve(pezzi)}`);
  const indice = new Map();
  pezzi.forEach((p, i) => {
    if (!oggetto(p) || typeof p.id !== 'string' || !p.id) throw sbaglio(`il pezzo ${i} non ha un id`);
    if (indice.has(p.id)) throw sbaglio(`il pezzo «${p.id}» compare due volte`);
    indice.set(p.id, i);
    const m = p.mat;
    if (!oggetto(m) || !(finito(m.E) && m.E > 0 && m.E <= 1e7) || !(finito(m.nu) && m.nu > -1 && m.nu < 0.5)) {
      throw sbaglio(`il pezzo «${p.id}» ha il materiale ${breve(m && m.chiave)} senza E e ν validi: serve un materiale vero, non 'generico'`);
    }
    let v, b;
    try { v = volume(p); b = ingombro(p); } catch { v = null; }
    if (!(v > 0 && v < Infinity) || !b || ![...b.min, ...b.max].every(finito)) {
      throw sbaglio(`il pezzo «${p.id}» (${breve(p.forma)}) non ha volume e ingombro validi: i pezzi 'file' non entrano nel calcolo`);
    }
  });
  const lista = (v, nome, max) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > max) throw sbaglio(`${nome} deve essere una lista di al massimo ${max}, non ${breve(v)}`);
    return v;
  };
  const lato = (x, cosa) => {
    if (!oggetto(x) || !indice.has(x.pezzo)) throw sbaglio(`${cosa} riguarda il pezzo ${breve(x && x.pezzo)}, che non è nel calcolo`);
    if (!FACCE.includes(x.faccia)) throw sbaglio(`${cosa} ha la faccia ${breve(x.faccia)}: le facce sono ${FACCE.join(', ')}`);
    return { p: indice.get(x.pezzo), id: x.pezzo, faccia: x.faccia, asse: 'xyz'.indexOf(x.faccia[1]), segno: x.faccia[0] === '+' ? 1 : -1 };
  };
  const carichi = lista(l.carichi, 'carichi', LIMITI.carichi).map((c, i) => {
    const f = lato(c, `il carico ${i}`), d = c.direzione;
    if (!(finito(c.forza_N) && c.forza_N > 0 && c.forza_N <= 1e7)) throw sbaglio(`il carico ${i} ha forza_N ${breve(c.forza_N)}: va da 0 (escluso) a 1e7 N`);
    const n = Array.isArray(d) && d.length === 3 && d.every(finito) ? Math.hypot(d[0], d[1], d[2]) : NaN;
    if (!(n > 0 && n < Infinity)) throw sbaglio(`il carico ${i} ha la direzione ${breve(d)}: serve un vettore [x, y, z] non nullo`);
    return { ...f, F: d.map((x) => (c.forza_N * x) / n) };
  });
  const vincoli = lista(l.vincoli, 'vincoli', LIMITI.vincoli).map((v, i) => {
    if (oggetto(v) && v.tipo != null && v.tipo !== 'incastro') throw sbaglio(`il vincolo ${i} è di tipo ${breve(v.tipo)}: c'è solo 'incastro'`);
    return lato(v, `il vincolo ${i}`);
  });
  if (!vincoli.length) throw sbaglio("manca un incastro: senza vincoli il modello volerebbe via");
  if (!carichi.length) throw sbaglio('manca un carico: senza forze non c\'è niente da calcolare');
  const o = oggetto(l.opzioni) ? l.opzioni : {}, op = {};
  for (const [k, [pred, min, max]] of Object.entries(OPZIONI)) {
    const v = o[k] ?? pred;
    if (!(finito(v) && v > min && v <= max)) throw sbaglio(`opzioni.${k} vale ${breve(v)}: va da ${min} (escluso) a ${max}`);
    op[k] = v;
  }
  return { pezzi, carichi, vincoli, voxelMax: op.voxel_max, tempoMax: op.tempo_max_s * 1000, tempoMaxS: op.tempo_max_s };
}

// ---------------------------------------------------------------- griglia e voxel
// h dal budget dei voxel pieni, h³ = Σ volumi / voxel_max (le sovrapposizioni contano due volte: un po'
// meno voxel, mai di più); se la griglia intera supera CELLE_MAX, h cresce. La griglia è centrata
// sull'ingombro, così i voxel parziali stanno metà da una parte e metà dall'altra.
function griglia(pezzi, voxelMax) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let vol = 0;
  for (const p of pezzi) {
    const b = ingombro(p);
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], b.min[c]); max[c] = Math.max(max[c], b.max[c]); }
    vol += volume(p);
  }
  const L = [0, 1, 2].map((c) => max[c] - min[c]), h0 = Math.cbrt(vol / voxelMax);
  let h = h0, n;
  for (;;) {
    n = L.map((x) => Math.max(1, Math.ceil(x / h - 1e-9)));
    if (n[0] * n[1] * n[2] <= CELLE_MAX) break;
    h *= Math.cbrt((n[0] * n[1] * n[2]) / CELLE_MAX) * 1.001;
  }
  return { h, h0, nx: n[0], ny: n[1], nz: n[2], origine: [0, 1, 2].map((c) => min[c] - (n[c] * h - L[c]) / 2) };
}

// Voxel parziali come voxelizzaFrazione dello studio: dove gli 8 angoli non sono d'accordo (o sono fuori
// ma il centro è dentro) si contano 64 campioni. Un voxel è del pezzo che ne occupa la parte maggiore,
// e la frazione è dell'unione: due pezzi incollati che si dividono un voxel lo riempiono, non lo svuotano.
// → chi: pezzo + 1 (0 vuoto), livello: frazione in Q livelli, scatole: i voxel dell'ingombro di ogni pezzo.
function voxelizza(G, pezzi) {
  const { nx, ny, nz, h } = G, [x0, y0, z0] = G.origine, nxy = nx * ny, n = nxy * nz;
  const chi = new Uint16Array(n), parte = new Uint8Array(n), pieno = new Uint8Array(n);
  const condivisi = new Map(), scatole = [];
  const taglia = (v, N) => Math.min(N - 1, Math.max(0, v));
  const conta = (prova, i, j, k) => {
    let c = 0;
    for (let s = 0; s < CAMPIONI; s++) if (prova(x0 + (i + OX[s]) * h, y0 + (j + OY[s]) * h, z0 + (k + OZ[s]) * h)) c++;
    return c;
  };
  pezzi.forEach((p, q) => {
    const b = ingombro(p), prova = (x, y, z) => dentro(p, x, y, z);
    const i0 = taglia(Math.floor((b.min[0] - x0) / h), nx), i1 = taglia(Math.ceil((b.max[0] - x0) / h) - 1, nx);
    const j0 = taglia(Math.floor((b.min[1] - y0) / h), ny), j1 = taglia(Math.ceil((b.max[1] - y0) / h) - 1, ny);
    const k0 = taglia(Math.floor((b.min[2] - z0) / h), nz), k1 = taglia(Math.ceil((b.max[2] - z0) / h) - 1, nz);
    scatole.push([i0, i1, j0, j1, k0, k1]);
    const AX = i1 - i0 + 2, AY = j1 - j0 + 2, AXY = AX * AY, angoli = new Uint8Array(AXY * (k1 - k0 + 2));
    for (let K = 0; K <= k1 - k0 + 1; K++)
      for (let J = 0; J < AY; J++)
        for (let I = 0; I < AX; I++) angoli[I + AX * J + AXY * K] = dentro(p, x0 + (i0 + I) * h, y0 + (j0 + J) * h, z0 + (k0 + K) * h) ? 1 : 0;
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const a = i - i0 + AX * (j - j0) + AXY * (k - k0);
          const c8 = angoli[a] + angoli[a + 1] + angoli[a + AX] + angoli[a + AX + 1] +
            angoli[a + AXY] + angoli[a + AXY + 1] + angoli[a + AXY + AX] + angoli[a + AXY + AX + 1];
          let c = CAMPIONI;
          if (c8 < 8) {
            if (c8 === 0 && !dentro(p, x0 + (i + 0.5) * h, y0 + (j + 0.5) * h, z0 + (k + 0.5) * h)) continue;
            if (!(c = conta(prova, i, j, k))) continue;
          }
          const v = i + nx * j + nxy * k;
          if (!chi[v]) { chi[v] = q + 1; parte[v] = pieno[v] = c; continue; }
          let l = condivisi.get(v);
          if (!l) condivisi.set(v, (l = [chi[v] - 1]));
          l.push(q);
          if (c > parte[v]) { chi[v] = q + 1; parte[v] = c; }
        }
  });
  for (const [v, l] of condivisi) {
    if (parte[v] === CAMPIONI) { pieno[v] = CAMPIONI; continue; }
    pieno[v] = conta((x, y, z) => l.some((q) => dentro(pezzi[q], x, y, z)), v % nx, ((v / nx) | 0) % ny, (v / nxy) | 0);
  }
  for (let v = 0; v < n; v++) if (chi[v] && pieno[v] < 2) chi[v] = 0; // meno di 1/32 del voxel, come nello studio: vuoto
  return { chi, livello: pieno, scatole };
}

// ---------------------------------------------------------------- spessore
// Lo spessore più sottile, in mm, dalle misure: una stima che serve solo a dire quanti voxel ci stanno.
// Per i profili piani, dal punto medio di ogni lato un raggio verso il materiale fino al primo bordo; dai
// fori tondi 16 raggi verso fuori. Nella rivoluzione l'asse non è un bordo: arrivarci vale doppio,
// perché il pieno continua dall'altra parte.
function spessore(p) {
  const m = p.misure;
  switch (p.forma) {
    case 'scatola': return Math.min(m.x, m.y, m.z);
    case 'cilindro': return Math.min(2 * m.r, m.h);
    case 'tubo': return Math.min(m.r - m.r_interno, m.h);
    case 'sfera': return 2 * m.r;
    case 'cono': return Math.min(m.h, 2 * Math.max(m.r, m.r_cima));
    case 'toro': case 'cavo': return 2 * m.r;
    case 'piastra': return Math.min(m.spessore, m.x, m.z);
    case 'estrusione': return Math.min(m.profondita, spessoreProfilo([m.profilo, ...m.fori], m.fori_tondi));
    case 'rivoluzione': return spessoreProfilo([poligonoRivoluzione(m.profilo)], [], true);
    case 'ingranaggio': return Math.min(m.spessore, spessoreProfilo([profiloIngranaggio(m)], m.foro > 0 ? [{ x: 0, y: 0, r: m.foro }] : []));
    default: return Infinity;
  }
}

function spessoreProfilo(anelli, tondi, asse = false) {
  const L = [];
  for (const P of anelli) for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; L.push(a[0], a[1], b[0], b[1]); }
  const raggio = (ox, oy, dx, dy, mio, tondoMio) => {
    let t = Infinity, doppio = false;
    const eps = 1e-9 * (1 + Math.abs(ox) + Math.abs(oy));
    for (let s = 0; s < L.length; s += 4) {
      if (s === mio) continue;
      const ex = L[s + 2] - L[s], ey = L[s + 3] - L[s + 1], den = dx * ey - dy * ex;
      if (!den) continue;
      const wx = L[s] - ox, wy = L[s + 1] - oy, ts = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
      if (ts > eps && u >= 0 && u <= 1 && ts < t) { t = ts; doppio = asse && L[s] === 0 && L[s + 2] === 0; }
    }
    for (const f of tondi) {
      if (f === tondoMio) continue;
      const px = ox - f.x, py = oy - f.y, b = px * dx + py * dy, d = b * b - (px * px + py * py - f.r * f.r);
      if (d < 0) continue;
      const ts = -b - Math.sqrt(d);
      if (ts > eps && ts < t) { t = ts; doppio = false; }
    }
    return doppio ? 2 * t : t;
  };
  let min = Infinity, s = 0;
  anelli.forEach((P, r) => {
    let area = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const verso = Math.sign(area) * (r === 0 ? 1 : -1); // il materiale sta a sinistra di un esterno antiorario
    for (let i = 0; i < P.length; i++, s += 4) {
      const ex = L[s + 2] - L[s], ey = L[s + 3] - L[s + 1], l = Math.hypot(ex, ey);
      if (!l || (asse && L[s] === 0 && L[s + 2] === 0)) continue;
      min = Math.min(min, raggio((L[s] + L[s + 2]) / 2, (L[s + 1] + L[s + 3]) / 2, (-ey / l) * verso, (ex / l) * verso, s, null));
    }
  });
  for (const f of tondi) {
    for (let k = 0; k < 16; k++) {
      const c = Math.cos((k * Math.PI) / 8), sn = Math.sin((k * Math.PI) / 8);
      min = Math.min(min, raggio(f.x + f.r * c, f.y + f.r * sn, c, sn, -1, f));
    }
  }
  return min;
}

// Errore della trave a sbalzo con n voxel nello spessore (studio del 5/11, prove/fea/test-trave.mjs).
function erroreAtteso(n) {
  if (n < 2) return 'sforzi e spostamenti sottostimati oltre il 12%, numeri poco affidabili';
  const e = n < 3 ? -12 + (n - 2) * 6 : -6 + (n - 3) * 2.5;
  return `sforzi e spostamenti sottostimati, errore atteso intorno al ${meno(e)}`;
}

// ---------------------------------------------------------------- isole e facce
// Componenti connesse per facce: due voxel che si toccano solo su uno spigolo farebbero una cerniera.
function isole(G, chi) {
  const { nx, ny, nz } = G, nxy = nx * ny, n = nxy * nz;
  const comp = new Int32Array(n).fill(-1), coda = new Int32Array(n);
  let nc = 0;
  for (let v0 = 0; v0 < n; v0++) {
    if (!chi[v0] || comp[v0] >= 0) continue;
    let testa = 0, fine = 0;
    coda[fine++] = v0;
    comp[v0] = nc;
    while (testa < fine) {
      const v = coda[testa++], i = v % nx, j = ((v / nx) | 0) % ny, k = (v / nxy) | 0;
      const prova = (w) => { if (chi[w] && comp[w] < 0) { comp[w] = nc; coda[fine++] = w; } };
      if (i > 0) prova(v - 1);
      if (i < nx - 1) prova(v + 1);
      if (j > 0) prova(v - nx);
      if (j < ny - 1) prova(v + nx);
      if (k > 0) prova(v - nxy);
      if (k < nz - 1) prova(v + nxy);
    }
    nc++;
  }
  return { comp, nc };
}

// Le facce di un carico o di un vincolo, come nel contratto: le facce esterne dei voxel del pezzo con la
// normale giusta, entro max(h, 2% dell'ingombro del pezzo lungo quell'asse) dall'estremo, che si prende
// dai voxel (con le rotazioni l'ingombro analitico può essere largo). → [v, strato del nodo lungo l'asse, …]
function facce(G, chi, scatola, q, f, ing) {
  const { nx, ny, nz, h } = G, N = [nx, ny, nz], passo = [1, nx, nx * ny], { asse: a, segno: s } = f;
  const [i0, i1, j0, j1, k0, k1] = scatola, tutte = [];
  let estremo = s > 0 ? -Infinity : Infinity;
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const v = i + nx * (j + ny * k);
        if (chi[v] !== q + 1) continue;
        const x = a === 0 ? i : a === 1 ? j : k, oltre = x + s;
        if (oltre >= 0 && oltre < N[a] && chi[v + s * passo[a]]) continue; // non è esterna
        const c = s > 0 ? x + 1 : x;
        tutte.push(v, c);
        if (s > 0 ? c > estremo : c < estremo) estremo = c;
      }
  const tol = Math.max(h, 0.02 * (ing.max[a] - ing.min[a])) * (1 + 1e-9), scelte = [];
  for (let t = 0; t < tutte.length; t += 2) if (Math.abs(tutte[t + 1] - estremo) * h <= tol) scelte.push(tutte[t], tutte[t + 1]);
  return scelte;
}

// ---------------------------------------------------------------- il calcolo
/** Il lavoro di ologramma.mjs → risultato (vedi il contratto in public/ologramma/LEGGIMI-ologramma.md). */
export function analizza(lavoro) {
  const t0 = ora();
  const { pezzi, carichi, vincoli, voxelMax, tempoMax, tempoMaxS } = leggiLavoro(lavoro);
  const avvisi = [], P = pezzi.length;
  const G = griglia(pezzi, voxelMax), { nx, ny, nz, h, origine } = G, nxy = nx * ny, n = nxy * nz;
  const NX = nx + 1, NY = ny + 1, passoN = [1, NX, NX * NY];
  if (G.h > G.h0 * 1.0001) {
    avvisi.push(`il modello è largo e quasi vuoto: per stare in ${CELLE_MAX / 1e6} milioni di celle il voxel passa da ${mm(G.h0)} a ${mm(h)} mm, e i voxel pieni sono meno di ${voxelMax}`);
  }
  const { chi, livello, scatole } = voxelizza(G, pezzi);
  const { comp, nc } = isole(G, chi);
  const tot = new Int32Array(P);
  for (let v = 0; v < n; v++) if (chi[v]) tot[chi[v] - 1]++;

  const sottili = [];
  pezzi.forEach((p, q) => { const t = spessore(p); if (tot[q] && t / h < 4) sottili.push({ id: p.id, t, nv: t / h }); });
  for (const s of sottili.slice(0, 3)) {
    avvisi.push(`pezzo «${s.id}»: lo spessore più sottile, circa ${mm(s.t)} mm, sta in ${N2.format(s.nv)} voxel di ${mm(h)} mm: ${erroreAtteso(s.nv)} (studio: 2 voxel −12%, 3 voxel −6%, 4 voxel −3,5%)`);
  }
  if (sottili.length > 3) avvisi.push(`altri ${sottili.length - 3} pezzi hanno meno di 4 voxel di spessore: ${elenco(sottili.slice(3).map((s) => s.id))}`);
  const sottile = (q) => sottili.some((s) => s.id === pezzi[q].id && s.nv < 2);

  // Facce dei carichi e dei vincoli, e quali isole toccano.
  const conCarico = new Uint8Array(nc), conVincolo = new Uint8Array(nc);
  const trova = (x, cosa) => {
    const f = facce(G, chi, scatole[x.p], x.p, x, ingombro(pezzi[x.p]));
    if (!f.length) {
      throw sbaglio(`${cosa} sul pezzo «${x.id}» non trova facce esterne verso ${x.faccia}: ${tot[x.p]
        ? 'quel lato del pezzo è coperto da altri pezzi'
        : `il pezzo non ha voxel suoi, perché è più piccolo del voxel di ${mm(h)} mm o sta dentro un altro pezzo`}`);
    }
    return f;
  };
  const facceV = vincoli.map((x) => { const f = trova(x, "l'incastro"); for (let t = 0; t < f.length; t += 2) conVincolo[comp[f[t]]] = 1; return f; });
  const facceC = carichi.map((x) => { const f = trova(x, 'il carico'); for (let t = 0; t < f.length; t += 2) conCarico[comp[f[t]]] = 1; return f; });
  carichi.forEach((x, t) => {
    const f = facceC[t];
    for (let s = 0; s < f.length; s += 2) {
      const c = comp[f[s]];
      if (conVincolo[c]) continue;
      const insieme = new Set();
      for (let v = 0; v < n; v++) if (comp[v] === c) insieme.add(chi[v] - 1);
      const altri = [...insieme].filter((q) => q !== x.p).map((q) => pezzi[q].id);
      throw sbaglio(`il carico sul pezzo «${x.id}» non ha nessun vincolo: il pezzo${altri.length ? `, con ${elenco(altri)} incollati a lui,` : ''} volerebbe via. ` +
        `Serve un incastro su uno di questi pezzi, o un contatto per una faccia con un pezzo incastrato${sottile(x.p) ? ` (il pezzo è più sottile di 2 voxel di ${mm(h)} mm: i suoi voxel possono staccarsi)` : ''}`);
    }
  });

  // Le isole senza carichi né vincoli restano fuori; voxel_pezzo le tiene, con sforzo zero.
  const tenuta = (c) => conCarico[c] === 1 || conVincolo[c] === 1;
  const fuori = new Int32Array(P), vs = new Uint16Array(n);
  for (let v = 0; v < n; v++) {
    if (!chi[v]) continue;
    if (tenuta(comp[v])) vs[v] = (chi[v] - 1) * Q + livello[v];
    else fuori[chi[v] - 1]++;
  }
  const esclusi = pezzi.filter((p, q) => tot[q] > 0 && fuori[q] === tot[q]).map((p) => p.id);
  if (esclusi.length) avvisi.push(`lasciati fuori perché non toccano vincoli e non hanno carichi: ${elenco(esclusi)}`);
  pezzi.forEach((p, q) => {
    if (!tot[q]) avvisi.push(`pezzo «${p.id}»: nessun voxel suo, perché è più piccolo del voxel di ${mm(h)} mm o sta dentro un altro pezzo: non entra nel calcolo`);
    else if (fuori[q] && fuori[q] < tot[q]) avvisi.push(`pezzo «${p.id}»: ${fuori[q]} voxel su ${tot[q]} sono staccati dal resto, senza carichi né vincoli: lasciati fuori`);
  });

  // Il modello: il materiale di ogni pezzo in Q livelli di frazione, E·q/Q, con la Ke condivisa per ν.
  const materiali = [];
  for (const p of pezzi) for (let l = 1; l <= Q; l++) materiali.push({ E: (p.mat.E * l) / Q, nu: p.mat.nu, frazione: l / Q });
  const m = creaModello({ nx, ny, nz, h, voxel: vs, materiali, origine });
  // I 4 nodi di una faccia, con l'indice compatto di voxel-fea (fisso e f): sono di voxel calcolati, quindi usati.
  const nodi = (v, a, c) => {
    const ijk = [v % nx, ((v / nx) | 0) % ny, (v / nxy) | 0];
    ijk[a] = c;
    const b = ijk[0] + NX * ijk[1] + NX * NY * ijk[2], s1 = passoN[(a + 1) % 3], s2 = passoN[(a + 2) % 3];
    return [m.mappa[b], m.mappa[b + s1], m.mappa[b + s2], m.mappa[b + s1 + s2]];
  };
  vincoli.forEach((x, t) => {
    const f = facceV[t];
    for (let s = 0; s < f.length; s += 2) for (const nn of nodi(f[s], x.asse, f[s + 1])) m.fisso[3 * nn] = m.fisso[3 * nn + 1] = m.fisso[3 * nn + 2] = 1;
  });
  carichi.forEach((x, t) => {
    const f = facceC[t], quota = 2 / f.length; // f ha 2 numeri per faccia; ogni faccia passa F/k ai suoi 4 nodi
    let bloccati = 0;
    for (let s = 0; s < f.length; s += 2) {
      for (const nn of nodi(f[s], x.asse, f[s + 1])) {
        for (let d = 0; d < 3; d++) m.f[3 * nn + d] += (x.F[d] * quota) / 4;
        bloccati += m.fisso[3 * nn];
      }
    }
    const pct = (100 * bloccati) / (2 * f.length);
    if (pct >= 50) avvisi.push(`il carico sul pezzo «${x.id}» cade per il ${Math.round(pct)}% su nodi incastrati, che non si muovono: conta solo il resto`);
  });

  const t1 = ora();
  const sol = risolvi(m, { tol: TOL, multigriglia: true, tempoMax: tempoMax - (t1 - t0) });
  const t2 = ora();
  if (!sol.convergito) {
    avvisi.push(`il calcolo ha superato il tempo massimo di ${N3.format(tempoMaxS)} s: fermato dopo ${sol.iterazioni} iterazioni con residuo ${sol.residuo.toExponential(0)} invece di ${TOL.toExponential(0)}, quindi i numeri sono approssimati`);
  }

  const { vm: vmE } = sforzi(m, sol.u);
  const vm = new Float32Array(n), massimo = new Float64Array(P).fill(-1), dove = new Int32Array(P).fill(-1);
  for (let e = 0; e < m.ne; e++) {
    const v = m.vox[e], q = chi[v] - 1, s = vmE[e];
    if (!(s < Infinity)) throw sbaglio('il risolutore ha dato sforzi non validi (NaN o infiniti): il modello è malcondizionato');
    vm[v] = s;
    if (s > massimo[q]) { massimo[q] = s; dove[q] = v; }
  }
  let u2 = 0;
  for (let c = 0; c < m.nu; c++) {
    const b = 3 * m.nodi[c], ux = sol.u[b], uy = sol.u[b + 1], uz = sol.u[b + 2];
    u2 = Math.max(u2, ux * ux + uy * uy + uz * uz);
  }
  // Il massimo sta entro VICINO·h da un nodo incastrato? Lì il valore dipende dalla griglia.
  const vicino = (v) => {
    const i = v % nx, j = ((v / nx) | 0) % ny, k = (v / nxy) | 0;
    for (let K = Math.max(0, k - 1); K <= Math.min(nz, k + 2); K++)
      for (let J = Math.max(0, j - 1); J <= Math.min(ny, j + 2); J++)
        for (let I = Math.max(0, i - 1); I <= Math.min(nx, i + 2); I++) {
          const c = m.mappa[I + NX * (J + NY * K)];
          if (c >= 0 && m.fisso[3 * c] && (I - i - 0.5) ** 2 + (J - j - 0.5) ** 2 + (K - k - 0.5) ** 2 <= VICINO * VICINO) return true;
        }
    return false;
  };
  const risultati = [];
  pezzi.forEach((p, q) => {
    const v = dove[q];
    if (v < 0) return;
    const i = v % nx, j = ((v / nx) | 0) % ny, k = (v / nxy) | 0;
    risultati.push({
      id: p.id, sforzo_max_MPa: massimo[q],
      punto_mm: [origine[0] + (i + 0.5) * h, origine[1] + (j + 0.5) * h, origine[2] + (k + 0.5) * h],
      vicino_incastro: vicino(v),
    });
  });
  const vicini = risultati.filter((r) => r.vicino_incastro).map((r) => r.id);
  if (vicini.length) {
    avvisi.push(`il massimo di ${elenco(vicini)} è a meno di ${VICINO} voxel da un incastro: lì il valore dipende dalla griglia, e lo studio ha misurato sottostime fino al 40%`);
  }
  const t3 = ora();
  return {
    h_mm: h, nx, ny, nz, origine: [...origine],
    voxel_pezzo: chi, vm,
    voxel: m.ne, iterazioni: sol.iterazioni, convergito: sol.convergito, tempo_s: (t3 - t0) / 1000,
    spostamento_max_mm: Math.sqrt(u2),
    pezzi: risultati, esclusi, avvisi: avvisi.map((a) => (a.length > 300 ? a.slice(0, 299) + '…' : a)),
    tempi: { voxel_s: (t1 - t0) / 1000, risolutore_s: (t2 - t1) / 1000, sforzi_s: (t3 - t2) / 1000 },
  };
}

// ---------------------------------------------------------------- nel worker
// Un solo calcolo alla volta: vince l'ultimo, quindi una chiamata nuova termina il worker di prima e ne
// rifiuta la promessa. Il timeout termina il worker davvero (terminate ferma anche un ciclo JavaScript).
let inCorso = null;

/** analizza(lavoro) in un worker_threads → Promise<risultato>, con i due array trasferiti, non copiati. */
export function calcolaInWorker(lavoro, { timeout_s } = {}) {
  if (inCorso) inCorso.ferma(new Error('calcolo interrotto: ne è partito uno nuovo'));
  const tm = lavoro && oggetto(lavoro.opzioni) && finito(lavoro.opzioni.tempo_max_s) ? lavoro.opzioni.tempo_max_s : OPZIONI.tempo_max_s[0];
  const limite = finito(timeout_s) && timeout_s > 0 ? timeout_s : Math.min(tm, OPZIONI.tempo_max_s[2]) + 30;
  return new Promise((ok, no) => {
    let w = null, timer = null, chiuso = false;
    const questo = {};
    const fine = (e, r) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      if (inCorso === questo) inCorso = null;
      if (w) w.terminate().catch(() => {});
      if (e) no(e);
      else ok(r);
    };
    questo.ferma = (e) => fine(e);
    inCorso = questo;
    try {
      w = new Worker(new URL('./lavoratore.mjs', import.meta.url), { workerData: lavoro });
    } catch (e) {
      fine(e);
      return;
    }
    timer = setTimeout(() => fine(new Error(`calcolo fermato dopo ${N3.format(limite)} s: il modello è troppo grande per il tempo concesso`)), limite * 1000);
    w.on('message', (msg) => (msg && msg.ok ? fine(null, msg.r) : fine(new Error((msg && msg.errore) || 'il calcolo è fallito senza dire perché'))));
    w.on('error', (e) => fine(e instanceof Error ? e : new Error(String(e))));
    w.on('exit', (codice) => fine(new Error(`il calcolo si è chiuso prima del risultato (codice ${codice})`)));
  });
}
