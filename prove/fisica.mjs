// fisica.mjs — le molle dell'HUD (public/fisica.js), senza browser: un secondo.
//   node prove/fisica.mjs
// Controlla che la forma esatta coincida con un'integrazione a passi minuscoli, che il 2% arrivi davvero dopo ts,
// che il rimbalzo sia quello dichiarato, che un passo lungo (fotogramma perso) non la faccia esplodere e che la curva CSS
// parta da 0, arrivi a 1 e duri quanto dice.
import { molla, curvaCSS, MOTO } from '../public/fisica.js';

let falliti = 0, controlli = 0;
const controlla = (ok, nome, dettagli = '') => { controlli++; if (!ok) falliti++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`); };

for (const [nome, tipo] of Object.entries(MOTO)) {
  // 1. forma esatta contro Eulero semi-implicito a 1 µs
  const w = tipo.zeta < 1 ? 4 / (tipo.zeta * tipo.ts) : 5.83 / tipo.ts;
  const m = molla(0, tipo).verso(1);
  let x = 0, v = 0, peggio = 0;
  for (let k = 1; k <= 60; k++) {
    m.passo(1 / 120);
    for (let i = 0; i < 8333; i++) { v += (-2 * tipo.zeta * w * v - w * w * (x - 1)) * 1e-6; x += v * 1e-6; }
    peggio = Math.max(peggio, Math.abs(m.x - x));
  }
  controlla(peggio < 2e-3, `${nome}: la forma esatta segue l'equazione`, `scarto massimo ${peggio.toExponential(1)}`);

  // 2. assestamento al 2%: l'ultima volta che |x − 1| supera 0,02
  const s = molla(0, tipo).verso(1);
  let ultimo = 0, max = 0;
  for (let t = 0; t < 2; t += 0.001) { s.passo(0.001); if (Math.abs(s.x - 1) > 0.02) ultimo = t + 0.001; max = Math.max(max, s.x); }
  controlla(ultimo <= tipo.ts * 1.05 && ultimo >= tipo.ts * 0.6, `${nome}: al 2% entro ts = ${tipo.ts} s`, `${ultimo.toFixed(3)} s`);
  const atteso = tipo.zeta < 1 ? Math.exp(-Math.PI * tipo.zeta / Math.sqrt(1 - tipo.zeta ** 2)) : 0;
  controlla(Math.abs(max - 1 - atteso) < 0.002, `${nome}: rimbalzo ${(atteso * 100).toFixed(1)}%`, `${((max - 1) * 100).toFixed(2)}%`);

  // 3. un passo da mezzo secondo non esplode, e arriva dove arriverebbero 500 passi da 1 ms
  const a = molla(0, tipo).verso(1), b = molla(0, tipo).verso(1);
  a.passo(0.5); for (let i = 0; i < 500; i++) b.passo(0.001);
  // 1e-4: sotto quella soglia la molla si ferma sulla meta
  controlla(Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.v - b.v) < 1e-3, `${nome}: un fotogramma lungo vale quanto tanti corti`, `${a.x.toFixed(6)} contro ${b.x.toFixed(6)}`);

  // 4. cambiare meta a metà corsa non fa saltare la posizione
  const c = molla(0, tipo).verso(1);
  for (let i = 0; i < 80; i++) c.passo(0.001);
  const prima = c.x; c.verso(0); c.passo(1e-4);
  controlla(Math.abs(c.x - prima) < 0.01, `${nome}: cambiare meta tiene posizione e velocità`, `${prima.toFixed(4)} → ${c.x.toFixed(4)}`);

  // 5. la curva CSS
  const cv = curvaCSS(tipo), punti = cv.linear.slice(7, -1).split(', ').map(Number);
  controlla(punti[0] === 0 && punti[punti.length - 1] === 1 && cv.ms > tipo.ts * 1000 && cv.ms < tipo.ts * 2200,
    `${nome}: la curva CSS va da 0 a 1 in ${cv.ms} ms`, `${punti.length} punti, massimo ${Math.max(...punti)}`);
}
// 6. le armoniche sferiche della goccia (nucleo.js): ortonormali sulla sfera, cioè ∫ Y_i·Y_j = δ_ij (40.000 punti di Fibonacci)
{
  const { armoniche } = await import('../public/nucleo.js');
  const N = 40000, M = 32, G = new Float64Array(M * M), y = new Float64Array(M), ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const yy = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - yy * yy), th = ga * i;
    armoniche(Math.cos(th) * r, yy, Math.sin(th) * r, y);
    for (let a = 0; a < M; a++) for (let b = a; b < M; b++) G[a * M + b] += y[a] * y[b];
  }
  let diag = 0, fuori = 0;
  for (let a = 0; a < M; a++) for (let b = a; b < M; b++) { const v = G[a * M + b] * 4 * Math.PI / N; if (a === b) diag = Math.max(diag, Math.abs(v - 1)); else fuori = Math.max(fuori, Math.abs(v)); }
  controlla(diag < 1e-3 && fuori < 1e-3, 'armoniche della goccia ortonormali (l = 2..5, 32 modi)', `diagonale ±${diag.toExponential(1)}, fuori ${fuori.toExponential(1)}`);
}
console.log(`\n${controlli - falliti} su ${controlli}`);
process.exit(falliti ? 1 : 0);
