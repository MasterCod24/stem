// O.S.C.A.R.: il nucleo. Ogni forma è calcolata e ogni moto segue un'equazione: niente decorazione inventata.
//   - La goccia: 24.000 particelle su una sfera che vibra coi modi di Rayleigh di una goccia (armoniche sferiche, l = 2..5).
//     Ogni modo è un oscillatore smorzato: a riposo lo muove il rumore termico, quando O.S.C.A.R. ascolta o parla lo spettro
//     vero dell'audio, quando pensa una spinta che fa girare la goccia allungata. Il critico la fa tremare.
//   - Il campo: le linee di campo di un dipolo magnetico al centro e di sei regioni attive vicino alla superficie, tracciate
//     una volta (Runge-Kutta). Ruotano con la goccia, come un flusso congelato nel fluido; quando pensa ci corrono le cariche.
//   - Gli anelli, dall'interno: la linea di contatto; lo spettro vero (64 bande, basse in basso, alte in alto, a specchio);
//     una corda chiusa che segue l'equazione delle onde (la voce la eccita dall'alto, il microfono dal basso, il pensiero
//     con impulsi che girano e interferiscono); una scala graduata con l'inerzia di un giroscopio; l'anello esterno.
//   - L'avvio: una nube che ruota collassa nella goccia, ogni particella su un oscillatore smorzato (spirale vera); poi
//     un'onda d'urto disegna gli anelli. Pronto in 1,45 s.
// Contratto con oscar.js: TIMING e createScene(canvas, S) → { frame, anchor, assembling, renderer, strato }.
// S.spettro (facoltativo): 64 bande del microfono o della voce, byte da getByteFrequencyData.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Tempi dell'avvio (secondi): la goccia è formata, l'onda d'urto parte, tutto pronto. I suoni ci sono agganciati.
export const TIMING = { formEnd: 0.85, reveal: 0.9, ready: 1.45 };

// Unità: altezza dello schermo = 1, origine al centro, y in su. Il nucleo vive in coordinate locali col centro in 0,0.
const CY = 0.11;   // centro del nucleo: 39% dall'alto
const RS = 0.15;   // raggio della goccia
const RO = 0.33;   // anello più esterno: lì oscar.js appoggia i dati
const R = { base: 0.166, spe0: 0.176, spe1: 0.224, corda: 0.252, scala: 0.274, out: RO };
const RING_IN = 0.158, RING_OUT = 0.346;
const C_URTO = 0.9;          // velocità dell'onda d'urto dell'avvio (unità/s): attraversa gli anelli in 0,2 s
const LINEE = 320, PASSI = 140, LINEA_W = 0.8;
const NP = 24000;            // particelle della goccia
const NC = 256;              // nodi della corda
const NB = 64;               // bande dello spettro

const f4 = (x) => x.toFixed(4);
const GLSL_R = Object.entries(R).map(([k, v]) => `const float R_${k.toUpperCase()} = ${f4(v)};`).join('\n');
const GLSL_COMMON = /* glsl */`
  const float TAU = 6.28318530718;
  float sq(float x) { return x * x; }
`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const unit = (rnd) => { const z = 2 * rnd() - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z); return new THREE.Vector3(s * Math.cos(a), s * Math.sin(a), z); };
const clamp01 = (x) => Math.min(1, Math.max(0, x || 0));

// ---------- Armoniche sferiche reali ortonormali, l = 2..5: 32 modi. Asse polare y ----------
const L_MIN = 2, L_MAX = 5;
const fatt = (n) => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const MODI = [];
for (let l = L_MIN; l <= L_MAX; l++) for (let m = -l; m <= l; m++) {
  const am = Math.abs(m);
  MODI.push({ l, m, K: Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (fatt(l - am) / fatt(l + am))) * (m ? Math.SQRT2 : 1) });
}
const NM = MODI.length; // 32
const P = new Float64Array((L_MAX + 1) * (L_MAX + 1));
export function armoniche(x, y, z, out, o = 0) { // esportata per prove/fisica.mjs
  const ct = y, st = Math.sqrt(Math.max(0, 1 - y * y)), ph = Math.atan2(x, z);
  for (let m = 0; m <= L_MAX; m++) { // Legendre associati P_l^m, con la ricorrenza in l
    let pmm = 1; for (let i = 1; i <= m; i++) pmm *= -(2 * i - 1) * st;
    P[m * 6 + m] = pmm;
    if (m < L_MAX) P[m * 6 + m + 1] = ct * (2 * m + 1) * pmm;
    for (let l = m + 2; l <= L_MAX; l++) P[m * 6 + l] = ((2 * l - 1) * ct * P[m * 6 + l - 1] - (l + m - 1) * P[m * 6 + l - 2]) / (l - m);
  }
  for (let k = 0; k < NM; k++) {
    const { l, m, K } = MODI[k], am = Math.abs(m);
    out[o + k] = K * P[am * 6 + l] * (m > 0 ? Math.cos(m * ph) : m < 0 ? Math.sin(am * ph) : 1);
  }
  return out;
}

// ---------- La goccia: Fibonacci con un po' di disordine, coi suoi 32 valori di armonica e la partenza nella nube ----------
// Formazione: ogni particella è un oscillatore smorzato (ζ = 0,55) che parte da fermo in una nube larga 2,5–4 raggi e
// ruotante attorno a y. Il tempo in cui il suo inviluppo scende al 2% è il suo «arrivo»: la percentuale di ASSEMBLING è la
// frazione di particelle arrivate, non una curva scelta.
const ZETA_F = 0.55;
function buildShell(rnd, n) {
  const pos = new Float32Array(n * 3), ar = new Float32Array(n * 4), p0 = new Float32Array(n * 3), v0 = new Float32Array(n * 3);
  const Y = Array.from({ length: 8 }, () => new Float32Array(n * 4)), y = new Float64Array(NM);
  const arrivi = new Float32Array(n);
  const ga = Math.PI * (3 - Math.sqrt(5)), v = new THREE.Vector3(), asse = new THREE.Vector3(0.15, 1, 0.05).normalize();
  const a = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const yy = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - yy * yy), th = ga * i;
    v.set(Math.cos(th) * rr, yy, Math.sin(th) * rr).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.03)).normalize();
    pos.set([v.x, v.y, v.z], i * 3);
    armoniche(v.x, v.y, v.z, y);
    for (let k = 0; k < NM; k++) Y[k >> 2][i * 4 + (k & 3)] = y[k];
    // arrivo fra 0,32 e 0,85 s, fitto all'inizio; ritardo di partenza fino a 0,08 s
    const rit = 0.08 * rnd(), arr = 0.32 + 0.53 * Math.pow(rnd(), 1.6);
    const w = Math.log(50) / (ZETA_F * (arr - rit));
    arrivi[i] = arr;
    ar.set([w, rit, rnd(), rnd()], i * 4);
    // partenza nella nube, in coordinate del mondo (unità di schermo), con una velocità che gira attorno all'asse
    a.copy(unit(rnd)).multiplyScalar(RS * (2.5 + 1.5 * rnd()));
    p0.set([a.x, a.y * 0.8, a.z], i * 3);
    t.crossVectors(asse, a).multiplyScalar(w * (0.45 + 0.25 * rnd()));
    v0.set([t.x, t.y, t.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(ar, 4));
  g.setAttribute('aP0', new THREE.BufferAttribute(p0, 3));
  g.setAttribute('aV0', new THREE.BufferAttribute(v0, 3));
  Y.forEach((arr, k) => g.setAttribute(`aY${k}`, new THREE.BufferAttribute(arr, 4)));
  arrivi.sort();
  return { g, arrivi };
}

// ---------- Il campo: linee di campo magnetico, tracciate una volta con Runge-Kutta e disegnate come nastri sottili ----------
// Un dipolo al centro, inclinato, e sei piccoli dipoli tangenti a 0,62 del raggio (regioni attive: archi vicino al bordo).
// Il dipolo ammorbidito (ε) tiene finito il campo al centro. Colore dall'intensità: chiaro dove il campo è forte.
function buildCampo(rnd, F, N) {
  const dip = [{ p: [0, 0, 0], m: new THREE.Vector3(0.18, 1, 0.12).normalize().toArray() }];
  for (let i = 0; i < 6; i++) {
    const d = unit(rnd), tg = unit(rnd); tg.addScaledVector(d, -tg.dot(d)).normalize().multiplyScalar(0.05 + 0.05 * rnd());
    dip.push({ p: d.multiplyScalar(0.62).toArray(), m: tg.toArray() });
  }
  const EPS2 = 0.05 * 0.05, RMAX = 0.985, H = 0.017;
  const B = (x, y, z, o) => {
    let bx = 0, by = 0, bz = 0;
    for (const { p, m } of dip) {
      const dx = x - p[0], dy = y - p[1], dz = z - p[2], r2 = dx * dx + dy * dy + dz * dz + EPS2, r = Math.sqrt(r2), i3 = 1 / (r2 * r);
      const nx = dx / r, ny = dy / r, nz = dz / r, mn = m[0] * nx + m[1] * ny + m[2] * nz;
      bx += (3 * nx * mn - m[0]) * i3; by += (3 * ny * mn - m[1]) * i3; bz += (3 * nz * mn - m[2]) * i3;
    }
    o[0] = bx; o[1] = by; o[2] = bz; return o;
  };
  const b = [0, 0, 0], k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0];
  const dir = (x, y, z, s, o) => { B(x, y, z, o); const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] *= s / l; o[1] *= s / l; o[2] *= s / l; return o; };
  function traccia(x, y, z, s, max) { // passi di lunghezza H lungo ±B, finché resta dentro la goccia
    const pts = [];
    for (let i = 0; i < max; i++) {
      dir(x, y, z, s, k1);
      dir(x + k1[0] * H / 2, y + k1[1] * H / 2, z + k1[2] * H / 2, s, k2);
      dir(x + k2[0] * H / 2, y + k2[1] * H / 2, z + k2[2] * H / 2, s, k3);
      dir(x + k3[0] * H, y + k3[1] * H, z + k3[2] * H, s, k4);
      x += (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * H / 6; y += (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * H / 6; z += (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * H / 6;
      if (x * x + y * y + z * z > RMAX * RMAX) break;
      pts.push([x, y, z]);
    }
    return pts;
  }
  const nv = F * (N + 1) * 2;
  const pos = new Float32Array(nv * 3), q = new Float32Array(nv * 3), s4 = new Float32Array(nv * 4), c3 = new Float32Array(nv * 3);
  const idx = new Uint32Array(F * N * 6);
  const cDebole = new THREE.Color(0x2a7dff), cMedio = new THREE.Color(0x29e3ff), cForte = new THREE.Color(0xbff4ff), cAcqua = new THREE.Color(0x2bffc8), col = new THREE.Color();
  let vi = 0, ii = 0, fatte = 0, tentativi = 0;
  while (fatte < F && tentativi < F * 20) {
    tentativi++;
    const p = unit(rnd).multiplyScalar(0.18 + 0.72 * Math.pow(rnd(), 0.8));
    const indietro = traccia(p.x, p.y, p.z, -1, N >> 1), avanti = traccia(p.x, p.y, p.z, 1, N >> 1);
    const tutti = [...indietro.reverse(), [p.x, p.y, p.z], ...avanti];
    if (tutti.length < N * 0.35) continue; // troppo corta: un pezzo di linea che esce subito
    const seme = indietro.length / (tutti.length - 1), r1 = rnd(), acqua = rnd() < 0.18;
    // ricampionata a N+1 punti uguali lungo la linea
    const pts = [];
    for (let j = 0; j <= N; j++) {
      const u = (j / N) * (tutti.length - 1), i0 = Math.min(tutti.length - 2, Math.floor(u)), f = u - i0, A = tutti[i0], C = tutti[i0 + 1];
      pts.push(new THREE.Vector3(A[0] + (C[0] - A[0]) * f, A[1] + (C[1] - A[1]) * f, A[2] + (C[2] - A[2]) * f));
    }
    const base = vi;
    for (let j = 0; j <= N; j++) {
      const a = pts[j], c = j < N ? pts[j + 1] : pts[j].clone().multiplyScalar(2).sub(pts[j - 1]);
      B(a.x, a.y, a.z, b);
      const forza = clamp01((Math.log10(Math.hypot(b[0], b[1], b[2])) - 0.1) / 2.2); // |B| da circa 1,3 a 200
      col.copy(cDebole).lerp(cMedio, Math.min(1, forza * 1.6)).lerp(cForte, Math.max(0, forza * 1.6 - 0.6) * 0.7);
      if (acqua) col.lerp(cAcqua, 0.55);
      for (const side of [-1, 1]) {
        pos.set([a.x, a.y, a.z], vi * 3); q.set([c.x, c.y, c.z], vi * 3);
        s4.set([side, j / N, seme, r1], vi * 4); c3.set([col.r, col.g, col.b], vi * 3);
        vi++;
      }
    }
    for (let j = 0; j < N; j++) { const o = base + 2 * j; idx.set([o, o + 2, o + 1, o + 1, o + 2, o + 3], ii); ii += 6; } // antiorari
    fatte++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aQ', new THREE.BufferAttribute(q, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(s4, 4));
  g.setAttribute('aC', new THREE.BufferAttribute(c3, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.setDrawRange(0, fatte * N * 6);
  return { g, linee: fatte };
}

// ---------- Shader ----------
const POINT_FRAG = /* glsl */`
  varying vec3 vC;
  void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * (1.0 - smoothstep(0.15, 0.5, d)), 1.0); }
`;

// La goccia. Spostamento radiale dr = Σ a_lm·Y_lm, velocità radiale vr = Σ ȧ_lm·Y_lm: dove la superficie si muove più in
// fretta la particella si schiarisce. Colore da quanto è di taglio: bordo verde acqua, poi ciano, blu, viola al centro.
const SHELL_VERT = /* glsl */`
  uniform float uT, uClock, uPR, uPtK, uRs, uListen, uThink, uSpeak, uAudio, uMic, uAl, uDens;
  uniform mat3 uRotS;
  uniform vec4 uA[8], uV[8];
  uniform vec3 cRim, cMid, cDeep, cIce, cAlarm;
  attribute vec4 aR, aY0, aY1, aY2, aY3, aY4, aY5, aY6, aY7;
  attribute vec3 aP0, aV0;
  varying vec3 vC;
  ${GLSL_COMMON}
  void main() {
    float dr = dot(aY0, uA[0]) + dot(aY1, uA[1]) + dot(aY2, uA[2]) + dot(aY3, uA[3]) + dot(aY4, uA[4]) + dot(aY5, uA[5]) + dot(aY6, uA[6]) + dot(aY7, uA[7]);
    float vr = dot(aY0, uV[0]) + dot(aY1, uV[1]) + dot(aY2, uV[2]) + dot(aY3, uV[3]) + dot(aY4, uV[4]) + dot(aY5, uV[5]) + dot(aY6, uV[6]) + dot(aY7, uV[7]);
    vec3 d = uRotS * position;
    vec3 home = d * uRs * (0.985 + 0.02 * aR.w) * (1.0 + dr);
    vec3 p = home;
    float rim = 1.0 - abs(d.z);
    float r2 = rim * rim, r4 = r2 * r2, r8 = r4 * r4;
    vec3 col = mix(cDeep, cMid, smoothstep(0.15, 0.7, rim));
    col = mix(col, cRim, smoothstep(0.6, 0.97, rim));
    col = mix(col, cAlarm, uAl * smoothstep(0.4, 0.9, rim));
    float moto = clamp(abs(vr) * 5.0, 0.0, 1.0);
    col = mix(col, cIce, 0.75 * moto);
    float front = 0.35 + 0.65 * smoothstep(-0.6, 0.6, d.z);
    float tw = 0.8 + 0.2 * sin(uClock * (0.7 + 2.2 * aR.z) + aR.w * 40.0);
    float gain = 1.0 + 0.45 * uListen + 1.4 * uMic + 0.5 * uSpeak * uAudio - 0.25 * uThink + 1.2 * moto;
    float a = (0.12 + 0.2 * r4 + 0.1 * r8) * front * tw * gain * uDens;
    float sz = 1.2 + 0.9 * aR.z;
    // formazione: oscillatore smorzato dalla nube (aP0, aV0) alla sua casa, in forma esatta
    float te = uT - aR.y;
    if (te < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); gl_PointSize = 0.0; return; }
    float w = aR.x, ka = ${f4(ZETA_F)} * w, wd = w * ${f4(Math.sqrt(1 - ZETA_F * ZETA_F))};
    float env = exp(-ka * te);
    if (env > 0.003) {
      vec3 A = aP0 - home, Bv = (aV0 + ka * A) / wd;
      p = home + env * (A * cos(wd * te) + Bv * sin(wd * te));
      float x = 1.0 - env;
      a = mix(0.35 * smoothstep(0.0, 0.12, te), a, x * x);
      col = mix(cIce, col, x);
      sz = mix(1.6 + 1.0 * aR.z, sz, x);
    }
    vC = col * a;
    gl_PointSize = sz * uPR * uPtK;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Linee di campo: nastri larghi uW px, che ruotano con la goccia. All'avvio si accendono dal seme verso le punte;
// quando pensa ci corrono le cariche, più fitte e veloci.
const CAMPO_VERT = /* glsl */`
  uniform float uT, uClock, uPxL, uW, uRs, uThink, uSpeak, uAudio, uAl, uGain, uCorr;
  uniform mat3 uRotS;
  uniform vec3 cAlarm, cIce;
  attribute vec3 aQ, aC; attribute vec4 aS;
  varying vec3 vC; varying float vV;
  ${GLSL_COMMON}
  void main() {
    float sc = uRs * (1.0 + 0.03 * uSpeak * uAudio);
    vec3 p = uRotS * position * sc, q = uRotS * aQ * sc;
    vec2 d = q.xy - p.xy; float L = length(d);
    d = L > 1e-7 ? d / L : vec2(1.0, 0.0);
    float hw = 0.5 * uW + 1.0;
    vec3 pos = p + vec3(vec2(-d.y, d.x) * (aS.x * hw * uPxL), 0.0);
    vV = aS.x * hw;
    float s = aS.y, seme = aS.z;
    // accensione: dal seme verso le due punte, 0,45 s a partire da 0,3 s
    float g = clamp((uT - 0.3 - 0.12 * aS.w) / 0.45, 0.0, 1.0);
    float dist = abs(s - seme) / max(seme, 1.0 - seme);
    float acceso = 1.0 - smoothstep(g - 0.05, g, dist);
    float punta = exp(-sq((dist - g) * 25.0)) * (1.0 - step(1.0, g));
    // cariche lungo il campo: la corrente uCorr sale col pensiero
    float ph = fract(s * 2.2 - uClock * uCorr * (0.6 + 0.8 * aS.w) + aS.w * 7.0);
    float carica = exp(-sq((ph - 0.5) * 18.0));
    float depth = 0.3 + 0.7 * smoothstep(-uRs, uRs, p.z);
    float ends = smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.95, 1.0, s));
    vec3 col = mix(aC, cAlarm, uAl * step(aS.w, 0.15));
    float a = (0.08 + 0.04 * uThink + 0.12 * uSpeak * uAudio) * depth * ends * acceso * uGain;
    vC = col * a + mix(col, cIce, 0.5) * (carica * (0.04 + 0.55 * uThink) + punta * 0.8) * depth * ends * acceso * uGain;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const CAMPO_FRAG = /* glsl */`
  uniform float uW;
  varying vec3 vC; varying float vV;
  void main() { gl_FragColor = vec4(vC * clamp(0.5 * uW + 0.5 - abs(vV), 0.0, 1.0), 1.0); }
`;

// Corpo della goccia: viola profondo, un alone appena fuori, e il cuore che si accende con la voce
const BODY_FRAG = /* glsl */`
  uniform float uRs, uPxL, uVis, uCore, uAudio, uSpeak, uThink, uListen, uMic, uAl, uClock;
  uniform vec3 cViolet, cMid, cRim, cIce, cCyan, cAlarm;
  varying vec2 vL;
  ${GLSL_COMMON}
  void main() {
    float r = length(vL) / uRs;
    float inside = 1.0 - smoothstep(0.93, 1.0, r);
    float rc1 = min(r, 1.0);
    float fres = 1.0 - sqrt(max(1.0 - rc1 * rc1, 0.0));
    vec3 rimC = mix(cRim, cAlarm, uAl);
    float lift = 1.0 + 0.6 * uListen + 1.2 * uMic;
    vec3 body = mix(cViolet * 0.3, cMid * 0.1, smoothstep(0.0, 0.35, fres));
    body = mix(body, rimC * 0.16, smoothstep(0.35, 1.0, fres));
    float v = uSpeak * uAudio;
    vec3 col = body * inside * lift * (1.0 + 1.3 * v);
    col += rimC * exp(-max(r - 1.0, 0.0) * 20.0) * (1.0 - inside) * 0.03 * lift;
    float rc = r / (0.14 + 0.28 * v + 0.03 * uThink);
    float beat = uCore * (0.07 + 0.03 * sin(uClock * 2.1) + 1.1 * v + 0.3 * uThink * (0.6 + 0.4 * sin(uClock * 9.0)));
    col += (cCyan * exp(-rc * rc * 2.0) * 0.35 + cIce * exp(-rc * rc * 12.0) * 0.9) * beat;
    gl_FragColor = vec4(col * uVis, 1.0);
  }
`;

// Anelli: un solo frammento sulla corona, che sceglie l'anello dal raggio. u = giri in senso orario con 0 in alto.
const RING_FRAG = /* glsl */`
  uniform float uPxL, uClock, uThink, uListen, uSpeak, uAl, uSmall, uScala;
  uniform vec4 uRev; uniform float uRevOut;
  uniform sampler2D uCorda, uSpettro;
  uniform vec3 cCyan, cBlue, cAqua, cIce, cAlarm;
  varying vec2 vL;
  ${GLSL_COMMON}
  ${GLSL_R}
  float cov(float d, float w) { return clamp(0.5 * w + 0.5 - abs(d), 0.0, 1.0) * min(w, 1.0); }
  float band(float r, float a, float b, float px) { return clamp((r - a) / px + 0.5, 0.0, 1.0) * clamp((b - r) / px + 0.5, 0.0, 1.0); }
  float arcm(float x, float len, float pu) { x = fract(x); return clamp(x * pu + 0.5, 0.0, 1.0) * clamp((len - x) * pu + 0.5, 0.0, 1.0); }
  // l'anello si disegna da u = 0 fino a p, mentre l'onda d'urto lo attraversa
  float revm(float u, float p, float pu) { return p >= 0.999 ? 1.0 : arcm(u, p, pu) * step(0.0005, p); }
  void main() {
    float r = length(vL);
    float px = uPxL;
    float u0 = 0.25 - atan(vL.y, vL.x) / TAU;
    float pu = TAU * r / px;
    vec3 tint = cCyan * (1.0 - 0.4 * uAl);
    vec3 col = vec3(0.0);
    if (r < R_SPE0 - 0.003) {
      // linea di contatto, appena fuori dalla goccia
      col += tint * cov((r - R_BASE) / px, 1.0) * 0.45 * revm(u0, uRev.x, pu);
    } else if (r < R_SPE1 + 0.006) {
      // spettro vero: 64 bande a specchio, le basse in basso e le alte in alto
      float dx = abs(fract(u0) - 0.5);
      float x = (dx - 0.012) / 0.476, fb = x * 64.0, b = floor(fb), f = fract(fb), q = pu * 0.476 / 64.0;
      float barra = step(0.0, x) * step(x, 1.0) * clamp(f * q + 0.5, 0.0, 1.0) * clamp((0.5 - f) * q + 0.5, 0.0, 1.0);
      float lv = texelFetch(uSpettro, ivec2(int(clamp(b, 0.0, 63.0)), 0), 0).r;
      float h = 0.0025 + (R_SPE1 - R_SPE0 - 0.0025) * lv;
      vec3 c = mix(mix(tint, cAqua, uListen * 0.85), cIce, uSpeak * 0.3);
      float rv = revm(u0, uRev.y, pu);
      col += c * barra * band(r, R_SPE0, R_SPE0 + h, px) * (0.28 + 0.9 * lv) * rv;
    } else if (r < (R_CORDA + R_SCALA) * 0.5) {
      // la corda: spostamento radiale e energia dall'equazione delle onde
      vec2 cd = texture(uCorda, vec2(fract(u0), 0.5)).rg;
      float s = (cd.r - 0.5) * 2.0, e = cd.g;
      float d = r - (R_CORDA + 0.0105 * s);
      col += mix(tint, cIce, e) * cov(d / px, 1.15 + 0.8 * e) * (0.32 + 1.3 * e) * revm(u0, uRev.z, pu);
    } else if (r < (R_SCALA + R_OUT) * 0.5) {
      // scala graduata: tacche ogni 2°, 10° e 30°, che girano con l'inerzia di un giroscopio
      float u = u0 + uScala, rv = revm(u, uRev.w, pu);
      float n = 180.0, fi = u * n, k = floor(fi + 0.5), dpx = abs(fi - k) * pu / n;
      float m10 = 1.0 - step(1.0, mod(k + 0.5, 5.0)), m30 = 1.0 - step(1.0, mod(k + 0.5, 15.0));
      float len = mix(mix(0.004, 0.008, m10), 0.013, m30);
      float dens = max(m10, smoothstep(2.5, 5.0, pu / n)) * (1.0 - uSmall * (1.0 - m30));
      float tk = cov(dpx, mix(mix(1.0, 1.2, m10), 1.5, m30)) * band(r, R_SCALA, R_SCALA + len, px) * dens * mix(mix(0.3, 0.45, m10), 0.7, m30);
      col += tint * (cov((r - R_SCALA) / px, 1.0) * 0.4 + tk) * rv;
    } else {
      // anello esterno: una linea con quattro varchi ai punti cardinali e tacche ogni 5°
      float rv = revm(u0, uRevOut, pu), uq = fract(u0 * 4.0), p4 = pu * 0.25;
      float l = cov((r - R_OUT) / px, 1.2) * (1.0 - arcm(uq - 0.485, 0.03, p4)) * 0.55;
      float fi = u0 * 72.0, dk = abs(fi - floor(fi + 0.5)) * pu / 72.0;
      l += cov(dk, 1.0) * band(r, R_OUT + 0.002, R_OUT + 0.0055, px) * 0.35 * (1.0 - uSmall);
      col += tint * l * rv;
      // allarme: trattini arancioni o rossi appena fuori, che pulsano
      float tr = arcm(fract(u0 * 36.0 - uClock * 1.08), 0.5, pu / 36.0);
      col += cAlarm * cov((r - R_OUT - 0.0105) / px, 3.0) * tr * uAl * (0.65 + 0.35 * sin(uClock * 8.0)) * 0.9;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Onda d'urto dell'avvio: un fronte che si allarga a C_URTO, con l'ampiezza che cala come 1/√r (onda cilindrica)
const WAVE_VERT = /* glsl */`
  uniform float uWR, uWW; attribute float aSide; varying float vS;
  void main() { vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * (uWR + aSide * uWW), 0.0, 1.0); }
`;
const WAVE_FRAG = /* glsl */`
  uniform float uWA; uniform vec3 cA, cB; varying float vS;
  float sq(float x) { return x * x; }
  void main() {
    float front = exp(-sq((vS - 0.55) * 5.0));
    float trail = smoothstep(-1.0, 0.55, vS) * (1.0 - smoothstep(0.55, 1.0, vS)) * 0.3;
    gl_FragColor = vec4((cA * front + cB * trail) * uWA, 1.0);
  }
`;
function waveGeometry(n) {
  const pos = new Float32Array((n + 1) * 2 * 3), side = new Float32Array((n + 1) * 2), idx = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.set([c, s, 0, c, s, 0], i * 6); side.set([-1, 1], i * 2);
    if (i < n) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

// ---------- La fisica che gira sulla CPU a ogni fotogramma ----------
// Modi della goccia: ä + 2γ_l·ȧ + ω_l²·a = F. ω_l ∝ √(l(l−1)(l+2)) come per una goccia con tensione superficiale (l = 2 a
// 1,5 Hz), γ_l ∝ (l−1)(2l+1) come lo smorzamento viscoso. La forza: rumore termico (Langevin), lo spettro dell'audio
// con un carico statico uguale per ogni l (F = g·E·ω²), il pensiero (una spinta che gira lenta su l = 2, m = ±2: la
// goccia allungata ruota) e il critico (rumore forte sugli l alti: trema).
function creaGoccia(rnd) {
  const W0 = 2 * Math.PI * 1.5, G0 = 0.9;
  const w = new Float64Array(NM), g = new Float64Array(NM), q = new Float64Array(NM), c = new Float64Array(NM);
  const a = new Float64Array(NM), v = new Float64Array(NM);
  MODI.forEach(({ l }, k) => {
    w[k] = W0 * Math.sqrt((l * (l - 1) * (l + 2)) / 8);
    g[k] = (G0 * (l - 1) * (2 * l + 1)) / 5;
    q[k] = (0.006 / (l - 1)) * 2 * w[k] * Math.sqrt(g[k]); // rms termico 0,6% per l = 2, meno sugli altri
    c[k] = gauss(rnd);
  });
  const k22 = MODI.findIndex((x) => x.l === 2 && x.m === 2), k2m2 = MODI.findIndex((x) => x.l === 2 && x.m === -2);
  const normalizza = () => { for (let l = L_MIN; l <= L_MAX; l++) { let s = 0; MODI.forEach((x, k) => { if (x.l === l) s += c[k] * c[k]; }); s = Math.sqrt(s) || 1; MODI.forEach((x, k) => { if (x.l === l) c[k] /= s; }); } };
  normalizza();
  let fase = 0;
  return {
    a, v,
    // E: energia per l (indice l − 2), pensa e trema in 0..1
    passo(dt, E, pensa, trema) {
      for (let k = 0; k < NM; k++) c[k] += 0.9 * Math.sqrt(dt) * gauss(rnd); // la forma della spinta cambia in circa un secondo
      normalizza();
      fase += dt * 2 * Math.PI * 0.18;
      const H = 1 / 240, n = Math.max(1, Math.ceil(dt / H)), h = dt / n;
      for (let i = 0; i < n; i++) for (let k = 0; k < NM; k++) {
        const l = MODI[k].l, w2 = w[k] * w[k];
        let F = 0.08 * E[l - 2] * w2 * c[k]; // carico statico 8% per E = 1: circa 4% di deformazione con la voce
        if (k === k22) F += 0.075 * pensa * w2 * Math.cos(fase); // |Y22| ≤ 0,546: la goccia si allunga del 4%
        if (k === k2m2) F += 0.075 * pensa * w2 * Math.sin(fase);
        const rumore = q[k] * (1 + (l >= 4 ? 14 * trema : 0));
        v[k] += (F - 2 * g[k] * v[k] - w2 * a[k]) * h + rumore * Math.sqrt(h) * gauss(rnd);
        a[k] += v[k] * h;
      }
    },
    urto(forza) { MODI.forEach(({ l }, k) => { if (l === 2) v[k] += forza * gauss(rnd); }); }, // la goccia appena formata ondeggia
  };
}

// La corda: equazione delle onde su un anello di NC nodi, u_tt = c²·u_xx − (c/R)²·u − 2γ·u_t + f. Un impulso fa il giro
// in 1,6 s. Il termine (c/R)²·u è la tensione del cerchio che richiama l'anello quando si allarga tutto insieme: senza,
// una spinta con la media diversa da zero lo faceva derivare senza fine (misurato: spostamento 1.700 volte il massimo).
function creaCorda(rnd) {
  const u = new Float32Array(NC), v = new Float32Array(NC), f = new Float32Array(NC);
  const C = NC / 1.6, GAM = 1.4, K0 = (C * 2 * Math.PI / NC) ** 2;
  const spinta = (centro, ampiezza, largo = 3) => {
    for (let d = -3 * largo; d <= 3 * largo; d++) f[(centro + d + NC) % NC] += ampiezza * Math.exp(-(d * d) / (2 * largo * largo));
  };
  return {
    u, v, spinta,
    colpo(centro, ampiezza, largo = 4) { for (let d = -3 * largo; d <= 3 * largo; d++) v[(Math.round(centro) + d + NC) % NC] += ampiezza * Math.exp(-(d * d) / (2 * largo * largo)); },
    passo(dt) {
      const H = 1 / 240, n = Math.max(1, Math.ceil(dt / H)), h = dt / n, c2 = C * C;
      for (let s = 0; s < n; s++) {
        for (let i = 0; i < NC; i++) {
          const lap = u[(i + 1) % NC] - 2 * u[i] + u[(i + NC - 1) % NC];
          v[i] += (c2 * lap - K0 * u[i] - 2 * GAM * v[i] + f[i]) * h;
        }
        for (let i = 0; i < NC; i++) u[i] += v[i] * h;
      }
      f.fill(0);
    },
  };
}

// ---------- Scena ----------
export async function createScene(canvas, S) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pr = Math.min(window.devicePixelRatio || 1, 1.5); // 1,5x invece di 2x: il 44% di pixel in meno, le linee restano nitide
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, -10, 10);
  const col = (hex) => new THREE.Color(hex);
  const C = {
    cyan: col(0x29e3ff), blue: col(0x2a7dff), aqua: col(0x2bffc8), ice: col(0xd2f8ff), mid: col(0x1d63c8),
    violet: col(0x5a2a9a), deep: col(0x241050), rim: col(0x36ffd6), orange: col(0xff8a1f), red: col(0xff2e2e),
  };
  const alarm = new THREE.Color(0, 0, 0);
  const rnd = rng(2026);

  // i dati di corda e spettro passano alla GPU come due righe di byte
  const cordaDati = new Uint8Array(NC * 4), spettroDati = new Uint8Array(NB * 4);
  const texCorda = new THREE.DataTexture(cordaDati, NC, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texCorda.wrapS = THREE.RepeatWrapping; texCorda.magFilter = texCorda.minFilter = THREE.LinearFilter; texCorda.needsUpdate = true;
  const texSpettro = new THREE.DataTexture(spettroDati, NB, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texSpettro.magFilter = texSpettro.minFilter = THREE.NearestFilter; texSpettro.needsUpdate = true;

  const vec8 = () => Array.from({ length: 8 }, () => new THREE.Vector4());
  // uniform condivise: un solo oggetto per valore, letto da tutti i materiali che lo nominano
  const U = {
    uT: { value: 0 }, uClock: { value: 0 }, uPR: { value: pr }, uPtK: { value: 1 }, uPxL: { value: 0.001 }, uRs: { value: RS },
    uMic: { value: 0 }, uListen: { value: 0 }, uThink: { value: 0 }, uSpeak: { value: 0 }, uAudio: { value: 0 },
    uDens: { value: 1 }, uAl: { value: 0 }, uVis: { value: 0 }, uCore: { value: 0 }, uSmall: { value: 0 }, uGain: { value: 1 },
    uRotS: { value: new THREE.Matrix3() }, uA: { value: vec8() }, uV: { value: vec8() }, uCorr: { value: 0.12 },
    uW: { value: LINEA_W }, uScala: { value: 0 }, uRev: { value: new THREE.Vector4() }, uRevOut: { value: 0 },
    uCorda: { value: texCorda }, uSpettro: { value: texSpettro },
    uWR: { value: RS }, uWW: { value: 0.01 }, uWA: { value: 0 },
    cRim: { value: C.rim }, cMid: { value: C.mid }, cDeep: { value: C.deep }, cIce: { value: C.ice }, cCyan: { value: C.cyan }, cBlue: { value: C.blue },
    cAqua: { value: C.aqua }, cViolet: { value: C.violet }, cAlarm: { value: alarm }, cA: { value: C.ice }, cB: { value: C.cyan },
  };
  const pickU = (src) => Object.fromEntries([...src.matchAll(/uniform\s+\w+\s+([^;]+);/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/\[.*\]$/, ''))).filter((n) => U[n]).map((n) => [n, U[n]]));
  const mat = (vert, frag) => new THREE.ShaderMaterial({
    uniforms: pickU(vert + frag), vertexShader: vert, fragmentShader: frag,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });

  const nucleus = new THREE.Group();
  scene.add(nucleus);
  const add = (obj, order) => { obj.renderOrder = order; obj.frustumCulled = false; nucleus.add(obj); return obj; };

  const LOCAL_VERT = 'varying vec2 vL; void main() { vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  add(new THREE.Mesh(new THREE.PlaneGeometry(2.7 * RS, 2.7 * RS), mat(LOCAL_VERT, BODY_FRAG)), 1);
  const campo = buildCampo(rnd, LINEE, PASSI);
  const linee = add(new THREE.Mesh(campo.g, mat(CAMPO_VERT, CAMPO_FRAG)), 2);
  const shell = buildShell(rnd, NP);
  add(new THREE.Points(shell.g, mat(SHELL_VERT, POINT_FRAG)), 3);
  const rings = add(new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 256, 1), mat(LOCAL_VERT, RING_FRAG)), 5);
  const wave = add(new THREE.Mesh(waveGeometry(256), mat(WAVE_VERT, WAVE_FRAG)), 6);

  // post: bagliore. Il render target ha lo stencil per chi si aggancia con strato()
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, stencilBuffer: true }));
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  const hudPass = new RenderPass(scene, camera);
  composer.addPass(hudPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0, 0.18);
  // i due livelli più larghi facevano un alone squadrato largo il triplo degli anelli: il bagliore resta stretto
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.8, 0.5, 0.12, 0.0];
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // inquadratura: con finestre strette tutto si rimpicciolisce
  let W = innerWidth, H = innerHeight, aspect = W / H, k = Math.min(1, aspect / 1.4);
  function layout() {
    W = innerWidth; H = innerHeight; aspect = W / H; k = Math.min(1, aspect / 1.4);
    camera.left = -aspect * 0.5 / k; camera.right = aspect * 0.5 / k; camera.top = 0.5 / k; camera.bottom = -0.5 / k;
    camera.updateProjectionMatrix();
  }
  layout();
  addEventListener('resize', () => {
    pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    layout();
  });

  // Dove sta il nucleo: al centro; col browser nella colonna sinistra (bordo dell'anello entro 0,40·W); nell'angolo del
  // report con l'anello esterno di 100 punti al massimo. split e dock arrivano da molle (oscar.js): un filo oltre 0..1 è
  // il rimbalzo, e si lascia vedere.
  const lay = { x: 0, y: CY, s: 1 };
  const corsa = (x) => Math.min(1.1, Math.max(-0.1, x || 0));
  function place() {
    const split = corsa(S.split), dock = corsa(S.dock), ppu = H * k, halfW = aspect * 0.5 / k, colW = 0.40 * 2 * halfW;
    const sSplit = Math.min(0.88, (colW - 0.06) / (2 * RO));
    let x = (-halfW + colW / 2) * split, y = CY, s = 1 + (sSplit - 1) * split;
    const cellW = 2 * (W * 0.956 - 132) / 12 + 12, cellH = 2 * (H * 0.914 - 60) / 6 + 12;
    const sDock = Math.max(20, Math.min(100, 0.45 * cellW, 0.4 * cellH - 8)) / (RO * ppu);
    const dx = ((S.dockX ?? W) - W / 2) / ppu, dy = (H / 2 - (S.dockY ?? H)) / ppu;
    x += (dx - x) * dock; y += (dy - y) * dock; s += (sDock - s) * dock;
    lay.x = x; lay.y = y; lay.s = Math.max(0.02, s);
  }
  place();

  const goccia = creaGoccia(rnd), corda = creaCorda(rnd);
  const sm = { listen: 0, think: 0, speak: 0, audio: 0, audioLento: 0, mic: 0, micLento: 0, al: 0, giro: 0.02 };
  const liv = new Float32Array(NB), E = new Float64Array(4);
  let spin = 0, scala = 0, urtato = false, prossimoImpulso = 0;
  const asse = new THREE.Vector3(0.22, 1, 0.12).normalize(), m4 = new THREE.Matrix4(), tilt = new THREE.Matrix4().makeRotationX(0.32);
  // In quale ordine e quando l'onda d'urto attraversa gli anelli: base, spettro, corda, scala | esterno
  const RAGGI = [R.base, R.spe0, R.corda, R.scala, R.out];
  const WR = 5.83 / 0.3; // ogni anello si chiude con una molla critica in 0,3 s
  const rivela = (t, r0) => { const x = t - TIMING.reveal - (r0 - RS) / C_URTO; return x <= 0 ? 0 : 1 - (1 + WR * x) * Math.exp(-WR * x); };

  function frame(t, clock, dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    const mode = S.mode || 'idle';
    const kk = 1 - Math.exp(-dt * 14); // stati: un filtro RC che arriva al 2% in 0,28 s
    sm.listen += ((mode === 'listening' ? 1 : 0) - sm.listen) * kk;
    sm.think += ((mode === 'thinking' ? 1 : 0) - sm.think) * kk;
    sm.speak += ((mode === 'speaking' ? 1 : 0) - sm.speak) * kk;
    // balistica da VU: sale in fretta, scende piano; la versione lenta serve a separare le sillabe dal livello medio
    const aud = clamp01(S.audio), mic = clamp01(S.mic) * (S.hearing ? 1 : 0.6) * (0.35 + 0.65 * sm.listen);
    sm.audio += (aud - sm.audio) * (1 - Math.exp(-dt * (aud > sm.audio ? 30 : 9)));
    sm.mic += (mic - sm.mic) * (1 - Math.exp(-dt * (mic > sm.mic ? 25 : 8)));
    sm.audioLento += (sm.audio - sm.audioLento) * (1 - Math.exp(-dt * 3));
    sm.micLento += (sm.mic - sm.micLento) * (1 - Math.exp(-dt * 3));
    const alT = Math.min(2, Math.max(0, Math.round(Number(S.allarme) || 0)));
    sm.al += (alT - sm.al) * (1 - Math.exp(-dt * 8));
    if (alT === 0 && sm.al < 0.004) sm.al = 0;
    const al1 = Math.min(1, sm.al), al2 = Math.max(0, Math.min(1, sm.al - 1));
    alarm.copy(C.orange).lerp(C.red, al2);

    // lo spettro: le 64 bande vere se oscar.js le passa, se no (banco) una forma dal livello
    // il microfono pesa per intero solo mentre O.S.C.A.R. ascolta e qualcuno parla, come il suo livello (sm.mic): la TV
    // mentre pensa non deve far ballare l'anello
    const sp = S.spettro, fonte = Math.max(sm.audio * sm.speak, sm.mic);
    const gSp = Math.max(sm.speak, (0.35 + 0.65 * sm.listen) * (S.hearing ? 1 : 0.6));
    for (let b = 0; b < NB; b++) {
      const x = sp ? gSp * clamp01((sp[b] - 70) / 150) : fonte * (0.95 - 0.6 * b / NB) * (0.65 + 0.35 * Math.sin(clock * (5 + b * 0.37) + b));
      liv[b] += (x - liv[b]) * (1 - Math.exp(-dt * (x > liv[b] ? 60 : 7)));
      spettroDati[b * 4] = Math.round(clamp01(liv[b]) * 255);
    }
    texSpettro.needsUpdate = true;

    // la goccia: energia per l dalle bande (basse → l = 2 … alte → l = 5)
    for (let l = 0; l < 4; l++) { let s = 0; const b0 = [0, 6, 16, 32][l], b1 = [6, 16, 32, 64][l]; for (let b = b0; b < b1; b++) s += liv[b]; E[l] = s / (b1 - b0); }
    if (!urtato && t >= TIMING.formEnd) { urtato = true; goccia.urto(0.3); }
    goccia.passo(dt, E, sm.think, al2);
    for (let i = 0; i < 8; i++) { U.uA.value[i].fromArray(goccia.a, i * 4); U.uV.value[i].fromArray(goccia.v, i * 4); }

    // la corda: la voce la spinge dall'alto, il microfono dal basso (solo le sillabe: livello meno la sua media lenta),
    // il pensiero con impulsi in punti a caso che girano nei due versi e interferiscono
    // tarate su una simulazione con la voce finta del banco: picco circa 0,9 (9 px), media 0,17
    corda.spinta(0, 400 * Math.max(0, sm.audio - sm.audioLento) * sm.speak);
    corda.spinta(NC >> 1, 400 * Math.max(0, sm.mic - sm.micLento));
    if (sm.think > 0.5 && t >= prossimoImpulso) { corda.colpo(rnd() * NC, 13 + 9 * rnd()); prossimoImpulso = t + 0.45 + 0.5 * rnd(); }
    corda.passo(dt);
    for (let i = 0; i < NC; i++) {
      cordaDati[i * 4] = Math.round(clamp01(0.5 + 0.5 * corda.u[i]) * 255);
      cordaDati[i * 4 + 1] = Math.round(clamp01(Math.abs(corda.v[i]) / 10) * 255);
    }
    texCorda.needsUpdate = true;

    // rotazioni con inerzia (τ = 0,35 s): pensare dà più coppia alla goccia e alla scala
    sm.giro += ((0.09 + 0.16 * sm.think) - sm.giro) * (1 - Math.exp(-dt / 0.35));
    spin += dt * sm.giro;
    scala = (scala + dt * (0.004 + 0.05 * sm.think + 0.01 * sm.speak)) % 1;
    U.uRotS.value.setFromMatrix4(m4.makeRotationAxis(asse, spin).premultiply(tilt));
    U.uCorr.value = 0.12 + 1.1 * sm.think + 0.25 * sm.speak;

    // avvio: l'onda d'urto parte quando la goccia è fatta e disegna gli anelli mentre li attraversa
    U.uRev.value.set(rivela(t, RAGGI[0]), rivela(t, RAGGI[1]), rivela(t, RAGGI[2]), rivela(t, RAGGI[3]));
    U.uRevOut.value = rivela(t, RAGGI[4]);
    rings.visible = t >= TIMING.reveal;
    U.uScala.value = scala;
    U.uVis.value = THREE.MathUtils.smoothstep(t, 0.2, TIMING.formEnd);
    U.uCore.value = THREE.MathUtils.smoothstep(t, 0.5, TIMING.formEnd);
    const xw = t - TIMING.reveal, rw = RS + xw * C_URTO;
    if (xw >= 0 && rw < RING_OUT + 0.04) {
      wave.visible = true; U.uWR.value = rw; U.uWW.value = 0.006 + 0.02 * xw / 0.25;
      U.uWA.value = 0.8 * Math.sqrt(RS / rw) * THREE.MathUtils.smoothstep(xw, 0, 0.03) * (1 - THREE.MathUtils.smoothstep(rw, RING_OUT - 0.02, RING_OUT + 0.04));
    } else wave.visible = false;

    place();
    nucleus.position.set(lay.x, lay.y, 0);
    nucleus.scale.setScalar(lay.s);
    U.uPxL.value = 1 / (H * k * pr * lay.s);
    U.uPtK.value = Math.max(0.6, Math.min(1, lay.s * 1.25));
    U.uSmall.value = THREE.MathUtils.smoothstep(0.75 - lay.s, 0.0, 0.3);
    // nell'angolo le stesse particelle e le stesse linee stanno in un'area 10 volte più piccola: si abbassano per non bruciare
    U.uDens.value = Math.min(1, Math.max(0.08, (lay.s * lay.s) / (U.uPtK.value * U.uPtK.value)));
    U.uGain.value = Math.min(1, Math.max(0.3, lay.s * 1.1));
    linee.geometry.setDrawRange(0, Math.round(campo.linee * U.uGain.value) * PASSI * 6);

    U.uT.value = t; U.uClock.value = clock; U.uPR.value = pr;
    U.uListen.value = sm.listen; U.uThink.value = sm.think; U.uSpeak.value = sm.speak; U.uAudio.value = sm.audio;
    U.uMic.value = sm.mic; U.uAl.value = al1;
    bloom.strength = 0.55 + 0.15 * sm.speak * sm.audio;
    composer.render(dt);
  }

  // centro, raggio della goccia e dell'anello esterno, in pixel CSS: lì oscar.js appoggia le scritte
  function anchor() {
    const ppu = H * k;
    return { x: W / 2 + lay.x * ppu, y: H / 2 - lay.y * ppu, r: RS * lay.s * ppu, R: RO * lay.s * ppu };
  }

  // «ASSEMBLING… N%»: la frazione di particelle già arrivate (inviluppo sotto il 2%)
  function assembling(t) {
    const a = shell.arrivi;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; }
    return lo / a.length;
  }

  // aggancio di un'altra scena (il globo della meteo): un RenderPass subito dopo quello dell'HUD e prima del bagliore
  function strato(sc, cam) {
    const p = new RenderPass(sc, cam);
    p.clear = false; p.clearDepth = true;
    composer.insertPass(p, composer.passes.indexOf(hudPass) + 1);
    return p;
  }

  return { frame, anchor, assembling, renderer, strato };
}
