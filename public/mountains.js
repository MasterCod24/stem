// Montagne di particelle ai lati del busto: creste che brillano, venature d'oro, scintille.
// Un rilievo invisibile (scrive solo la profondità) nasconde i punti dei versanti coperti.
import * as THREE from 'three';

function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rumore a gradiente 2D, circa in [-1, 1]
function perlin(seed) {
  const R = rng(seed), p = new Uint8Array(256), P = new Uint8Array(512), G = new Float32Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = R() * Math.PI * 2; G[i * 2] = Math.cos(a); G[i * 2 + 1] = Math.sin(a); }
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const h00 = P[P[X] + Y] * 2, h10 = P[P[X + 1] + Y] * 2, h01 = P[P[X] + Y + 1] * 2, h11 = P[P[X + 1] + Y + 1] * 2;
    const a = G[h00] * xf + G[h00 + 1] * yf, b = G[h10] * (xf - 1) + G[h10 + 1] * yf;
    const c = G[h01] * xf + G[h01 + 1] * (yf - 1), e = G[h11] * (xf - 1) + G[h11 + 1] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v) * 1.45;
  };
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Dominio del rilievo (unità del mondo) e camera
const X0 = -19, X1 = 19, Z0 = -30, Z1 = 7, STEP = 0.06;
const CAM = { fov: 34, pos: [0, 2.6, 17], look: [0, 0.9, 0] };

function buildHeight() {
  const n = perlin(5), m = perlin(11), q = perlin(29);
  const ridged = (x, z) => {
    let s = 0, a = 0.5, f = 1, w = 1;
    for (let o = 0; o < 6; o++) {
      let r = 1 - Math.abs(n(x * f + o * 13.7, z * f - o * 7.9));
      r *= r;
      s += r * a * w;
      w = Math.min(1, r * 1.8);
      f *= 2.05; a *= 0.5;
    }
    return s;
  };
  // massicci principali: alti ai lati, bassi dietro al busto
  const massif = (x, z, cx, cz, rx, rz, h) => h * Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
  return (x, z) => {
    const wx = x + m(x * 0.07, z * 0.07) * 2.4, wz = z + m(x * 0.07 + 7.3, z * 0.07 - 3.1) * 2.4;
    const ax = Math.abs(x);
    let base = 0.5 + 0.5 * sstep(1.5, 7, ax);
    base += massif(x, z, -9.5, -6, 4.0, 4.5, 1.0) + massif(x, z, 9.5, -8, 4.5, 5, 0.85) + massif(x, z, -15, -16, 6, 7, 0.9) + massif(x, z, 16, -17, 6, 7, 1.0);
    const r = ridged(wx * 0.12, wz * 0.12);
    return -4.0 + base * (1.0 + 2.6 * r) + 0.2 * q(x * 0.5, z * 0.5) * base;
  };
}

export function createMountains() {
  const R = rng(1234);
  const H = buildHeight();
  const vein = perlin(77), vein2 = perlin(91);

  // Griglia delle altezze, poi campioni bilineari
  const GX = Math.round((X1 - X0) / STEP) + 1, GZ = Math.round((Z1 - Z0) / STEP) + 1;
  const grid = new Float32Array(GX * GZ);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) grid[j * GX + i] = H(X0 + i * STEP, Z0 + j * STEP);
  const at = (i, j) => grid[Math.min(GZ - 1, Math.max(0, j)) * GX + Math.min(GX - 1, Math.max(0, i))];
  const sample = (x, z) => {
    const fx = (x - X0) / STEP, fz = (z - Z0) / STEP, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
  // normale, cresta (convessità) e pendenza
  const L = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
  const info = (x, z) => {
    const e = STEP * 2, h = sample(x, z);
    const hx1 = sample(x + e, z), hx0 = sample(x - e, z), hz1 = sample(x, z + e), hz0 = sample(x, z - e);
    const dx = (hx1 - hx0) / (2 * e), dz = (hz1 - hz0) / (2 * e);
    const lap = (hx1 + hx0 + hz1 + hz0 - 4 * h) / (e * e);
    const nl = Math.hypot(dx, 1, dz);
    const lit = Math.max(0, (-dx * L.x + L.y - dz * L.z) / nl);
    return { h, ridge: Math.min(1, Math.max(0, -lap * 0.11)), slope: Math.hypot(dx, dz), lit };
  };

  const pos = [], col = [], prm = [];
  const blue = new THREE.Color(0x1d6dff), cyan = new THREE.Color(0x3fb4ff), white = new THREE.Color(0xc8ecff); // azzurro elettrico come nel video
  const orange = new THREE.Color(0xff8a24), gold = new THREE.Color(0xffc870);
  const tmp = new THREE.Color();
  const push = (x, y, z, c, k, size, kind) => {
    pos.push(x, y, z); col.push(c.r * k, c.g * k, c.b * k);
    prm.push(size, 0.6 + R() * 2.4, R() * 6.283, kind);
  };
  const inView = (x, z) => Math.abs(x) < 3.2 + (CAM.pos[2] - z) * 0.62 && Math.abs(x) > 1.0;
  const fogK = (z) => 1 - 0.55 * sstep(-2, Z0, z);

  // 1) superficie: griglia sfalsata, più punti dove c'è luce o cresta
  for (let z = Z0; z < Z1; z += STEP * 1.25) {
    for (let x = X0; x < X1; x += STEP * 1.25) {
      const px = x + (R() - 0.5) * STEP * 1.2, pz = z + (R() - 0.5) * STEP * 1.2;
      if (!inView(px, pz)) continue;
      const f = info(px, pz);
      const b = 0.05 + 0.32 * f.lit * f.lit + 0.9 * f.ridge;
      if (R() > 0.22 + b) continue;
      tmp.copy(blue).lerp(cyan, Math.min(1, f.ridge * 1.3));
      push(px, f.h + 0.02, pz, tmp, (0.24 + 1.35 * b) * fogK(pz), 1.2 + R() * 1.0, 0);
    }
  }
  // 2) creste: campionamento a rifiuto, punti chiari e fitti
  for (let n = 0, tries = 0; n < 42000 && tries < 900000; tries++) {
    const px = X0 + R() * (X1 - X0), pz = Z0 + R() * (Z1 - Z0);
    if (!inView(px, pz)) continue;
    const f = info(px, pz);
    if (f.ridge < 0.25 || R() > f.ridge) continue;
    tmp.copy(cyan).lerp(white, R() * 0.6 * f.ridge);
    push(px, f.h + 0.03, pz, tmp, (0.7 + 1.6 * f.ridge) * fogK(pz), 1.4 + R() * 1.4, 1); // creste al neon
    n++;
  }
  // 3) venature d'oro: linee di livello di un rumore lento, sui versanti
  for (let n = 0, tries = 0; n < 26000 && tries < 1400000; tries++) {
    const px = X0 + R() * (X1 - X0), pz = Z0 + R() * (Z1 - Z0);
    if (!inView(px, pz) || pz > 4) continue;
    const w = vein(px * 0.11 + 3.3, pz * 0.16) + 0.35 * vein2(px * 0.4, pz * 0.4);
    if (Math.abs(w) > 0.018) continue;
    const f = info(px, pz);
    if (f.slope < 0.25 || f.h < -2.6) continue;
    const g = R();
    tmp.copy(orange).lerp(gold, g).lerp(white, g > 0.93 ? 0.6 : 0);
    push(px, f.h + 0.04, pz, tmp, (1.0 + 0.9 * R()) * fogK(pz), 1.5 + R() * 1.5, 2); // venature d'oro ben visibili
    n++;
  }
  // 4) scintille sulle creste
  for (let n = 0, tries = 0; n < 2600 && tries < 300000; tries++) {
    const px = X0 + R() * (X1 - X0), pz = Z0 + R() * (Z1 - Z0);
    if (!inView(px, pz)) continue;
    const f = info(px, pz);
    if (f.ridge < 0.45) continue;
    tmp.copy(R() < 0.25 ? gold : white);
    push(px, f.h + 0.05, pz, tmp, 1.1 * fogK(pz), 2.2 + R() * 2.2, 3);
    n++;
  }
  // 5) polvere nel cielo
  for (let n = 0; n < 900; n++) {
    const px = (R() - 0.5) * 60, pz = -32 - R() * 10, py = -2 + R() * 22;
    push(px, py, pz, R() < 0.2 ? gold : cyan, 0.12 + R() * 0.25, 1 + R() * 1.4, 4);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aP', new THREE.Float32BufferAttribute(prm, 4));

  const uniforms = {
    uVP: { value: new THREE.Matrix4() }, uPR: { value: 1 }, uClock: { value: 0 },
    uSide: { value: 2 }, uShift: { value: 0 }, uBright: { value: 1 },
  };
  const VERT_HEAD = /* glsl */`
    uniform mat4 uVP; uniform float uShift, uSide;
    vec4 project(vec3 p) { vec4 c = uVP * vec4(p, 1.0); c.x += uShift * c.w; return c; }
    float reveal(vec4 c) { return smoothstep(uSide, uSide + 0.35, abs(c.x / c.w)); }
  `;
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT_HEAD + /* glsl */`
      uniform float uPR, uClock, uBright;
      attribute vec3 color; attribute vec4 aP;
      varying vec3 vC;
      void main() {
        vec4 c = project(position);
        gl_Position = c;
        float k = aP.w;
        float tw = 0.78 + 0.22 * sin(uClock * aP.y + aP.z);
        if (k > 1.5 && k < 2.5) tw = 0.55 + 0.45 * sin(dot(position.xz, vec2(1.7, 0.9)) * 2.2 - uClock * 1.6 + aP.z * 0.3);
        if (k > 2.5 && k < 3.5) { float s = 0.5 + 0.5 * sin(uClock * aP.y * 1.3 + aP.z); tw = 0.15 + 1.1 * s * s * s; }
        float size = aP.x * clamp(15.0 / c.w, 0.65, 1.6);
        gl_PointSize = size * uPR;
        vC = color * tw * reveal(c) * uBright;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d);
        gl_FragColor = vec4(vC * a, 1.0);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;

  // Rilievo che nasconde i punti coperti (solo profondità)
  const MS = 4, mx = Math.floor((GX - 1) / MS) + 1, mz = Math.floor((GZ - 1) / MS) + 1;
  const mpos = new Float32Array(mx * mz * 3), idx = [];
  for (let j = 0; j < mz; j++) for (let i = 0; i < mx; i++) {
    const o = (j * mx + i) * 3;
    mpos[o] = X0 + i * MS * STEP; mpos[o + 1] = at(i * MS, j * MS) - 0.06; mpos[o + 2] = Z0 + j * MS * STEP;
  }
  for (let j = 0; j < mz - 1; j++) for (let i = 0; i < mx - 1; i++) {
    const a = j * mx + i, b = a + 1, c = a + mx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const mgeo = new THREE.BufferGeometry();
  mgeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
  mgeo.setIndex(idx);
  const mmat = new THREE.ShaderMaterial({
    uniforms, transparent: true, colorWrite: false, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    vertexShader: VERT_HEAD + `void main() { gl_Position = project(position); }`,
    fragmentShader: `void main() { gl_FragColor = vec4(0.0); }`,
  });
  const mesh = new THREE.Mesh(mgeo, mmat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  const group = new THREE.Group();
  group.add(mesh, points);

  const camera = new THREE.PerspectiveCamera(CAM.fov, 1.5, 0.1, 200);
  const look = new THREE.Vector3(...CAM.look);

  // aspect, k (scala dell'inquadratura), clock, side (0..2), shift (NDC), pr
  function update(o) {
    camera.aspect = o.aspect;
    camera.fov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) / o.k) * 180 / Math.PI;
    // leggero ondeggiare della camera: le montagne respirano
    camera.position.set(CAM.pos[0] + Math.sin(o.clock * 0.05) * 0.25, CAM.pos[1] + Math.sin(o.clock * 0.037) * 0.08, CAM.pos[2]);
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    uniforms.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    uniforms.uClock.value = o.clock;
    uniforms.uSide.value = o.side;
    uniforms.uShift.value = o.shift;
    uniforms.uPR.value = o.pr;
    uniforms.uBright.value = o.bright ?? 1;
    group.visible = o.side < 1.2;
  }

  return { group, update, count: pos.length / 3 };
}
