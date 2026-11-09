// STEM: busto al neon (contorno, linee di livello, viso arancione, filamenti d'oro),
// particelle (cometa, aura, nucleo), cerchi sonar e montagne di particelle.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createMountains } from './mountains.js';

// Tempi della formazione (secondi dall'avvio): fine formazione, anello che rivela, tutto pronto
export const TIMING = { formEnd: 4.1, reveal: 5.6, ready: 6.5 };

// Unità: altezza dello schermo = 1. Origine al centro della testa, y verso l'alto.
const HEAD_Y = 0.11;                 // centro della testa: 39% dall'alto
const CORE = [0, -0.548];            // nucleo allo sterno
const HW = 0.172, HH = 0.247;        // mezza larghezza e mezza altezza della testa
const JUNCTION = -0.17;              // dove il collo entra sotto la mascella
const SCREEN_BOTTOM = -0.61;

// Profilo destro della testa (dall'alto al mento) e del corpo (dal collo in giù), misurati sul video
const HEAD_PROFILE = [[0, 0.247], [0.046, 0.242], [0.08, 0.231], [0.112, 0.21], [0.134, 0.185], [0.148, 0.158], [0.157, 0.132],
  [0.163, 0.106], [0.166, 0.081], [0.168, 0.055], [0.168, 0.03], [0.17, 0.01], [0.176, -0.018], [0.173, -0.045], [0.166, -0.072],
  [0.157, -0.098], [0.146, -0.123], [0.133, -0.149], [0.116, -0.174], [0.094, -0.2], [0.068, -0.222], [0.04, -0.238], [0, -0.247]];
const BODY_PROFILE = [[0.117, -0.1], [0.117, -0.17], [0.118, -0.22], [0.12, -0.25], [0.125, -0.272], [0.134, -0.292], [0.153, -0.315],
  [0.185, -0.337], [0.24, -0.362], [0.31, -0.384], [0.37, -0.41], [0.41, -0.44], [0.438, -0.48], [0.453, -0.53], [0.461, -0.6],
  [0.466, -0.7], [0.468, -0.85], [0.469, -1.2]];

// Regioni dei campi precalcolati
const SDF_RECT = [-0.8, -0.7, 0.8, 0.44];
const FIL_RECT = [-0.16, -0.58, 0.16, -0.22];

// Arrivo della cometa lungo il contorno: s=0 spalla sinistra, 0.3 attacco sinistro del collo,
// 0.5 cima della testa, 0.7 attacco destro, 0.76 fine mento, 1 spalla destra
const ARR = [[0, 0.45], [0.2, 1.15], [0.3, 1.35], [0.5, 1.85], [0.7, 2.55], [0.8, 2.8], [1, 3.15]];
const tArr = (s) => {
  s = Math.min(1, Math.max(0, s));
  for (let i = 1; i < ARR.length; i++) if (s <= ARR[i][0]) {
    const [s0, t0] = ARR[i - 1], [s1, t1] = ARR[i];
    return t0 + (t1 - t0) * (s - s0) / (s1 - s0);
  }
  return ARR[ARR.length - 1][1];
};
const f3 = (x) => x.toFixed(4);
const GLSL_COMMON = /* glsl */`
  float sq(float x) { return x * x; }
  float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float tArr(float s) {
    s = clamp(s, 0.0, 1.0);
    ${ARR.slice(1).map(([s1, t1], i) => { const [s0, t0] = ARR[i]; return `if (s <= ${f3(s1)}) return mix(${f3(t0)}, ${f3(t1)}, (s - ${f3(s0)}) / ${f3(s1 - s0)});`; }).join('\n    ')}
    return ${f3(ARR[ARR.length - 1][1])};
  }
`;

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Geometria del busto ----------
function spaced(points, n, closed) {
  const c = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), closed, 'centripetal');
  return c.getSpacedPoints(n).map((v) => [v.x, v.y]);
}
const arcLens = (pts) => { const a = [0]; for (let i = 1; i < pts.length; i++) a.push(a[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return a; };

function buildContours() {
  // Testa: chiusa, in senso orario a partire dalla cima
  const right = HEAD_PROFILE;
  const left = HEAD_PROFILE.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  let head = spaced([...right, ...left], 360, true);
  head = head.slice(0, -1); // l'ultimo coincide col primo
  const n = head.length;
  // attacchi del collo (destro sulla parte destra, sinistro su quella sinistra)
  let jR = 0, jL = 0, bR = 9, bL = 9;
  head.forEach(([x, y], i) => {
    const d = Math.abs(y - JUNCTION);
    if (x > 0 && d < bR) { bR = d; jR = i; }
    if (x < 0 && d < bL) { bL = d; jL = i; }
  });
  const sHead = new Float32Array(n);
  const walk = (from, to, s0, s1) => { // da from a to (indici, avanti, con giro), s lineare sull'arco
    const idx = []; for (let i = from; ; i = (i + 1) % n) { idx.push(i); if (i === to) break; }
    const pts = idx.map((i) => head[i]); const a = arcLens(pts); const L = a[a.length - 1];
    idx.forEach((i, k) => { sHead[i] = s0 + (s1 - s0) * a[k] / L; });
  };
  walk(0, jR, 0.5, 0.7);
  walk(jR, jL, 0.7, 0.76);
  walk(jL, 0, 0.3, 0.5);
  sHead[0] = 0.5;

  // Corpo: lato sinistro dal basso verso il collo, lato destro dal collo in giù, chiuso sotto lo schermo
  const bodyR = spaced(BODY_PROFILE, 300, false);
  const bodyL = bodyR.map(([x, y]) => [-x, y]).reverse();
  // s: 0..0.3 a sinistra (dal fondo dello schermo all'attacco), 0.7..1 a destra
  const sideS = (pts, fromTop) => {
    // arco a partire dall'attacco del collo
    const ord = fromTop ? pts : [...pts].reverse();
    const a = arcLens(ord);
    const kJ = ord.findIndex(([, y]) => y <= JUNCTION);
    const kB = ord.findIndex(([, y]) => y <= SCREEN_BOTTOM);
    const s = ord.map((_, k) => Math.min(1, Math.max(0, (a[k] - a[kJ]) / (a[kB] - a[kJ]))));
    return { s: fromTop ? s : s.reverse(), len: a[kB] - a[kJ] };
  };
  const rS = sideS(bodyR, true), lS = sideS(bodyL, false);
  const body = [...bodyL, ...bodyR];
  const sBody = new Float32Array(body.length);
  bodyL.forEach((_, i) => { sBody[i] = 0.3 - 0.3 * lS.s[i]; });
  bodyR.forEach((_, i) => { sBody[bodyL.length + i] = 0.7 + 0.3 * rS.s[i]; });
  return { head, sHead, body, sBody, bodyLen: rS.len };
}

// Filamenti d'oro nel collo: due fulmini ramificati che salgono dal nucleo verso il mento
function buildFilaments() {
  const R = rng(42);
  const segs = [];
  const zig = (a, b, amp, lv) => {
    if (lv === 0) return [a, b];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const o = (R() - 0.5) * 2 * amp * L;
    const m = [mx - dy / L * o, my + dx / L * o];
    return [...zig(a, m, amp, lv - 1).slice(0, -1), ...zig(m, b, amp, lv - 1)];
  };
  // ritorna la g finale; i punti sono una polilinea
  const branch = (pts, g0, w) => {
    let full = [];
    for (let i = 0; i < pts.length - 1; i++) { const z = zig(pts[i], pts[i + 1], 0.32, 3); full = full.concat(i ? z.slice(1) : z); }
    let g = g0;
    for (let i = 0; i < full.length - 1; i++) {
      const L = Math.hypot(full[i + 1][0] - full[i][0], full[i + 1][1] - full[i][1]);
      segs.push([...full[i], ...full[i + 1], g, g + L, w]); g += L;
    }
    return g;
  };
  const yc = CORE[1] + 0.03;
  const gTrunk = branch([[0, yc], [0.002, -0.47], [0, -0.445]], 0, 1);
  for (const sg of [-1, 1]) {
    const P = (x, y) => [sg * x, y];
    const gMain = branch([P(0, -0.445), P(0.012, -0.405), P(0.03, -0.362), P(0.047, -0.326), P(0.059, -0.292), P(0.064, -0.268)], gTrunk, 1);
    const ga = gTrunk + (gMain - gTrunk) * 0.42, gb = gTrunk + (gMain - gTrunk) * 0.62;
    branch([P(0.03, -0.362), P(0.024, -0.33), P(0.021, -0.3), P(0.028, -0.272)], ga, 0.8);
    branch([P(0.047, -0.326), P(0.07, -0.31), P(0.086, -0.292)], gb, 0.6);
    branch([P(0.004, -0.475), P(0.018, -0.49), P(0.03, -0.497)], gTrunk * 0.5, 0.22);
  }
  const gMax = Math.max(...segs.map((s) => s[5]));
  segs.forEach((s) => { s[4] /= gMax; s[5] /= gMax; });
  return segs;
}

// Campo precalcolato una volta sola sulla GPU: per ogni texel distanze e parametri
function bake(renderer, frag, segs, rect, w, h, type) {
  const N = segs.length;
  const data = new Float32Array(N * 2 * 4);
  segs.forEach((s, i) => { data.set(s.slice(0, 4), i * 4); data.set([s[4], s[5], s[6] ?? 0, 0], (N + i) * 4); });
  const segTex = new THREE.DataTexture(data, N, 2, THREE.RGBAFormat, THREE.FloatType);
  segTex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(w, h, { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSeg: { value: segTex }, uRect: { value: new THREE.Vector4(...rect) } },
    defines: { N },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(sc, new THREE.Camera());
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose(); segTex.dispose();
  return rt.texture;
}

const BAKE_SDF = /* glsl */`
  uniform sampler2D uSeg; uniform vec4 uRect; varying vec2 vUv;
  void main() {
    vec2 p = mix(uRect.xy, uRect.zw, vUv);
    float dh = 1e3, sh = 0.0, db = 1e3, sb = 0.0; bool inH = false, inB = false;
    for (int i = 0; i < N; i++) {
      vec4 s = texelFetch(uSeg, ivec2(i, 0), 0);
      vec4 m = texelFetch(uSeg, ivec2(i, 1), 0);
      vec2 a = s.xy, b = s.zw, pa = p - a, ba = b - a;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);
      bool cr = ((a.y > p.y) != (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x);
      if (m.z < 0.5) { if (d < dh) { dh = d; sh = mix(m.x, m.y, h); } if (cr) inH = !inH; }
      else { if (d < db) { db = d; sb = mix(m.x, m.y, h); } if (cr) inB = !inB; }
    }
    gl_FragColor = vec4(inH ? -dh : dh, sh, inB ? -db : db, sb);
  }
`;
const BAKE_FIL = /* glsl */`
  uniform sampler2D uSeg; uniform vec4 uRect; varying vec2 vUv;
  void main() {
    vec2 p = mix(uRect.xy, uRect.zw, vUv);
    float best = 1e3, g = 0.0, w = 0.0;
    for (int i = 0; i < N; i++) {
      vec4 s = texelFetch(uSeg, ivec2(i, 0), 0);
      vec4 m = texelFetch(uSeg, ivec2(i, 1), 0);
      vec2 pa = p - s.xy, ba = s.zw - s.xy;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);
      if (d < best) { best = d; g = mix(m.x, m.y, h); w = m.z; }
    }
    gl_FragColor = vec4(best, g, w, 0.0);
  }
`;

// ---------- Shader del busto ----------
const BUST_VERT = /* glsl */`
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BUST_FRAG = /* glsl */`
  uniform sampler2D uSdf, uFil;
  uniform vec4 uSdfRect, uFilRect;
  uniform float uT, uClock, uPx, uPR, uFill, uLenB;
  uniform float uSpeak, uListen, uThink, uMic;
  uniform vec3 cOut, cOutCore, cLine, cLineHi, cFace, cFace2, cHot, cGold, cFillC;
  varying vec2 vP;
  ${GLSL_COMMON}
  float lineAA(float f, float w) {
    float d = abs(fract(f + 0.5) - 0.5) / max(fwidth(f), 1e-5);
    return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.9, d);
  }
  void main() {
    vec2 p = vP;
    vec4 sd = texture2D(uSdf, (p - uSdfRect.xy) / (uSdfRect.zw - uSdfRect.xy));
    float dH = sd.r, sH = sd.g, dB = sd.b, sB = sd.a;
    float px = uPx;
    float inHead = smoothstep(px, -px, dH);
    float inBodyAll = smoothstep(px, -px, dB);
    float inBody = inBodyAll * (1.0 - inHead);
    float inside = max(inHead, inBodyAll);
    float speak = uSpeak;

    // tempi della formazione
    float tH = tArr(sH), tB = tArr(sB);
    float visOH = smoothstep(tH, tH + 0.3, uT), visOB = smoothstep(tB, tB + 0.3, uT);
    float hotH = visOH * exp(-max(uT - tH, 0.0) * 2.2), hotB = visOB * exp(-max(uT - tB, 0.0) * 2.2);
    float formed = smoothstep(3.0, 4.2, uT);

    vec3 col = vec3(0.0);

    // --- Contorno al neon (testa intera, corpo solo fuori dalla testa)
    float oH = abs(dH);
    float oB = abs(dB);
    float bodyOut = smoothstep(-0.001, 0.006, dH);
    float glowK = 1.0 + 0.55 * speak + 0.45 * uListen * uMic;
    float wO = 0.0024;
    float coreH = exp(-sq(oH / wO)), thinH = exp(-sq(oH / (wO * 0.45))), haloH = exp(-oH / 0.008);
    float coreB = exp(-sq(oB / wO)), thinB = exp(-sq(oB / (wO * 0.45))), haloB = exp(-oB / 0.008);
    vec3 outH = (cOutCore * thinH * 0.7 + cOut * (coreH * 1.25 + haloH * 0.2)) * visOH * (1.0 + hotH * 0.7);
    vec3 outB = (cOutCore * thinB * 0.6 + cOut * (coreB * 1.15 + haloB * 0.18)) * visOB * (1.0 + hotB * 0.7) * bodyOut;
    col += (outH + outB) * glowK;

    // --- Testa: curve di livello orizzontali
    vec2 hn = vec2(p.x / ${f3(HW)}, p.y / ${f3(HH)});
    float fr = 1.0 + 0.28 * speak;
    float fm = exp(-(sq(hn.x / (0.58 * fr)) + sq((hn.y + 0.3) / (0.42 * fr))));      // zona del viso
    float cm = exp(-(sq(hn.x / (0.26 * fr)) + sq((hn.y + 0.3) / (0.15 * fr))));      // centro caldo
    float wav = (0.3 + 0.7 * fm) * 0.024 * (1.0 + 0.9 * speak) *
      (sin(hn.x * 8.3 + hn.y * 3.1 + uClock * 0.8) * 0.6 + sin(hn.x * 15.7 - hn.y * 5.3 - uClock * 1.3) * 0.4);
    float F = hn.y * (1.0 + 0.17 * hn.x * hn.x) + wav;
    float fl = F * 20.5;
    float li = floor(fl + 0.5);
    float lw = 1.1 * uPR + 0.3;
    float lH = lineAA(fl, lw);
    float dotsH = 0.5 + 0.5 * smoothstep(0.2, 0.8, fract(p.x * 235.0 + hash1(li) * 13.0));
    float lbr = 0.7 + 0.3 * hash1(li * 3.7 + 1.0);
    float depthH = max(-dH, 0.0);
    float tL = tH + 0.35 + depthH * 6.5;
    float visL = max(smoothstep(tL, tL + 0.5, uT), smoothstep(3.3, 3.9, uT));
    float rim = exp(-depthH / 0.028);
    float faceVis = smoothstep(2.9, 4.0, uT);
    float idle = 0.93 + 0.07 * sin(uClock * 1.1);
    float heat = clamp(cm * speak * 1.25, 0.0, 1.0);
    vec3 blueL = mix(cLine * 0.85, cLineHi * 1.15, rim);
    vec3 faceL = mix(cFace, cFace2, smoothstep(0.25, 0.95, cm)) * (1.2 + 0.85 * speak) * idle;
    faceL = mix(faceL, cHot * 1.7, heat * 0.85); // si scalda verso il giallo, le linee restano leggibili
    float faceMix = smoothstep(0.12, 0.55, fm) * faceVis;
    vec3 lineCol = mix(blueL, faceL, faceMix);
    // pensiero: una banda che risale lenta lungo la testa
    float scan = exp(-sq((hn.y - (fract(uClock * 0.32) * 2.6 - 1.3)) / 0.16)) * uThink;
    lineCol += cLineHi * scan * 0.9;
    col += lineCol * lH * dotsH * lbr * visL * inHead;
    // bagliore del viso sotto le linee
    col += (cFace * fm * 0.13 + cFace2 * cm * 0.08) * faceVis * idle * (1.0 + 1.6 * speak) * inHead;
    col += cHot * cm * speak * 0.22 * inHead;
    // alone interno lungo il bordo
    col += cOut * exp(-depthH / 0.014) * 0.07 * inHead * visOH;

    // --- Collo, spalle e petto: linee parallele al contorno
    float depthB = max(-dB, 0.0);
    float fb = depthB / 0.0118;
    float lB = lineAA(fb, lw) * smoothstep(0.006, 0.011, depthB);
    float lbi = floor(fb + 0.5);
    float dotsB = 0.45 + 0.55 * smoothstep(0.2, 0.8, fract(sB * uLenB / 0.3 / 0.0042 + hash1(lbi) * 11.0));
    float bb = 0.5 + 0.65 * exp(-depthB / 0.05);
    float tLB = tB + 0.12 + depthB * 2.6;
    float visLB = max(smoothstep(tLB, tLB + 0.5, uT), smoothstep(3.4, 4.0, uT));
    col += mix(cLine * 0.6, cLineHi * 0.9, exp(-depthB / 0.03)) * lB * dotsB * bb * visLB * inBody;

    // --- Filamenti d'oro
    vec2 fu = (p - uFilRect.xy) / (uFilRect.zw - uFilRect.xy);
    float inF = step(0.0, fu.x) * step(fu.x, 1.0) * step(0.0, fu.y) * step(fu.y, 1.0);
    vec4 fd = texture2D(uFil, clamp(fu, 0.0, 1.0));
    float grow = clamp((uT - 2.55) / 1.3, 0.0, 1.0);
    float gv = smoothstep(fd.g - 0.02, fd.g + 0.02, grow * 1.05 - 0.025);
    float tip = exp(-sq((grow - fd.g) / 0.05)) * (1.0 - smoothstep(0.95, 1.0, grow));
    float pulse = 1.0 + uThink * 0.7 * (0.5 + 0.5 * sin(fd.g * 28.0 - uClock * 5.0)) + speak * 0.35;
    float fcore = exp(-sq(fd.r / 0.0008)), fglow = exp(-fd.r / 0.004);
    float fil = (fcore * 1.3 + fglow * 0.16) * fd.b * gv * inF * smoothstep(0.0, 0.008, dH);
    col += mix(cGold, cHot, fcore * 0.35) * fil * (1.0 + tip * 2.5) * pulse;

    // riempimento scuro: nasconde montagne e cerchi dietro al busto
    float a = inside * uFill;
    vec3 fill = cFillC;
    gl_FragColor = vec4(fill * a + col, a);
  }
`;

// ---------- Sfondo, anelli, globo ----------
const FS_VERT = /* glsl */`
  uniform vec2 uHalf; varying vec2 vP;
  void main() { vP = position.xy * uHalf; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BG_FRAG = /* glsl */`
  uniform vec2 uHalf, uHead; uniform vec3 cBgA, cBgB; varying vec2 vP;
  void main() {
    vec2 q = vP / uHalf;
    float v = length(q * vec2(0.75, 1.0));
    vec3 c = mix(cBgA, cBgB, smoothstep(0.15, 1.25, v));
    gl_FragColor = vec4(c, 1.0);
  }
`;
const RINGS_FRAG = /* glsl */`
  uniform vec2 uHead; uniform float uScale, uPx, uPR, uClock, uRevealR, uRevealA, uRings, uMic;
  uniform vec3 cRing, cRingHi; varying vec2 vP;
  ${GLSL_COMMON}
  void main() {
    vec2 d = (vP - uHead) / uScale;
    float r = length(d), ang = atan(d.y, d.x);
    vec3 col = vec3(0.0);
    // anello spesso che rivela le montagne
    float band = exp(-sq((r - uRevealR) / 0.034));
    float inner = smoothstep(uRevealR - 0.22, uRevealR, r) * step(r, uRevealR);
    col += (cRingHi * band * 0.18 + cRing * (band * 0.75 + inner * 0.16)) * uRevealA;
    // cerchi sonar: si allargano, uno ogni 0.65 s
    if (uRings > 0.001) {
      float per = 0.65, ph = uClock / per, frc = fract(ph), base = floor(ph);
      float pxu = uPx / uScale;
      float acc = 0.0;
      for (int i = 0; i < 9; i++) {
        float ri = 0.235 + (float(i) + frc) * 0.05;
        float id = float(i) - base;
        float fade = smoothstep(0.235, 0.3, ri) * (1.0 - smoothstep(0.5, 0.66, ri));
        float wob = uMic * 0.007 * sin(ang * 5.0 + uClock * 3.0 + id * 1.7);
        float dd = abs(r - ri - wob) / pxu;
        float l = 1.0 - smoothstep(0.55 * uPR, 1.5 * uPR, dd);
        float h = hash1(id * 7.31 + 3.0);
        float dots = mix(0.55 + 0.45 * smoothstep(0.3, 0.6, fract(ang * ri / 0.0055)), 1.0, step(0.55, h));
        float gap = h < 0.25 ? smoothstep(0.1, 0.2, abs(fract(ang / 6.2832 + h * 3.0) - 0.5)) : 1.0;
        acc += l * fade * dots * gap * (0.6 + 0.4 * hash1(id * 3.1));
      }
      col += cRing * acc * uRings * (0.42 + 0.9 * uMic);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
const ORB_FRAG = /* glsl */`
  uniform float uSize, uBright; uniform vec3 cOrb, cOrbCore; varying vec2 vQ;
  void main() {
    float r = length(vQ);
    float s = max(uSize, 1e-3);
    float core = exp(-r / (0.0055 * s));
    float halo = exp(-sq(r / (0.032 * s))) * 0.7 + exp(-r / (0.05 * s)) * 0.25;
    vec3 c = (cOrbCore * core * 2.2 + cOrb * halo) * uBright;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// ---------- Particelle ----------
const PART_VERT = /* glsl */`
  uniform float uT, uClock, uPR, uSpeak, uThink, uListen, uMic;
  uniform vec2 uOrb;
  attribute float aKind; attribute vec4 aA; attribute vec4 aR;
  varying vec3 vC;
  ${GLSL_COMMON}
  vec2 bez(vec2 a, vec2 b, vec2 c, vec2 d, float s) { float o = 1.0 - s; return o*o*o*a + 3.0*o*o*s*b + 3.0*o*s*s*c + s*s*s*d; }
  vec2 flight(vec2 tgt, float s, vec4 r, float spread, float hook) {
    vec2 c1 = uOrb + vec2(0.4 + 0.12 * r.x, 0.2 + 0.12 * r.y);
    vec2 c2 = vec2(0.2 + 0.3 * tgt.x + 0.12 * r.z, max(tgt.y, -0.3) + hook + 0.12 * r.w);
    vec2 q = bez(uOrb, c1, c2, tgt, s);
    float env = sin(3.14159 * s);
    q += (r.zw - 0.5) * spread * env;
    float an = uT * 1.6 + r.x * 6.2832;
    q += vec2(cos(an), sin(an)) * 0.025 * env * r.y;
    return q;
  }
  void main() {
    vec2 p = uOrb; float a = 0.0; float sz = 1.5;
    vec3 c = vec3(0.3, 0.68, 1.0);
    float k = aKind;
    if (k < 0.5) {
      // cometa che deposita il contorno
      float ta = aA.z;
      float e = max(ta - (0.55 + 0.5 * aR.x), 0.02 + aR.y * 0.12);
      float D = ta - e;
      float s = (uT - e) / D;
      if (s >= 0.0 && s < 1.0) {
        p = flight(aA.xy, s, aR, 0.03 + 0.09 * smoothstep(0.6, 2.2, ta), 0.46);
        a = smoothstep(0.0, 0.06, s) * (0.4 + 0.25 * s);
        sz = 1.3 + 1.1 * aR.z;
        c = mix(vec3(0.25, 0.6, 1.0), vec3(0.6, 0.9, 1.0), s * s);
      } else if (s >= 1.0) {
        float age = uT - ta;
        p = aA.xy + (aR.zw - 0.5) * 0.007 * (1.0 + age * 1.5);
        a = exp(-age * 1.3) * 0.6;
        sz = 1.5 + 1.1 * aR.z;
        c = mix(vec3(0.75, 0.95, 1.0), vec3(0.3, 0.65, 1.0), clamp(age * 1.5, 0.0, 1.0));
      }
    } else if (k < 1.5) {
      // particelle arancioni che si raccolgono nel viso
      float ta = aA.z;
      float e = ta - (0.7 + 0.45 * aR.x);
      float s = (uT - e) / (ta - e);
      c = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.62, 0.2), aR.y);
      if (s >= 0.0 && s < 1.0) {
        p = flight(aA.xy, s, aR, 0.12, 0.3);
        a = smoothstep(0.0, 0.15, s) * 0.75;
        c = mix(vec3(0.35, 0.6, 1.0), c, smoothstep(0.2, 0.7, s));
      } else if (s >= 1.0) {
        float age = uT - ta;
        float sw = 0.012 + 0.03 * exp(-age * 1.5);
        vec2 j = vec2(sin(uT * 1.3 + aR.z * 6.3), cos(uT * 1.1 + aR.w * 6.3)) * sw;
        p = aA.xy + j;
        p.y = mix(p.y, aA.w, smoothstep(3.1, 3.8, uT));
        a = 0.85 * (1.0 - smoothstep(3.7, 4.5, uT));
      }
      sz = 1.4 + 1.0 * aR.z;
    } else if (k < 2.5) {
      // nuvola che vortica e poi si disperde a destra
      float ta = aA.z;
      float e = max(ta - (0.6 + 0.5 * aR.x), 0.02 + aR.y * 0.15);
      float D = ta - e;
      float s = clamp((uT - e) / D, 0.0, 0.5 + 0.42 * aR.w);
      if (uT > e) {
        p = flight(aA.xy, s, aR, 0.16 + 0.1 * aR.y, 0.55);
        float sw = uT * (0.5 + aR.x) + aR.z * 6.3;
        p += vec2(cos(sw), sin(sw)) * 0.03 * aR.w;
        float go = max(uT - 2.6 - aR.x * 0.4, 0.0);
        p += vec2(0.32, 0.05 + 0.1 * (aR.y - 0.5)) * go * go * (0.6 + aR.z);
        a = smoothstep(0.0, 0.08, (uT - e) / D) * 0.42 * (1.0 - smoothstep(3.3, 4.4 + aR.z * 0.4, uT));
        c = mix(vec3(0.25, 0.58, 1.0), vec3(0.55, 0.85, 1.0), aR.z);
        if (aR.x > 0.82) c = vec3(1.0, 0.5, 0.15);
      }
      sz = 1.2 + 1.0 * aR.z;
    } else if (k < 3.5) {
      // aura sopra la testa
      float life = fract(uClock * 0.07 * (0.6 + aR.x) + aR.y);
      float dist = 0.003 + aR.z * aR.z * 0.12 + life * 0.025;
      p = aA.xy + aA.zw * dist + vec2(sin(uClock * 0.4 + aR.w * 9.0) * 0.004, life * 0.012);
      a = sin(3.14159 * life) * (1.0 - smoothstep(0.03, 0.14, dist)) * 0.9 + 0.1;
      a *= smoothstep(aR.w, aR.w + 0.9, uT) * (0.85 + 0.3 * uSpeak + 0.25 * uListen * uMic);
      sz = 1.0 + 1.3 * fract(aR.x * 7.1);
      c = mix(vec3(0.2, 0.55, 1.0), vec3(0.65, 0.9, 1.0), fract(aR.y * 5.3));
    } else if (k < 4.5) {
      // scintille aggrappate al contorno
      float off = aR.z * aR.z * 0.028;
      p = aA.xy + aA.zw * off + vec2(sin(uClock * 0.6 + aR.x * 20.0), cos(uClock * 0.5 + aR.y * 20.0)) * 0.0015;
      float tw = 0.55 + 0.45 * sin(uClock * (1.0 + 2.5 * aR.x) + aR.y * 6.3);
      a = tw * smoothstep(aR.w, aR.w + 0.4, uT) * (1.0 - aR.z * 0.6) * (0.9 + 0.4 * uSpeak);
      sz = 1.0 + 1.2 * fract(aR.y * 3.7);
      c = mix(vec3(0.3, 0.7, 1.0), vec3(0.8, 0.96, 1.0), fract(aR.x * 4.1));
    } else {
      // nucleo di particelle allo sterno
      float ang = uClock * (0.3 + aR.x * 0.4) + aR.y * 6.2832;
      p = aA.xy + vec2(cos(ang), sin(ang)) * 0.003;
      float tw = 0.5 + 0.5 * sin(uClock * (2.0 + 3.0 * aR.z) + aR.w * 6.3);
      a = (0.25 + 0.45 * tw) * smoothstep(3.6, 5.2, uT) * (1.0 + 0.5 * uSpeak + 0.4 * uThink);
      sz = 1.0 + 1.3 * aR.z;
      c = mix(vec3(0.35, 0.8, 1.0), vec3(0.85, 0.97, 1.0), aR.w);
    }
    vC = c * a;
    gl_PointSize = sz * uPR;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
    if (a <= 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const PART_FRAG = /* glsl */`
  varying vec3 vC;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vC * smoothstep(0.5, 0.12, d), 1.0);
  }
`;

function buildParticles(C) {
  const R = rng(777);
  const kind = [], A = [], Rr = [];
  const add = (k, a, r) => { kind.push(k); A.push(...a); Rr.push(...r); };
  const rnd4 = () => [R(), R(), R(), R()];

  // punti visibili del contorno con normale verso l'esterno e parametro s
  const outline = [];
  const pushContour = (pts, ss, closed, filter) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      if (!closed && (i === 0 || i === pts.length - 1)) continue;
      const [x, y] = pts[i];
      if (!filter(x, y)) continue;
      const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
      outline.push({ x, y, nx: -ty / L, ny: tx / L, s: ss[i], head: closed });
    }
  };
  pushContour(C.head, C.sHead, true, () => true);
  pushContour(C.body, C.sBody, false, (x, y) => y < JUNCTION - 0.005 && y > SCREEN_BOTTOM + 0.005);
  const pick = () => outline[(R() * outline.length) | 0];

  // 0) cometa che disegna il contorno
  for (let i = 0; i < 9000; i++) {
    const o = pick();
    const j = (R() - 0.5) * 0.006;
    add(0, [o.x + o.nx * j, o.y + o.ny * j, tArr(o.s) + (R() - 0.5) * 0.08, o.s], rnd4());
  }
  // 1) viso arancione
  for (let i = 0; i < 5500; i++) {
    const rr = Math.sqrt(R()), th = R() * Math.PI * 2;
    const x = Math.cos(th) * rr * 0.1, y = -0.074 + Math.sin(th) * rr * 0.1;
    const hx = x / HW, F = (y / HH) * (1 + 0.17 * hx * hx);
    const ys = Math.round(F * 20.5) / 20.5 * HH / (1 + 0.17 * hx * hx);
    add(1, [x, y, 1.55 + R() * 1.4, ys], rnd4());
  }
  // 2) nuvola
  for (let i = 0; i < 9000; i++) {
    const o = pick();
    add(2, [o.x, o.y, tArr(o.s), 0], rnd4());
  }
  // 3) aura: soprattutto in cima alla testa
  const headPts = outline.filter((o) => o.head);
  for (let n = 0; n < 6500;) {
    const o = headPts[(R() * headPts.length) | 0];
    const ang = Math.atan2(o.x, o.y); // 0 in cima
    const w = Math.exp(-(ang * ang) / (2 * 0.55 * 0.55)) + 0.12 * (o.x > 0 ? 1.3 : 0.7) * (o.y > -0.1 ? 1 : 0);
    if (R() > w) continue;
    const r = rnd4(); r[3] = tArr(o.s) + 0.6;
    const nx = o.nx * 0.8 + (R() - 0.5) * 0.5, ny = o.ny * 0.8 + 0.25 + (R() - 0.5) * 0.3, L = Math.hypot(nx, ny);
    add(3, [o.x, o.y, nx / L, ny / L], r);
    n++;
  }
  // 4) scintille sul contorno (più fitte sulle spalle e in cima)
  for (let n = 0; n < 7000;) {
    const o = pick();
    const w = o.head ? (o.y > 0.1 ? 1 : 0.45) : (Math.abs(o.x) > 0.25 ? 1 : 0.5);
    if (R() > w) continue;
    const r = rnd4(); r[3] = tArr(o.s) + 0.15;
    add(4, [o.x, o.y, o.nx, o.ny], r);
    n++;
  }
  // 5) nucleo
  for (let i = 0; i < 600; i++) {
    const rr = Math.pow(R(), 0.7), th = R() * Math.PI * 2;
    add(5, [CORE[0] + Math.cos(th) * rr * 0.04, CORE[1] + Math.sin(th) * rr * 0.03 - 0.004, 0, 0], rnd4());
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(kind.length * 3), 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 4));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(Rr, 4));
  return g;
}

// ---------- Scena ----------
export async function createScene(canvas, S) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pr = Math.min(window.devicePixelRatio || 1, 1.5); // 1,5x invece di 2x: il 44% di pixel in meno, le linee restano nitide
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);

  const floatLinear = renderer.extensions.has('OES_texture_float_linear');
  const ftype = floatLinear ? THREE.FloatType : THREE.HalfFloatType;
  const C = buildContours();
  const segs = [];
  for (let i = 0; i < C.head.length; i++) {
    const j = (i + 1) % C.head.length;
    let s0 = C.sHead[i], s1 = C.sHead[j];
    if (Math.abs(s1 - s0) > 0.1) s1 = s0; // salto del parametro all'attacco sinistro
    segs.push([...C.head[i], ...C.head[j], s0, s1, 0]);
  }
  for (let i = 0; i < C.body.length; i++) {
    const j = (i + 1) % C.body.length;
    let s0 = C.sBody[i], s1 = C.sBody[j];
    if (Math.abs(s1 - s0) > 0.1) s1 = s0;
    segs.push([...C.body[i], ...C.body[j], s0, s1, 1]);
  }
  const sdfTex = bake(renderer, BAKE_SDF, segs, SDF_RECT, 1024, Math.round(1024 * (SDF_RECT[3] - SDF_RECT[1]) / (SDF_RECT[2] - SDF_RECT[0])), ftype);
  const filTex = bake(renderer, BAKE_FIL, buildFilaments(), FIL_RECT, 512, 576, ftype);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, -10, 10);
  const col = (hex) => new THREE.Color(hex);

  // sfondo
  const fsGeo = new THREE.PlaneGeometry(2, 2);
  const half = new THREE.Vector2(1, 0.5);
  const head = new THREE.Vector2(0, HEAD_Y);
  const bg = new THREE.Mesh(fsGeo, new THREE.ShaderMaterial({
    uniforms: { uHalf: { value: half }, uHead: { value: head }, cBgA: { value: col(0x0a1229) }, cBgB: { value: col(0x03050c) } },
    vertexShader: FS_VERT, fragmentShader: BG_FRAG, depthTest: false, depthWrite: false, transparent: true,
  }));
  bg.renderOrder = 0; bg.frustumCulled = false;
  scene.add(bg);

  // montagne
  const mountains = createMountains();
  scene.add(mountains.group);

  // cerchi e anello della rivelazione
  const ringU = {
    uHalf: { value: half }, uHead: { value: head }, uScale: { value: 1 }, uPx: { value: 0.001 }, uPR: { value: pr },
    uClock: { value: 0 }, uRevealR: { value: 0 }, uRevealA: { value: 0 }, uRings: { value: 0 }, uMic: { value: 0 },
    cRing: { value: col(0x1f8fff) }, cRingHi: { value: col(0x63c6ff) },
  };
  const rings = new THREE.Mesh(fsGeo, new THREE.ShaderMaterial({
    uniforms: ringU, vertexShader: FS_VERT, fragmentShader: RINGS_FRAG,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  rings.renderOrder = 3; rings.frustumCulled = false;
  scene.add(rings);

  // busto
  const bust = new THREE.Group();
  scene.add(bust);
  const bustU = {
    uSdf: { value: sdfTex }, uFil: { value: filTex },
    uSdfRect: { value: new THREE.Vector4(...SDF_RECT) }, uFilRect: { value: new THREE.Vector4(...FIL_RECT) },
    uT: { value: 0 }, uClock: { value: 0 }, uPx: { value: 0.001 }, uPR: { value: pr }, uFill: { value: 0 }, uLenB: { value: C.bodyLen },
    uSpeak: { value: 0 }, uListen: { value: 0 }, uThink: { value: 0 }, uMic: { value: 0 },
    cOut: { value: col(0x1c95ff) }, cOutCore: { value: col(0x9ff0ff) }, cLine: { value: col(0x2a86ff) }, cLineHi: { value: col(0x6cc8ff) },
    cFace: { value: col(0xff7a12) }, cFace2: { value: col(0xffb040) }, cHot: { value: col(0xfff1c4) }, cGold: { value: col(0xffb648) },
    cFillC: { value: col(0x040916) },
  };
  const bw = SDF_RECT[2] - SDF_RECT[0], bh = SDF_RECT[3] - SDF_RECT[1];
  const bustGeo = new THREE.PlaneGeometry(bw, bh);
  bustGeo.translate((SDF_RECT[0] + SDF_RECT[2]) / 2, (SDF_RECT[1] + SDF_RECT[3]) / 2, 0);
  const bustMesh = new THREE.Mesh(bustGeo, new THREE.ShaderMaterial({
    uniforms: bustU, vertexShader: BUST_VERT, fragmentShader: BUST_FRAG, extensions: { derivatives: true },
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  bustMesh.renderOrder = 4; bustMesh.frustumCulled = false;
  bust.add(bustMesh);

  // globo / nucleo luminoso
  const orbU = { uSize: { value: 1 }, uBright: { value: 1 }, cOrb: { value: col(0x1f8cff) }, cOrbCore: { value: col(0xe6f8ff) } };
  const orbGeo = new THREE.PlaneGeometry(0.5, 0.5);
  const orb = new THREE.Mesh(orbGeo, new THREE.ShaderMaterial({
    uniforms: orbU,
    vertexShader: 'varying vec2 vQ; void main() { vQ = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_COMMON}\n${ORB_FRAG}`,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  orb.position.set(CORE[0], CORE[1], 0);
  orb.renderOrder = 5; orb.frustumCulled = false;
  bust.add(orb);

  // particelle
  const partU = {
    uT: { value: 0 }, uClock: { value: 0 }, uPR: { value: pr }, uSpeak: { value: 0 }, uThink: { value: 0 }, uListen: { value: 0 }, uMic: { value: 0 },
    uOrb: { value: new THREE.Vector2(CORE[0], CORE[1]) },
  };
  const parts = new THREE.Points(buildParticles(C), new THREE.ShaderMaterial({
    uniforms: partU, vertexShader: PART_VERT, fragmentShader: PART_FRAG,
    depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  }));
  parts.renderOrder = 6; parts.frustumCulled = false;
  bust.add(parts);

  // post: bagliore. Il render target ha lo stencil per la sezione piena dell'ologramma (strato): senza, il tappo non si vede (misurato)
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, stencilBuffer: true }));
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  const hudPass = new RenderPass(scene, camera);
  composer.addPass(hudPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.45, 0.18);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // inquadratura: con finestre strette tutto si rimpicciolisce
  let W = innerWidth, H = innerHeight, aspect = W / H, k = Math.min(1, aspect / 1.4);
  function layout() {
    W = innerWidth; H = innerHeight; aspect = W / H; k = Math.min(1, aspect / 1.4);
    camera.left = -aspect * 0.5 / k; camera.right = aspect * 0.5 / k; camera.top = 0.5 / k; camera.bottom = -0.5 / k;
    camera.updateProjectionMatrix();
    half.set(aspect * 0.5 / k, 0.5 / k);
  }
  layout();
  addEventListener('resize', () => {
    pr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
    layout();
  });

  const sm = { speak: 0, listen: 0, think: 0, audio: 0, rings: 0 };
  const ease = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

  function frame(t, clock, dt) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    const kk = 1 - Math.exp(-dt * 5);
    const mode = S.mode || 'idle';
    sm.listen += ((mode === 'listening' ? 1 : 0) - sm.listen) * kk;
    sm.think += ((mode === 'thinking' ? 1 : 0) - sm.think) * kk;
    const speakOn = mode === 'speaking' ? 1 : 0;
    sm.speak += (speakOn - sm.speak) * kk;
    const aud = Math.min(1, Math.max(0, S.audio || 0));
    sm.audio += (aud - sm.audio) * (1 - Math.exp(-dt * (aud > sm.audio ? 30 : 9)));
    const speak = sm.speak * (0.25 + 0.75 * sm.audio);
    const mic = Math.min(1, Math.max(0, S.mic || 0));

    // busto: posizione e scala (S.split lo sposta a sinistra, S.dock lo rimpicciolisce nell'angolo del report)
    const split = Math.min(1, Math.max(0, S.split || 0));
    const dock = Math.min(1, Math.max(0, S.dock || 0));
    const sc = (1 - 0.12 * split) * (1 - 0.7 * dock);
    const bx = -split * 0.255 * aspect / k, by = HEAD_Y - 0.02 * split;
    const dx = ((S.dockX ?? W) - W / 2) / (H * k), dy = (H / 2 - (S.dockY ?? H)) / (H * k);
    bust.position.set(bx + (dx - bx) * dock, by + (dy - by) * dock, 0);
    bust.scale.setScalar(sc);
    head.set(bust.position.x, bust.position.y);
    const unitsPerPx = 1 / (H * k * pr);

    bustU.uT.value = t; bustU.uClock.value = clock;
    bustU.uPx.value = unitsPerPx / sc; bustU.uPR.value = pr;
    bustU.uFill.value = ease(3.0, 5.0, t);
    bustU.uSpeak.value = speak; bustU.uListen.value = sm.listen; bustU.uThink.value = sm.think; bustU.uMic.value = mic;

    partU.uT.value = t; partU.uClock.value = clock; partU.uPR.value = pr;
    partU.uSpeak.value = speak; partU.uThink.value = sm.think; partU.uListen.value = sm.listen; partU.uMic.value = mic;

    // globo: grande durante la cometa, poi si riduce al nucleo
    const big = 1 - ease(2.6, 5.0, t);
    orbU.uSize.value = (0.22 + 0.78 * big) * (1 + 0.04 * Math.sin(clock * 9)) * ease(-0.05, 0.25, t);
    orbU.uBright.value = (0.55 + 0.45 * big) * (1 + 0.6 * speak + 0.3 * sm.think * (0.5 + 0.5 * Math.sin(clock * 4)));

    // anello che si allarga e cerchi sonar
    const R = Math.max(0, t - TIMING.reveal) * 1.0 + (t > TIMING.reveal ? 0.02 : 0);
    ringU.uRevealR.value = R;
    ringU.uRevealA.value = ease(TIMING.reveal, TIMING.reveal + 0.12, t) * (1 - ease(6.45, 6.95, t));
    const intro = ease(6.2, 6.6, t) * (1 - ease(8.0, 9.5, t));
    const wantRings = t > 6.2 ? Math.max(intro, sm.listen * ease(6.2, 6.6, t)) : 0;
    sm.rings += (wantRings - sm.rings) * (t < 7 ? 1 : kk);
    ringU.uRings.value = sm.rings; ringU.uMic.value = mic * sm.listen;
    ringU.uClock.value = clock; ringU.uScale.value = sc; ringU.uPx.value = unitsPerPx; ringU.uPR.value = pr;

    // montagne: compaiono dai lati verso il centro mentre passa l'anello
    const side = 1.05 - 1.4 * ease(TIMING.reveal + 0.1, TIMING.ready + 0.05, t);
    mountains.update({ aspect, k, clock, side: t < TIMING.reveal ? 2 : side, shift: -split * 0.12, pr, bright: (1 + 0.08 * speak) * (1 - 0.8 * dock) }); // col report le montagne si abbassano: lo sfondo torna scuro

    bloom.strength = 0.85 + 0.12 * speak + 0.1 * sm.listen * mic;
    composer.render(dt);
  }

  // centro della testa e raggio (pixel CSS), per l'HUD
  function anchor() {
    const ppu = H * k;
    return { x: W / 2 + bust.position.x * ppu, y: H / 2 - bust.position.y * ppu, r: HH * bust.scale.x * ppu };
  }

  // avanzamento per "ASSEMBLING... N%" (22% a 0.5 s, 97% a 4.5 s come nel video)
  function assembling(t) {
    const x = Math.min(1, Math.max(0, t / 6.9));
    return 1 - Math.pow(1 - x, 3.3);
  }

  // aggancio dell'ologramma: un RenderPass subito dopo quello dell'HUD e prima del bagliore, così brilla come il resto
  // con un solo renderer (+2,4 ms contro un secondo canvas che coprirebbe la testa). Pulisce solo la profondità.
  function strato(sc, cam) {
    const p = new RenderPass(sc, cam);
    p.clear = false; p.clearDepth = true;
    composer.insertPass(p, composer.passes.indexOf(hudPass) + 1);
    return p;
  }

  return { frame, anchor, assembling, renderer, strato };
}
