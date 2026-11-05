// test-trave.mjs — valida voxel-fea.mjs contro la trave a sbalzo analitica.
// node test-trave.mjs            → controlli sull'elemento, trazione, trave a 4 risoluzioni,
//                                   tolleranza, cambio di lega
// node test-trave.mjs 4 8        → solo le risoluzioni scelte (n voxel nello spessore)
// node test-trave.mjs --mg        → con il precondizionatore multigriglia invece di Jacobi
import { creaModello, incastra, forzaSuFacce, risolvi, sforzi, matriceKe, prodotto } from './voxel-fea.mjs';

const ora = () => performance.now();
const MG = process.argv.includes('--mg');
const numeri = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
const pct = (a, b) => (100 * (a - b)) / b;
const f2 = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

// Acciaio e trave del compito: mm, N, MPa.
const ACCIAIO = { E: 210000, nu: 0.3, snervamento: 235 };
const L = 100, b = 10, t = 10, P = 100;
const I = (b * t ** 3) / 12;
const deltaEB = (P * L ** 3) / (3 * ACCIAIO.E * I); // Eulero-Bernoulli
const sigmaMax = (P * L * (t / 2)) / I; // M·c/I all'incastro, fibra esterna
const G = ACCIAIO.E / (2 * (1 + ACCIAIO.nu));
const kappa = (10 * (1 + ACCIAIO.nu)) / (12 + 11 * ACCIAIO.nu); // Cowper, sezione rettangolare
const deltaT = deltaEB + (P * L) / (kappa * G * b * t); // Timoshenko: + taglio

// ------------------------------------------------------------ 0. l'elemento
function controlliElemento() {
  const K = matriceKe(ACCIAIO.E, ACCIAIO.nu, 1, 1, 1);
  let kmax = 0, asim = 0;
  for (let r = 0; r < 24; r++)
    for (let c = 0; c < 24; c++) {
      kmax = Math.max(kmax, Math.abs(K[r * 24 + c]));
      asim = Math.max(asim, Math.abs(K[r * 24 + c] - K[c * 24 + r]));
    }
  const XI = [-1, 1, 1, -1, -1, 1, 1, -1], ETA = [-1, -1, 1, 1, -1, -1, 1, 1], ZETA = [-1, -1, -1, -1, 1, 1, 1, 1];
  const moti = {
    traslazione: (a) => [1, 0, 0],
    rotazione_z: (a) => [-ETA[a], XI[a], 0],
    rotazione_x: (a) => [0, -ZETA[a], ETA[a]],
  };
  const res = {};
  for (const [nome, fn] of Object.entries(moti)) {
    const u = new Float64Array(24);
    for (let a = 0; a < 8; a++) u.set(fn(a), 3 * a);
    let fmax = 0;
    for (let r = 0; r < 24; r++) {
      let s = 0;
      for (let c = 0; c < 24; c++) s += K[r * 24 + c] * u[c];
      fmax = Math.max(fmax, Math.abs(s));
    }
    res[nome] = fmax / kmax;
  }
  console.log(`Elemento: asimmetria ${(asim / kmax).toExponential(1)}, forze da moto rigido (relative) ` +
    Object.entries(res).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', '));
  return asim / kmax < 1e-12 && Object.values(res).every((v) => v < 1e-12);
}

// ------------------------------------------------------------ 1. trazione uniforme
// Il trilineare la rappresenta esattamente: deve tornare alla tolleranza del risolutore.
function trazione() {
  const nx = 10, ny = 2, nz = 2, h = 1, s0 = 100;
  const m = creaModello({ nx, ny, nz, h, voxel: new Uint8Array(nx * ny * nz).fill(1), materiali: [ACCIAIO] });
  incastra(m, (x) => x < 1e-9, [true, false, false]);
  incastra(m, (x, y, z) => x < 1e-9 && y < 1e-9 && z < 1e-9, [false, true, true]);
  incastra(m, (x, y, z) => x < 1e-9 && Math.abs(y - ny) < 1e-9 && z < 1e-9, [false, false, true]);
  forzaSuFacce(m, (x, y, z, f) => f === 1, [s0 * ny * nz, 0, 0]);
  const sol = risolvi(m, { tol: 1e-12 });
  const { vm } = sforzi(m, sol.u);
  const atteso = (s0 * nx) / ACCIAIO.E;
  let eu = 0;
  for (let n = 0; n < m.nn; n++) if (n % m.NX === nx) eu = Math.max(eu, Math.abs(sol.u[3 * n] - atteso) / atteso);
  let es = 0;
  for (let e = 0; e < m.ne; e++) es = Math.max(es, Math.abs(vm[e] - s0) / s0);
  console.log(`Trazione uniforme: errore massimo ${eu.toExponential(1)} sullo spostamento, ${es.toExponential(1)} sullo sforzo, ${sol.iterazioni} iterazioni`);
  return eu < 1e-8 && es < 1e-8;
}

// ------------------------------------------------------------ 2. trave a sbalzo
export function trave(n, { tol = 1e-8, materiale = ACCIAIO, u0 = null } = {}) {
  const nx = 10 * n, ny = n, nz = n, h = L / nx;
  const t0 = ora();
  const m = creaModello({ nx, ny, nz, h, voxel: new Uint8Array(nx * ny * nz).fill(1), materiali: [materiale] });
  incastra(m, (x) => x < 1e-9);
  forzaSuFacce(m, (x, y, z, f) => f === 1, [0, 0, -P]); // trazione di taglio uniforme sulla faccia in punta
  const t1 = ora();
  const sol = risolvi(m, { tol, u0, multigriglia: MG });
  const t2 = ora();
  const { vm, s } = sforzi(m, sol.u);
  const t3 = ora();

  // Freccia: media di uz sui nodi della faccia in punta (x = L).
  let somma = 0, cont = 0;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) { somma += sol.u[3 * (nx + m.NX * (j + m.NY * k)) + 2]; cont++; }
  const freccia = -somma / cont;

  // Il pieno è tutto pieno: l'elemento e coincide col voxel (i, j, k).
  const el = (i, j, k) => i + nx * (j + ny * k);
  const jA = Math.floor((ny - 1) / 2), jB = Math.ceil((ny - 1) / 2); // elementi centrali in larghezza (uno se ny è dispari)
  const centro = (i, k, c) => (s[6 * el(i, jA, k) + c] + s[6 * el(i, jB, k) + c]) / 2;
  const vmCentro = (i, k) => (vm[el(i, jA, k)] + vm[el(i, jB, k)]) / 2;
  const teoria = (xc, zc) => (P * (L - xc) * (zc - t / 2)) / I; // σxx di trave nel punto (xc, zc)

  // a) l'elemento all'incastro, fibra tesa in alto
  const incastroVm = vmCentro(0, nz - 1), incastroSxx = centro(0, nz - 1, 0);
  const teoriaIncastro = teoria(h / 2, t - h / 2);
  // b) il massimo di von Mises su tutto il pezzo
  let vmMax = 0, eMax = 0;
  for (let e = 0; e < m.ne; e++) if (vm[e] > vmMax) { vmMax = vm[e]; eMax = e; }
  const iMax = eMax % nx, jMax = ((eMax / nx) | 0) % ny, kMax = (eMax / (nx * ny)) | 0;
  // c) a metà trave, lontano da incastro e carico
  const im = nx / 2, xm = (im + 0.5) * h;
  const metaSxx = centro(im, nz - 1, 0), teoriaMeta = teoria(xm, t - h / 2);
  // d) ricostruito: due file di centri → superficie (lineare in z), poi retta in x da 0,2 L a 0,6 L → x = 0
  const xs = [], ys = [];
  for (let i = 0; i < nx; i++) {
    const xc = (i + 0.5) * h;
    if (xc < 0.2 * L || xc > 0.6 * L) continue;
    xs.push(xc);
    ys.push(1.5 * centro(i, nz - 1, 0) - 0.5 * centro(i, nz - 2, 0));
  }
  const mx = xs.reduce((a, c) => a + c, 0) / xs.length, my = ys.reduce((a, c) => a + c, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let q = 0; q < xs.length; q++) { sxy += (xs[q] - mx) * (ys[q] - my); sxx += (xs[q] - mx) ** 2; }
  const ricostruito = my - (sxy / sxx) * mx;

  return {
    n, voxel: m.ne, gdl: m.ndof, iterazioni: sol.iterazioni, convergito: sol.convergito, livelli: sol.livelli, msPrep: sol.msPreparazione,
    msPreparazione: t1 - t0, msRisolutore: t2 - t1, msSforzi: t3 - t2, msTotale: t3 - t0,
    msPerProdotto: sol.msProdotto / Math.max(1, sol.iterazioni),
    freccia, erroreFrecciaEB: pct(freccia, deltaEB), erroreFrecciaT: pct(freccia, deltaT),
    incastroVm, incastroSxx, teoriaIncastro,
    erroreIncastroVm: pct(incastroVm, sigmaMax), erroreIncastroPunto: pct(incastroSxx, teoriaIncastro),
    vmMax, erroreVmMax: pct(vmMax, sigmaMax), dovMax: [iMax, jMax, kMax],
    erroreMeta: pct(metaSxx, teoriaMeta), ricostruito, erroreRicostruito: pct(ricostruito, sigmaMax),
    u: sol.u, vm,
  };
}

// ------------------------------------------------------------ esecuzione
const risoluzioni = numeri.length ? numeri : [4, 8, 10, 12];
console.log(`Precondizionatore: ${MG ? 'multigriglia' : 'Jacobi'}`);
console.log(`Teoria: freccia ${deltaEB.toFixed(5)} mm (Eulero-Bernoulli), ${deltaT.toFixed(5)} mm (Timoshenko), sforzo massimo ${sigmaMax.toFixed(1)} MPa`);
const okElemento = controlliElemento();
const okTrazione = trazione();
trave(2); // riscaldamento del JIT

const righe = [];
for (const n of risoluzioni) {
  const r = trave(n);
  righe.push(r);
  console.log(
    `${10 * n}×${n}×${n}: ${r.voxel} voxel, ${r.gdl} gdl | ${r.iterazioni} it${r.convergito ? '' : ' (NON convergito)'}, ` +
    `${(r.msTotale / 1000).toFixed(2)} s (risolutore ${(r.msRisolutore / 1000).toFixed(2)} s, di cui preparazione ${(r.msPrep / 1000).toFixed(2)} s, ${r.msPerProdotto.toFixed(2)} ms a prodotto${r.livelli ? ', livelli ' + r.livelli.map((l) => l.join('×')).join(' → ') : ''}) | ` +
    `freccia ${r.freccia.toFixed(5)} mm: ${f2(r.erroreFrecciaEB)}% su EB, ${f2(r.erroreFrecciaT)}% su Timoshenko | ` +
    `incastro vm ${r.incastroVm.toFixed(1)} MPa (${f2(r.erroreIncastroVm)}% su 60; σxx ${f2(r.erroreIncastroPunto)}% sulla teoria nel suo centro ${r.teoriaIncastro.toFixed(1)}) | ` +
    `vm max ${r.vmMax.toFixed(1)} MPa (${f2(r.erroreVmMax)}%) in [${r.dovMax}] | metà trave ${f2(r.erroreMeta)}% | ricostruito ${r.ricostruito.toFixed(1)} MPa (${f2(r.erroreRicostruito)}%)`
  );
}

// Criterio scritto prima: freccia < 10% alla risoluzione media, < 2 s per circa 10.000 voxel.
const media = righe.find((r) => r.n === 8);
const diecimila = righe.find((r) => r.n === 10);
if (media) console.log(`CRITERIO freccia a 80×8×8 sotto il 10%: ${Math.abs(media.erroreFrecciaEB) < 10 ? 'REGGE' : 'NON REGGE'} (${f2(media.erroreFrecciaEB)}%)`);
if (diecimila) console.log(`CRITERIO tempo a 10.000 voxel sotto 2 s: ${diecimila.msTotale < 2000 ? 'REGGE' : 'NON REGGE'} (${(diecimila.msTotale / 1000).toFixed(2)} s)`);

// ------------------------------------------------------------ 3. tolleranza: quanta ne serve ai colori?
if (!numeri.length) {
  const rif = trave(10, { tol: 1e-10 });
  let vmRif = 0;
  for (const v of rif.vm) vmRif = Math.max(vmRif, v);
  console.log(`Tolleranza (100×10×10, riferimento 1e-10: ${rif.iterazioni} it, ${(rif.msRisolutore / 1000).toFixed(2)} s):`);
  for (const tol of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-8]) {
    const r = trave(10, { tol });
    let dv = 0;
    for (let e = 0; e < r.vm.length; e++) dv = Math.max(dv, Math.abs(r.vm[e] - rif.vm[e]));
    console.log(`  tol ${tol.toExponential(0)}: ${r.iterazioni} it, risolutore ${(r.msRisolutore / 1000).toFixed(2)} s, ` +
      `freccia ${f2(pct(r.freccia, rif.freccia))}% dal riferimento, von Mises: scarto massimo ${f2((100 * dv) / vmRif)}% del massimo`);
  }

  // ---------------------------------------------------------- 4. cambio di lega
  // Con carichi imposti e un solo materiale, lo sforzo non dipende da E: cambia solo per ν.
  const acc = trave(8, { tol: 1e-10 });
  const alluNu = trave(8, { tol: 1e-10, materiale: { E: 68900, nu: 0.33 } });
  const alluStessoNu = trave(8, { tol: 1e-10, materiale: { E: 68900, nu: 0.3 } });
  const scarto = (a, c) => { let d = 0, mx = 0; for (let e = 0; e < a.vm.length; e++) { d = Math.max(d, Math.abs(a.vm[e] - c.vm[e])); mx = Math.max(mx, c.vm[e]); } return (100 * d) / mx; };
  console.log(`Cambio di lega (80×8×8): freccia alluminio/acciaio ${(alluNu.freccia / acc.freccia).toFixed(3)} (E: ${(210000 / 68900).toFixed(3)}); ` +
    `von Mises, scarto massimo ${scarto(alluNu, acc).toFixed(2)}% del massimo con ν 0,33 contro 0,30, ${scarto(alluStessoNu, acc).toExponential(1)}% con lo stesso ν`);
}

console.log(`Controlli: elemento ${okElemento ? 'ok' : 'FALLITO'}, trazione ${okTrazione ? 'ok' : 'FALLITA'}`);
