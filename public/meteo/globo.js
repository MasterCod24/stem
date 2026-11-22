// O.S.C.A.R. — il globo al centro della vista meteo: la Terra scura coi continenti a esagoni ciano, il radar vero di RainViewer
// proiettato sulla curva, il luogo che pulsa, il vento che scorre sopra la zona, le città vicine quando si è vicini, sei anelli
// che girano attorno all'asse. Disegna nello stesso renderer dell'HUD, prima del bagliore (strato di nucleo.js, come
// l'ologramma): niente secondo contesto WebGL, e brilla come il resto.
// - Gli esagoni non sono vertici: li calcola lo shader della sfera, punto per punto, su una griglia che si infittisce con lo
//   zoom (sempre circa 9 pixel fra uno e l'altro); da vicino si spengono al 22%, perché il dato è il radar e loro il contesto. Dove è terra lo dice una maschera, riempita dai poligoni di mappa.json:
//   tutto il mondo a 0,18° (circa 20 km) e un riquadro di ±6° attorno al luogo a circa 1,3 km.
// - Il radar è una texture sola: a ogni cambio di mappa cambia l'immagine e si ricarica nella stessa memoria; se cambiano le
//   misure si libera prima. Le 13 mappe restano canvas in radar.js, non texture.
// - Il vento è quello del luogo, un punto solo (Open-Meteo): le linee lo mostrano uguale su tutta la zona, accelerato.
// - La vista si comanda con un punto guardato (lon, lat) e un raggio in km (dal punto al bordo alto del riquadro), come il
//   radar piatto di prima; la camera li insegue morbida. Dal largo guarda il centro della Terra; sotto i 5.000 km comincia a
//   inclinarsi e sotto i 1.500 è a 55°: scendendo, il bordo della Terra con l'atmosfera resta in cima al riquadro e si vede la
//   curva. A 150 km l'orizzonte è lontano (servirebbero oltre 70°, e il radar diventerebbe una striscia): lì si atterra inclinati.
// - Le scritte (città e luogo) stanno in un canvas 2D sopra, ridisegnato solo quando la camera si muove; entrano con fillText.
import * as THREE from 'three';
import { createRadar, merc } from './radar.js';

const R = 6371;                                   // km, il raggio medio della Terra
const GR = Math.PI / 180;
const KG = (R * Math.PI) / 180;                   // km in un grado
const FOV = 30;
export const RAGGIO = Object.freeze({ base: 150, min: 25, max: 12000 });
const INCLINA_MAX = 55 * GR;
const INTRO_S = 3.8;
const MASCHERA = { w: 2048, h: 1024 }, LOCALE = { lato: 1024, gradi: 6 };
const CITTA_MAX = 14;

const versore = (lon, lat, v = new THREE.Vector3()) => v.set(Math.cos(lat * GR) * Math.sin(lon * GR), Math.sin(lat * GR), Math.cos(lat * GR) * Math.cos(lon * GR));
const versoEst = (lon, v = new THREE.Vector3()) => v.set(Math.cos(lon * GR), 0, -Math.sin(lon * GR));
const versoNord = (lon, lat, v = new THREE.Vector3()) => v.set(-Math.sin(lat * GR) * Math.sin(lon * GR), Math.cos(lat * GR), -Math.sin(lat * GR) * Math.cos(lon * GR));
const delta = (a) => ((((a + 180) % 360) + 360) % 360) - 180; // la differenza di longitudine più corta
const liscio = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, x) => a + (b - a) * x;

// ---------------------------------------------------------------- la mappa: anelli di terra e laghi, confini, città
let mappa = null;
function caricaMappa() {
  return (mappa ||= fetch('/meteo/mappa.json').then((r) => r.json()).then((m) => {
    const anelli = (ls) => ls.map((a) => {
      const p = new Float32Array(a.length);
      let lon = 0, lat = 0, x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (let i = 0; i < a.length; i += 2) {
        lon += a[i]; lat += a[i + 1];
        const x = lon / 100, y = lat / 100;
        p[i] = x; p[i + 1] = y;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { p, x0, x1, y0, y1 };
    });
    const linee = { coste: anelli(m.linee.coste), laghi: anelli(m.linee.laghi), confini: anelli(m.linee.confini) };
    const citta = m.citta.map(([nome, lon, lat, k]) => ({ nome: String(nome).toUpperCase(), k, v: versore(lon / 100, lat / 100) }));
    return { linee, citta };
  }).catch((e) => { mappa = null; throw e; }));
}

// Dove è terra: gli anelli di terre e laghi riempiti pari-dispari (un lago è un buco, un'isola nel lago torna terra), letto
// dall'alfa. X e Y portano lon e lat nei pixel; filtro salta gli anelli fuori dal riquadro.
function riempi(linee, w, h, X, Y, filtro, out) {
  const tela = document.createElement('canvas');
  tela.width = w; tela.height = h;
  const c = tela.getContext('2d', { willReadFrequently: true });
  c.beginPath();
  for (const l of [...linee.coste, ...linee.laghi]) {
    if (filtro && !filtro(l)) continue;
    const p = l.p;
    c.moveTo(X(p[0]), Y(p[1]));
    for (let i = 2; i < p.length; i += 2) c.lineTo(X(p[i]), Y(p[i + 1]));
    c.closePath();
  }
  c.fillStyle = '#fff';
  c.fill('evenodd');
  const d = c.getImageData(0, 0, w, h).data;
  for (let i = 0, n = w * h; i < n; i++) out[i] = d[i * 4 + 3];
  tela.width = tela.height = 0;
}

// Coste, laghi e confini come segmenti sulla sfera, 2,5 km sopra. Le terre tagliate a ±180° e l'Antartide hanno lati finti
// lungo l'antimeridiano e a −90°: si saltano.
function lineeGeometria(linee) {
  const pos = [], tipo = [], v = new THREE.Vector3(), Rl = R + 2.5;
  [['coste', 0], ['laghi', 1], ['confini', 2]].forEach(([k, t]) => {
    for (const { p } of linee[k]) for (let i = 2; i < p.length; i += 2) {
      const lo0 = p[i - 2], la0 = p[i - 1], lo1 = p[i], la1 = p[i + 1];
      if ((Math.abs(lo0) > 179.99 && Math.abs(lo1) > 179.99) || (la0 < -89.9 && la1 < -89.9)) continue;
      versore(lo0, la0, v).multiplyScalar(Rl); pos.push(v.x, v.y, v.z);
      versore(lo1, la1, v).multiplyScalar(Rl); pos.push(v.x, v.y, v.z);
      tipo.push(t, t);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTipo', new THREE.Float32BufferAttribute(tipo, 1));
  return g;
}

// ---------------------------------------------------------------- shader
// Tutto il globo resta nel riquadro centrale: fuori si taglia (scissor) e negli ultimi 28 pixel sfuma
const CELLA = `
uniform vec4 uRect;
float cella() { vec2 p = gl_FragCoord.xy; vec2 d = min(p - uRect.xy, uRect.zw - p); return clamp(min(d.x, d.y) / 28.0, 0.0, 1.0); }`;
const VERT = `varying vec3 vPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const SFERA_FRAG = `${CELLA}
uniform sampler2D uTerra, uTerraLoc, uRadar;
uniform vec4 uLocBox, uRadarBox;
uniform float uRadarA, uPronta, uRadPx, uVis, uMira, uTerraLuce;
uniform vec3 cMare, cAtmo, cTerra;
varying vec3 vPos;
const float GR = 0.017453292519943295, KG = ${KG.toFixed(6)}, PI = 3.141592653589793;
float terra(float lat, float lon) {
  float g = texture2D(uTerra, vec2((lon + 180.0) / 360.0, (90.0 - lat) / 180.0)).r;
  vec2 q = vec2((lon - uLocBox.x) / uLocBox.z, (uLocBox.y + uLocBox.w - lat) / uLocBox.w);
  float l = texture2D(uTerraLoc, clamp(q, 0.0, 1.0)).r;
  float dentro = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
  return step(0.5, mix(g, l, dentro));
}
// Esagoni a righe sfalsate, s km l'uno dall'altro; ogni esagono è terra o no tutto intero, dal suo centro
float esagoni(float lat, float lon, float s, float kpp) {
  float dlat = 0.866 * s / KG;
  float r = floor((lat + 90.0) / dlat), latc = -90.0 + (r + 0.5) * dlat;
  float n = max(1.0, floor(360.0 * KG * cos(latc * GR) / s)), dlon = 360.0 / n;
  float off = mod(r, 2.0) * 0.5 * dlon;
  float c = floor((lon + 180.0 - off) / dlon), lonc = -180.0 + off + (c + 0.5) * dlon;
  vec2 d = abs(vec2((lon - lonc) * KG * cos(lat * GR), (lat - latc) * KG));
  float h = max(d.x, 0.5 * d.x + 0.866025 * d.y), rad = 0.3 * s;
  return (1.0 - smoothstep(rad - kpp, rad + kpp, h)) * terra(latc, lonc);
}
void main() {
  vec3 n = normalize(vPos), v = normalize(cameraPosition - vPos);
  float lat = asin(clamp(n.y, -1.0, 1.0)) / GR, lon = atan(n.x, n.z) / GR;
  // km in un pixel, qui, lungo la direzione più schiacciata: di sbieco gli esagoni si diradano invece di fare moiré, e sul
  // bordo radente sfumano
  float nv = clamp(dot(n, v), 0.0, 1.0), kpp = distance(vPos, cameraPosition) * uRadPx / max(nv, 0.12);
  float L = log2(max(kpp * 9.0, 0.25)), i = floor(L), f = smoothstep(0.0, 1.0, L - i);
  float punti = uPronta > 0.0 ? mix(esagoni(lat, lon, exp2(i), kpp), esagoni(lat, lon, exp2(i + 1.0), kpp), f) * uPronta * smoothstep(0.03, 0.2, nv) : 0.0;
  float fr = pow(1.0 - nv, 3.0);
  vec3 col = cMare + cAtmo * fr * (0.5 + 0.35 * uMira) + cTerra * punti * uTerraLuce;
  // il radar: Mercatore esatto, punto per punto
  float la = clamp(lat, -85.0, 85.0), s = sin(la * GR);
  vec2 m = vec2((lon + 180.0) / 360.0, 0.5 - log((1.0 + s) / (1.0 - s)) / (4.0 * PI));
  float dx = m.x - uRadarBox.x; dx -= floor(dx);
  vec2 uv = vec2(dx / uRadarBox.z, (m.y - uRadarBox.y) / uRadarBox.w);
  vec4 rd = texture2D(uRadar, clamp(uv, 0.0, 1.0));
  vec2 bordo = min(uv, 1.0 - uv) * vec2(uRadarBox.z, uRadarBox.w) * 40.0;  // gli ultimi 2,5 centesimi del mondo sfumano
  float ok = clamp(min(bordo.x, bordo.y), 0.0, 1.0) * step(abs(lat), 85.0) * uRadarA;
  col = mix(col, rd.rgb, rd.a * ok);
  gl_FragColor = vec4(col, 0.94 * cella() * uVis);
}`;

const ATMO_FRAG = `${CELLA}
uniform vec3 cAtmo; uniform float uAtmo, uVis, uRA, uRT;
varying vec3 vPos;
void main() { // quanto passa vicino alla Terra il raggio di vista: luce piena sul bordo, niente al limite del guscio
  vec3 d = normalize(vPos - cameraPosition);
  float t = max(-dot(cameraPosition, d), 0.0), b = length(cameraPosition + d * t);
  float g = clamp((uRA - b) / (uRA - uRT), 0.0, 1.0);
  gl_FragColor = vec4(cAtmo * g * g * (0.6 + 0.4 * g) * uAtmo * uVis * cella(), 1.0);
}`;

const LINEE_VERT = `attribute float aTipo; varying float vTipo; varying vec3 vPos;
void main() { vTipo = aTipo; vPos = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const LINEE_FRAG = `${CELLA}
uniform vec3 cLinea; uniform vec3 uLuce; uniform float uVis; varying float vTipo;
void main() { float a = vTipo < 0.5 ? uLuce.x : vTipo < 1.5 ? uLuce.y : uLuce.z; gl_FragColor = vec4(cLinea * a * uVis * cella(), 1.0); }`;

const ANELLO_VERT = `attribute float aT; varying float vT; varying vec3 vPos;
void main() { vT = aT; vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const ANELLO_FRAG = `${CELLA}
uniform vec3 cAnello; uniform float uN, uDuty, uLuce, uVis; varying float vT;
void main() { // tratteggio, più una scia che gira con l'anello
  float tratto = uN > 0.0 ? step(fract(vT * uN), uDuty) : 1.0;
  float scia = pow(fract(vT), 6.0);
  gl_FragColor = vec4(cAnello * (tratto * 0.55 + scia * 0.9) * uLuce * uVis * cella(), 1.0);
}`;

const SEGNO_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SEGNO_FRAG = `${CELLA}
uniform vec3 cAcqua; uniform float uT, uVis; varying vec2 vUv;
void main() { // due onde che si allargano, il punto, un anello fisso e quattro tacche
  vec2 p = vUv * 2.0 - 1.0; float d = length(p), a = 0.0;
  for (int k = 0; k < 2; k++) { float ph = fract(uT * 0.55 + float(k) * 0.5); a += (1.0 - smoothstep(0.0, 0.05, abs(d - ph))) * (1.0 - ph) * 0.9; }
  a += 1.0 - smoothstep(0.05, 0.075, d);
  a += (1.0 - smoothstep(0.0, 0.014, abs(d - 0.17))) * 0.8;
  vec2 q = abs(p);
  a += (step(q.y, 0.01) * step(0.24, q.x) * step(q.x, 0.36) + step(q.x, 0.01) * step(0.24, q.y) * step(q.y, 0.36)) * 0.9;
  gl_FragColor = vec4(cAcqua * a * (1.0 - smoothstep(0.92, 1.0, d)) * uVis * cella(), 1.0);
}`;
const RAGGIO_VERT = `attribute float aA; varying float vA; void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RAGGIO_FRAG = `${CELLA}
uniform vec3 cAcqua; uniform float uVis; varying float vA;
void main() { gl_FragColor = vec4(cAcqua * vA * vA * 0.9 * uVis * cella(), 1.0); }`;

// Il vento: ogni linea corre lungo il vento in un quadrato di lato uL km centrato sul luogo, da una parte all'altra, e
// sale in un arco basso; si accende e si spegne ai bordi del cerchio e della corsa. Tutto nello shader: niente da
// aggiornare per ogni particella.
const VENTO_VERT = `
attribute vec2 aSeme; attribute float aCoda;
uniform vec3 uCentro, uEst, uNord; uniform vec2 uDir; uniform float uFase, uL, uCoda;
varying float vA;
void main() {
  float u = fract(aSeme.x + uFase), uu = u - aCoda * uCoda;
  vec2 p = (vec2(uu, aSeme.y) - 0.5) * uL;
  vec2 en = uDir * p.x + vec2(-uDir.y, uDir.x) * p.y;
  float h = 3.0 + uL * 0.025 * sin(3.14159 * clamp(uu, 0.0, 1.0));
  vec3 pos = normalize(uCentro * ${R.toFixed(1)} + uEst * en.x + uNord * en.y) * (${R.toFixed(1)} + h);
  float rr = length((vec2(u, aSeme.y) - 0.5) * 2.0);
  vA = (1.0 - aCoda) * (1.0 - smoothstep(0.65, 0.98, rr)) * smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.88, 1.0, u));
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;
const VENTO_FRAG = `${CELLA}
uniform vec3 cVento; uniform float uVento, uVis; varying float vA;
void main() { gl_FragColor = vec4(cVento * vA * uVento * uVis * cella(), 1.0); }`;

// Gli anelli: altezza e raggio in raggi terrestri, tratti (0 pieno), parte accesa, velocità in radianti al secondo
const ANELLI = [
  { y: 0, r: 1.3, n: 0, duty: 1, w: 0.12, luce: 0.55 },
  { y: 0, r: 1.46, n: 120, duty: 0.35, w: -0.05, luce: 0.5 },
  { y: 0.42, r: 1.12, n: 36, duty: 0.7, w: 0.08, luce: 0.42 },
  { y: -0.42, r: 1.12, n: 36, duty: 0.7, w: -0.09, luce: 0.42 },
  { y: 0.74, r: 0.86, n: 240, duty: 0.22, w: 0.04, luce: 0.45 },
  { y: -0.74, r: 0.86, n: 240, duty: 0.22, w: -0.035, luce: 0.45 },
];

// ---------------------------------------------------------------- il globo
// el: l'elemento del riquadro (mouse, misure); tela: il canvas delle scritte; onInfo: come radar.js
export function createGlobo({ renderer, strato, el, tela, onInfo = () => {} }) {
  const scena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 10, 1e6);
  const passo = strato(scena, camera);
  passo.enabled = false;
  const col = (h) => new THREE.Color(h);
  const C = { mare: col('#020b14'), atmo: col('#00a8ff'), terra: col('#00f0ff'), linea: col('#3ee6ff'), anello: col('#7ff4ff'), acqua: col('#3dffd0'), vento: col('#c8f8ff') };
  const rect = new THREE.Vector4();
  const vis = { value: 0 };

  // Tutto il globo resta nel riquadro: scissor sul render target, più la sfumatura di cella() negli shader
  const disegna = passo.render.bind(passo);
  const taglio = { x: 0, y: 0, w: 1, h: 1 };
  passo.render = (rend, scrivi, leggi, dt, mask) => {
    leggi.scissor.set(taglio.x, taglio.y, taglio.w, taglio.h); leggi.scissorTest = true;
    disegna(rend, scrivi, leggi, dt, mask);
    leggi.scissorTest = false;
  };

  // maschere della terra: il mondo, e un riquadro fine attorno al luogo
  const datiTerra = new Uint8Array(MASCHERA.w * MASCHERA.h), datiLoc = new Uint8Array(LOCALE.lato * LOCALE.lato);
  const mascheraTex = (d, w, h) => {
    const t = new THREE.DataTexture(d, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  };
  const texTerra = mascheraTex(datiTerra, MASCHERA.w, MASCHERA.h), texLoc = mascheraTex(datiLoc, LOCALE.lato, LOCALE.lato);
  const texRadar = new THREE.Texture();
  Object.assign(texRadar, { colorSpace: THREE.SRGBColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, flipY: false });

  const U = {
    uRect: { value: rect }, uVis: vis, uMira: { value: 0 }, uRadPx: { value: 0.001 }, uPronta: { value: 0 }, uTerraLuce: { value: 0.85 },
    uTerra: { value: texTerra }, uTerraLoc: { value: texLoc }, uLocBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRadar: { value: texRadar }, uRadarBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uRadarA: { value: 0 },
    cMare: { value: C.mare }, cAtmo: { value: C.atmo }, cTerra: { value: C.terra },
  };
  const mat = (vert, frag, extra = {}, o = {}) => new THREE.ShaderMaterial({ uniforms: { uRect: U.uRect, uVis: vis, ...extra }, vertexShader: vert, fragmentShader: frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...o });

  // la sfera: scrive la profondità, così il resto dietro di lei sparisce
  const sfera = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 128), mat(VERT, SFERA_FRAG, U, { blending: THREE.NormalBlending, depthWrite: true }));
  sfera.renderOrder = 0;
  const atmo = { uAtmo: { value: 0.55 }, uRA: { value: R * 1.07 }, uRT: { value: R }, cAtmo: { value: C.atmo } };
  const guscio = new THREE.Mesh(new THREE.SphereGeometry(R * 1.07, 96, 48), mat(VERT, ATMO_FRAG, atmo, { side: THREE.BackSide }));
  guscio.renderOrder = 1;
  scena.add(sfera, guscio);

  // coste, laghi e confini: arrivano con la mappa
  const luceLinee = { value: new THREE.Vector3(0.3, 0.2, 0.15) };
  let linee = null;

  // gli anelli
  const anelli = ANELLI.map((a, i) => {
    const N = 720, pos = new Float32Array((N + 1) * 3), t = new Float32Array(N + 1);
    for (let k = 0; k <= N; k++) { const x = (k / N) * Math.PI * 2; pos.set([Math.cos(x), 0, -Math.sin(x)], k * 3); t[k] = k / N; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    const m = new THREE.Line(g, mat(ANELLO_VERT, ANELLO_FRAG, { cAnello: { value: C.anello }, uN: { value: a.n }, uDuty: { value: a.duty }, uLuce: { value: 0 } }));
    m.position.y = a.y * R; m.scale.setScalar(a.r * R); m.rotation.y = i * 1.7; m.renderOrder = 3; m.frustumCulled = false;
    scena.add(m);
    return { m, ...a };
  });

  // il luogo: il segno sulla superficie e un raggio che sale
  const segnoU = { cAcqua: { value: C.acqua }, uT: { value: 0 } };
  const segno = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(SEGNO_VERT, SEGNO_FRAG, segnoU, { side: THREE.DoubleSide }));
  segno.renderOrder = 5; segno.matrixAutoUpdate = false; segno.frustumCulled = false;
  const gRaggio = new THREE.BufferGeometry();
  gRaggio.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
  gRaggio.setAttribute('aA', new THREE.Float32BufferAttribute([1, 0], 1));
  const raggioLuce = new THREE.LineSegments(gRaggio, mat(RAGGIO_VERT, RAGGIO_FRAG, { cAcqua: segnoU.cAcqua }));
  raggioLuce.renderOrder = 5; raggioLuce.matrixAutoUpdate = false; raggioLuce.frustumCulled = false;
  scena.add(segno, raggioLuce);

  // il vento
  const NV = 700, semi = new Float32Array(NV * 4), code = new Float32Array(NV * 2);
  for (let i = 0; i < NV; i++) { const a = Math.random(), b = Math.random(); semi.set([a, b, a, b], i * 4); code.set([0, 1], i * 2); }
  const gVento = new THREE.BufferGeometry();
  gVento.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NV * 6), 3));
  gVento.setAttribute('aSeme', new THREE.BufferAttribute(semi, 2)); gVento.setAttribute('aCoda', new THREE.BufferAttribute(code, 1));
  const ventoU = { uCentro: { value: new THREE.Vector3() }, uEst: { value: new THREE.Vector3() }, uNord: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector2(1, 0) },
    uFase: { value: 0 }, uL: { value: 400 }, uCoda: { value: 0.05 }, uVento: { value: 0 }, cVento: { value: C.vento } };
  const vento = new THREE.LineSegments(gVento, mat(VENTO_VERT, VENTO_FRAG, ventoU));
  vento.renderOrder = 4; vento.frustumCulled = false;
  scena.add(vento);

  // ---------------------------------------------------------------- stato della vista
  let luogo = null, aperto = false, vivo = false, carta = null, pronta = false;
  const tgt = { lon: 0, lat: 0, r: RAGGIO.base };           // dove si vuole guardare
  const cur = { lon: 0, lat: 0, r: RAGGIO.max };            // dove guarda la camera adesso
  let volo = null;                                          // { t0, dur, da, a, giro, intro }
  let tempo = 0, kmh = 0, dirVento = null, fase = 0, mira = 0, miraV = 0, inclina = 0;
  let box = { x: 0, y: 0, w: 1, h: 1 }, dpr = 1, firma = '', etichette = [];
  const ctx = tela.getContext('2d');
  const radar = createRadar({ onInfo, onMappa });

  function onMappa(fr) {
    if (!fr) { U.uRadarA.value = 0; return; }
    const img = fr.tela;
    if (texRadar.image && (texRadar.image.width !== img.width || texRadar.image.height !== img.height)) texRadar.dispose(); // misure nuove: si libera la vecchia
    texRadar.image = img; texRadar.needsUpdate = true;
    const n = 2 ** fr.s.z;
    U.uRadarBox.value.set(fr.s.x0 / n, fr.s.y0 / n, fr.s.nx / n, fr.s.ny / n);
    U.uRadarA.value = 0.92;
  }

  // Le misure del riquadro dal layout, non da getBoundingClientRect: l'entrata dei moduli lo sposta con le trasformazioni
  function misura() {
    let x = 0, y = 0, e = el;
    while (e) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    box = { x, y, w: Math.max(1, el.offsetWidth), h: Math.max(1, el.offsetHeight) };
    dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(box.w * dpr), H = Math.round(box.h * dpr);
    if (tela.width !== W) tela.width = W;
    if (tela.height !== H) tela.height = H;
    firma = '';
  }
  const tanCella = () => (box.h / innerHeight) * Math.tan((FOV / 2) * GR); // tangente del mezzo angolo del riquadro in altezza
  const inclinaDi = (r) => liscio((Math.log(5000) - Math.log(r)) / (Math.log(5000) - Math.log(1500))); // 0 dal largo, 1 sotto i 1.500 km
  const vistaRadar = () => radar.vista({ lon: tgt.lon, lat: tgt.lat, raggio: tgt.r, aspetto: box.w / box.h, pxMezzo: (box.h / 2) * dpr, inclina: inclinaDi(tgt.r) });

  // La maschera fine attorno al luogo: ±6° di latitudine, la longitudine allargata perché sia quadrata in km
  function mascheraLocale() {
    if (!carta || !luogo) return;
    const hl = LOCALE.gradi, wl = Math.min(40, hl / Math.max(0.15, Math.cos(luogo.lat * GR)));
    const lon0 = luogo.lon - wl, lat0 = Math.max(-89.9, luogo.lat - hl), lat1 = Math.min(89.9, luogo.lat + hl), L = LOCALE.lato;
    riempi(carta.linee, L, L, (lon) => ((lon - lon0) / (2 * wl)) * L, (lat) => ((lat1 - lat) / (lat1 - lat0)) * L,
      (l) => l.x1 >= lon0 && l.x0 <= lon0 + 2 * wl && l.y1 >= lat0 && l.y0 <= lat1, datiLoc);
    texLoc.needsUpdate = true;
    U.uLocBox.value.set(lon0, lat0, 2 * wl, lat1 - lat0);
  }
  function preparaMappa() {
    caricaMappa().then((m) => {
      if (carta) return;
      carta = m;
      const t0 = performance.now();
      riempi(m.linee, MASCHERA.w, MASCHERA.h, (lon) => ((lon + 180) / 360) * MASCHERA.w, (lat) => ((90 - lat) / 180) * MASCHERA.h, null, datiTerra);
      texTerra.needsUpdate = true;
      mascheraLocale();
      linee = new THREE.LineSegments(lineeGeometria(m.linee), mat(LINEE_VERT, LINEE_FRAG, { cLinea: { value: C.linea }, uLuce: luceLinee }));
      linee.renderOrder = 2; linee.frustumCulled = false;
      scena.add(linee);
      pronta = true; firma = '';
      console.info(`[meteo] globo: mappa pronta in ${Math.round(performance.now() - t0)} ms`);
    }, (e) => console.warn('[meteo] mappa', e));
  }

  // ---------------------------------------------------------------- camera
  const vT = new THREE.Vector3(), vU = new THREE.Vector3(), vE = new THREE.Vector3(), vN = new THREE.Vector3(), vS = new THREE.Vector3();
  function voloVerso(dur, { intro = false } = {}) {
    const da = { ...cur }, a = { ...tgt };
    const km = Math.acos(Math.min(1, versore(da.lon, da.lat, vS).dot(versore(a.lon, a.lat, vT)))) * R;
    volo = { t0: tempo, dur, da, a, intro, picco: Math.max(0, Math.log(Math.min(RAGGIO.max, km * 1.1)) - Math.max(Math.log(da.r), Math.log(a.r))) };
  }
  function anima(dt) {
    if (volo) {
      const p = Math.min(1, (tempo - volo.t0) / volo.dur), { da, a } = volo;
      if (volo.intro) { // il giro: il mondo gira veloce e rallenta, resta largo un terzo del tempo, poi scende sul luogo
        cur.lon = a.lon - 150 * Math.pow(1 - p, 2.2);
        cur.lat = lerp(da.lat, a.lat, liscio(p));
        const q = p < 0.3 ? 1 - Math.pow(1 - p / 0.3, 3) : 1, z = liscio((p - 0.38) / 0.62);
        cur.r = Math.exp(lerp(lerp(Math.log(da.r), Math.log(RAGGIO.max), q), Math.log(a.r), z));
      } else { // il volo: la longitudine per la via corta, il raggio che sale a metà strada se il salto è lungo
        const e = liscio(p);
        cur.lon = da.lon + delta(a.lon - da.lon) * e; cur.lat = lerp(da.lat, a.lat, e);
        cur.r = Math.exp(lerp(Math.log(da.r), Math.log(a.r), e) + volo.picco * 4 * e * (1 - e));
      }
      if (p >= 1) volo = null;
      return;
    }
    const k = 1 - Math.exp(-dt * 9);
    cur.lon += delta(tgt.lon - cur.lon) * k; cur.lat += (tgt.lat - cur.lat) * k;
    cur.r = Math.exp(Math.log(cur.r) + (Math.log(tgt.r) - Math.log(cur.r)) * k);
  }
  function piazzaCamera() {
    const W = innerWidth, H = innerHeight, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    inclina = INCLINA_MAX * inclinaDi(cur.r);
    const dist = cur.r / tanCella();
    versore(cur.lon, cur.lat, vU); versoNord(cur.lon, cur.lat, vN);
    vT.copy(vU).multiplyScalar(R);
    camera.position.copy(vT).addScaledVector(vU, dist * Math.cos(inclina)).addScaledVector(vN, -dist * Math.sin(inclina));
    camera.up.copy(vU).multiplyScalar(Math.sin(inclina)).addScaledVector(vN, Math.cos(inclina));
    camera.lookAt(vT);
    const alto = camera.position.length() - R;
    camera.near = Math.max(1, alto * 0.25); camera.far = camera.position.length() + 2 * R;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const pr = renderer.getPixelRatio();
    U.uRadPx.value = (2 * Math.tan((FOV / 2) * GR)) / (H * pr);
    rect.set(box.x * pr, (H - box.y - box.h) * pr, (box.x + box.w) * pr, (H - box.y) * pr);
    Object.assign(taglio, { x: Math.floor(rect.x), y: Math.floor(rect.y), w: Math.ceil(rect.z - rect.x), h: Math.ceil(rect.w - rect.y) });
  }

  function piazzaLuogo() {
    if (!luogo) return;
    versore(luogo.lon, luogo.lat, vU); versoEst(luogo.lon, vE); versoNord(luogo.lon, luogo.lat, vN);
    const lato = Math.min(1600, cur.r * 0.34);
    segno.matrix.makeBasis(vE, vN, vU).scale(vS.set(lato, lato, 1)).setPosition(vT.copy(vU).multiplyScalar(R + 0.6));
    segno.matrixWorldNeedsUpdate = true;
    raggioLuce.matrix.makeBasis(vE, vN, vU).scale(vS.set(1, 1, Math.min(2500, cur.r * 0.55))).setPosition(vT);
    raggioLuce.matrixWorldNeedsUpdate = true;
    ventoU.uCentro.value.copy(vU); ventoU.uEst.value.copy(vE); ventoU.uNord.value.copy(vN);
  }

  // ---------------------------------------------------------------- le scritte: il luogo sempre, le città da vicino
  const vP = new THREE.Vector3(), vC = new THREE.Vector3();
  function schermo(v3, out) { // v3 sulla sfera di raggio 1: davanti alla camera e dentro il riquadro?
    vP.copy(v3).multiplyScalar(R);
    vC.copy(camera.position).sub(vP).normalize();
    if (vC.dot(v3) < 0.08) return false;
    vP.project(camera);
    out[0] = (vP.x * 0.5 + 0.5) * innerWidth - box.x; out[1] = (-vP.y * 0.5 + 0.5) * innerHeight - box.y;
    return true;
  }
  function scritta(t, x, y, colore) {
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0, 8, 12, .85)'; ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y); ctx.fillStyle = colore; ctx.fillText(t, x, y);
  }
  function disegnaScritte() {
    const e = camera.matrixWorld.elements, f = `${e.map((x) => x.toFixed(3)).join()}|${vis.value.toFixed(2)}|${box.w}x${box.h}|${pronta}`;
    if (f === firma) return;
    firma = f;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tela.width, tela.height);
    etichette = [];
    if (!luogo || vis.value < 0.05) return;
    const s = dpr, xy = [0, 0], margine = 26;
    ctx.globalAlpha = vis.value;
    ctx.font = `400 ${8.5 * s}px Menlo, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const prese = [];
    const libero = (r) => !prese.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const dentro = (x, y) => x > margine && y > margine && x < box.w - margine && y < box.h - margine;
    // il luogo, in verde acqua, accanto al segno
    const nome = String(luogo.nome || '').toUpperCase();
    if (schermo(versore(luogo.lon, luogo.lat, vS), xy) && dentro(xy[0], xy[1])) {
      const x = (xy[0] + 18) * s, y = (xy[1] - 12) * s, w = ctx.measureText(nome).width;
      prese.push([x - 4 * s, y - 8 * s, x + w + 6 * s, y + 8 * s], [(xy[0] - 10) * s, (xy[1] - 10) * s, (xy[0] + 10) * s, (xy[1] + 10) * s]);
      scritta(nome, x, y, 'rgba(61, 255, 208, .95)');
      etichette.push(nome);
    }
    // le città: da vicino (sotto i 900 km di raggio), prima le grandi e vicine al punto guardato (le lontane sull'orizzonte
    // vengono dopo: Zurigo a 220 km da Milano passava davanti a Como e Bergamo), senza scritte una sopra l'altra
    const a = 1 - liscio((cur.r - 450) / 450);
    if (a > 0.02 && carta) {
      ctx.globalAlpha = vis.value * a;
      const centro = versore(cur.lon, cur.lat, vT), coseno = Math.cos(Math.min(Math.PI / 2, (cur.r * 3) / R)), scelte = [];
      for (const c of carta.citta) {
        const d = c.v.dot(centro);
        if (d >= coseno && c.nome !== nome) scelte.push([Math.log10(c.k + 1) - (1.2 * Math.acos(Math.min(1, d)) * R) / cur.r, c]);
      }
      scelte.sort((x, y) => y[0] - x[0]);
      for (const [, c] of scelte) {
        if (etichette.length > CITTA_MAX) break;
        if (!schermo(c.v, xy) || !dentro(xy[0], xy[1])) continue;
        const x = xy[0] * s, y = xy[1] * s, w = ctx.measureText(c.nome).width + 10 * s, r = [x - 4 * s, y - 7 * s, x + w, y + 7 * s];
        if (!libero(r)) continue;
        prese.push(r);
        ctx.fillStyle = 'rgba(210, 251, 255, .9)'; ctx.fillRect(x - 1.5 * s, y - 1.5 * s, 3 * s, 3 * s);
        scritta(c.nome, x + 5 * s, y, 'rgba(210, 251, 255, .88)');
        etichette.push(c.nome);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- un fotogramma
  function fotogramma(t, dt) {
    if (!vivo) return;
    tempo += dt;
    vis.value = Math.min(1, Math.max(0, vis.value + (aperto ? dt / 0.6 : -dt / 0.45)));
    if (!aperto && vis.value <= 0) {
      vivo = false; passo.enabled = false; volo = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, tela.width, tela.height); firma = '';
      return;
    }
    anima(dt);
    piazzaCamera();
    piazzaLuogo();
    const pr = Math.min(1, U.uPronta.value + (pronta ? dt / 0.5 : 0));
    U.uPronta.value = pr;
    miraV += (mira - miraV) * (1 - Math.exp(-dt * 8));
    U.uMira.value = miraV;
    atmo.uAtmo.value = 0.55 + 0.25 * miraV;
    // da lontano gli anelli, da vicino linee più accese, vento e città
    const largo = liscio((cur.r - 1800) / 2700), vicino = 1 - liscio((cur.r - 300) / 2500);
    for (const a of anelli) { a.m.rotation.y += a.w * dt; a.m.material.uniforms.uLuce.value = a.luce * largo; a.m.visible = largo > 0.01; }
    luceLinee.value.set(lerp(0.22, 0.6, vicino), lerp(0.16, 0.42, vicino), lerp(0.1, 0.3, vicino));
    U.uTerraLuce.value = lerp(0.85, 0.22, vicino);
    segnoU.uT.value = tempo;
    // vento: la fase corre di kmh·0,0022 lati al secondo; il quadrato segue lo zoom, così a schermo va alla stessa velocità
    ventoU.uL.value = Math.max(60, Math.min(1400, cur.r * 2.4));
    fase = (fase + dt * kmh * 0.0022) % 1;
    ventoU.uFase.value = fase;
    ventoU.uCoda.value = Math.min(0.12, 0.02 + 0.0025 * kmh);
    ventoU.uVento.value = (dirVento === null ? 0 : liscio((kmh - 0.5) / 3)) * (1 - liscio((cur.r - 1500) / 1500)) * 0.75;
    vento.visible = ventoU.uVento.value > 0.01;
    disegnaScritte();
  }

  return {
    fotogramma,
    // Al primo avvio il giro del mondo e la discesa; con la vista già aperta, un volo verso il luogo nuovo
    avvia(l) {
      const primo = !aperto;
      const nuovo = !luogo || l.lat !== luogo.lat || l.lon !== luogo.lon;
      luogo = l;
      aperto = true; vivo = true; passo.enabled = true;
      misura();
      tgt.lon = l.lon; tgt.lat = l.lat; tgt.r = RAGGIO.base;
      if (primo && vis.value <= 0) { Object.assign(cur, { lon: l.lon - 150, lat: Math.max(-35, Math.min(35, l.lat * 0.3)), r: RAGGIO.max * 2.2 }); voloVerso(INTRO_S, { intro: true }); }
      else if (nuovo || primo) voloVerso(2.2);
      if (nuovo) mascheraLocale();
      preparaMappa();
      radar.avvia(l, { lon: tgt.lon, lat: tgt.lat, raggio: tgt.r, aspetto: box.w / box.h, pxMezzo: (box.h / 2) * dpr, inclina: inclinaDi(tgt.r) });
    },
    ferma() { aperto = false; radar.ferma(); mira = 0; },
    ridimensiona() { if (!aperto) return; misura(); vistaRadar(); },
    tempo: (t) => radar.tempo(t),
    // In pixel CSS: la superficie segue la mano o il mouse (a destra si guarda più a ovest, in giù più a nord)
    sposta(dx, dy) {
      if (!luogo || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      volo = null;
      const kmPx = tgt.r / (box.h / 2);
      tgt.lat = Math.max(-80, Math.min(80, tgt.lat + (dy * kmPx) / KG));
      tgt.lon = delta(tgt.lon - (dx * kmPx) / (KG * Math.max(0.2, Math.cos(tgt.lat * GR))));
      vistaRadar();
    },
    zoom(f) {
      if (!(f > 0) || !Number.isFinite(f)) return;
      volo = null;
      tgt.r = Math.max(RAGGIO.min, Math.min(RAGGIO.max, tgt.r / f));
      vistaRadar();
    },
    reimposta() { if (!luogo) return; tgt.lon = luogo.lon; tgt.lat = luogo.lat; tgt.r = RAGGIO.base; voloVerso(1.4); vistaRadar(); },
    // Il vento all'ora scelta: km/h e da dove viene, in gradi (0 da nord); le linee corrono verso dove va
    vento(v, dir) {
      kmh = Number.isFinite(v) ? Math.max(0, v) : 0;
      dirVento = Number.isFinite(dir) ? dir : null;
      if (dirVento !== null) { const verso = (dirVento + 180) * GR; ventoU.uDir.value.set(Math.sin(verso), Math.cos(verso)); }
    },
    mira(on) { mira = on ? 1 : 0; },
    get stato() {
      return { ...radar.stato, raggio: tgt.r, centro: merc(tgt.lon, tgt.lat), camera: { lon: cur.lon, lat: cur.lat, raggio: cur.r, inclinazione: inclina / GR, volo: !!volo },
        mappa: pronta, etichette: [...etichette], memoria: { ...renderer.info.memory } };
    },
  };
}
