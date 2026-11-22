// O.S.C.A.R.: il nucleo. Una sfera-cervello a strati dentro anelli concentrici.
// Dall'esterno all'interno: guscio di particelle (il bordo luminoso, sente il microfono), gomitolo di filamenti
// (pensa: impulsi che corrono), nucleo al centro (pulsa con la voce). Intorno, anelli a velocità e versi diversi:
// barre dei dati, tratteggi, segmenti spessi con buchi, quadrante coi gradi, arco che scansiona, micro-dati.
// Contratto con oscar.js: TIMING e createScene(canvas, S) → { frame, anchor, assembling, renderer, strato }.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Tempi della formazione (secondi dall'avvio): fine formazione, onda che rivela, tutto pronto. I suoni ci sono agganciati.
export const TIMING = { formEnd: 4.1, reveal: 5.6, ready: 6.5 };

// Unità: altezza dello schermo = 1, origine al centro, y in su. Il nucleo vive in coordinate locali col centro in 0,0.
const CY = 0.11;   // centro del nucleo: 39% dall'alto
const RS = 0.15;   // raggio della sfera
const RO = 0.33;   // anello più esterno
// Raggi degli anelli (locali), dall'interno
const R = {
  base: 0.166, bar0: 0.173, bar1: 0.203, dash: 0.2145, seg0: 0.2235, seg1: 0.2305,
  dial: 0.2425, num0: 0.2565, num1: 0.2725, scan: 0.2855, gauge: 0.2975, hex0: 0.3055, hex1: 0.3165, out: RO,
};
const RING_IN = 0.158, RING_OUT = 0.346;   // la corona disegnata: fuori da qui gli anelli non costano niente
// gomitolo: tanti fili sottili e tenui, fitto come il secondo riferimento (con 96 fili larghi era rado)
const YARN_F = 320, YARN_N = 140, YARN_W = 0.8;
const WAVE_V = 0.55;                        // velocità dell'onda della rivelazione (unità/s)

const f4 = (x) => x.toFixed(4);
const GLSL_R = Object.entries(R).map(([k, v]) => `const float R_${k.toUpperCase()} = ${f4(v)};`).join('\n');
const GLSL_COMMON = /* glsl */`
  const float TAU = 6.28318530718;
  float sq(float x) { return x * x; }
  float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  vec3 rodrigues(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unit = (rnd) => { const z = 2 * rnd() - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - z * z); return new THREE.Vector3(s * Math.cos(a), s * Math.sin(a), z); };
const clamp01 = (x) => Math.min(1, Math.max(0, x || 0));
const easeOut = (x, p = 3) => 1 - Math.pow(1 - clamp01(x), p);

// ---------- Guscio: particelle sulla sfera (Fibonacci con un po' di disordine) ----------
// Arrivo di ogni particella sulla curva di ASSEMBLING: la sfera si riempie come sale la percentuale, tutte dentro a 4 s.
function buildShell(rnd, n) {
  const pos = new Float32Array(n * 3), ar = new Float32Array(n * 4);
  const ga = Math.PI * (3 - Math.sqrt(5)), A4 = 1 - Math.pow(1 - 4 / 6.9, 3.3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), th = ga * i;
    v.set(Math.cos(th) * rr, y, Math.sin(th) * rr).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.03)).normalize();
    pos.set([v.x, v.y, v.z], i * 3);
    const w = 6.9 * (1 - Math.pow(1 - rnd() * A4, 1 / 3.3)) / 4;   // 0..1, fitto all'inizio come la percentuale
    ar.set([0.55 + 3.45 * w, rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(ar, 4));
  return g;
}

// ---------- Nucleo: scintille che girano strette attorno al centro ----------
function buildSparks(rnd, n) {
  const pos = new Float32Array(n * 3), ar = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const v = unit(rnd); pos.set([v.x, v.y, v.z], i * 3); ar.set([rnd() * rnd(), rnd(), rnd(), rnd()], i * 4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(ar, 4));
  return g;
}

// ---------- Gomitolo: filamenti che vagano sulla sfera con curvatura liscia, disegnati come nastri sottili ----------
// Calcolati una volta: la GPU li ruota, li fa crescere e ci fa correre gli impulsi.
function buildYarn(rnd, F, N) {
  const nv = F * (N + 1) * 2;
  const pos = new Float32Array(nv * 3), q = new Float32Array(nv * 3), s4 = new Float32Array(nv * 4), c3 = new Float32Array(nv * 3), ax = new Float32Array(nv * 4);
  const idx = new Uint32Array(F * N * 6);
  const PAL = [[0x29e3ff, 0.34], [0x2a7dff, 0.24], [0x2bffc8, 0.18], [0xbff4ff, 0.08], [0x14b4cc, 0.16]];
  const pick = () => { let x = rnd(); for (const [h, w] of PAL) if ((x -= w) <= 0) return new THREE.Color(h); return new THREE.Color(PAL[0][0]); };
  let vi = 0, ii = 0;
  for (let f = 0; f < F; f++) {
    const col = pick(), r1 = rnd(), r2 = rnd();
    const axis = unit(rnd), w = (rnd() - 0.5) * 1.2;
    const p = unit(rnd), t = unit(rnd); t.addScaledVector(p, -t.dot(p)).normalize();
    const L = 2.4 + 3.4 * rnd(), ds = L / N;
    const k1 = (rnd() - 0.5) * 5, k2 = (rnd() - 0.5) * 9, w1 = 0.6 + 1.6 * rnd(), w2 = 2 + 4 * rnd(), p1 = rnd() * 6.28, p2 = rnd() * 6.28;
    const rb = 0.56 + 0.34 * Math.sqrt(rnd());                     // dentro il guscio
    const hair = rb > 0.78 && rnd() < 0.45 ? { at: 0.15 + 0.7 * rnd(), h: 0.14 + 0.16 * rnd(), w: 0.025 + 0.03 * rnd() } : null; // fili che escono dal bordo
    const pts = [];
    for (let j = 0; j <= N; j++) {
      const sj = j / N;
      t.applyAxisAngle(p, (k1 * Math.sin(w1 * sj * L + p1) + k2 * Math.sin(w2 * sj * L + p2)) * ds);
      p.addScaledVector(t, ds).normalize();
      t.addScaledVector(p, -t.dot(p)).normalize();
      let rad = rb * (1 + 0.06 * Math.sin(sj * L * 3 + p1));
      if (hair) rad += hair.h * Math.exp(-(((sj - hair.at) / hair.w) ** 2));
      pts.push(p.clone().multiplyScalar(rad));
    }
    const base = vi;
    for (let j = 0; j <= N; j++) {
      const a = pts[j], b = j < N ? pts[j + 1] : pts[j].clone().multiplyScalar(2).sub(pts[j - 1]);
      for (const side of [-1, 1]) {
        pos.set([a.x, a.y, a.z], vi * 3); q.set([b.x, b.y, b.z], vi * 3);
        s4.set([side, j / N, r1, r2], vi * 4); c3.set([col.r, col.g, col.b], vi * 3); ax.set([axis.x, axis.y, axis.z, w], vi * 4);
        vi++;
      }
    }
    for (let j = 0; j < N; j++) { const o = base + 2 * j; idx.set([o, o + 2, o + 1, o + 1, o + 2, o + 3], ii); ii += 6; } // antiorari: three scarta le facce posteriori
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aQ', new THREE.BufferAttribute(q, 3));
  g.setAttribute('aS', new THREE.BufferAttribute(s4, 4));
  g.setAttribute('aC', new THREE.BufferAttribute(c3, 3));
  g.setAttribute('aX', new THREE.BufferAttribute(ax, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// ---------- Testo degli anelli: una striscia generata in codice (riga A: gradi, riga B: micro-dati) ----------
// La striscia si avvolge sull'anello: u = giro (in senso orario, 0 in alto), v = raggio. I glifi sono stirati
// in larghezza perché sull'anello escano con le proporzioni giuste.
function buildText(renderer) {
  const TW = 8192, ROW = 64, cv = document.createElement('canvas');
  cv.width = TW; cv.height = ROW * 2;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, TW, ROW * 2);
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const sx = (r0, r1) => (TW / (Math.PI * (r0 + r1))) / (ROW / (r1 - r0));
  // riga A: gradi ogni 10°, centrati sulle tacche lunghe
  const sA = sx(R.num0, R.num1);
  g.font = '44px Menlo, monospace'; g.textAlign = 'center';
  for (let k = 0; k < 36; k++) {
    const x = (k / 36) * TW, lab = String(k * 10).padStart(3, '0');
    for (const xx of [x, x - TW, x + TW]) { g.setTransform(sA, 0, 0, 1, xx, ROW / 2 + 2); g.fillText(lab, 0, 0); }
  }
  // riga B: esadecimali, coordinate e percentuali, tutto attorno
  const sB = sx(R.hex0, R.hex1);
  g.font = '40px Menlo, monospace'; g.textAlign = 'left';
  const adv = g.measureText('0').width * sB, cells = Math.floor(TW / adv);
  const rnd = rng(31), hex = (n) => Array.from({ length: n }, () => '0123456789ABCDEF'[(rnd() * 16) | 0]).join('');
  const tok = [() => hex(4) + ' ' + hex(4), () => '0x' + hex(8), () => (rnd() * 100).toFixed(1) + '%', () => 'X' + (rnd() * 2 - 1).toFixed(3) + ' Y' + (rnd() * 2 - 1).toFixed(3),
    () => 'SYS.' + hex(2), () => (rnd() * 360).toFixed(2) + '°', () => hex(6)];
  let line = '';
  while (line.length < cells) line += tok[(rnd() * tok.length) | 0]() + '   ';
  line = line.slice(0, cells);
  g.setTransform(sB, 0, 0, 1, 0, ROW + ROW / 2 + 2); g.fillText(line, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return { tex, cells };
}

// ---------- Shader ----------
const POINT_FRAG = /* glsl */`
  varying vec3 vC;
  void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC * (1.0 - smoothstep(0.15, 0.5, d)), 1.0); }
`;

// Guscio: durante la formazione ogni particella arriva da fuori schermo a spirale; poi respira, sente il microfono,
// si gonfia con la voce. Il colore dipende da quanto è di taglio: bordo verde acqua, poi ciano, blu, viola al centro.
const SHELL_VERT = /* glsl */`
  uniform float uT, uClock, uPR, uPtK, uRs, uMic, uListen, uThink, uSpeak, uAudio, uLock, uAl, uDens;
  uniform mat3 uRotS;
  uniform vec3 cRim, cMid, cDeep, cIce, cAlarm;
  attribute vec4 aR;
  varying vec3 vC;
  ${GLSL_COMMON}
  void main() {
    vec3 dir = position;
    vec3 d = uRotS * dir;
    float fl = 1.0 + 0.6 * aR.y;                       // durata del volo
    float s = (uT - aR.x) / fl + 1.0;                   // 0 alla partenza, 1 all'arrivo
    float rip = 0.5 * sin(dot(dir, vec3(0.31, 0.95, 0.0)) * 11.0 - uClock * 7.5) + 0.5 * sin(dot(dir, vec3(-0.8, 0.2, 0.56)) * 7.0 - uClock * 5.3);
    float push = uMic * (0.03 + 0.045 * rip) + uSpeak * uAudio * 0.04;
    float esc = step(0.94, aR.w) * fract(aR.z * 7.3 + uClock * 0.04);   // poche particelle si staccano e se ne vanno piano
    float rr = uRs * (0.975 + 0.03 * aR.w + 0.12 * esc) * (1.0 + 0.012 * sin(uClock * 1.25) + push);
    vec3 home = d * rr;
    vec3 p = home;
    float rim = 1.0 - abs(d.z);
    float r2 = rim * rim, r4 = r2 * r2, r8 = r4 * r4;
    vec3 col = mix(cDeep, cMid, smoothstep(0.15, 0.7, rim));
    col = mix(col, cRim, smoothstep(0.6, 0.97, rim));
    col = mix(col, cAlarm, uAl * smoothstep(0.4, 0.9, rim));
    float front = 0.35 + 0.65 * smoothstep(-0.6, 0.6, d.z);
    float tw = 0.7 + 0.3 * sin(uClock * (0.7 + 2.2 * aR.z) + aR.w * 40.0);
    float gain = 1.0 + 0.45 * uListen + uMic * (1.6 + 1.0 * rip) + 0.5 * uSpeak * uAudio - 0.3 * uThink;
    float spk = max(0.0, sin(uClock * (0.5 + 0.9 * aR.y) + aR.z * 50.0)) * step(0.8, aR.y);
    spk = sq(sq(sq(sq(spk))));                          // un lampo breve ogni tanto: si vede che è fatta di particelle
    float a = (0.12 + 0.2 * r4 + 0.1 * r8) * front * tw * gain * (1.0 + 1.6 * uLock) * uDens * (1.0 - 0.7 * esc) * (1.0 - step(0.94, aR.w) * (1.0 - sin(3.14159 * fract(aR.z * 7.3 + uClock * 0.04))));
    float sz = 1.2 + 0.9 * aR.z;
    if (s < 1.0) {
      // in volo: raggio e angolo interpolati, così la traiettoria è una spirale che si stringe
      float e = 1.0 - sq(1.0 - clamp(s, 0.0, 1.0)) * (1.0 - clamp(s, 0.0, 1.0));
      float rh = length(home.xy);
      float ah = rh > 1e-5 ? atan(home.y, home.x) : 0.0;
      float rad = mix(0.95 + 0.75 * aR.y, rh, e);
      float an = ah + (1.0 - e) * (2.4 + 1.6 * aR.w);
      p = vec3(cos(an) * rad, sin(an) * rad, home.z * e);
      a = smoothstep(0.0, 0.12, s) * (0.3 + 0.45 * e);
      col = mix(cIce, cRim, e);
      sz = 1.6 + 1.2 * aR.z;
      spk = 0.0;
    } else {
      a *= 1.0 + 1.5 * exp(-(uT - aR.x) * 5.0);        // lampo d'arrivo
    }
    vC = col * a + mix(col, cIce, 0.6) * spk * 0.5 * front * uDens;
    gl_PointSize = sz * uPR * uPtK;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    if (s < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SPARK_VERT = /* glsl */`
  uniform float uClock, uPR, uPtK, uRs, uCore, uAudio, uSpeak, uThink, uSpinC;
  uniform vec3 cIce, cCyan;
  attribute vec4 aR;
  varying vec3 vC;
  ${GLSL_COMMON}
  void main() {
    vec3 axis = normalize(vec3(aR.y - 0.5, 1.0, aR.z - 0.5));
    float v = uSpeak * uAudio;
    float rr = uRs * (0.04 + 0.24 * aR.x) * (1.0 + 0.9 * v + 0.25 * uThink);
    vec3 p = rodrigues(position, axis, uSpinC * (0.5 + 1.5 * aR.w)) * rr;
    float tw = 0.5 + 0.5 * sin(uClock * (3.0 + 5.0 * aR.z) + aR.w * 30.0);
    float a = uCore * (0.2 + 0.8 * tw) * (1.0 - 0.6 * aR.x) * (0.1 + 1.1 * v + 0.3 * uThink);
    vC = mix(cCyan, cIce, tw) * a;
    gl_PointSize = (1.0 + 1.2 * aR.z) * uPR * uPtK;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Nastri del gomitolo: larghi uW px a ogni scala, con un pixel in più per l'antialias
const YARN_VERT = /* glsl */`
  uniform float uT, uClock, uPxL, uW, uRs, uSpinF, uThink, uSpeak, uAudio, uListen, uAl, uGain;
  uniform mat3 uRotF;
  uniform vec3 cAlarm, cIce;
  attribute vec3 aQ, aC; attribute vec4 aS, aX;
  varying vec3 vC; varying float vV;
  ${GLSL_COMMON}
  void main() {
    float an = aX.w * uSpinF;
    float sc = uRs * (1.0 + 0.012 * sin(uClock * 1.25 + 0.6) + 0.03 * uSpeak * uAudio);
    vec3 p = uRotF * rodrigues(position, aX.xyz, an) * sc;
    vec3 q = uRotF * rodrigues(aQ, aX.xyz, an) * sc;
    vec2 d = q.xy - p.xy; float L = length(d);
    d = L > 1e-7 ? d / L : vec2(1.0, 0.0);
    float hw = 0.5 * uW + 1.0;
    vec3 pos = p + vec3(vec2(-d.y, d.x) * (aS.x * hw * uPxL), 0.0);
    vV = aS.x * hw;
    float s = aS.y;
    // crescita durante la formazione, con la punta accesa
    float g0 = 2.0 + 1.3 * aS.z, g = clamp((uT - g0) / 0.7, 0.0, 1.0);
    float grow = (1.0 - smoothstep(g - 0.04, g, s)) * step(0.001, g);
    float tip = exp(-sq((s - g) * 30.0)) * (1.0 - step(1.0, g));
    // impulsi che corrono lungo il filo: radi a riposo, fitti e veloci nel pensiero
    float ph = fract(s * 1.6 - uClock * (0.12 + 0.2 * aS.w) * (1.0 + 4.0 * uThink) + aS.z * 7.0);
    float pulse = exp(-sq((ph - 0.5) * 16.0));
    float depth = 0.3 + 0.7 * smoothstep(-uRs, uRs, p.z);
    float ends = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.94, 1.0, s));
    vec3 col = mix(aC, cAlarm, uAl * step(aS.w, 0.15));   // pochi fili: tanti rossi sul viola farebbero magenta
    float a = (0.085 + 0.05 * uThink + 0.12 * uSpeak * uAudio) * depth * ends * grow * uGain;
    col = mix(col, cIce, 0.3 * uSpeak * uAudio);
    vC = col * a + mix(col, cIce, 0.5) * (pulse * (0.05 + 0.5 * uThink) + tip * 0.8) * depth * ends * grow * uGain;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const YARN_FRAG = /* glsl */`
  uniform float uW;
  varying vec3 vC; varying float vV;
  void main() { gl_FragColor = vec4(vC * clamp(0.5 * uW + 0.5 - abs(vV), 0.0, 1.0), 1.0); }
`;

// Corpo della sfera e nucleo in un solo quadrato: viola profondo al centro, filo luminoso sul bordo, cuore che pulsa
const BODY_FRAG = /* glsl */`
  uniform float uRs, uPxL, uVis, uCore, uAudio, uSpeak, uThink, uListen, uMic, uAl, uLock, uClock;
  uniform vec3 cViolet, cMid, cRim, cIce, cCyan, cAlarm;
  varying vec2 vL;
  ${GLSL_COMMON}
  void main() {
    float r = length(vL) / uRs;
    float px = uPxL / uRs;
    float inside = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
    float rc1 = min(r, 1.0);
    float fres = 1.0 - sqrt(max(1.0 - rc1 * rc1, 0.0));      // quanto è di taglio: 0 al centro, 1 sul bordo
    vec3 rimC = mix(cRim, cAlarm, uAl);
    float lift = 1.0 + 0.6 * uListen + 1.2 * uMic;
    vec3 body = mix(cViolet * 0.32, cMid * 0.11, smoothstep(0.0, 0.35, fres));
    body = mix(body, rimC * 0.2, smoothstep(0.3, 1.0, fres));
    float v = uSpeak * uAudio;
    vec3 col = body * inside * lift * (1.0 + 1.3 * v);
    float dpx = (r - 1.0) / px;                               // distanza dal bordo in pixel
    col += rimC * clamp(1.2 - abs(dpx + 0.6), 0.0, 1.0) * 0.4 * lift * (1.0 + uLock);
    col += rimC * exp(-max(r - 1.0, 0.0) * 22.0) * (1.0 - inside) * 0.035 * lift;
    // nucleo: in attesa un fondo viola; con la voce un cuore ciano-bianco che si accende sillaba per sillaba
    float rc = r / (0.14 + 0.28 * v + 0.03 * uThink);
    float beat = uCore * (0.07 + 0.03 * sin(uClock * 2.1) + 1.1 * v + 0.3 * uThink * (0.6 + 0.4 * sin(uClock * 9.0)));
    col += (cCyan * exp(-rc * rc * 2.0) * 0.35 + cIce * exp(-rc * rc * 12.0) * 0.9) * beat;
    gl_FragColor = vec4(col * uVis, 1.0);
  }
`;

// Anelli: un solo frammento sulla corona, che sceglie l'anello dal raggio. u = giri in senso orario con 0 in alto.
const RING_FRAG = /* glsl */`
  uniform float uPxL, uClock, uThink, uListen, uSpeak, uLev, uAl, uSmall, uScan, uHexN;
  uniform vec4 uRotA, uRotB, uRevA, uRevB;
  uniform sampler2D uTex;
  uniform vec3 cCyan, cBlue, cAqua, cIce, cAlarm;
  varying vec2 vL;
  ${GLSL_COMMON}
  ${GLSL_R}
  // copertura di una linea larga w px a distanza d px dal centro
  float cov(float d, float w) { return clamp(0.5 * w + 0.5 - abs(d), 0.0, 1.0) * min(w, 1.0); }
  // fascia radiale [a, b], bordi a mezzo pixel
  float band(float r, float a, float b, float px) { return clamp((r - a) / px + 0.5, 0.0, 1.0) * clamp((b - r) / px + 0.5, 0.0, 1.0); }
  // arco lungo len giri a partire da x = 0; pu = pixel per giro
  float arcm(float x, float len, float pu) { x = fract(x); return clamp(x * pu + 0.5, 0.0, 1.0) * clamp((len - x) * pu + 0.5, 0.0, 1.0); }
  float dash(float u, float n, float duty, float pu) { float f = fract(u * n), q = pu / n; return clamp(f * q + 0.5, 0.0, 1.0) * clamp((duty - f) * q + 0.5, 0.0, 1.0); }
  // rivelazione: l'anello si disegna da u = 0 fino a p
  float revm(float u, float p, float pu) { return p >= 0.999 ? 1.0 : arcm(u, p, pu) * step(0.0005, p); }
  // testo della striscia con le derivate calcolate a mano: u salta a ±180° e al giro, il mip non deve accorgersene
  float txt(float u, float r, float r0, float r1, float v0, float px) {
    float v = v0 + 0.5 * (r - r0) / (r1 - r0);
    vec2 du = vec2(vL.y, -vL.x) / (r * r * TAU);
    vec2 dv = (vL / r) * (0.5 / (r1 - r0));
    return textureGrad(uTex, vec2(u, v), vec2(du.x, dv.x) * px, vec2(du.y, dv.y) * px).r;
  }
  void main() {
    float r = length(vL);
    float px = uPxL;
    float u0 = 0.25 - atan(vL.y, vL.x) / TAU;
    float pu = TAU * r / px;
    // in allarme il ciano non vira verso il rosso (mescolati fanno grigio-viola): si abbassa e lascia leggere i segmenti
    vec3 tint = cCyan * (1.0 - 0.4 * uAl);
    vec3 col = vec3(0.0);
    // pensiero: ventaglio radar dietro l'arco che scansiona
    float xs = fract(uScan - u0);
    col += tint * exp(-xs * 11.0) * 0.06 * uThink * band(r, R_BASE, R_OUT, px);

    if (r < R_BAR0 - 0.002) {
      // cerchio base appena fuori dalla sfera
      col += tint * cov((r - R_BASE) / px, 1.0) * 0.5 * revm(u0, uRevA.x, pu);
    } else if (r < R_BAR1 + 0.004) {
      // barre dei dati: microfono in ascolto, voce mentre parla; nel pensiero un gruppo acceso che gira
      float u = u0 + uRotA.y, nb = 120.0, fi = u * nb, id = mod(floor(fi), nb), f = fract(fi), q = pu / nb;
      float wb = clamp(f * q + 0.5, 0.0, 1.0) * clamp((0.42 - f) * q + 0.5, 0.0, 1.0);
      float h1 = hash1(id + 1.0), h2 = hash1(id * 3.7 + 11.0);
      float spec = uLev * (0.2 + 0.55 * (0.5 + 0.5 * sin(uClock * (4.0 + 7.0 * h1) + h2 * TAU)) + 0.25 * (0.5 + 0.5 * sin(uClock * (9.0 + 5.0 * h2) + h1 * 17.0)));
      float chase = uThink * exp(-fract(u * 3.0 - uClock * 0.8) * 5.0) * 0.55;
      float lv = clamp(spec + chase, 0.0, 1.0);
      float h = 0.0035 + (R_BAR1 - R_BAR0 - 0.0035) * lv;
      vec3 c = mix(mix(tint, cAqua, uListen * 0.85), cIce, uSpeak * 0.3);
      col += c * wb * band(r, R_BAR0, R_BAR0 + h, px) * (0.3 + 0.9 * lv) * revm(u, uRevA.y, pu);
    } else if (r < R_SEG0 - 0.003) {
      // tratteggio veloce e, appena dentro, un filo di puntini che gira al contrario
      float u = u0 + uRotA.z, rv = revm(u, uRevA.z, pu);
      col += tint * cov((r - R_DASH) / px, 1.3) * dash(u, 72.0, 0.6, pu) * 0.6 * rv;
      col += cBlue * cov((r - R_DASH + 0.0055) / px, 1.0) * dash(u0 - uRotA.z * 0.7, 240.0, 0.35, pu) * 0.7 * rv;
    } else if (r < (R_SEG1 + R_DIAL) * 0.5) {
      // segmenti spessi con buchi: due gruppi uguali; in allarme si accendono arancioni o rossi e lampeggiano
      float u = u0 + uRotA.w, uh = fract(u * 2.0), ph = pu * 0.5;
      float m = arcm(uh, 0.27, ph) * (1.0 - 0.85 * dash(uh, 64.0, 0.18, ph)) + arcm(uh - 0.31, 0.1, ph) + arcm(uh - 0.45, 0.035, ph) + arcm(uh - 0.53, 0.2, ph);
      float body = band(r, R_SEG0, R_SEG1, px);
      float edge = min(1.0, cov((r - R_SEG0) / px, 1.0) + cov((r - R_SEG1) / px, 1.0));
      vec3 c = mix(tint, cAlarm, uAl);
      float fill = mix(0.16, 0.6, uAl) * (1.0 + 0.35 * uAl * sin(uClock * 9.0));
      col += c * min(m, 1.0) * (body * fill + edge * 0.35) * revm(u, uRevA.w, pu);
    } else if (r < (R_NUM1 + R_SCAN) * 0.5) {
      // quadrante: cerchio, tacche ogni 2°, 10° e 30°, numeri dei gradi
      float u = u0 + uRotB.x, rv = revm(u, uRevB.x, pu);
      float n = 180.0, fi = u * n, k = floor(fi + 0.5), dpx = abs(fi - k) * pu / n;
      float m10 = 1.0 - step(1.0, mod(k + 0.5, 5.0)), m30 = 1.0 - step(1.0, mod(k + 0.5, 15.0));
      float len = mix(mix(0.0045, 0.0085, m10), 0.0125, m30);
      float dens = max(m10, smoothstep(2.5, 5.0, pu / n));      // tacche fitte spente quando sono troppo vicine
      float tk = cov(dpx, mix(mix(1.0, 1.25, m10), 1.6, m30)) * band(r, R_DIAL, R_DIAL + len, px) * dens * mix(mix(0.35, 0.5, m10), 0.75, m30);
      float l = cov((r - R_DIAL) / px, 1.0) * 0.45 + tk;
      if (r > R_NUM0 - px && uSmall < 0.99) l += txt(u, r, R_NUM0, R_NUM1, 0.5, px) * 0.6 * (1.0 - uSmall);
      col += tint * l * rv;
    } else if (r < (R_GAUGE + R_HEX0) * 0.5) {
      // binario della scansione; nel pensiero l'arco che scansiona con la testa bianca
      float u = u0 + uRotB.y, rv = revm(u, uRevB.y, pu);
      col += tint * cov((r - R_SCAN) / px, 1.0) * dash(u, 180.0, 0.5, pu) * 0.32 * rv;
      col += mix(tint, cIce, exp(-xs * 40.0)) * cov((r - R_SCAN) / px, 2.4) * exp(-xs * 6.0) * uThink * 1.3;
      // livello di microfono e voce: arco in basso che si allarga, su un binario con i tappi
      float dx = abs(fract(u0) - 0.5), ext = 0.012 + 0.16 * uLev;
      col += tint * cov((r - R_GAUGE) / px, 1.0) * clamp((0.18 - dx) * pu + 0.5, 0.0, 1.0) * 0.25 * rv;
      col += tint * cov(abs(dx - 0.18) * pu, 1.3) * band(r, R_GAUGE - 0.005, R_GAUGE + 0.005, px) * 0.5 * rv;
      vec3 cg = mix(mix(tint, cAqua, uListen), cIce, uSpeak * 0.4);
      col += cg * cov((r - R_GAUGE) / px, 3.2) * clamp((ext - dx) * pu + 0.5, 0.0, 1.0) * (0.45 + 0.6 * uLev) * rv;
    } else if (r < R_OUT - 0.0095) {
      // micro-dati: quattro archi di testo che scorrono, qualche carattere che si spegne
      float u = u0 + uRotB.z, rv = revm(u, uRevB.z, pu);
      float seg = arcm(fract(u * 4.0) - 0.06, 0.62, pu * 0.25);
      float cell = floor(fract(u) * uHexN);
      float blink = step(0.9, hash1(cell * 1.31 + floor(uClock * 5.0) * 7.7));
      float hi = exp(-fract(u - uClock * 0.1) * 14.0);
      if (uSmall < 0.99) col += tint * txt(u, r, R_HEX0, R_HEX1, 0.0, px) * seg * (0.42 * (1.0 - 0.75 * blink) + hi * 0.5) * (1.0 - uSmall) * rv;
    } else {
      // anello esterno: linea con quattro buchi, staffe e triangoli ai punti cardinali, tacche ogni 5°
      float u = u0 + uRotB.w, rv = revm(u, uRevB.w, pu), uq = fract(u * 4.0), p4 = pu * 0.25;
      float l = cov((r - R_OUT) / px, 1.2) * (1.0 - arcm(uq - 0.47, 0.06, p4)) * 0.6;
      l += cov((r - R_OUT - 0.0045) / px, 2.4) * arcm(uq + 0.035, 0.07, p4) * 0.6;
      float dq = abs(fract(uq + 0.5) - 0.5) * p4;
      float tri = clamp((r - (R_OUT - 0.009)) / px * 0.55 - dq + 0.5, 0.0, 1.0) * band(r, R_OUT - 0.009, R_OUT - 0.002, px);
      l += tri * 0.65;
      float fi = u * 72.0, dk = abs(fi - floor(fi + 0.5)) * pu / 72.0;
      l += cov(dk, 1.0) * band(r, R_OUT + 0.002, R_OUT + 0.006, px) * 0.4;
      col += tint * l * rv;
      // allarme: trattini arancioni o rossi che lampeggiano appena fuori
      col += cAlarm * cov((r - R_OUT - 0.0105) / px, 3.0) * dash(u0 - uClock * 0.03, 36.0, 0.5, pu) * uAl * (0.65 + 0.35 * sin(uClock * 8.0)) * 0.9;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Onda: al blocco (4,1 s) un anello stretto che si chiude sul cerchio base; alla rivelazione un fronte che si allarga
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

  // uniform condivise: un solo oggetto per valore, letto da tutti i materiali che lo nominano
  const U = {
    uT: { value: 0 }, uClock: { value: 0 }, uPR: { value: pr }, uPtK: { value: 1 }, uPxL: { value: 0.001 }, uRs: { value: RS },
    uMic: { value: 0 }, uListen: { value: 0 }, uThink: { value: 0 }, uSpeak: { value: 0 }, uAudio: { value: 0 }, uLev: { value: 0 },
    uLock: { value: 0 }, uDens: { value: 1 }, uAl: { value: 0 }, uVis: { value: 0 }, uCore: { value: 0 }, uSmall: { value: 0 }, uGain: { value: 1 },
    uRotS: { value: new THREE.Matrix3() }, uRotF: { value: new THREE.Matrix3() }, uSpinF: { value: 0 }, uSpinC: { value: 0 },
    uW: { value: YARN_W }, uScan: { value: 0 },
    uRotA: { value: new THREE.Vector4() }, uRotB: { value: new THREE.Vector4() }, uRevA: { value: new THREE.Vector4() }, uRevB: { value: new THREE.Vector4() },
    uWR: { value: RS }, uWW: { value: 0.01 }, uWA: { value: 0 },
    cRim: { value: C.rim }, cMid: { value: C.mid }, cDeep: { value: C.deep }, cIce: { value: C.ice }, cCyan: { value: C.cyan }, cBlue: { value: C.blue },
    cAqua: { value: C.aqua }, cViolet: { value: C.violet }, cAlarm: { value: alarm }, cA: { value: C.ice }, cB: { value: C.cyan },
  };
  const pickU = (src) => Object.fromEntries([...src.matchAll(/uniform\s+\w+\s+([^;]+);/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter((n) => U[n]).map((n) => [n, U[n]]));
  const mat = (vert, frag, extra = {}) => new THREE.ShaderMaterial({
    uniforms: { ...pickU(vert + frag), ...extra }, vertexShader: vert, fragmentShader: frag,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });

  const nucleus = new THREE.Group();
  scene.add(nucleus);
  const add = (obj, order) => { obj.renderOrder = order; obj.frustumCulled = false; nucleus.add(obj); return obj; };

  // corpo e nucleo
  const LOCAL_VERT = 'varying vec2 vL; void main() { vL = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  add(new THREE.Mesh(new THREE.PlaneGeometry(2.7 * RS, 2.7 * RS), mat(LOCAL_VERT, BODY_FRAG)), 1);
  // gomitolo
  const yarn = add(new THREE.Mesh(buildYarn(rnd, YARN_F, YARN_N), mat(YARN_VERT, YARN_FRAG)), 2);
  // guscio e scintille
  add(new THREE.Points(buildShell(rnd, 24000), mat(SHELL_VERT, POINT_FRAG)), 3);
  add(new THREE.Points(buildSparks(rnd, 500), mat(SPARK_VERT, POINT_FRAG)), 4);
  // anelli
  const text = buildText(renderer);
  const rings = add(new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 256, 1), mat(LOCAL_VERT, RING_FRAG, { uTex: { value: text.tex }, uHexN: { value: text.cells } })), 5);
  // onda
  const wave = add(new THREE.Mesh(waveGeometry(256), mat(WAVE_VERT, WAVE_FRAG)), 6);

  // post: bagliore. Il render target ha lo stencil per la sezione piena dell'ologramma (strato): senza, il tappo non si vede (misurato)
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, stencilBuffer: true }));
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  const hudPass = new RenderPass(scene, camera);
  composer.addPass(hudPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0, 0.18);
  // i due livelli più larghi (1/16 e 1/32) facevano un alone squadrato largo il triplo degli anelli, visibile
  // sopra il report e l'ologramma: il bagliore resta stretto attorno a quello che brilla
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

  // Dove sta il nucleo: al centro; col browser nella colonna sinistra (bordo dell'anello entro 0,40·W);
  // nell'angolo del report con l'anello esterno di 100 punti al massimo (la cella è di circa 234×290)
  const lay = { x: 0, y: CY, s: 1 };
  function place() {
    const split = clamp01(S.split), dock = clamp01(S.dock), ppu = H * k, halfW = aspect * 0.5 / k, colW = 0.40 * 2 * halfW;
    const sSplit = Math.min(0.88, (colW - 0.06) / (2 * RO));
    let x = (-halfW + colW / 2) * split, y = CY, s = 1 + (sSplit - 1) * split;
    const cellW = 2 * (W * 0.956 - 132) / 12 + 12, cellH = 2 * (H * 0.914 - 60) / 6 + 12;
    const sDock = Math.max(20, Math.min(100, 0.45 * cellW, 0.4 * cellH - 8)) / (RO * ppu);
    const dx = ((S.dockX ?? W) - W / 2) / ppu, dy = (H / 2 - (S.dockY ?? H)) / ppu;
    x += (dx - x) * dock; y += (dy - y) * dock; s += (sDock - s) * dock;
    lay.x = x; lay.y = y; lay.s = s;
  }
  place();

  const sm = { listen: 0, think: 0, speak: 0, audio: 0, mic: 0, al: 0 };
  // velocità degli anelli (giri/s; il segno è il verso): barre, tratteggio, segmenti | quadrante, binario, micro-dati, esterno
  const SPD = [0.006, -0.035, 0.012, -0.0035, 0.01, 0.007, -0.0022];
  const DIR = [1, -1, 1, -1, 1, -1, 1, -1];
  const rot = new Float64Array(7);
  let spinS = 0, spinF = 0, spinC = 0, scan = 0;
  const axS = new THREE.Vector3(0.22, 1, 0.12).normalize(), axF = new THREE.Vector3(-0.3, 1, 0.25).normalize();
  const m4 = new THREE.Matrix4(), tilt = new THREE.Matrix4().makeRotationX(0.32);
  const LR = [R.base, (R.bar0 + R.bar1) / 2, R.dash, R.seg0, R.dial, R.scan, R.hex0, R.out];

  function frame(t, clock, dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    const kk = 1 - Math.exp(-dt * 5);
    const mode = S.mode || 'idle';
    sm.listen += ((mode === 'listening' ? 1 : 0) - sm.listen) * kk;
    sm.think += ((mode === 'thinking' ? 1 : 0) - sm.think) * kk;
    sm.speak += ((mode === 'speaking' ? 1 : 0) - sm.speak) * kk;
    const aud = clamp01(S.audio);
    sm.audio += (aud - sm.audio) * (1 - Math.exp(-dt * (aud > sm.audio ? 30 : 9)));
    const mic = clamp01(S.mic) * (S.hearing ? 1 : 0.6) * (0.35 + 0.65 * sm.listen);
    sm.mic += (mic - sm.mic) * (1 - Math.exp(-dt * (mic > sm.mic ? 25 : 8)));
    // allarme: smussato qui; a zero torna zero esatto, così senza allarme non resta un filo d'arancione
    const alT = Math.min(2, Math.max(0, Math.round(Number(S.allarme) || 0)));
    sm.al += (alT - sm.al) * (1 - Math.exp(-dt * 4));
    if (alT === 0 && sm.al < 0.004) sm.al = 0;
    const al1 = Math.min(1, sm.al), al2 = Math.max(0, Math.min(1, sm.al - 1));
    alarm.copy(C.orange).lerp(C.red, al2);

    // rotazioni accumulate: cambiando stato la velocità cambia senza salti
    const busy = 1 + 2.6 * sm.think + 0.5 * sm.speak + 0.25 * sm.listen;
    for (let i = 0; i < SPD.length; i++) rot[i] = (rot[i] + SPD[i] * busy * dt) % 1;
    spinS += dt * (0.09 + 0.12 * sm.think);
    spinF += dt * (0.25 + 1.6 * sm.think + 0.3 * sm.speak);
    spinC += dt * (1.2 + 2.5 * sm.think + 3 * sm.speak * sm.audio);
    scan = (scan + dt * (0.1 + 0.4 * sm.think)) % 1;
    U.uRotS.value.setFromMatrix4(m4.makeRotationAxis(axS, spinS).premultiply(tilt));
    U.uRotF.value.setFromMatrix4(m4.makeRotationAxis(axF, -spinS * 0.7).premultiply(tilt));

    // formazione e rivelazione
    const revP = (r0) => t < TIMING.reveal ? 0 : easeOut((t - TIMING.reveal - (r0 - RS) / WAVE_V) / (TIMING.ready - TIMING.reveal - (r0 - RS) / WAVE_V), 2.2);
    const pr0 = t < TIMING.formEnd ? 0 : easeOut((t - TIMING.formEnd) / 0.45, 2.2);
    const P = LR.map((r0, i) => (i === 0 ? pr0 : revP(r0)));
    const spinR = (i) => DIR[i] * 0.55 * (1 - P[i]) * (1 - P[i]);  // gli archi girano mentre si chiudono
    U.uRevA.value.set(P[0], P[1], P[2], P[3]); U.uRevB.value.set(P[4], P[5], P[6], P[7]);
    U.uRotA.value.set(0, rot[0] + spinR(1), rot[1] + spinR(2), rot[2] + spinR(3));
    U.uRotB.value.set(rot[3] + spinR(4), rot[4] + spinR(5), rot[5] + spinR(6), rot[6] + spinR(7));
    rings.visible = P[0] > 0;
    U.uScan.value = scan;
    U.uLock.value = t >= TIMING.formEnd ? Math.exp(-(t - TIMING.formEnd) * 5) : 0;
    U.uVis.value = THREE.MathUtils.smoothstep(t, 1.8, 4.0);
    U.uCore.value = THREE.MathUtils.smoothstep(t, 3.2, 4.1);

    if (t >= TIMING.formEnd && t < TIMING.formEnd + 0.6) {
      const x = (t - TIMING.formEnd) / 0.6;
      wave.visible = true; U.uWR.value = RS + (R.base - RS) * easeOut(x * 1.7); U.uWW.value = 0.004; U.uWA.value = 1.3 * (1 - x) * (1 - x);
    } else if (t >= TIMING.reveal && t < TIMING.reveal + 1.6) {
      const x = t - TIMING.reveal;
      wave.visible = true; U.uWR.value = RS + x * WAVE_V; U.uWW.value = 0.012 + 0.03 * x;
      U.uWA.value = THREE.MathUtils.smoothstep(x, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(x, 0.45, 1.6)) * 0.65; // sopra 0,7 il fronte bruciava in bianco
    } else wave.visible = false;

    // posizione, scala e tremito dell'allarme critico
    place();
    let jx = 0, jy = 0;
    if (al2 > 0) {
      jx = al2 * 0.0013 * (Math.sin(clock * 73.1) + 0.6 * Math.sin(clock * 131.7));
      jy = al2 * 0.0013 * (Math.cos(clock * 89.3) + 0.6 * Math.sin(clock * 151.1));
    }
    nucleus.position.set(lay.x + jx, lay.y + jy, 0);
    nucleus.scale.setScalar(lay.s);
    U.uPxL.value = 1 / (H * k * pr * lay.s);
    U.uPtK.value = Math.max(0.6, Math.min(1, lay.s * 1.25));
    U.uSmall.value = THREE.MathUtils.smoothstep(0.75 - lay.s, 0.0, 0.3);
    // nell'angolo le stesse particelle e gli stessi fili stanno in un'area 10 volte più piccola: si abbassano per non bruciare
    U.uDens.value = Math.min(1, Math.max(0.08, (lay.s * lay.s) / (U.uPtK.value * U.uPtK.value)));
    U.uGain.value = Math.min(1, Math.max(0.3, lay.s * 1.1));
    // e meno fili: tutti e 320 in una sfera piccola fanno un grumo bianco
    yarn.geometry.setDrawRange(0, Math.round(YARN_F * U.uGain.value) * YARN_N * 6);

    U.uT.value = t; U.uClock.value = clock; U.uPR.value = pr;
    U.uListen.value = sm.listen; U.uThink.value = sm.think; U.uSpeak.value = sm.speak; U.uAudio.value = sm.audio;
    U.uMic.value = sm.mic; U.uLev.value = Math.min(1, Math.max(sm.mic * 1.8 * sm.listen, sm.audio * sm.speak));
    U.uAl.value = al1;
    U.uSpinF.value = spinF; U.uSpinC.value = spinC;

    bloom.strength = 0.6 + 0.15 * sm.speak * sm.audio;
    composer.render(dt);
  }

  // centro, raggio della sfera e dell'anello esterno, in pixel CSS: lì oscar.js appoggia le scritte
  function anchor() {
    const ppu = H * k;
    return { x: W / 2 + lay.x * ppu, y: H / 2 - lay.y * ppu, r: RS * lay.s * ppu, R: RO * lay.s * ppu };
  }

  // avanzamento per "ASSEMBLING... N%" (22% a 0.5 s, 97% a 4.5 s come nel video)
  function assembling(t) {
    const x = Math.min(1, Math.max(0, t / 6.9));
    return 1 - Math.pow(1 - x, 3.3);
  }

  // aggancio dell'ologramma: un RenderPass subito dopo quello dell'HUD e prima del bagliore, così brilla come il resto
  // con un solo renderer (+2,4 ms contro un secondo canvas che coprirebbe il nucleo). Pulisce solo la profondità.
  function strato(sc, cam) {
    const p = new RenderPass(sc, cam);
    p.clear = false; p.clearDepth = true;
    composer.insertPass(p, composer.passes.indexOf(hudPass) + 1);
    return p;
  }

  return { frame, anchor, assembling, renderer, strato };
}
