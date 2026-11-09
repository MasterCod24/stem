// geometrie.js — le geometrie three.js degli ologrammi, dalle stesse misure di forme.js: disegno, massa e
// voxel devono parlare dello stesso solido (prove/ologramma-geometrie.mjs lo controlla con punti a caso).
// Coordinate locali del pezzo in mm, asse Y in alto; la posa si applica con matricePezzo (Euler 'XYZ').
// Tutte le geometrie sono chiuse e con le facce verso fuori: la sezione con lo stencil conta le facce.
import * as THREE from 'three';
import { profiloIngranaggio, poligonoRivoluzione, PASSI_CAVO, areaPoligono } from './forme.js';

const GRADI = Math.PI / 180; // lo stesso di forme.js e di THREE.MathUtils.DEG2RAD

// Suddivisioni scelte perché il volume della mesh resti entro l'1,5% di quello esatto (misurato nella prova)
// e i pezzi costino poco: un giro a 64 lati sbaglia l'area dello 0,16%.
export const SEGMENTI = Object.freeze({ giro: 64, sfera: [48, 32], toro: [32, 96], cavo: 24, foro: 32, arco: 2 /* gradi per lato */ });
export const ESTENSIONI = Object.freeze(['glb', 'stl', 'obj', '3mf', 'ply']);
// Oltre, un file porta l'HUD sotto i 45 fps con le mani accese. Misurato l'8/11 in headless sulla GPU dell'M2, con il
// cursore delle mani sul modello: 1 milione di triangoli 50,7 fps presentati, 2 milioni 33,3 (22 ms di GPU a fotogramma).
// Il caricamento ferma comunque l'HUD: a 1 milione EdgesGeometry blocca il thread per circa 2,5 s (revisione del 7/11).
const TRIANGOLI_MAX = 1e6;

/** La matrice del pezzo con THREE.Euler 'XYZ': deve coincidere con forme.matrice (c'è un test). */
export function matricePezzo(pezzo, m = new THREE.Matrix4()) {
  const t = pezzo.posizione || [0, 0, 0], g = pezzo.rotazione || [0, 0, 0];
  return m.makeRotationFromEuler(new THREE.Euler(g[0] * GRADI, g[1] * GRADI, g[2] * GRADI, 'XYZ')).setPosition(t[0], t[1], t[2]);
}

/** BufferGeometry locale del pezzo normalizzato, o null per 'file' (si carica con leggiFile). */
export function geometria(pezzo) {
  const m = pezzo.misure;
  switch (pezzo.forma) {
    case 'scatola': return new THREE.BoxGeometry(m.x, m.y, m.z);
    case 'cilindro': return new THREE.CylinderGeometry(m.r, m.r, m.h, SEGMENTI.giro);
    case 'tubo': return tornio([[m.r_interno, -m.h / 2], [m.r, -m.h / 2], [m.r, m.h / 2], [m.r_interno, m.h / 2], [m.r_interno, -m.h / 2]]);
    case 'sfera': return new THREE.SphereGeometry(m.r, ...SEGMENTI.sfera);
    case 'cono': return new THREE.CylinderGeometry(m.r_cima, m.r, m.h, SEGMENTI.giro); // r_cima a +h/2, r a −h/2
    case 'toro': return new THREE.TorusGeometry(m.R, m.r, ...SEGMENTI.toro).rotateX(Math.PI / 2); // da XY al piano XZ
    case 'piastra': return m.raggio === null ? new THREE.BoxGeometry(m.x, m.spessore, m.z) : piastraCurva(m);
    case 'estrusione': return estrusione(m);
    case 'rivoluzione': return rivoluzione(m.profilo);
    case 'ingranaggio': return ingranaggio(m);
    case 'cavo': return cavo(m);
    default: return null;
  }
}

// Lathe con gli spigoli vivi: un punto doppio dove il profilo gira di più di 20°, perché LatheGeometry media
// le normali dei due tratti e un bordo netto sembrerebbe smussato.
function tornio(punti) {
  const P = [];
  for (let i = 0; i < punti.length; i++) {
    const [r, y] = punti[i];
    P.push(new THREE.Vector2(r, y));
    if (i > 0 && i < punti.length - 1) {
      const a = punti[i - 1], b = punti[i + 1];
      const ux = r - a[0], uy = y - a[1], wx = b[0] - r, wy = b[1] - y;
      const c = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy) || 1);
      if (c < Math.cos(20 * GRADI)) P.push(new THREE.Vector2(r, y));
    }
  }
  return new THREE.LatheGeometry(P, SEGMENTI.giro);
}

// Il profilo chiuso dall'asse, percorso in senso antiorario nel piano (r, y): così Lathe mette le facce verso fuori.
// Il lato sull'asse resta implicito, perché i due estremi stanno sull'asse.
function rivoluzione(profilo) {
  const Q = poligonoRivoluzione(profilo);
  return tornio(areaPoligono(Q) < 0 ? Q.reverse() : Q);
}

// Contorno antiorario: ExtrudeGeometry lo gira e gira i fori di conseguenza, e le pareti dei fori vengono verso fuori.
const antiorario = (punti) => (areaPoligono(punti) < 0 ? [...punti].reverse() : punti).map(([x, y]) => new THREE.Vector2(x, y));

function estrusione(m) {
  const forma = new THREE.Shape(antiorario(m.profilo));
  for (const f of m.fori) forma.holes.push(new THREE.Path(antiorario(f)));
  for (const f of m.fori_tondi) forma.holes.push(new THREE.Path().absarc(f.x, f.y, f.r, 0, 2 * Math.PI, true));
  return new THREE.ExtrudeGeometry(forma, { depth: m.profondita, bevelEnabled: false, curveSegments: SEGMENTI.foro / 2 })
    .translate(0, 0, -m.profondita / 2);
}

// Il profilo [x, z] diventa Shape(x, z); rotateX(π/2) porta (u, v, w) in (u, −w, v), quindi z resta z (con −π/2
// la ruota uscirebbe specchiata) e lo spessore va da −spessore a 0 in Y, poi si centra.
function ingranaggio(m) {
  const forma = new THREE.Shape(profiloIngranaggio(m).map(([x, z]) => new THREE.Vector2(x, z)));
  if (m.foro > 0) forma.holes.push(new THREE.Path().absarc(0, 0, m.foro, 0, 2 * Math.PI, true));
  return new THREE.ExtrudeGeometry(forma, { depth: m.spessore, bevelEnabled: false, curveSegments: SEGMENTI.foro / 2 })
    .rotateX(Math.PI / 2).translate(0, m.spessore / 2, 0);
}

// Costruttore di triangoli con la normale voluta: se l'ordine dei vertici la contraddice, lo gira.
// Così le facce stanno verso fuori per costruzione e non per un conto di versi fatto a mano.
function costruttore() {
  const pos = [], nor = [], uv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  function tri(p0, p1, p2, n0, n1, n2) {
    a.fromArray(p1).sub(b.fromArray(p0)); c.fromArray(p2).sub(b);
    a.cross(c);
    const giusto = a.x * (n0[0] + n1[0] + n2[0]) + a.y * (n0[1] + n1[1] + n2[1]) + a.z * (n0[2] + n1[2] + n2[2]) >= 0;
    const V = giusto ? [p0, p1, p2, n0, n1, n2] : [p0, p2, p1, n0, n2, n1];
    for (let k = 0; k < 3; k++) { pos.push(...V[k]); nor.push(...V[k + 3]); uv.push(0, 0); }
  }
  const quad = (p0, p1, p2, p3, n0, n1 = n0, n2 = n0, n3 = n0) => { tri(p0, p1, p2, n0, n1, n2); tri(p0, p2, p3, n0, n2, n3); };
  function geometria() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }
  return { tri, quad, geometria };
}

// Piastra curva del contratto: x = ρ·sin φ, y = R − segno(R)·ρ·cos φ, φ fra ±x/(2|R|), ρ fra |R| ∓ spessore/2,
// z fra ±z/2. Superfici curve con normali lisce, facce piane con normali piatte. A 360° le due testate
// coincidono e si annullano nel conto delle facce, come deve essere per un anello.
function piastraCurva(m) {
  const R = m.raggio, Ra = Math.abs(R), s = Math.sign(R), hs = m.spessore / 2, hz = m.z / 2;
  const alfa = m.x / (2 * Ra), n = Math.min(360, Math.max(4, Math.ceil((2 * alfa) / (SEGMENTI.arco * GRADI))));
  const ri = Ra - hs, ro = Ra + hs;
  const P = (rho, phi, z) => [rho * Math.sin(phi), R - s * rho * Math.cos(phi), z];
  const N = (phi, verso) => [verso * Math.sin(phi), -verso * s * Math.cos(phi), 0]; // fuori dal centro di curvatura
  const K = costruttore();
  for (let i = 0; i < n; i++) {
    const f0 = -alfa + (2 * alfa * i) / n, f1 = -alfa + (2 * alfa * (i + 1)) / n;
    K.quad(P(ro, f0, -hz), P(ro, f1, -hz), P(ro, f1, hz), P(ro, f0, hz), N(f0, 1), N(f1, 1), N(f1, 1), N(f0, 1));
    K.quad(P(ri, f0, -hz), P(ri, f1, -hz), P(ri, f1, hz), P(ri, f0, hz), N(f0, -1), N(f1, -1), N(f1, -1), N(f0, -1));
    for (const z of [-hz, hz]) K.quad(P(ri, f0, z), P(ro, f0, z), P(ro, f1, z), P(ri, f1, z), [0, 0, Math.sign(z)]);
  }
  for (const [phi, v] of [[-alfa, -1], [alfa, 1]]) { // testate: normale lungo la tangente dell'arco, verso fuori
    const t = [v * Math.cos(phi), v * s * Math.sin(phi), 0];
    K.quad(P(ri, phi, -hz), P(ro, phi, -hz), P(ro, phi, hz), P(ri, phi, hz), t);
  }
  return K.geometria();
}

// Cavo: TubeGeometry su una CatmullRomCurve3 centripeta, con gli anelli a parametro uniforme (non per lunghezza,
// come farebbe da sola): cadono proprio sui campioni di campionaCavo((punti − 1)·PASSI_CAVO + 1) di forme.js.
// Le due estremità sono dischi piatti, come i tagli di forme.js. uv.x è la lunghezza percorsa (0..1), per i flussi.
function cavo(m) {
  const n = (m.punti.length - 1) * PASSI_CAVO, rs = SEGMENTI.cavo;
  const curva = new THREE.CatmullRomCurve3(m.punti.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  curva.getUtoTmapping = (u) => u;
  const tubo = new THREE.TubeGeometry(curva, n, m.r, rs, false);
  const pos = tubo.attributes.position, uv = tubo.attributes.uv;
  const centri = [];
  for (let i = 0; i <= n; i++) centri.push(curva.getPoint(i / n));
  const lungo = [0];
  for (let i = 1; i <= n; i++) lungo.push(lungo[i - 1] + centri[i].distanceTo(centri[i - 1]));
  const L = lungo[n] || 1;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= rs; j++) uv.setX(i * (rs + 1) + j, lungo[i] / L);
  // tappi: un ventaglio dal centro dell'anello, con la normale lungo la curva verso fuori
  const K = costruttore();
  for (const [i, v] of [[0, -1], [n, 1]]) {
    const c = centri[i].toArray(), t = curva.getTangent(i / n).multiplyScalar(v).toArray();
    for (let j = 0; j < rs; j++) {
      const a = i * (rs + 1) + j;
      K.tri(c, [pos.getX(a), pos.getY(a), pos.getZ(a)], [pos.getX(a + 1), pos.getY(a + 1), pos.getZ(a + 1)], t, t, t);
    }
  }
  const tappi = K.geometria(), base = pos.count, idx = Array.from(tubo.index.array);
  for (let k = 0; k < tappi.attributes.position.count; k++) idx.push(base + k);
  const g = new THREE.BufferGeometry();
  for (const nome of ['position', 'normal', 'uv']) {
    const A = tubo.attributes[nome], B = tappi.attributes[nome], arr = new Float32Array(A.array.length + B.array.length);
    arr.set(A.array); arr.set(B.array, A.array.length);
    g.setAttribute(nome, new THREE.BufferAttribute(arr, A.itemSize));
  }
  g.setIndex(idx);
  g.userData.lunghezza = L;
  tubo.dispose(); tappi.dispose();
  return g;
}

/** Volume con segno della mesh (mm³): positivo se è chiusa con le facce verso fuori. */
export function volumeMesh(g) {
  const p = g.attributes.position, idx = g.index, n = idx ? idx.count : p.count;
  let v = 0;
  for (let k = 0; k < n; k += 3) {
    const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a), bx = p.getX(b), by = p.getY(b), bz = p.getZ(b), cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** L'estensione del percorso, minuscola, o '' se non è ammessa. */
export function estensione(percorso) {
  const s = String(percorso || ''), punto = s.lastIndexOf('.');
  const e = punto > s.lastIndexOf('/') ? s.slice(punto + 1).toLowerCase() : '';
  return ESTENSIONI.includes(e) ? e : '';
}

/**
 * Un modello da file (ArrayBuffer) → { geometrie: BufferGeometry[], ingombro: {min, max} in mm, triangoli }.
 * Le geometrie sono già in mm (× scala) e, con centra, centrate sull'origine; i materiali del file si buttano,
 * perché l'ologramma ha i suoi. Le risorse esterne non si scaricano: l'HUD non va su internet.
 */
export async function leggiFile(dati, est, { scala = 1, centra = true } = {}) {
  if (!(dati instanceof ArrayBuffer)) throw new Error('dati del file mancanti');
  if (!Number.isFinite(scala) || scala <= 0) throw new Error('scala non valida');
  const gestore = new THREE.LoadingManager();
  gestore.setURLModifier((url) => (url.startsWith('data:') ? url : 'data:,'));
  let ogg;
  if (est === 'glb') { const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'); ogg = (await new GLTFLoader(gestore).parseAsync(dati, '')).scene; }
  else if (est === 'stl') { const { STLLoader } = await import('three/addons/loaders/STLLoader.js'); ogg = new THREE.Mesh(new STLLoader(gestore).parse(dati)); }
  else if (est === 'obj') { const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js'); ogg = new OBJLoader(gestore).parse(new TextDecoder().decode(dati)); }
  else if (est === '3mf') { const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js'); ogg = new ThreeMFLoader(gestore).parse(dati); }
  else if (est === 'ply') { const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js'); ogg = new THREE.Mesh(new PLYLoader(gestore).parse(dati)); }
  else throw new Error(`estensione non ammessa: ${String(est).slice(0, 8)}`);
  ogg.updateMatrixWorld(true);
  const geometrie = [], scarti = new Set();
  let triangoli = 0;
  ogg.traverse((o) => {
    for (const mat of [].concat(o.material || [])) scarti.add(mat);
    if (!o.isMesh || !o.geometry?.attributes?.position) { if (o.geometry) scarti.add(o.geometry); return; }
    const src = o.geometry, g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
    if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv.clone());
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(o.matrixWorld);
    triangoli += (g.index ? g.index.count : g.attributes.position.count) / 3;
    geometrie.push(g);
    scarti.add(src);
  });
  for (const x of scarti) {
    if (x.isMaterial) for (const v of Object.values(x)) if (v && v.isTexture) v.dispose();
    x.dispose?.();
  }
  if (!geometrie.length) throw new Error('il file non contiene superfici');
  if (triangoli > TRIANGOLI_MAX) { geometrie.forEach((g) => g.dispose()); throw new Error(`troppo pesante per l'HUD: ${Math.round(triangoli)} triangoli, al massimo ${TRIANGOLI_MAX}`); }
  const box = new THREE.Box3();
  for (const g of geometrie) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const centro = centra ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  for (const g of geometrie) {
    g.translate(-centro.x, -centro.y, -centro.z).scale(scala, scala, scala);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
  }
  box.translate(centro.negate());
  return { geometrie, ingombro: { min: box.min.multiplyScalar(scala).toArray(), max: box.max.multiplyScalar(scala).toArray() }, triangoli };
}
