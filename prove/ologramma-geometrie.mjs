// Prova di public/ologramma/geometrie.js in Node: le mesh three.js devono essere lo stesso solido di forme.js.
// Per ogni forma: punti a caso, metà nell'ingombro allargato del 10% e metà vicino alla superficie della mesh
// (spostati lungo la normale fino a un quarto della misura più piccola: i pezzi sottili come i cavi riempiono
// poco il loro ingombro), «dentro» secondo forme.dentroLocale contro
// «dentro» secondo la mesh (parità dei raggi, maggioranza su 3 direzioni). Si esclude una fascia sottile
// vicino alla superficie, dove le facce piane tagliano le curve: un punto è nella fascia se spostandolo di
// δ lungo un asse cambia risposta. Poi il volume con segno della mesh (chiusa e con le facce verso fuori)
// contro il volume esatto, e le normali concordi con il verso dei triangoli. Infine la matrice 'XYZ'.
// Uso: node prove/ologramma-geometrie.mjs   (codice 0 solo se passa tutto)
import * as THREE from 'three';
import { normalizzaPezzo, dentroLocale, volume, matrice, ingombroLocale } from '../public/ologramma/forme.js';
import { geometria, matricePezzo, volumeMesh, SEGMENTI } from '../public/ologramma/geometrie.js';

const PUNTI = 3000, ACCORDO_MIN = 0.99, VOLUME_MAX = 0.015, FASCIA = 0.02; // δ = 2% della misura più piccola dell'ingombro
let fallite = 0;
const esito = (ok, testo) => { if (!ok) fallite++; console.log(`${ok ? 'PASS' : 'FAIL'} ${testo}`); };

function rng(seed) { // mulberry32: le stesse prove a ogni giro
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Triangoli della mesh proiettati sul piano perpendicolare a d, in una griglia: un raggio prova solo la sua cella.
function preparaRaggi(g, d) {
  const p = g.attributes.position, idx = g.index, n = (idx ? idx.count : p.count) / 3;
  const u = new THREE.Vector3(1, 0, 0).cross(d); if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(d); u.normalize();
  const v = new THREE.Vector3().crossVectors(d, u);
  const T = new Float64Array(9 * n), B = new Float64Array(4 * n);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < n; k++) {
    let bu0 = Infinity, bu1 = -Infinity, bv0 = Infinity, bv1 = -Infinity;
    for (let c = 0; c < 3; c++) {
      const i = idx ? idx.getX(3 * k + c) : 3 * k + c, x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      T[9 * k + 3 * c] = x; T[9 * k + 3 * c + 1] = y; T[9 * k + 3 * c + 2] = z;
      const pu = x * u.x + y * u.y + z * u.z, pv = x * v.x + y * v.y + z * v.z;
      bu0 = Math.min(bu0, pu); bu1 = Math.max(bu1, pu); bv0 = Math.min(bv0, pv); bv1 = Math.max(bv1, pv);
    }
    B.set([bu0, bu1, bv0, bv1], 4 * k);
    u0 = Math.min(u0, bu0); u1 = Math.max(u1, bu1); v0 = Math.min(v0, bv0); v1 = Math.max(v1, bv1);
  }
  const G = Math.max(8, Math.min(256, Math.round(Math.sqrt(n)))), du = (u1 - u0) / G || 1, dv = (v1 - v0) / G || 1;
  const celle = Array.from({ length: G * G }, () => []);
  const cella = (a, s0, ds) => Math.min(G - 1, Math.max(0, Math.floor((a - s0) / ds)));
  for (let k = 0; k < n; k++) {
    for (let i = cella(B[4 * k], u0, du); i <= cella(B[4 * k + 1], u0, du); i++) for (let j = cella(B[4 * k + 2], v0, dv); j <= cella(B[4 * k + 3], v0, dv); j++) celle[i + G * j].push(k);
  }
  return { d, u, v, T, celle, G, u0, du, v0, dv, cella };
}

function dentroMesh(R, x, y, z) { // Möller–Trumbore lungo +d, conta gli attraversamenti
  const { d, T } = R, pu = x * R.u.x + y * R.u.y + z * R.u.z, pv = x * R.v.x + y * R.v.y + z * R.v.z;
  const lista = R.celle[R.cella(pu, R.u0, R.du) + R.G * R.cella(pv, R.v0, R.dv)];
  let conta = 0;
  for (const k of lista) {
    const o = 9 * k, ax = T[o], ay = T[o + 1], az = T[o + 2];
    const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az, e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
    const hx = d.y * e2z - d.z * e2y, hy = d.z * e2x - d.x * e2z, hz = d.x * e2y - d.y * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(a) < 1e-14) continue;
    const f = 1 / a, sx = x - ax, sy = y - ay, sz = z - az, s = f * (sx * hx + sy * hy + sz * hz);
    if (s < 0 || s > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, t = f * (d.x * qx + d.y * qy + d.z * qz);
    if (t < 0 || s + t > 1) continue;
    if (f * (e2x * qx + e2y * qy + e2z * qz) > 0) conta++;
  }
  return (conta & 1) === 1;
}

// Normali dei vertici concordi con il verso dei triangoli (solo triangoli non degeneri).
function normaliCoerenti(g) {
  const p = g.attributes.position, nn = g.attributes.normal, idx = g.index, n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Vector3();
  let buoni = 0, tot = 0;
  g.computeBoundingSphere();
  const minimo = 1e-10 * g.boundingSphere.radius ** 2;
  for (let k = 0; k < n; k += 3) {
    const i = [0, 1, 2].map((q) => (idx ? idx.getX(k + q) : k + q));
    a.fromBufferAttribute(p, i[0]); b.fromBufferAttribute(p, i[1]).sub(a); c.fromBufferAttribute(p, i[2]).sub(a);
    b.cross(c);
    if (b.length() < minimo) continue;
    s.set(0, 0, 0); for (const q of i) s.add(m.fromBufferAttribute(nn, q));
    tot++; if (b.dot(s) > 0) buoni++;
  }
  return buoni / tot;
}

// Un punto a caso sulla superficie della mesh, scelto in proporzione all'area dei triangoli, spostato lungo la normale.
function campionatore(g, caso) {
  const p = g.attributes.position, idx = g.index, n = (idx ? idx.count : p.count) / 3, cum = new Float64Array(n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const tri = (k) => { for (const [v, q] of [[a, 0], [b, 1], [c, 2]]) v.fromBufferAttribute(p, idx ? idx.getX(3 * k + q) : 3 * k + q); };
  let tot = 0;
  for (let k = 0; k < n; k++) { tri(k); tot += b.clone().sub(a).cross(c.clone().sub(a)).length(); cum[k] = tot; }
  return (spessore) => {
    const x = caso() * tot;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
    tri(lo);
    let u = caso(), v = caso(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const nn = b.clone().sub(a).cross(c.clone().sub(a)).normalize(), s = (2 * caso() - 1) * spessore;
    return [0, 1, 2].map((k) => a.getComponent(k) + u * (b.getComponent(k) - a.getComponent(k)) + v * (c.getComponent(k) - a.getComponent(k)) + s * nn.getComponent(k));
  };
}

const P = (p) => { const r = normalizzaPezzo(p); if (!r.pezzo) throw new Error(`${p.id}: ${r.errori.join('; ')}`); return r.pezzo; };
const casi = [
  P({ id: 'scatola', forma: 'scatola', misure: { x: 40, y: 20, z: 10 } }),
  P({ id: 'cilindro', forma: 'cilindro', misure: { r: 15, h: 40 } }),
  P({ id: 'tubo', forma: 'tubo', misure: { r: 20, r_interno: 14, h: 30 } }),
  P({ id: 'sfera', forma: 'sfera', misure: { r: 12 } }),
  P({ id: 'cono-punta', forma: 'cono', misure: { r: 15, h: 30 } }),
  P({ id: 'cono-tronco', forma: 'cono', misure: { r: 10, r_cima: 6, h: 25 } }),
  P({ id: 'toro', forma: 'toro', misure: { R: 20, r: 5 } }),
  P({ id: 'piastra-piana', forma: 'piastra', misure: { x: 60, z: 30, spessore: 3 } }),
  P({ id: 'piastra-su', forma: 'piastra', misure: { x: 80, z: 20, spessore: 4, raggio: 40 } }),
  P({ id: 'piastra-giu-286', forma: 'piastra', misure: { x: 150, z: 12, spessore: 5, raggio: -30 } }),
  P({ id: 'piastra-360', forma: 'piastra', misure: { x: 2 * Math.PI * 25, z: 10, spessore: 4, raggio: 25 } }),
  P({ id: 'estrusione-fori', forma: 'estrusione', misure: { profilo: [[0, 0], [60, 0], [60, 10], [12, 10], [12, 50], [0, 50]], profondita: 20, fori: [[[3, 30], [9, 30], [9, 40], [3, 40]]], fori_tondi: [{ x: 40, y: 5, r: 3 }, { x: 6, y: 18, r: 2.5 }] } }),
  P({ id: 'estrusione-oraria', forma: 'estrusione', misure: { profilo: [[0, 0], [0, 30], [25, 30], [40, 0]], profondita: 8, fori_tondi: [{ x: 15, y: 12, r: 5 }] } }),
  P({ id: 'rivoluzione-vaso', forma: 'rivoluzione', misure: { profilo: [[0, 0], [10, 0], [12, 5], [8, 15], [9, 25], [0, 25]] } }),
  P({ id: 'rivoluzione-aperta', forma: 'rivoluzione', misure: { profilo: [[6, 30], [14, 20], [14, 4], [8, 0]] } }),
  P({ id: 'ingranaggio', forma: 'ingranaggio', misure: { denti: 20, modulo: 2, spessore: 6, foro: 4 } }),
  P({ id: 'ingranaggio-6', forma: 'ingranaggio', misure: { denti: 6, modulo: 5, spessore: 8 } }),
  P({ id: 'cavo-2punti', forma: 'cavo', misure: { punti: [[0, 0, 0], [80, 10, -5]], r: 3 } }),
  P({ id: 'cavo-curvo', forma: 'cavo', misure: { punti: [[0, 0, 0], [30, 10, 0], [50, 40, 10], [60, 80, 0], [20, 90, -20]], r: 3 } }),
];

const t0 = performance.now();
const caso = rng(20261106);
const direzioni = [[0.577, 0.613, 0.539], [-0.42, 0.81, -0.41], [0.73, -0.29, -0.62]].map((v) => new THREE.Vector3(...v).normalize());
for (const pezzo of casi) {
  const t1 = performance.now(), g = geometria(pezzo);
  const R = direzioni.map((d) => preparaRaggi(g, d));
  const b = ingombroLocale(pezzo), lato = [0, 1, 2].map((c) => b.max[c] - b.min[c]);
  const delta = FASCIA * Math.min(...lato), vicino = campionatore(g, caso);
  let fuoriFascia = 0, accordi = 0, accordiTutti = 0, dentro = 0;
  for (let i = 0; i < PUNTI; i++) {
    const q = i % 2 ? vicino(0.25 * Math.min(...lato)) : [0, 1, 2].map((c) => b.min[c] - 0.05 * lato[c] + caso() * 1.1 * lato[c]);
    const vero = dentroLocale(pezzo, q[0], q[1], q[2]);
    const voti = R.reduce((s, r) => s + (dentroMesh(r, q[0], q[1], q[2]) ? 1 : 0), 0), mesh = voti >= 2;
    if (vero) dentro++;
    if (vero === mesh) accordiTutti++;
    let fascia = false;
    for (let c = 0; c < 3 && !fascia; c++) for (const s of [-1, 1]) {
      const z = [...q]; z[c] += s * delta;
      if (dentroLocale(pezzo, z[0], z[1], z[2]) !== vero) { fascia = true; break; }
    }
    if (fascia) continue;
    fuoriFascia++;
    if (vero === mesh) accordi++;
  }
  const acc = accordi / fuoriFascia, vm = volumeMesh(g), ve = volume(pezzo), errV = vm / ve - 1, nc = normaliCoerenti(g);
  const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
  esito(acc >= ACCORDO_MIN && dentro > 0.1 * PUNTI && PUNTI - dentro > 0.1 * PUNTI && fuoriFascia > 0.5 * PUNTI,
    `${pezzo.id}: accordo ${(100 * acc).toFixed(2)}% su ${fuoriFascia} punti fuori dalla fascia di ${delta.toFixed(3)} mm (con la fascia ${(100 * accordiTutti / PUNTI).toFixed(2)}%, dentro ${dentro}), ${tri} triangoli, ${(performance.now() - t1).toFixed(0)} ms`);
  esito(Math.abs(errV) <= VOLUME_MAX, `${pezzo.id}: volume della mesh ${vm.toFixed(1)} contro ${ve.toFixed(1)} mm³ (${(100 * errV).toFixed(3)}%), chiusa e verso fuori`);
  esito(nc >= 0.999, `${pezzo.id}: normali concordi con il verso dei triangoli nel ${(100 * nc).toFixed(2)}%`);
  g.dispose();
}

// La posa: forme.matrice, matricePezzo e un Object3D con rotation 'XYZ' (quello che usa scena.js) coincidono.
let scarto = 0;
const o = new THREE.Object3D();
for (let i = 0; i < 200; i++) {
  const pezzo = { posizione: [0, 1, 2].map(() => (caso() - 0.5) * 2000), rotazione: [0, 1, 2].map(() => (caso() - 0.5) * 720) };
  const a = matrice(pezzo), b = matricePezzo(pezzo).elements;
  o.position.fromArray(pezzo.posizione); o.rotation.set(...pezzo.rotazione.map((g) => g * THREE.MathUtils.DEG2RAD), 'XYZ'); o.updateMatrix();
  for (let k = 0; k < 16; k++) scarto = Math.max(scarto, Math.abs(a[k] - b[k]), Math.abs(a[k] - o.matrix.elements[k]));
}
esito(scarto < 1e-9, `posa: forme.matrice, matricePezzo e Object3D 'XYZ' coincidono su 200 pose (scarto massimo ${scarto.toExponential(2)})`);

console.log(`segmenti: ${JSON.stringify(SEGMENTI)}; ${casi.length} forme in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(fallite ? `${fallite} FAIL` : 'tutto PASS');
process.exit(fallite ? 1 : 0);
