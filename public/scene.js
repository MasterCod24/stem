// La testa: particelle che si assemblano come calamite, poi diventano fibre; occhi luminosi.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Tempi della formazione (secondi dall'apertura)
export const T = { gather: 0.9, spread: 2.6, travel: 1.7, fibers: 2.6, fiberSpan: 2.2, body: 3.4, eyes: 5.4 };

const N_PARTICLES = 26000;
const LEVELS = 150;
const HEAD_HEIGHT = 2.6;
// Occhi: x come frazione di metà testa, y come frazione della distanza cima-naso
const EYE = { xr: 0.33, yr: 0.76, inset: 0.03 };

const GLSL_COMMON = /* glsl */`
  float fiberTime(float level) { return ${T.fibers.toFixed(2)} + level * ${T.fiberSpan.toFixed(2)}; }
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
`;

export async function createScene(canvas, S) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03070c);
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0.1, 7.4);

  const head = new THREE.Group();
  scene.add(head);

  // --- Geometria della testa ---
  const gltf = await new GLTFLoader().loadAsync('/models/LeePerrySmith.glb');
  let src = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
  const raw = src.geometry.clone().applyMatrix4(src.matrixWorld);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', raw.attributes.position);
  if (raw.index) g.setIndex(raw.index);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const c = bb.getCenter(new THREE.Vector3());
  const s = HEAD_HEIGHT / (bb.max.y - bb.min.y);
  g.translate(-c.x, -c.y, -c.z);
  g.scale(s, s, s);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const minY = g.boundingBox.min.y, maxY = g.boundingBox.max.y, H = maxY - minY;

  // Misure del viso dal modello: punta del naso, mento, larghezza all'altezza degli occhi
  const P0 = g.attributes.position;
  const nose = new THREE.Vector3(0, 0, -Infinity);
  for (let i = 0; i < P0.count; i++) {
    if (P0.getY(i) > minY + 0.5 * H && Math.abs(P0.getX(i)) < 0.04 && P0.getZ(i) > nose.z) nose.fromBufferAttribute(P0, i);
  }
  const chinY = maxY - (maxY - nose.y) * 1.5;
  const eyeY = maxY - (maxY - nose.y) * EYE.yr;
  let halfHead = 0;
  for (let i = 0; i < P0.count; i++) {
    if (Math.abs(P0.getY(i) - eyeY) < 0.02) halfHead = Math.max(halfHead, Math.abs(P0.getX(i)));
  }
  const headMid = new THREE.Vector3(0, (maxY + chinY) / 2, 0);
  const headLen = maxY - chinY;
  camera.position.set(0, headMid.y - headLen * 0.12, headLen * 4.6);

  // --- Corpo scuro: dà volume e nasconde il retro ---
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { uShow: { value: 0 }, uAudio: { value: 0 }, uMinY: { value: minY }, uH: { value: H }, uBg: { value: scene.background } },
    vertexShader: /* glsl */`
      uniform float uMinY, uH;
      varying vec3 vN; varying vec3 vV; varying float vLevel;
      void main() {
        vLevel = (position.y - uMinY) / uH;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uShow; uniform float uAudio; uniform vec3 uBg;
      varying vec3 vN; varying vec3 vV; varying float vLevel;
      void main() {
        vec3 bg = uBg;                                     // spazio lineare, come lo sfondo
        // clamp: un dot appena sopra 1 renderebbe negativa la base di pow -> NaN -> quadrati neri nel bloom
        vec3 n = normalize(vN + vec3(0.0, 0.0, 1e-5));
        float fr = pow(clamp(1.0 - dot(n, normalize(vV)), 0.0, 1.0), 2.8);
        float key = max(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
        vec3 col = vec3(0.0016, 0.0035, 0.0075) + vec3(0.003, 0.008, 0.018) * key + vec3(0.02, 0.08, 0.22) * fr * (0.8 + uAudio * 0.6);
        gl_FragColor = vec4(mix(bg, col, uShow * smoothstep(0.06, 0.42, vLevel)), 1.0);
      }`,
  });
  const body = new THREE.Mesh(g, bodyMat);
  body.visible = false;
  head.add(body);

  // --- Particelle ---
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(g)).build();
  const pTarget = new Float32Array(N_PARTICLES * 3);
  const pStart = new Float32Array(N_PARTICLES * 3);
  const pNormal = new Float32Array(N_PARTICLES * 3);
  const pDelay = new Float32Array(N_PARTICLES);
  const pRand = new Float32Array(N_PARTICLES);
  const pLevel = new Float32Array(N_PARTICLES);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < N_PARTICLES; i++) {
    sampler.sample(v, n);
    v.addScaledVector(n, 0.008);
    pTarget.set([v.x, v.y, v.z], i * 3);
    pNormal.set([n.x, n.y, n.z], i * 3);
    const level = (v.y - minY) / H;
    pLevel[i] = level;
    pRand[i] = Math.random();
    pDelay[i] = Math.min(1, Math.random() * 0.65 + (1 - level) * 0.35);
    // Partenza: polvere luminosa sparsa per tutto lo schermo
    const r = 3.5 + Math.random() * 5.5, a = Math.random() * Math.PI * 2;
    pStart.set([Math.cos(a) * r * 1.4, (Math.random() - 0.5) * 7.5, Math.sin(a) * r * 0.6 - 1.5], i * 3);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pTarget, 3));
  pg.setAttribute('aStart', new THREE.BufferAttribute(pStart, 3));
  pg.setAttribute('aNormal', new THREE.BufferAttribute(pNormal, 3));
  pg.setAttribute('aDelay', new THREE.BufferAttribute(pDelay, 1));
  pg.setAttribute('aRand', new THREE.BufferAttribute(pRand, 1));
  pg.setAttribute('aLevel', new THREE.BufferAttribute(pLevel, 1));
  const particleMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uClock: { value: 0 }, uPR: { value: pr }, uAudio: { value: 0 }, uEnergy: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime, uClock, uPR, uAudio;
      attribute vec3 aStart, aNormal; attribute float aDelay, aRand, aLevel;
      varying float vAlpha, vFlash;
      ${GLSL_COMMON}
      void main() {
        float begin = ${T.gather.toFixed(2)} + aDelay * ${T.spread.toFixed(2)};
        float p = clamp((uTime - begin) / ${T.travel.toFixed(2)}, 0.0, 1.0);
        float e = p * p * p;                       // attrazione magnetica: accelera avvicinandosi
        vec3 s = aStart + vec3(sin(uClock * 0.3 + aRand * 40.0), cos(uClock * 0.23 + aRand * 31.0), sin(uClock * 0.17 + aRand * 17.0)) * 0.18;
        float ang = (1.0 - e) * (1.4 + aRand * 1.4);
        s.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * s.xz;
        vec3 pos = mix(s, position, e);
        float landed = step(1.0, p);
        pos += aNormal * uAudio * 0.045 * sin(aRand * 60.0 + uClock * 11.0) * landed;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;

        float since = uTime - (begin + ${T.travel.toFixed(2)});
        float flash = smoothstep(0.8, 1.0, p) * (1.0 - smoothstep(0.0, 0.45, since));
        float fiber = smoothstep(0.0, 0.7, uTime - fiberTime(aLevel));
        float keep = step(0.9, aRand);             // una parte resta come scintilla
        float tw = 0.5 + 0.5 * sin(uClock * (1.5 + aRand * 4.0) + aRand * 100.0);
        float facing = normalize(normalMatrix * aNormal).z;
        float size = mix(1.4, 2.4, aRand) * mix(1.0, mix(0.4, 0.9, keep), fiber) + flash * 2.6;
        gl_PointSize = size * uPR * (7.0 / -mv.z);
        vAlpha = (0.2 + 0.6 * e) * mix(1.0, mix(0.08, 0.4 + 0.6 * tw, keep), fiber)
               * mix(1.0, smoothstep(-0.25, 0.35, facing), fiber)
               * mix(1.0, smoothstep(0.06, 0.42, aLevel), e)   // le spalle sfumano nel buio
               * smoothstep(0.0, 0.9, uTime);
        vFlash = flash;
      }`,
    fragmentShader: /* glsl */`
      varying float vAlpha, vFlash;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 col = mix(vec3(0.35, 0.78, 1.0), vec3(0.95, 0.99, 1.0), clamp(vFlash + a * a * 0.35, 0.0, 1.0));
        gl_FragColor = vec4(col * a * vAlpha, 1.0);
      }`,
  });
  head.add(new THREE.Points(pg, particleMat));

  // --- Fibre: curve di livello orizzontali sulla superficie ---
  const pos = g.attributes.position, idx = g.index, nrm = g.attributes.normal;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const fPos = [], fLevel = [], fAng = [], fNormal = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), FN = new THREE.Vector3();
  const dy = H / LEVELS;
  const cut = (P, Q, y, out) => {
    if ((P.y - y) * (Q.y - y) < 0) out.push(new THREE.Vector3().lerpVectors(P, Q, (y - P.y) / (Q.y - P.y)));
  };
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    A.fromBufferAttribute(pos, ia); B.fromBufferAttribute(pos, ib); C.fromBufferAttribute(pos, ic);
    const lo = Math.ceil((Math.min(A.y, B.y, C.y) - minY) / dy), hi = Math.floor((Math.max(A.y, B.y, C.y) - minY) / dy);
    if (hi < lo) continue;
    FN.fromBufferAttribute(nrm, ia).add(B.clone().fromBufferAttribute(nrm, ib)).add(C.clone().fromBufferAttribute(nrm, ic)).normalize();
    for (let L = lo; L <= hi; L++) {
      const y = minY + L * dy + dy * 0.5 * 0.001;
      const pts = [];
      cut(A, B, y, pts); cut(B, C, y, pts); cut(C, A, y, pts);
      if (pts.length !== 2) continue;
      for (const P of pts) {
        P.addScaledVector(FN, 0.006);
        fPos.push(P.x, P.y, P.z);
        fLevel.push(L / LEVELS);
        fAng.push(Math.atan2(P.x, P.z) / Math.PI);
        fNormal.push(FN.x, FN.y, FN.z);
      }
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
  fg.setAttribute('aLevel', new THREE.Float32BufferAttribute(fLevel, 1));
  fg.setAttribute('aAng', new THREE.Float32BufferAttribute(fAng, 1));
  fg.setAttribute('aNormal', new THREE.Float32BufferAttribute(fNormal, 3));
  const fiberMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uClock: { value: 0 }, uAudio: { value: 0 }, uThink: { value: 0 }, uListen: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute float aLevel, aAng; attribute vec3 aNormal;
      varying float vLevel, vAng, vFace, vOn;
      ${GLSL_COMMON}
      void main() {
        vLevel = aLevel; vAng = aAng;
        vFace = normalize(normalMatrix * aNormal).z;
        vOn = smoothstep(0.0, 0.6, uTime - fiberTime(aLevel) - abs(aAng) * 0.8);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uClock, uAudio, uThink, uListen;
      varying float vLevel, vAng, vFace, vOn;
      ${GLSL_COMMON}
      void main() {
        float lr = hash(floor(vLevel * ${LEVELS}.0 + 0.5) + 3.0);
        float streak = step(0.8, lr);                                    // poche fibre lunghe e luminose
        float seg = fract(vAng * mix(3.0 + lr * 8.0, 0.8 + lr * 1.5, streak) + lr * 13.0);
        float dash = step(mix(0.22 + lr * 0.45, 0.12, streak), seg);    // tratti digitali
        float pulse = pow(1.0 - fract(vAng * 1.2 - uClock * (0.06 + lr * 0.14) + lr * 5.0), 22.0); // dati che scorrono
        float sd = (vLevel - fract(uClock * 0.45)) * 16.0;          // quadrato a mano: pow con base negativa dà NaN su Metal
        float scan = exp(-sd * sd) * uThink;
        float face = smoothstep(-0.15, 0.55, vFace);
        float a = vOn * face * smoothstep(0.06, 0.42, vLevel)
                * (0.025 + 0.05 * dash + 0.32 * streak * dash + (0.35 + streak) * (0.8 + uAudio * 1.8) * pulse * dash
                   + 0.4 * scan + 0.04 * uListen);
        vec3 col = mix(vec3(0.12, 0.48, 1.0), vec3(0.7, 0.93, 1.0), clamp(pulse + scan, 0.0, 1.0));
        gl_FragColor = vec4(col * a, 1.0);
      }`,
  });
  head.add(new THREE.LineSegments(fg, fiberMat));

  // --- Occhi ---
  const ray = new THREE.Raycaster();
  const eyeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, // mai tagliati dal viso
    uniforms: { uOpen: { value: 0 }, uGlow: { value: 0 }, uGaze: { value: new THREE.Vector2() }, uTint: { value: new THREE.Color(0x9fd8ff) } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uOpen, uGlow; uniform vec2 uGaze; uniform vec3 uTint;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(2.0, 1.0);
        float x = p.x / 0.36;
        float lid = 0.11 * uOpen * (1.0 - x * x);                       // mandorla
        float inside = abs(x) < 1.0 ? lid - abs(p.y) : -abs(p.y) - (abs(x) - 1.0) * 0.36;
        float core = smoothstep(0.0, 0.025, inside);
        float o = max(-inside, 0.0);
        float halo = exp(-o * 26.0) * 0.38 + exp(-o * 7.0) * 0.14;
        halo *= (1.0 - smoothstep(0.3, 0.5, abs(p.y))) * (1.0 - smoothstep(0.75, 1.0, abs(p.x))); // zero ai bordi del rettangolo
        vec2 g = vec2(uGaze.x * 0.12, uGaze.y * 0.03);
        float iris = exp(-dot(p - g, p - g) * 90.0) * core;
        vec3 col = uTint * halo + vec3(0.9, 0.97, 1.0) * core * 0.95 + vec3(1.0) * iris * 0.5;
        gl_FragColor = vec4(col * uGlow, 1.0);
      }`,
  });
  const eyes = [];
  // Speculari rispetto alla linea mediana del viso (la x del naso, che nel modello non è 0), stessa profondità
  const ex = EYE.xr * halfHead, ey = eyeY, midX = nose.x;
  const eyeZ = Math.max(...[-1, 1].map((side) => {
    ray.set(new THREE.Vector3(midX + side * ex, ey, 5), new THREE.Vector3(0, 0, -1));
    return ray.intersectObject(body, false)[0]?.point.z ?? 0.9;
  }));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), eyeMat);
    eye.position.set(midX + side * ex, ey, eyeZ + EYE.inset);
    eye.rotation.y = side * 0.18;
    eye.renderOrder = 10;
    head.add(eye);
    eyes.push(eye);
  }

  // --- Post-processing ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.5, 0.12);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  // --- Animazione ---
  let nextBlink = 6.5, blinkAt = -1;
  const gaze = new THREE.Vector2(), gazeTarget = new THREE.Vector2();
  let nextGaze = 0;
  const lerp = (a, b, k) => a + (b - a) * k;

  function frame(t, clock, dt) {
    const k = 1 - Math.exp(-dt * 4);
    particleMat.uniforms.uTime.value = t;
    particleMat.uniforms.uClock.value = clock;
    particleMat.uniforms.uAudio.value = S.audio;
    fiberMat.uniforms.uTime.value = t;
    fiberMat.uniforms.uClock.value = clock;
    fiberMat.uniforms.uAudio.value = S.audio;
    fiberMat.uniforms.uThink.value = lerp(fiberMat.uniforms.uThink.value, S.mode === 'thinking' ? 1 : 0, k);
    fiberMat.uniforms.uListen.value = lerp(fiberMat.uniforms.uListen.value, S.mode === 'listening' ? 1 : 0, k);

    const show = THREE.MathUtils.smoothstep(t, T.body, T.body + 1.6);
    body.visible = show > 0;
    bodyMat.uniforms.uShow.value = show;
    bodyMat.uniforms.uAudio.value = S.audio;

    // Occhi: si aprono a testa formata, sbattono, seguono lo stato
    let open = THREE.MathUtils.smoothstep(t, T.eyes, T.eyes + 0.6);
    if (t > nextBlink) { blinkAt = t; nextBlink = t + 2.5 + Math.random() * 4.5; }
    if (blinkAt > 0) { const b = (t - blinkAt) / 0.16; if (b < 1) open *= Math.abs(b * 2 - 1); }
    let glow = 0.8 + Math.sin(clock * 1.3) * 0.05;
    if (S.mode === 'listening') glow = 1.2 + S.mic * 0.6;
    if (S.mode === 'thinking') glow = 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(clock * 7));
    if (S.mode === 'speaking') glow = 0.9 + S.audio * 1.1;
    eyeMat.uniforms.uOpen.value = open;
    eyeMat.uniforms.uGlow.value = lerp(eyeMat.uniforms.uGlow.value, glow * THREE.MathUtils.smoothstep(t, T.eyes - 0.3, T.eyes + 0.8), 1 - Math.exp(-dt * 10));
    eyeMat.uniforms.uTint.value.set(S.mode === 'listening' ? 0x8ff0ff : S.mode === 'thinking' ? 0xa9b8ff : 0x9fd8ff);
    if (clock > nextGaze) { gazeTarget.set((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.2); nextGaze = clock + 1.5 + Math.random() * 3; }
    const want = S.mode === 'listening' ? new THREE.Vector2(0, 0) : gazeTarget; // in ascolto guarda Tony
    gaze.lerp(want, 1 - Math.exp(-dt * 8));
    eyeMat.uniforms.uGaze.value.copy(gaze);

    // Testa: solo una lenta oscillazione, indipendente dal mouse
    head.rotation.y = lerp(head.rotation.y, Math.sin(clock * 0.11) * 0.17, k * 0.5);
    head.rotation.x = lerp(head.rotation.x, Math.sin(clock * 0.08) * 0.03 + (S.mode === 'thinking' ? 0.05 : 0), k * 0.5);

    // Quando c'è il browser a destra, la testa scivola a sinistra e rimpicciolisce un po'
    camera.zoom = 1 - 0.12 * S.split;
    camera.setViewOffset(innerWidth, innerHeight, S.split * innerWidth * 0.255, 0, innerWidth, innerHeight);

    bloom.strength = 0.8 + S.audio * 0.45 + (S.mode === 'listening' ? 0.12 : 0);
    composer.render();
  }

  // Centro e raggio del viso sullo schermo, per centrare gli anelli dell'HUD
  function anchor() {
    const toPx = (v) => { const p = v.clone().project(camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; };
    const c = toPx(headMid), top = toPx(new THREE.Vector3(0, maxY, 0));
    return { x: c.x, y: c.y, r: (c.y - top.y) * 1.25 };
  }

  return { frame, anchor };
}
