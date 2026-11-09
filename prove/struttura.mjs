// prove/struttura.mjs — il calcolo degli sforzi (fisica/struttura.mjs) nel formato del contratto, con
// pezzi, carichi e vincoli normalizzati da forme.js come li manda ologramma.mjs.
// node prove/struttura.mjs → PASS o FAIL per ogni caso, poi la tabella dei tempi; codice 0 solo se passa tutto.
import { analizza, calcolaInWorker } from '../fisica/struttura.mjs';
import { normalizzaPezzo, normalizzaCarichi, normalizzaVincoli } from '../public/ologramma/forme.js';
import { MATERIALI } from '../public/ologramma/materiali.js';

let falliti = 0;
const caso = (nome, ok, dettagli = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${dettagli ? `: ${dettagli}` : ''}`);
  if (!ok) falliti++;
};
const pct = (a, b) => (100 * (a - b)) / b;
const f = (v, c = 2) => v.toFixed(c);
const dormi = (ms) => new Promise((r) => setTimeout(r, ms));

// Un pezzo come in preparaLavoro di ologramma.mjs: normalizzato, più mat; matExtra per i materiali di laboratorio.
function pezzo(p, matExtra = null) {
  const r = normalizzaPezzo(p);
  if (!r.pezzo) throw new Error(r.errori.join('; '));
  const m = MATERIALI[r.pezzo.materiale];
  return { ...r.pezzo, mat: { chiave: r.pezzo.materiale, E: m.E, nu: m.nu, snervamento: m.snervamento, densita: m.densita, affidabile: m.affidabile, ...matExtra } };
}
function lavoro(pezzi, carichi, vincoli, opzioni = {}) {
  const c = normalizzaCarichi(carichi, pezzi), v = normalizzaVincoli(vincoli, pezzi);
  if (!c.carichi || !v.vincoli) throw new Error([...c.errori, ...v.errori].join('; '));
  return { pezzi, carichi: c.carichi, vincoli: v.vincoli, opzioni: { voxel_max: 40000, tempo_max_s: 45, ...opzioni } };
}
const errore = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ------------------------------------------------------------ 1. trave a sbalzo
// Acciaio S235, 100×10×10 da x = 0 a 100, incastro a −x, 100 N verso −y a +x.
const E = MATERIALI['acciaio-s235'].E, P = 100, L = 100, I = (10 * 10 ** 3) / 12;
const FRECCIA = (P * L ** 3) / (3 * E * I), SIGMA_META = (P * (L / 2) * 5) / I; // 0,19048 mm e 30 MPa
const trave = (materiale = 'acciaio-s235', opzioni = {}, matExtra = null) => lavoro(
  [pezzo({ id: 'trave', forma: 'scatola', misure: { x: 100, y: 10, z: 10 }, posizione: [50, 0, 0], materiale }, matExtra)],
  [{ pezzo: 'trave', faccia: '+x', forza_N: P, direzione: [0, -1, 0] }],
  [{ pezzo: 'trave', faccia: '-x', tipo: 'incastro' }], opzioni);

// vm a metà trave dalla fibra esterna: le righe in alto e in basso, interpolate fra le due colonne attorno a L/2.
function vmMeta(r) {
  const { nx, ny, nz, h_mm: h, origine } = r;
  const i0 = Math.floor((L / 2 - origine[0]) / h - 0.5), w = (L / 2 - (origine[0] + (i0 + 0.5) * h)) / h;
  const riga = (i) => {
    let s = 0;
    for (let k = 0; k < nz; k++) s += r.vm[i + nx * ny * k] + r.vm[i + nx * (ny - 1 + ny * k)];
    return s / (2 * nz);
  };
  return riga(i0) * (1 - w) + riga(i0 + 1) * w;
}

const rTrave = analizza(trave());
{
  const r = rTrave, e1 = pct(r.spostamento_max_mm, FRECCIA), e2 = pct(vmMeta(r), SIGMA_META);
  caso('Trave: freccia entro il 5% di PL³/3EI', r.convergito && Math.abs(e1) <= 5,
    `${f(r.spostamento_max_mm, 5)} mm contro ${f(FRECCIA, 5)} (${f(e1)}%), ${r.voxel} voxel di ${f(r.h_mm, 3)} mm, ${r.iterazioni} iterazioni, ${f(r.tempo_s)} s`);
  caso('Trave: vm a metà dalla fibra esterna entro il 7% di M·c/I', Math.abs(e2) <= 7, `${f(vmMeta(r))} MPa contro ${f(SIGMA_META)} (${f(e2)}%)`);
  const t = r.pezzi[0];
  caso("Trave: il massimo è all'incastro, segnalato con la sottostima dello studio",
    t.vicino_incastro && t.punto_mm[0] < 2 * r.h_mm && r.avvisi.some((a) => a.includes('«trave»') && a.includes('40%')),
    `${f(t.sforzo_max_MPa, 1)} MPa in [${t.punto_mm.map((x) => f(x, 1))}]; avviso: ${r.avvisi.find((a) => a.includes('40%'))}`);
  const forme = r.voxel_pezzo instanceof Uint16Array && r.vm instanceof Float32Array && r.vm.length === r.nx * r.ny * r.nz &&
    r.voxel_pezzo.length === r.vm.length && r.vm.every((v, i) => v >= 0 && Number.isFinite(v) && (r.voxel_pezzo[i] > 0 || v === 0));
  caso('Trave: risultato nella forma del contratto', forme && r.esclusi.length === 0 && Array.isArray(r.avvisi), `${r.nx}×${r.ny}×${r.nz}, origine [${r.origine.map((x) => f(x, 3))}]`);
}

// ------------------------------------------------------------ 2. staffa a L
// Due scatole incollate: il montante 14×60×10 (x 0..14, y 0..60), incastrato sotto; il braccio 50×10×10
// (x 14..64, y 50..60), con 200 N verso −y in punta. Lo spigolo interno è la retta x = 14, y = 50.
// Il montante è più spesso del braccio: all'incastro fa circa 36 MPa nominali, il braccio alla radice 60
// più la concentrazione dello spigolo, quindi il massimo deve venire dallo spigolo e non dall'incastro.
{
  const r = analizza(lavoro(
    [pezzo({ id: 'montante', forma: 'scatola', misure: { x: 14, y: 60, z: 10 }, posizione: [7, 30, 0], materiale: 'acciaio-s235' }),
      pezzo({ id: 'braccio', forma: 'scatola', misure: { x: 50, y: 10, z: 10 }, posizione: [39, 55, 0], materiale: 'acciaio-s235' })],
    [{ pezzo: 'braccio', faccia: '+x', forza_N: 200, direzione: [0, -1, 0] }],
    [{ pezzo: 'montante', faccia: '-y', tipo: 'incastro' }]));
  const top = r.pezzi.reduce((a, b) => (b.sforzo_max_MPa > a.sforzo_max_MPa ? b : a));
  const d = Math.hypot(top.punto_mm[0] - 14, top.punto_mm[1] - 50);
  caso('Staffa a L: converge, e il massimo sta vicino allo spigolo interno', r.convergito && d <= 3 * r.h_mm && !top.vicino_incastro,
    `${f(top.sforzo_max_MPa, 1)} MPa su «${top.id}» a ${f(d)} mm dallo spigolo (voxel ${f(r.h_mm, 3)} mm); ` +
    r.pezzi.map((p) => `${p.id} ${f(p.sforzo_max_MPa, 1)} MPa in [${p.punto_mm.map((x) => f(x, 1))}]`).join(', ') + `; ${r.iterazioni} iterazioni, ${f(r.tempo_s)} s`);
}

// ------------------------------------------------------------ 3. lega
{
  const op = { voxel_max: 8000 };
  const a = analizza(trave('acciaio-s235', op)), b = analizza(trave('acciaio-s355', op));
  const uguali = a.vm.length === b.vm.length && a.vm.every((v, i) => v === b.vm[i]);
  const fs = (r, sn) => { let m = Infinity; for (let i = 0; i < r.vm.length; i++) if (r.voxel_pezzo[i] && r.vm[i] > 0) m = Math.min(m, sn / r.vm[i]); return m; };
  const k = fs(b, 355) / fs(a, 235);
  caso('Lega: S235 e S355 danno vm identico e fs che scala con lo snervamento', uguali && Math.abs(k / (355 / 235) - 1) < 1e-12,
    `vm uguale in tutti i ${a.vm.length} voxel: ${uguali}; fs minimo ${f(fs(a, 235), 3)} e ${f(fs(b, 355), 3)}, rapporto ${k.toFixed(6)} (355/235 = ${(355 / 235).toFixed(6)})`);
  // La scorciatoia di ologramma.mjs: un solo materiale e lo stesso ν, E diverso → vm uguale, spostamento × E_vecchio/E_nuovo.
  const c = analizza(trave('acciaio-s235', op, { E: 68900 }));
  let dv = 0, vmax = 0;
  for (let i = 0; i < a.vm.length; i++) { dv = Math.max(dv, Math.abs(a.vm[i] - c.vm[i])); vmax = Math.max(vmax, a.vm[i]); }
  const ku = c.spostamento_max_mm / a.spostamento_max_mm;
  caso('Lega: con lo stesso ν, E diverso lascia vm uguale e scala lo spostamento', dv / vmax < 1e-6 && Math.abs(ku / (210000 / 68900) - 1) < 1e-6,
    `scarto massimo di vm ${(dv / vmax).toExponential(1)} del massimo; spostamento × ${ku.toFixed(6)} (E: ${(210000 / 68900).toFixed(6)}); iterazioni ${a.iterazioni} e ${c.iterazioni}`);
}

// ------------------------------------------------------------ 4. isole
{
  const base = () => pezzo({ id: 'trave', forma: 'scatola', misure: { x: 100, y: 10, z: 10 }, posizione: [50, 0, 0], materiale: 'acciaio-s235' });
  const op = { voxel_max: 8000 };
  const carico = { pezzo: 'trave', faccia: '+x', forza_N: 100, direzione: [0, -1, 0] }, incastro = { pezzo: 'trave', faccia: '-x', tipo: 'incastro' };
  const r = analizza(lavoro([base(), pezzo({ id: 'sasso', forma: 'sfera', misure: { r: 6 }, posizione: [50, 40, 0], materiale: 'pla' })], [carico], [incastro], op));
  const q = 2, celle = r.voxel_pezzo.reduce((s, v) => s + (v === q), 0);
  const zero = r.voxel_pezzo.every((v, i) => v !== q || r.vm[i] === 0);
  caso('Isole: un pezzo che galleggia viene escluso con un avviso', r.esclusi.length === 1 && r.esclusi[0] === 'sasso' && celle > 0 && zero &&
    r.avvisi.some((a) => a.includes('«sasso»') && a.includes('lasciati fuori')) && !r.pezzi.some((p) => p.id === 'sasso'),
    `esclusi ${JSON.stringify(r.esclusi)}, ${celle} voxel suoi con sforzo zero; avviso: ${r.avvisi.find((a) => a.includes('sasso'))}`);
  const e = errore(() => analizza(lavoro([base(), pezzo({ id: 'masso', forma: 'scatola', misure: { x: 10, y: 10, z: 10 }, posizione: [50, 40, 0], materiale: 'pla' })],
    [carico, { pezzo: 'masso', faccia: '+y', forza_N: 10, direzione: [0, 1, 0] }], [incastro], op)));
  caso('Isole: un carico su un pezzo senza vincolo dà errore', e instanceof Error && e.message.includes('«masso»') && e.message.includes('volerebbe via'), e ? e.message : 'nessun errore');
  // Incollato per una faccia: fa parte dello stesso corpo, quindi non si esclude e porta sforzo.
  const g = analizza(lavoro([base(), pezzo({ id: 'tacco', forma: 'scatola', misure: { x: 10, y: 6, z: 10 }, posizione: [30, 8, 0], materiale: 'pla' })], [carico], [incastro], op));
  const tacco = g.pezzi.find((p) => p.id === 'tacco');
  caso('Isole: un pezzo incollato per una faccia resta nel calcolo', g.esclusi.length === 0 && tacco && tacco.sforzo_max_MPa > 0,
    `esclusi ${JSON.stringify(g.esclusi)}, sforzo massimo del tacco ${tacco ? f(tacco.sforzo_max_MPa, 3) : '-'} MPa`);
}

// ------------------------------------------------------------ 5. piastra curva sottile e tempo massimo
{
  const r = analizza(lavoro(
    [pezzo({ id: 'guscio', forma: 'piastra', misure: { x: 100, z: 40, spessore: 2, raggio: 80 }, materiale: 'alluminio-6061' })],
    [{ pezzo: 'guscio', faccia: '+x', forza_N: 50, direzione: [0, -1, 0] }],
    [{ pezzo: 'guscio', faccia: '-x', tipo: 'incastro' }]));
  const p = r.pezzi[0], sottile = r.avvisi.find((a) => a.includes('spessore più sottile'));
  caso('Piastra curva sottile: converge, con il tempo e l\'avviso dello spessore', r.convergito && p.sforzo_max_MPa > 0 && Number.isFinite(p.sforzo_max_MPa) && !!sottile,
    `${r.voxel} voxel di ${f(r.h_mm, 3)} mm (griglia ${r.nx}×${r.ny}×${r.nz}), ${r.iterazioni} iterazioni, ${f(r.tempo_s)} s ` +
    `(voxel ${f(r.tempi.voxel_s)}, risolutore ${f(r.tempi.risolutore_s)}, sforzi ${f(r.tempi.sforzi_s)}); massimo ${f(p.sforzo_max_MPa, 1)} MPa, ` +
    `spostamento ${f(r.spostamento_max_mm, 4)} mm; avviso: ${sottile}`);
  const t = analizza(trave('acciaio-s235', { voxel_max: 20000, tempo_max_s: 0.001 }));
  const avviso = t.avvisi.find((a) => a.includes('tempo massimo'));
  caso('Tempo massimo: si ferma non convergito, con un avviso, ma con numeri già usabili', !t.convergito && !!avviso && t.iterazioni > 0 && t.pezzi[0].sforzo_max_MPa > 0,
    `${t.iterazioni} iterazioni invece di ${rTrave.iterazioni}; spostamento ${f(pct(t.spostamento_max_mm, rTrave.spostamento_max_mm))}% dal convergito; avviso: ${avviso}`);
}

// ------------------------------------------------------------ 6. il worker
{
  const l = trave('acciaio-s235', { voxel_max: 8000 });
  const d = analizza(l), w = await calcolaInWorker(l, { timeout_s: 30 });
  const uguale = w.vm instanceof Float32Array && w.voxel_pezzo instanceof Uint16Array && w.vm.every((v, i) => v === d.vm[i]) &&
    w.voxel_pezzo.every((v, i) => v === d.voxel_pezzo[i]) && JSON.stringify({ ...w, vm: 0, voxel_pezzo: 0, tempo_s: 0, tempi: 0 }) === JSON.stringify({ ...d, vm: 0, voxel_pezzo: 0, tempo_s: 0, tempi: 0 });
  caso('Worker: stesso risultato della chiamata diretta', uguale, `${w.vm.length} celle uguali, ${w.iterazioni} iterazioni, ${f(w.tempo_s)} s nel worker`);

  const grande = trave('acciaio-s235', { voxel_max: 400000 }); // da solo durerebbe decine di secondi
  const t0 = performance.now();
  const e = await calcolaInWorker(grande, { timeout_s: 0.5 }).then(() => null, (x) => x);
  const dt = (performance.now() - t0) / 1000;
  const c0 = process.cpuUsage(); // dopo il timeout il processo deve stare fermo: un worker vivo consumerebbe CPU
  await dormi(1000);
  const cpu = process.cpuUsage(c0), cpuS = (cpu.user + cpu.system) / 1e6;
  caso('Worker: il timeout lo ferma davvero', e instanceof Error && e.message.includes('fermato') && dt < 1.5 && cpuS < 0.2,
    `rifiutato dopo ${f(dt)} s (${e && e.message}); CPU del processo nel secondo dopo: ${f(cpuS, 3)} s`);

  const t1 = performance.now();
  const vecchio = calcolaInWorker(grande, { timeout_s: 60 }).then(() => null, (x) => x);
  await dormi(200);
  const nuovo = calcolaInWorker(l, { timeout_s: 30 });
  const [ev, rn] = await Promise.all([vecchio, nuovo]);
  const dt1 = (performance.now() - t1) / 1000;
  caso('Worker: una chiamata nuova termina quella vecchia', ev instanceof Error && ev.message.includes('interrotto') && rn.vm.every((v, i) => v === d.vm[i]) && dt1 < 5,
    `il vecchio: ${ev && ev.message}; il nuovo ha lo stesso risultato della chiamata diretta, tutto in ${f(dt1)} s`);

  const ee = await calcolaInWorker({ ...l, vincoli: [] }, { timeout_s: 30 }).then(() => null, (x) => x);
  caso('Worker: un errore torna come Error con il messaggio in italiano', ee instanceof Error && ee.message.includes('manca un incastro'), ee ? ee.message : 'nessun errore');
}

// ------------------------------------------------------------ 7. tempi
console.log('\nTempi della trave a tre dimensioni (Node, un processo, multigriglia, tolleranza 1e-6):');
console.log('voxel_max | voxel  | voxel di | iter | totale | voxel e facce | risolutore | sforzi | freccia | vm a metà');
for (const vm of [5000, 20000, 40000]) {
  const r = vm === 40000 ? rTrave : analizza(trave('acciaio-s235', { voxel_max: vm }));
  console.log(`${String(vm).padStart(9)} | ${String(r.voxel).padStart(6)} | ${f(r.h_mm, 3)} mm | ${String(r.iterazioni).padStart(4)} | ${f(r.tempo_s).padStart(4)} s | ` +
    `${f(r.tempi.voxel_s).padStart(11)} s | ${f(r.tempi.risolutore_s).padStart(8)} s | ${f(r.tempi.sforzi_s).padStart(4)} s | ${f(pct(r.spostamento_max_mm, FRECCIA)).padStart(6)}% | ${f(pct(vmMeta(r), SIGMA_META)).padStart(7)}%`);
}

console.log(falliti ? `\n${falliti} casi FALLITI` : '\nTutti i casi PASS');
process.exitCode = falliti ? 1 : 0;
