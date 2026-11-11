// scena.js — l'ologramma nell'HUD: costruisce i pezzi dallo stato del server (GET /api/ologramma), li disegna
// con l'aspetto olografico o in uno degli altri modi, apre la vista esplosa, taglia la sezione, seleziona,
// etichetta, quota in millimetri e fotografa. Disegna nello stesso renderer dell'HUD, con strato() di nucleo.js: un RenderPass
// prima del bagliore, quindi i colori sono lineari e tarati sulla soglia del bloom (0,18 di luminanza).
// Sicurezza: dallo stato arrivano solo dati; i testi vanno nel DOM con textContent e i numeri ripassano da
// forme.js (normalizzaPezzo, normalizzaVista) prima di toccare la scena.
import * as THREE from 'three';
import { normalizzaPezzo, normalizzaVista, volume, ingombro, massaTesto, MODI, PREDEFINITI } from './forme.js';
import { MATERIALI } from './materiali.js';
import { geometria, leggiFile, estensione, matricePezzo } from './geometrie.js';

const GRADI = Math.PI / 180;
const ETICHETTE_MAX = 12;
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
// Colori dell'HUD (THREE.Color li porta da sRGB a lineare). Ciano dominante, come il resto dell'HUD: gli spigoli sono il
// ciano #3ee6ff scalato alla luminanza lineare dell'azzurro di prima (0x2a86ff 0,25, 0x6cc8ff 0,52), perché l'aspetto è
// tarato sulla soglia del bloom (0,18). Gli interni ai raggi X sono verde acqua (0x3dffd0, 0,77 come il ciano chiaro di
// prima): con gli esterni ciano, un ciano chiaro non si distingueva. Arancione e rosso stanno solo nelle anomalie.
// Il solido ha luminanza 0,177, appena sotto la soglia del bloom: a 0,39 (la prima versione) il bagliore lo
// bruciava in bianco e l'ombreggiatura spariva (screenshot del 7/11).
const COL = {
  linea: new THREE.Color(0x2595a6), alta: new THREE.Color(0x37d0e7), interno: new THREE.Color(0x3dffd0),
  solido: lin(0.135, 0.185, 0.2), grigio: lin(0.09, 0.1, 0.12), scuro: lin(0.002, 0.014, 0.02),
};
// 48 direzioni quasi uniformi (spirale di Fibonacci) per i punti d'appoggio dei pezzi, usati dall'inquadratura
const DIREZIONI = (() => {
  const d = [], n = 48;
  for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * Math.PI * (3 - Math.sqrt(5)); d.push(Math.cos(a) * r, y, Math.sin(a) * r); }
  return d;
})();
// Flussi dichiarati sui cavi: colore, impulsi al secondo, passo in raggi del cavo, coda dell'impulso in frazioni del passo.
// È un disegno, non una simulazione. Senza l'arancione di prima si distinguono per colore, velocità e forma: elettrico
// scintille bianco-ciano corte e veloci, fluido onde blu profondo lunghe e lente, aria soffi larghi ciano pallido, dati
// trattini verde acqua fitti.
const FLUSSO = { elettrico: [0xd9fbff, 3.4, 8, 0.1], fluido: [0x1f4fff, 0.45, 16, 0.6], aria: [0x9fdcec, 0.9, 11, 0.42], dati: [0x3dffd0, 2.6, 5, 0.22] };

// ---------------------------------------------------------------- scale di colore
// Una sola funzione per shader e legenda, in RGB lineare. Rischio: dal blu al viola e al magenta man mano che il margine
// cala; il rosso solo da fs 1 in giù, dove il materiale snerva, perché il rosso è un'anomalia (regola di Tony del 10/11).
// Prima il rosso pieno partiva da fs 1,25, contro il contratto. La luminanza cresce col rischio e passa la soglia del
// bloom (0,18) solo vicino a fs 1: brilla solo quello che cede, il blu resta spento.
const TAPPE_RISCHIO = [[0, [0.006, 0.04, 0.7]], [0.35, [0.1, 0.03, 0.8]], [0.6, [0.42, 0.02, 0.55]], [0.9, [0.6, 0.02, 0.42]], [0.985, [0.68, 0.02, 0.32]], [1, [1, 0.1, 0.01]]];
// Densità: dal blu petrolio scuro (leggero) al ciano (denso). La luminanza cresce da 0,045 a 0,185 e resta vicino alla soglia
// del bloom come il solido, così l'ombreggiatura si legge. Prima la scala passava dall'arancione al rosso, che sono
// delle anomalie, e a metà (l'alluminio) arrivava a 0,36 e bruciava nel bagliore.
const TAPPE_DENSITA = [[0, [0.005, 0.0491, 0.1226]], [0.35, [0.006, 0.0989, 0.1798]], [0.7, [0.008, 0.1573, 0.2185]], [1, [0.012, 0.228, 0.2683]]];
export const DENSITA_SCALA = Object.freeze([900, 8000]); // kg/m³, in scala logaritmica: dal PA12 all'acciaio
function scala(tappe, t) {
  t = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let k = 0; while (k < tappe.length - 2 && t > tappe[k + 1][0]) k++;
  const [t0, a] = tappe[k], [t1, b] = tappe[k + 1], w = (t - t0) / (t1 - t0);
  return [0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * w);
}
/**
 * Rischio 0..1 dal fattore di sicurezza: 1/fs, cioè lo sforzo diviso lo snervamento; rosso da fs 1 in giù (contratto).
 * Lineare: con la scala di prima, blu da fs 3 in su, le analisi vere (fs 3,2 e 11,8) erano tutte blu e non si vedeva
 * dove il pezzo lavora.
 */
export const rischio = (fs) => Math.min(1, Math.max(0, 1 / fs));
/** Le tappe della legenda degli sforzi, in fs: 1/fs le mette a un quarto, a metà, a tre quarti e in fondo. */
export const TAPPE_FS = Object.freeze([4, 2, 4 / 3, 1]);
export const coloreRischio = (r) => scala(TAPPE_RISCHIO, r);
export const coloreDensita = (rho) => scala(TAPPE_DENSITA, Math.log(rho / DENSITA_SCALA[0]) / Math.log(DENSITA_SCALA[1] / DENSITA_SCALA[0]));
const sRGB = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).getStyle();
// 24 tappe: fra una e l'altra la differenza fra interpolare in sRGB (CSS) e in lineare (shader) non si vede
const gradiente = (f) => `linear-gradient(90deg, ${Array.from({ length: 24 }, (_, i) => `${sRGB(f(i / 23))} ${((100 * i) / 23).toFixed(1)}%`).join(', ')})`;

/** L'angolo della testa, come nel report: le ultime due colonne delle ultime due righe di una griglia 12×6. */
export function angoloTesta(W = innerWidth, H = innerHeight) {
  const gw = W * (1 - 0.044), gh = H * (1 - 0.086), cw = (gw - 11 * 12) / 12, rh = (gh - 5 * 12) / 6;
  const x0 = 0.022 * W + 10 * (cw + 12), y0 = 0.06 * H + 4 * (rh + 12), x1 = 0.022 * W + gw, y1 = 0.06 * H + gh;
  return { dockX: (x0 + x1) / 2, dockY: y0 + 0.6 * (y1 - y0), x0, y0, x1, y1 };
}

// ---------------------------------------------------------------- shader (nostri, mai da fuori)
// Il campo degli sforzi si legge per pixel da una texture 3D del rischio (0..254, 255 = voxel vuoto). Con i colori
// per vertice il picco della staffa (fs 1,57) spariva: la faccia del braccio ha vertici solo agli angoli e ai fori,
// un cilindro solo sui due bordi, e il colore si interpolava fra quelli (screenshot del 7/11). Trilineare sui soli
// voxel pieni; sulla superficie si guarda dentro il pezzo, lungo la normale, perché lì i voxel sono mezzi vuoti.
// La rampa è scritta dalle stesse tappe della legenda (numeri nostri, non dati da fuori).
const g4 = (x) => x.toFixed(4);
const CAMPO_GLSL = `uniform highp sampler3D uRischio; uniform vec3 uCampoO, uCampoN; uniform float uCampoH;
vec3 rampa(float t) {
  t = clamp(t, 0.0, 1.0);
  ${TAPPE_RISCHIO.slice(1).map(([t1, c1], k) => { const [t0, c0] = TAPPE_RISCHIO[k]; return `if (t <= ${g4(t1)}) return mix(vec3(${c0.map(g4)}), vec3(${c1.map(g4)}), (t - ${g4(t0)}) / ${g4(t1 - t0)});`; }).join('\n  ')}
  return vec3(${TAPPE_RISCHIO[TAPPE_RISCHIO.length - 1][1].map(g4)});
}
float rischioIn(vec3 p) {
  vec3 g = (p - uCampoO) / uCampoH - 0.5, i0 = floor(g), f = g - i0;
  float s = 0.0, w = 0.0;
  for (int c = 0; c < 8; c++) {
    vec3 o = vec3(float(c & 1), float((c >> 1) & 1), float(c >> 2)), i = i0 + o;
    if (any(lessThan(i, vec3(0.0))) || any(greaterThanEqual(i, uCampoN))) continue;
    float t = texelFetch(uRischio, ivec3(i), 0).r * 255.0;
    if (t > 254.5) continue;
    vec3 q = mix(1.0 - f, f, o);
    s += q.x * q.y * q.z * t / 254.0; w += q.x * q.y * q.z;
  }
  return w > 1e-6 ? s / w : -1.0;
}`;
const VERT = `#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vNW; varying float vU;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vNW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * w;
  vV = mvPosition.xyz;
  vN = normalize(normalMatrix * normal);
  vU = uv.x;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
// Ologramma e raggi X: luce che si somma (bordo fresnel, riempimento tenue sotto soglia, scanline che scorrono).
// Solido, densità e sforzi: opachi, ombreggiati con una luce fissa rispetto alla camera.
const FRAG = `#include <clipping_planes_pars_fragment>
uniform float uTempo, uTremolio, uAlfa, uFill, uRim, uSel, uFuoco, uOpaco, uRetro, uCampo, uAmb, uPasso, uSweep, uSweepA, uSweepK;
uniform float uFlusso, uFlussoVel, uFlussoPasso, uFlussoCoda, uLungo;
uniform vec3 uColA, uColB, uColFlusso;
${CAMPO_GLSL}
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vNW; varying float vU;
const float PASSI[5] = float[5](0.5, 1.0, 1.6, 2.4, 0.2);
void main() {
  #include <clipping_planes_fragment>
  if (uOpaco > 0.5 && uRetro > 0.5 && !gl_FrontFacing) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float f = 1.0 - clamp(abs(dot(n, normalize(-vV))), 0.0, 1.0);
  float fr = f * f * (0.5 + 0.5 * f);
  float sc = 0.5 + 0.5 * sin(vW.y * uPasso - uTempo * 2.4);
  sc *= sc;
  float sw = uSweepA * exp(-abs(vW.y - uSweep) * uSweepK);
  vec3 col;
  if (uOpaco < 0.5) {
    col = (uColA * uFill * (0.65 + 0.7 * sc) + uColB * (uRim * fr + sw)) * (1.0 + 0.9 * uSel) * uTremolio;
  } else {
    float d = max(dot(n, normalize(vec3(-0.35, 0.6, 0.72))), 0.0);
    vec3 base = uColA;
    if (uCampo > 0.5) {
      vec3 nw = normalize(vNW);
      if (!gl_FrontFacing) nw = -nw;
      float r = -1.0;
      for (int k = 0; k < 5; k++) { r = rischioIn(vW - nw * PASSI[k] * uCampoH); if (r >= 0.0) break; }
      base = r >= 0.0 ? rampa(r) : vec3(0.09, 0.1, 0.12);
    }
    col = (base * (uAmb + (1.0 - uAmb) * d) * (0.96 + 0.08 * sc) + uColB * (uRim * fr + sw)) * (1.0 + 0.45 * uSel);
  }
  if (uFlusso > 0.5) {
    float s = fract(vU * uLungo / uFlussoPasso - uTempo * uFlussoVel), testa = 0.2 * uFlussoCoda; // fronte netto, coda che sfuma
    col += uColFlusso * 0.8 * smoothstep(0.0, testa, s) * (1.0 - smoothstep(testa, uFlussoCoda, s));
  }
  // con un pezzo selezionato gli altri si abbassano: la selezione dentro la gondola prima non si vedeva
  col *= mix(1.0, 0.3, uFuoco * (1.0 - min(2.0 * uSel, 1.0)));
  gl_FragColor = vec4(col, uAlfa);
}`;
const VERT_W = `#include <clipping_planes_pars_vertex>
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const FRAG_SPIGOLI = `#include <clipping_planes_pars_fragment>
uniform float uTempo, uTremolio, uAlfa, uI, uPasso, uSel, uFuoco; uniform vec3 uCol;
varying vec3 vW;
void main() {
  #include <clipping_planes_fragment>
  float sc = 0.5 + 0.5 * sin(vW.y * uPasso - uTempo * 2.4);
  gl_FragColor = vec4(uCol * uI * (0.8 + 0.35 * sc) * (1.0 + uSel) * uTremolio * mix(1.0, 0.3, uFuoco * (1.0 - min(2.0 * uSel, 1.0))), uAlfa);
}`;
// Tappo della sezione: tratteggio ciano in coordinate del piano, con lo spessore delle righe costante sullo schermo.
// Con gli sforzi il tappo mostra il campo dentro il materiale tagliato, con il tratteggio più tenue sopra.
const FRAG_TAPPO = `uniform vec3 uU, uV, uCol, uFondo; uniform float uPasso, uAlfa, uSforzi;
${CAMPO_GLSL}
varying vec3 vW;
void main() {
  float d = (dot(vW, uU) + dot(vW, uV)) / uPasso;
  float g = 0.5 - abs(fract(d) - 0.5);
  float l = 1.0 - smoothstep(0.07, 0.07 + 1.5 * fwidth(d), g);
  vec3 fondo = uFondo;
  if (uSforzi > 0.5) { float r = rischioIn(vW); if (r >= 0.0) { fondo = rampa(r); l *= 0.3; } }
  gl_FragColor = vec4(mix(fondo, uCol, l) * uAlfa, 1.0);
}`;
const FRAG_PIANO = `uniform vec3 uCol; uniform float uAlfa;
void main() { gl_FragColor = vec4(uCol, uAlfa); }`;

// ---------------------------------------------------------------- DOM: stile fisso, testi solo con textContent
// Le variabili sono quelle di index.html (ciano, testi, sottile e mono); qui hanno un ripiego per il laboratorio, che non
// le definisce. Moduli trasparenti senza bordi pieni (gli angoli a staffa della scheda li disegna index.html), titoli e
// valori in sottile maiuscolo, etichette e numeri piccoli in mono. Arancione e rosso solo sulle anomalie: calcolo
// fallito, campo mancante o file che non si apre (.attenzione), pezzo che cede (.cede).
const CSS = `
.holo { --o-c: var(--ciano, #3ee6ff); --o-cv: var(--ciano-vivo, #b6f8ff); --o-ct: var(--ciano-tenue, rgba(62, 230, 255, .32));
  --o-t1: var(--testo, rgba(222, 251, 255, .94)); --o-t2: var(--testo-2, rgba(150, 222, 238, .7)); --o-ar: var(--arancio, #ff9b33); --o-ro: var(--rosso, #ff4343);
  --o-s: var(--sottile, "Helvetica Neue", Helvetica, Arial, sans-serif); --o-m: var(--mono, Menlo, Monaco, monospace);
  --o-gl: var(--bagliore, 0 0 6px rgba(62, 230, 255, .7), 0 0 16px rgba(62, 230, 255, .28)); --o-buio: 0 0 2px #000, 0 0 4px #000;
  position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .35s; z-index: 4; font: 300 12px/1.4 var(--o-s); color: var(--o-t1); }
.holo.on { opacity: 1; }
.holo-top { position: absolute; left: 2.2vw; right: 2.2vw; top: 2.2vh; display: flex; justify-content: space-between; align-items: baseline; gap: 2vw;
  white-space: nowrap; text-transform: uppercase; }
.holo-top span:first-child { overflow: hidden; text-overflow: ellipsis; font: 200 15px/1.2 var(--o-s); letter-spacing: .26em; color: var(--o-cv); text-shadow: var(--o-gl); }
.holo-top span:last-child { font: 400 9.5px/1 var(--o-m); letter-spacing: .2em; color: var(--o-c); text-shadow: var(--o-gl); }
.holo-desc { position: absolute; left: 2.2vw; top: calc(2.2vh + 25px); max-width: 46vw; font: 300 11.5px/1.45 var(--o-s); letter-spacing: .03em; color: var(--o-t2); }
.holo-card { position: absolute; left: 2.2vw; top: 12vh; min-width: 210px; max-width: 300px; padding: 12px 14px 11px;
  background: linear-gradient(135deg, rgba(62, 230, 255, .075), rgba(62, 230, 255, .02) 55%, rgba(62, 230, 255, 0));
  opacity: 0; transform: translateX(-8px); transition: opacity .25s, transform .25s; }
.holo-card.on { opacity: 1; transform: none; }
.holo-card b { display: block; margin-bottom: 4px; font: 300 16px/1.2 var(--o-s); letter-spacing: .14em; text-transform: uppercase; color: var(--o-cv); text-shadow: var(--o-gl); }
.holo-card div { margin-top: 8px; }
.holo-card .k { display: block; margin-bottom: 3px; font: 400 8.5px/1 var(--o-m); letter-spacing: .22em; text-transform: uppercase; color: var(--o-t2); }
.holo-card .v { font: 300 12.5px/1.35 var(--o-s); letter-spacing: .03em; color: var(--o-t1); overflow-wrap: anywhere; } /* una fonte senza spazi non esce dai 300 px */
.holo-leg { position: absolute; left: 2.2vw; bottom: 3.2vh; width: min(34vw, 420px); font: 400 9px/1.3 var(--o-m); letter-spacing: .14em; color: var(--o-t1);
  opacity: 0; transition: opacity .3s; }
.holo-leg.on { opacity: 1; }
.holo-leg .t { text-transform: uppercase; letter-spacing: .22em; color: var(--o-c); text-shadow: var(--o-gl); }
.holo-leg .bar { height: 6px; margin: 8px 0 5px; box-shadow: 0 0 0 1px rgba(62, 230, 255, .22); }
.holo-leg .ticks { position: relative; height: 19px; }
.holo-leg .ticks span { position: absolute; top: 3px; transform: translateX(-50%); white-space: nowrap; }
.holo-leg .ticks span::before { content: ""; position: absolute; left: 50%; top: -7px; height: 5px; border-left: 1px solid var(--o-ct); }
.holo-leg .nota { font: 300 12px/1.4 var(--o-s); letter-spacing: .03em; color: var(--o-t2); }
.holo .attenzione { color: var(--o-ar); text-shadow: 0 0 8px rgba(255, 155, 51, .55); }
.holo .cede { color: var(--o-ro); text-shadow: 0 0 8px rgba(255, 67, 67, .6); }
.holo-tag { position: absolute; left: 0; top: 0; font: 400 9px/14px var(--o-m); letter-spacing: .2em; text-transform: uppercase; white-space: nowrap;
  color: var(--o-t1); text-shadow: var(--o-buio), 0 0 7px rgba(62, 230, 255, .75); opacity: 0; will-change: transform, opacity; }
.holo-tag::before { content: ""; position: absolute; left: -11px; top: 50%; width: 5px; height: 5px; margin-top: -3px; border: 1px solid var(--o-c); border-radius: 50%;
  box-shadow: 0 0 4px var(--o-c); }
.holo-quota { position: absolute; left: 0; top: 0; font: 400 9.5px/12px var(--o-m); letter-spacing: .12em; white-space: nowrap;
  color: var(--o-cv); text-shadow: var(--o-buio), 0 0 7px rgba(62, 230, 255, .7); opacity: 0; will-change: transform, opacity; }
.holo-cur { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 1px solid var(--o-cv); border-radius: 50%;
  box-shadow: 0 0 10px rgba(62, 230, 255, .6); opacity: 0; transition: opacity .2s; }
.holo-cur.on { opacity: 1; }
.holo-cur.presa { background: rgba(62, 230, 255, .22); }
.holo-cur.azione { box-shadow: 0 0 14px rgba(62, 230, 255, .95); }
.holo-top .holo-mani { font: 400 9.5px/1 var(--o-m); letter-spacing: .2em; color: var(--o-c); text-shadow: var(--o-gl); }`;

function el(tag, cls, padre) { const e = document.createElement(tag); if (cls) e.className = cls; if (padre) padre.append(e); return e; }
const taglia = (s, n) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : '');
const finito = (v) => typeof v === 'number' && Number.isFinite(v);
const liscio = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const numero = (v, d = 1) => v.toLocaleString('it-IT', { maximumFractionDigits: d });
/**
 * Millimetri come in un disegno tecnico: il punto per le migliaia e, sotto i 100 mm, sempre una cifra decimale
 * («1.240», «12,5», «8,0»). toLocaleString('it-IT') non mette il punto nei numeri di quattro cifre, quindi si fa a mano.
 */
export function mmTesto(x) {
  if (!finito(x)) return '—';
  const d = Math.round(Math.abs(x) * 10) / 10 < 100 ? 1 : 0, [intera, dec] = x.toFixed(d).split('.');
  return intera.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
}
// Un pezzo ha misure solo con un ingombro vero: un file non ancora aperto, o che non si apre, ha per ingombro il punto della sua posizione.
const misurabile = (R) => (R.p.forma !== 'file' || R.corpi.length > 0) && !R.box.isEmpty() &&
  Number.isFinite(R.box.min.x + R.box.min.y + R.box.min.z + R.box.max.x + R.box.max.y + R.box.max.z);

/**
 * L'ologramma. renderer e strato vengono da createScene di nucleo.js; contenitore è l'elemento DOM per testi
 * ed etichette; onTogli(id) chiede al server di togliere un pezzo lanciato via; onFoto(png_base64, versione, modello)
 * riceve la foto di ogni versione nuova. scarica (facoltativo, predefinito fetch) serve alle prove senza server.
 */
export function createOlogramma({ renderer, strato, contenitore, sfx = null, onTogli = () => {}, onFoto = () => {}, scarica = (u) => fetch(u, { cache: 'no-store' }) }) {
  const scena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 1e6);
  const passo = strato(scena, camera);
  passo.enabled = false; // chiuso: il RenderPass si salta del tutto
  renderer.localClippingEnabled = true;
  // Il piano c'è sempre: senza sezione taglia a 1e9 mm, così i programmi non si ricompilano quando la sezione si accende.
  const piano = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  const comuni = { uTempo: { value: 0 }, uTremolio: { value: 1 }, uPasso: { value: 1 }, uSweep: { value: -1e9 }, uSweepA: { value: 0 }, uSweepK: { value: 1 }, uFuoco: { value: 0 },
    uRischio: { value: null }, uCampoO: { value: new THREE.Vector3() }, uCampoN: { value: new THREE.Vector3() }, uCampoH: { value: 1 } };

  // sezione: facce dietro +1, facce davanti −1 sullo stencil, poi il tappo dove lo stencil non è 0 (un passaggio solo)
  const baseStencil = { colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: [piano] };
  const stRetro = new THREE.MeshBasicMaterial({ ...baseStencil, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp });
  const stFronte = new THREE.MeshBasicMaterial({ ...baseStencil, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp });
  const uTappo = { uU: { value: new THREE.Vector3() }, uV: { value: new THREE.Vector3() }, uPasso: { value: 1 }, uAlfa: { value: 1 }, uCol: { value: COL.alta.clone().multiplyScalar(0.55) }, uFondo: { value: COL.scuro.clone() },
    uSforzi: { value: 0 }, uRischio: comuni.uRischio, uCampoO: comuni.uCampoO, uCampoN: comuni.uCampoN, uCampoH: comuni.uCampoH };
  const tappo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: uTappo, vertexShader: VERT_W, fragmentShader: FRAG_TAPPO, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
  }));
  tappo.renderOrder = 2; tappo.visible = false; tappo.frustumCulled = false;
  tappo.onAfterRender = (r) => r.clearStencil();
  const contornoGeo = new THREE.BufferGeometry();
  { // rettangolo unitario nel piano XY con le tacche agli angoli
    const v = [], q = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; v.push(a[0], a[1], 0, b[0], b[1], 0); }
    for (const [x, y] of q) v.push(x, y, 0, x * 1.06, y * 1.06, 0);
    contornoGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  }
  const additivo = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  const contorno = new THREE.LineSegments(contornoGeo, new THREE.ShaderMaterial({ ...additivo, uniforms: { uCol: { value: COL.alta.clone().multiplyScalar(0.6) }, uAlfa: { value: 1 } }, vertexShader: VERT_W, fragmentShader: FRAG_PIANO }));
  const velo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ ...additivo, side: THREE.DoubleSide, uniforms: { uCol: { value: COL.linea.clone() }, uAlfa: { value: 0.03 } }, vertexShader: VERT_W, fragmentShader: FRAG_PIANO }));
  contorno.renderOrder = velo.renderOrder = 6; contorno.visible = velo.visible = false;
  scena.add(tappo, contorno, velo);
  const modello = new THREE.Group();
  scena.add(modello);
  // Quote: per asse due linee di riferimento, la linea di quota e due trattini obliqui, cioè 5 segmenti. Un solo LineSegments
  // con un buffer di 30 vertici, riscritto solo quando cambia qualcosa (ingombro, spigolo scelto, distanza).
  const quotaBuf = new Float32Array(3 * 5 * 2 * 3), quotaNuovo = new Float32Array(quotaBuf.length), quotaGeo = new THREE.BufferGeometry();
  quotaGeo.setAttribute('position', new THREE.BufferAttribute(quotaBuf, 3).setUsage(THREE.DynamicDrawUsage));
  quotaGeo.setDrawRange(0, 0);
  const uQuota = { uCol: { value: COL.alta.clone() }, uAlfa: { value: 0 } };
  // Sempre sopra, come i testi: nel solido le linee dietro un pezzo sparivano e la quota restava a metà (foto della staffa)
  const quotaLinee = new THREE.LineSegments(quotaGeo, new THREE.ShaderMaterial({ ...additivo, depthTest: false, uniforms: uQuota, vertexShader: VERT_W, fragmentShader: FRAG_PIANO }));
  quotaLinee.renderOrder = 6; quotaLinee.frustumCulled = false; quotaLinee.visible = false;
  scena.add(quotaLinee);

  // DOM
  if (!document.getElementById('holo-stile')) { const s = el('style'); s.id = 'holo-stile'; s.textContent = CSS; document.head.append(s); }
  const radice = el('div', 'holo', contenitore);
  const barra = el('div', 'holo-top', radice), titoloEl = el('span', '', barra), contaEl = el('span', '', barra);
  // L'indizio delle mani, fra titolo e conteggio: dice cosa fare quando gesti.js è a riposo. Cambia solo coi cambi di fase
  const maniEl = el('span', 'holo-mani'); barra.insertBefore(maniEl, contaEl);
  let faseMani = 'spente';
  const descEl = el('div', 'holo-desc', radice);
  const scheda = el('div', 'holo-card', radice);
  const legenda = el('div', 'holo-leg', radice);
  const etichette = Array.from({ length: ETICHETTE_MAX }, () => el('div', 'holo-tag', radice));
  const larghezze = new Array(ETICHETTE_MAX).fill(0); // px, misurate quando cambia il testo
  const cursore = el('i', 'holo-cur', radice);
  const quoteEl = ['x', 'y', 'z'].map((a) => { const e = el('div', 'holo-quota', radice); e.dataset.asse = a; return e; });
  // Zone che etichette e quote non coprono: 0 la scheda, 1 la legenda, 2 la descrizione. I rettangoli si rileggono dal DOM
  // solo dopo un cambio o un ridimensionamento, non a ogni fotogramma.
  const ostacoli = [null, null, null];
  let rettOstacoli = null;
  function ostacolo(i, e) { ostacoli[i] = e || null; rettOstacoli = null; }
  function rettangoli() {
    if (!rettOstacoli) {
      rettOstacoli = [];
      for (const e of ostacoli) {
        const r = e?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) rettOstacoli.push({ x0: r.left - 12, y0: r.top - 6, x1: r.right + 12, y1: r.bottom + 6 }); // 12: la scheda entra da −8 px
      }
    }
    return rettOstacoli;
  }

  // stato locale
  const pezzi = new Map(); // id → record
  let aperto = false, numModello = null, versione = -Infinity, titolo = '', descrizione = '';
  let vista = { ...PREDEFINITI.vista }, vistaServer = null, analisi = null, campo = null, campoChiave = null, campoErrore = false, caricamenti = 0;
  const anim = { esploso: 0, apertura: Infinity, chiusura: null, finoA: 0, globale: 0, sezioneSuono: 0 };
  const cam = { yaw: -0.62, pitch: 0.3, zoom: 1, centro: new THREE.Vector3(), raggio: 1, pronta: false };
  const misureModello = { centro: new THREE.Vector3(), raggio: 1, D1: 1 };
  let gruppi = [], etichetteGruppi = [], zona = null, trascina = null, presa = null, sopra = null, ultimoSopra = 0, ultimoCursore = 0;
  const foto = { attesa: null, pronto: 0, inCorso: false };
  // soggetto: l'id del pezzo quotato, '*' per il modello intero o null; scelta: per asse lo spigolo e il lato della quota
  const quota = { soggetto: null, alfa: 0, scelta: [null, null, null], testi: ['', '', ''], carattere: 0 };
  let orologio = 0;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), box = new THREE.Box3(), boxP = new THREE.Box3();
  const raggio = new THREE.Raycaster();

  // ---------------------------------------------------------------- materiali di un pezzo
  function materiali(p) {
    const u = {
      ...comuni, uAlfa: { value: 0 }, uFill: { value: 0.05 }, uRim: { value: 0.4 }, uSel: { value: 0 }, uOpaco: { value: 0 }, uRetro: { value: p.forma === 'file' ? 0 : 1 },
      uCampo: { value: 0 }, uAmb: { value: 0.35 }, uColA: { value: COL.linea.clone() }, uColB: { value: COL.alta.clone() },
      uFlusso: { value: 0 }, uFlussoVel: { value: 1 }, uFlussoPasso: { value: 20 }, uFlussoCoda: { value: 0.3 }, uLungo: { value: 1 }, uColFlusso: { value: new THREE.Color() },
    };
    const corpo = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, clipping: true, clippingPlanes: [piano], ...additivo, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const spigoli = new THREE.ShaderMaterial({
      uniforms: { uTempo: comuni.uTempo, uTremolio: comuni.uTremolio, uPasso: comuni.uPasso, uFuoco: comuni.uFuoco, uAlfa: { value: 0 }, uI: { value: 0.45 }, uSel: { value: 0 }, uCol: { value: COL.alta.clone() } },
      vertexShader: VERT_W, fragmentShader: FRAG_SPIGOLI, clipping: true, clippingPlanes: [piano], ...additivo,
    });
    return { corpo, spigoli };
  }

  const chiaveGeo = (p) => JSON.stringify([p.forma, p.misure]);
  const chiavePosa = (p) => JSON.stringify([p.posizione, p.rotazione]);

  function nuovoPezzo(p) {
    const nodo = new THREE.Group(), mat = materiali(p);
    const R = {
      id: p.id, p, chiave: chiaveGeo(p), posa: chiavePosa(p), nodo, mat, corpi: [], geos: [], linee: [],
      box: new THREE.Box3(), centro: new THREE.Vector3(), off: new THREE.Vector3(), dir1: new THREE.Vector3(), dir2: new THREE.Vector3(), D2: 0,
      presaOff: new THREE.Vector3(), volo: null, voloOff: new THREE.Vector3(), alfa: 0, alfaT: 1, tolto: false, atterra: 0, colorato: false, errore: null, token: null, lunghezza: 1, sup: null,
    };
    modello.add(nodo);
    posa(R);
    if (p.forma === 'file') { calcolaBox(R); carica(R); } // finché il file non arriva, l'ingombro è il punto della sua posizione
    else monta(R, [geometria(p)]);
    return R;
  }

  function monta(R, geos) {
    for (const g of geos) {
      const corpo = new THREE.Mesh(g, R.mat.corpo);
      corpo.renderOrder = 3; corpo.userData.id = R.id;
      const linee = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), R.mat.spigoli);
      linee.renderOrder = 4;
      const sr = new THREE.Mesh(g, stRetro), sf = new THREE.Mesh(g, stFronte);
      sr.renderOrder = sf.renderOrder = 1;
      sr.userData.stencil = sf.userData.stencil = true;
      R.nodo.add(corpo, linee, sr, sf);
      R.corpi.push(corpo); R.geos.push(g, linee.geometry); R.linee.push(linee);
      if (g.userData.lunghezza) R.lunghezza = g.userData.lunghezza;
    }
    calcolaBox(R);
    R.colorato = false;
    if (campo) colora(R);
    statoMateriale(R);
  }

  function smonta(R) {
    for (const o of [...R.nodo.children]) R.nodo.remove(o);
    for (const g of R.geos) g.dispose();
    R.corpi = []; R.geos = []; R.linee = []; R.colorato = false;
  }

  function libera(R) {
    smonta(R);
    R.token = null;
    modello.remove(R.nodo);
    R.mat.corpo.dispose(); R.mat.spigoli.dispose();
  }

  // Posa del pezzo: Object3D con rotation 'XYZ', che coincide con forme.matrice (provato in prove/ologramma-geometrie.mjs).
  function posa(R) {
    const p = R.p;
    R.nodo.rotation.set(p.rotazione[0] * GRADI, p.rotazione[1] * GRADI, p.rotazione[2] * GRADI, 'XYZ');
    R.base = new THREE.Vector3(...p.posizione);
  }

  // L'ingombro del pezzo nel mondo, fermo (senza esploso): da forme.js, o dalla mesh per i file.
  function calcolaBox(R) {
    const b = R.p.forma === 'file' ? null : ingombro(R.p);
    if (b) R.box.set(v1.fromArray(b.min), v2.fromArray(b.max));
    else if (R.corpi.length) {
      R.box.makeEmpty();
      const m = matricePezzo(R.p);
      for (const c of R.corpi) { c.geometry.computeBoundingBox(); R.box.union(boxP.copy(c.geometry.boundingBox).applyMatrix4(m)); }
    } else R.box.set(v1.fromArray(R.p.posizione), v2.fromArray(R.p.posizione));
    R.box.getCenter(R.centro);
    appoggi(R);
  }

  // Punti d'appoggio nel mondo, da fermo: per ogni direzione il vertice più lontano lungo quella. L'inquadratura
  // misura il raggio del modello su questi punti e non sulla diagonale dell'ingombro, che con tori e tubi (gli
  // angoli della scatola restano vuoti) lasciava il turbofan nel 60% del cerchio libero. Un file enorme si campiona.
  function appoggi(R) {
    const k = DIREZIONI.length / 3, meglio = new Float64Array(k).fill(-Infinity), sup = new Float32Array(3 * k), m = matricePezzo(R.p).elements;
    for (const c of R.corpi) {
      const P = c.geometry.attributes.position, passo = Math.max(1, Math.ceil(P.count / 2e5));
      for (let i = 0; i < P.count; i += passo) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14];
        for (let d = 0; d < k; d++) {
          const s = X * DIREZIONI[3 * d] + Y * DIREZIONI[3 * d + 1] + Z * DIREZIONI[3 * d + 2];
          if (s > meglio[d]) { meglio[d] = s; sup[3 * d] = X; sup[3 * d + 1] = Y; sup[3 * d + 2] = Z; }
        }
      }
    }
    R.sup = meglio[0] > -Infinity ? sup : null;
  }

  async function carica(R) {
    const token = (R.token = {});
    caricamenti++;
    try {
      const r = await scarica(`/api/ologramma/file/${encodeURIComponent(numModello)}/${encodeURIComponent(R.id)}`);
      if (!r.ok) throw new Error(`il server risponde ${r.status}`);
      const dati = await r.arrayBuffer();
      if (R.token !== token) return;
      const { geometrie } = await leggiFile(dati, estensione(R.p.misure.file), R.p.misure);
      if (R.token !== token) { geometrie.forEach((g) => g.dispose()); return; }
      monta(R, geometrie);
      ricalcola();
    } catch (e) {
      if (R.token === token) { R.errore = taglia(String(e && e.message || e), 120); console.warn(`ologramma: ${R.id} non si carica:`, R.errore); }
    } finally { caricamenti--; if (!caricamenti) foto.pronto = performance.now(); }
  }

  // ---------------------------------------------------------------- modi
  const opaco = (R) => vista.modo === 'solido' || vista.modo === 'densita' || (vista.modo === 'sforzi' && R.colorato);
  function statoMateriale(R) {
    const m = vista.modo, u = R.mat.corpo.uniforms, s = R.mat.spigoli.uniforms, interno = R.p.interno, sez = !!vista.sezione;
    const op = opaco(R), mat = R.mat.corpo;
    u.uOpaco.value = op ? 1 : 0; u.uCampo.value = m === 'sforzi' && R.colorato ? 1 : 0;
    u.uColB.value.copy(COL.alta);
    if (m === 'ologramma') { u.uColA.value.copy(COL.linea); u.uFill.value = interno && !sez ? 0.02 : 0.05; u.uRim.value = interno && !sez ? 0.13 : 0.4; }
    else if (m === 'raggi-x') {
      // Gli interni si leggono dagli spigoli. Con riempimento 0,085 e bordo 0,55, e poi ancora con 0,014 e 0,3, le
      // decine di facce di taglio dei dischi, viste di sbieco, si sommavano in una macchia bianca (screenshot del
      // 7/11): il bordo fresnel di ogni faccia quasi di taglio valeva da solo più della soglia del bloom.
      if (interno) { u.uColA.value.copy(COL.interno); u.uColB.value.copy(COL.interno); u.uFill.value = 0.008; u.uRim.value = 0.08; }
      else { u.uColA.value.copy(COL.linea); u.uFill.value = 0.005; u.uRim.value = 0.1; }
    } else if (m === 'solido') { u.uColA.value.copy(COL.solido); u.uAmb.value = 0.3; u.uRim.value = 0.12; }
    else if (m === 'densita') {
      const rho = MATERIALI[R.p.materiale]?.densita;
      if (finito(rho)) u.uColA.value.setRGB(...coloreDensita(rho), THREE.LinearSRGBColorSpace); else u.uColA.value.copy(COL.grigio);
      u.uAmb.value = 0.4; u.uRim.value = 0.08;
    } else if (m === 'sforzi') {
      if (R.colorato) { u.uAmb.value = 0.8; u.uRim.value = 0.05; } // quasi senza ombra: il colore è il dato
      else { u.uColA.value.copy(COL.linea); u.uFill.value = 0.012; u.uRim.value = 0.12; } // fuori dal calcolo: un fantasma
    }
    mat.blending = op ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.polygonOffset = op;
    const fl = R.p.forma === 'cavo' && R.p.flusso && FLUSSO[R.p.flusso];
    u.uFlusso.value = fl ? 1 : 0;
    if (fl) { u.uColFlusso.value.set(fl[0]); u.uFlussoVel.value = fl[1]; u.uFlussoPasso.value = fl[2] * R.p.misure.r; u.uFlussoCoda.value = fl[3]; u.uLungo.value = R.lunghezza; }
    const sm = R.mat.spigoli;
    if (op) { s.uCol.value.copy(COL.scuro); s.uI.value = 1; sm.blending = THREE.NormalBlending; }
    else { s.uCol.value.copy(m === 'raggi-x' && interno ? COL.interno : COL.alta); s.uI.value = m === 'raggi-x' ? (interno ? 0.35 : 0.14) : interno && !sez ? 0.14 : 0.45; sm.blending = THREE.AdditiveBlending; }
    trasparenza(R);
  }
  // Un pezzo opaco che sfuma diventa trasparente per quel tempo; three.js lo disegna dopo gli opachi.
  function trasparenza(R) {
    const op = opaco(R), a = R.mat.corpo.uniforms.uAlfa.value, mat = R.mat.corpo;
    mat.transparent = !op || a < 0.999; mat.depthWrite = op && a >= 0.999;
    R.mat.spigoli.uniforms.uAlfa.value = op ? 0.55 * a : a;
  }

  // ---------------------------------------------------------------- colori degli sforzi
  // Il campo è il fattore di sicurezza per voxel (−1 vuoto). Si colorano i pezzi che entrano nel calcolo; il colore
  // lo fa lo shader (CAMPO_GLSL), qui si prepara solo la texture del rischio.
  function colora(R) { R.colorato = !!campo && R.p.calcolo && R.p.forma !== 'file' && R.corpi.length > 0; }
  function liberaCampo() {
    campo?.tex.dispose();
    campo = null; comuni.uRischio.value = null;
  }

  async function caricaCampo(c) {
    const n = c.nx * c.ny * c.nz, chiave = `${numModello}:${c.versione}`;
    if (campoChiave === chiave) return;
    campoChiave = chiave; campoErrore = false;
    try {
      const gl = renderer.getContext(), lato = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
      if (Math.max(c.nx, c.ny, c.nz) > lato) throw new Error(`campo di ${c.nx}×${c.ny}×${c.nz}: la GPU arriva a ${lato} per lato`);
      const r = await scarica(`/api/ologramma/campo?v=${encodeURIComponent(c.versione)}`);
      if (!r.ok) throw new Error(`il server risponde ${r.status}`);
      const buf = await r.arrayBuffer();
      if (campoChiave !== chiave) return;
      if (buf.byteLength !== 4 * n) throw new Error(`campo di ${buf.byteLength} byte invece di ${4 * n}`);
      const fs = new Float32Array(buf), dati = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const v = fs[i]; dati[i] = v > 0 && Number.isFinite(v) ? Math.round(254 * rischio(v)) : 255; }
      const tex = new THREE.Data3DTexture(dati, c.nx, c.ny, c.nz);
      tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
      liberaCampo();
      campo = { ...c, tex };
      comuni.uRischio.value = tex; comuni.uCampoO.value.fromArray(c.origine); comuni.uCampoN.value.set(c.nx, c.ny, c.nz); comuni.uCampoH.value = c.h;
      for (const R of pezzi.values()) { colora(R); statoMateriale(R); }
      aggiornaLegenda();
      chiediFoto();
    } catch (e) { if (campoChiave === chiave) { campoChiave = null; campoErrore = true; aggiornaLegenda(); console.warn('ologramma: campo non disponibile:', e && e.message); } }
  }

  // Il riassunto dell'analisi, solo con numeri controllati; null se non c'è o non è leggibile.
  function leggiAnalisi(a) {
    if (!a || typeof a !== 'object' || !['in-corso', 'fatta', 'errore'].includes(a.stato)) return null;
    const out = { stato: a.stato, versione: finito(a.versione) ? a.versione : null, sforzo_max_MPa: finito(a.sforzo_max_MPa) ? a.sforzo_max_MPa : null, fs_min: finito(a.fs_min) ? a.fs_min : null, pezzi: new Map(), campo: null };
    if (Array.isArray(a.pezzi)) for (const p of a.pezzi.slice(0, 200)) if (p && typeof p.id === 'string') out.pezzi.set(p.id, { fs: finito(p.fs_min) ? p.fs_min : null, sigma: finito(p.sforzo_max_MPa) ? p.sforzo_max_MPa : null });
    const c = a.campo;
    if (a.stato === 'fatta' && c && [c.nx, c.ny, c.nz].every((n) => Number.isInteger(n) && n > 0 && n <= 4096) && c.nx * c.ny * c.nz <= 3e7 &&
      finito(c.h) && c.h > 0 && Array.isArray(c.origine) && c.origine.length === 3 && c.origine.every(finito) && (finito(c.versione) || typeof c.versione === 'string')) {
      out.campo = { versione: c.versione, nx: c.nx, ny: c.ny, nz: c.nz, h: c.h, origine: [...c.origine] };
    }
    return out;
  }

  // ---------------------------------------------------------------- vista esplosa a due livelli
  // Primo livello (esploso 0 → 0,6): i gruppi si allontanano dal centro del modello, lungo la media degli `esplodi`
  // dei loro pezzi o, se nessuno lo dice, lungo la direzione dal centro al gruppo. Secondo livello (0,4 → 1): dentro
  // ogni gruppo i pezzi si allargano dal centro del gruppo. Un pezzo senza gruppo è un gruppo da solo.
  function ricalcola() {
    const vivi = [...pezzi.values()].filter((R) => !R.tolto);
    box.makeEmpty();
    for (const R of vivi) box.union(R.box);
    if (box.isEmpty()) return;
    box.getCenter(misureModello.centro);
    misureModello.raggio = Math.max(1e-3, box.getSize(v1).length() / 2);
    misureModello.D1 = 0.5 * misureModello.raggio;
    comuni.uPasso.value = (2 * Math.PI) / (misureModello.raggio / 40);
    comuni.uSweepK.value = 1 / (0.04 * misureModello.raggio);
    const mappa = new Map();
    for (const R of pezzi.values()) {
      const k = R.p.gruppo ? 'g:' + R.p.gruppo : 'p:' + R.id;
      if (!mappa.has(k)) mappa.set(k, { chiave: k, nome: R.p.gruppo || R.p.nome, pezzi: [], box: new THREE.Box3(), centro: new THREE.Vector3(), volume: 0, dir: new THREE.Vector3() });
      mappa.get(k).pezzi.push(R);
    }
    gruppi = [...mappa.values()];
    for (const G of gruppi) {
      let n = 0;
      for (const R of G.pezzi) { G.box.union(R.box); G.volume += volume(R.p) || R.box.getSize(v1).x * v1.y * v1.z; if (R.p.esplodi) { G.dir.add(v1.fromArray(R.p.esplodi)); n++; } }
      G.box.getCenter(G.centro);
      if (n) G.dir.divideScalar(n);
      else { G.dir.subVectors(G.centro, misureModello.centro); const l = G.dir.length(); G.dir.multiplyScalar(l > 1e-3 * misureModello.raggio ? 1 / l : 0); }
      const rg = Math.max(1e-3, G.box.getSize(v1).length() / 2);
      for (const R of G.pezzi) {
        R.dir1.copy(G.dir);
        R.dir2.subVectors(R.centro, G.centro);
        const l = R.dir2.length();
        R.dir2.multiplyScalar(G.pezzi.length > 1 && l > 1e-3 * rg ? 1 / l : 0);
        R.D2 = 0.35 * rg;
      }
    }
    gruppi.sort((a, b) => b.volume - a.volume);
    etichetteGruppi = gruppi.length > 1 ? gruppi.slice(0, ETICHETTE_MAX) : [];
    etichette.forEach((e, i) => {
      e.textContent = etichetteGruppi[i] ? taglia(String(etichetteGruppi[i].nome).replace(/[-_]/g, ' '), 40) : '';
      larghezze[i] = e.offsetWidth || e.textContent.length * 7.5; // senza layout (contenitore nascosto) si stima
    });
  }

  // ---------------------------------------------------------------- vista: modi, sezione, selezione
  function impostaModo(m) {
    if (!MODI.includes(m)) return;
    vista.modo = m;
    for (const R of pezzi.values()) statoMateriale(R);
    aggiornaLegenda();
  }
  function impostaEsploso(e, suono = true) {
    if (!finito(e)) return;
    e = Math.min(1, Math.max(0, e));
    if (suono && Math.abs(e - vista.esploso) > 0.05) sfx?.esplodi?.(e > vista.esploso);
    vista.esploso = e;
  }
  function impostaSezione(s) {
    const prima = vista.sezione;
    if (s === null) vista.sezione = null;
    else {
      const r = normalizzaVista({ sezione: s }, null, vista);
      if (!r.vista) return;
      vista.sezione = r.vista.sezione;
    }
    const ora = performance.now();
    if (vista.sezione && (!prima || prima.asse !== vista.sezione.asse || prima.verso !== vista.sezione.verso || ora - anim.sezioneSuono > 600)) { anim.sezioneSuono = ora; sfx?.sezione?.(); }
    if (!!prima !== !!vista.sezione) for (const R of pezzi.values()) statoMateriale(R);
  }
  function seleziona(id) {
    vista.selezionato = id && pezzi.has(id) ? id : null;
    aggiornaScheda();
  }
  function isola(id) { vista.isolato = id && pezzi.has(id) ? id : null; }

  // Il piano: con verso 1 resta la parte con coordinata ≤ posizione e il taglio guarda verso +asse; con −1 il contrario.
  function aggiornaSezione() {
    const s = vista.sezione, vivo = !!s && aperto;
    tappo.visible = contorno.visible = velo.visible = vivo;
    for (const R of pezzi.values()) for (const o of R.nodo.children) if (o.userData.stencil) o.visible = vivo;
    if (!vivo) { piano.normal.set(0, -1, 0); piano.constant = 1e9; return; }
    const a = s.asse === 'x' ? 0 : s.asse === 'y' ? 1 : 2, n = [0, 0, 0];
    n[a] = -s.verso;
    piano.normal.fromArray(n); piano.constant = s.verso * s.posizione;
    // tappo e contorno: nel piano, larghi quanto il modello con l'esploso di adesso. I piani nascono in XY:
    // per X si girano attorno a Y (X locale → −Z), per Y attorno a X (Y locale → −Z).
    const c = box.getCenter(v1), dim = box.getSize(v2), R = misureModello.raggio;
    c.setComponent(a, s.posizione);
    for (const o of [tappo, contorno, velo]) {
      o.position.copy(c);
      o.rotation.set(a === 1 ? -Math.PI / 2 : 0, a === 0 ? Math.PI / 2 : 0, 0);
    }
    tappo.scale.setScalar(6 * R);
    const [lx, ly] = a === 0 ? [dim.z, dim.y] : a === 1 ? [dim.x, dim.z] : [dim.x, dim.y];
    contorno.scale.set(Math.max(lx, 0.05 * R) * 1.08, Math.max(ly, 0.05 * R) * 1.08, 1); velo.scale.copy(contorno.scale);
    const u = (a + 1) % 3, w = (a + 2) % 3;
    uTappo.uU.value.set(0, 0, 0).setComponent(u, 1); uTappo.uV.value.set(0, 0, 0).setComponent(w, 1);
    uTappo.uPasso.value = R / 30;
  }

  // Righe [chiave, valore, classe]: la classe è solo per le anomalie, 'cede' (fs sotto 1) o 'attenzione' (file che non si apre).
  function aggiornaScheda() {
    const R = vista.selezionato && pezzi.get(vista.selezionato);
    scheda.classList.toggle('on', !!R && aperto);
    if (R) {
      const p = R.p, M = MATERIALI[p.materiale], righe = [];
      // materiale_vero, fattura e fonte vengono dalla ricerca di STEM sul pezzo vero; la chiave `materiale` è solo quella
      // del calcolo, e accanto a un materiale vero si dichiara come tale. Senza fonte è una stima, e la scheda lo dice.
      const chiave = p.materiale === 'generico' ? '' : `${M.nome} · ${numero(M.densita, 0)} kg/m³${M.affidabile ? '' : ' · non isotropo'}`;
      righe.push(['materiale', p.materiale_vero ? p.materiale_vero + (chiave ? ` · calcolato come ${chiave}` : '') : chiave || 'non detto (si disegna, non si calcola)']);
      if (p.fattura) righe.push(['fattura', p.fattura]);
      if (p.materiale_vero || p.fattura) righe.push(['fonte', p.fonte || 'stima di STEM, senza fonte']);
      const vol = volume(p), kg = finito(vol) && finito(M.densita) ? vol * M.densita * 1e-9 : null;
      const b = R.box.getSize(v1), misure = misurabile(R) ? [b.x, b.y, b.z].map(mmTesto).join(' × ') + ' mm' : ''; // un file non ancora aperto non ha misure
      if (kg !== null || misure) righe.push(['misure', [kg !== null ? massaTesto(kg) : '', misure].filter(Boolean).join(' · ')]);
      const a = analisi?.pezzi.get(p.id);
      if (a && (a.fs !== null || a.sigma !== null)) righe.push(['calcolo', `${a.fs !== null ? 'fs min ' + numero(a.fs, 2) : ''}${a.fs !== null && a.sigma !== null ? ' · ' : ''}${a.sigma !== null ? 'σ max ' + numero(a.sigma, 0) + ' MPa' : ''}`, a.fs !== null && a.fs < 1 ? 'cede' : '']);
      const extra = [p.interno ? 'interno' : '', p.flusso ? `flusso ${p.flusso} (dato dichiarato, non simulato)` : ''].filter(Boolean);
      if (extra.length) righe.push(['nota', extra.join(' · ')]);
      if (R.errore) righe.push(['file', R.errore, 'attenzione']);
      const nodi = [Object.assign(el('b'), { textContent: taglia(p.nome, 60) })];
      for (const [k, t, c] of righe) { const d = el('div'); d.append(Object.assign(el('span', 'k'), { textContent: k }), Object.assign(el('span', c ? 'v ' + c : 'v'), { textContent: t })); nodi.push(d); }
      scheda.replaceChildren(...nodi);
    }
    ostacolo(0, scheda.classList.contains('on') && scheda);
  }

  function aggiornaLegenda() {
    const m = vista.modo, on = aperto && (m === 'densita' || m === 'sforzi');
    legenda.classList.toggle('on', on);
    ostacolo(1, on && legenda);
    if (!on) return;
    const t = el('div', 't'), bar = el('div', 'bar'), ticks = el('div', 'ticks'), nota = el('div', 'nota');
    const segno = (pos, testo) => { const s = el('span', '', ticks); s.style.left = `${(100 * Math.min(1, Math.max(0, pos))).toFixed(1)}%`; s.textContent = testo; };
    if (m === 'densita') {
      t.textContent = 'densità dei materiali · kg/m³';
      bar.style.background = gradiente((x) => coloreDensita(DENSITA_SCALA[0] * Math.pow(DENSITA_SCALA[1] / DENSITA_SCALA[0], x)));
      const pos = (rho) => Math.log(rho / DENSITA_SCALA[0]) / Math.log(DENSITA_SCALA[1] / DENSITA_SCALA[0]);
      const usati = new Map();
      for (const R of pezzi.values()) { const M = MATERIALI[R.p.materiale]; if (M && finito(M.densita)) usati.set(R.p.materiale, M); }
      const lista = [...usati.values()].sort((a, b) => a.densita - b.densita).slice(0, 6);
      if (lista.length) for (const M of lista) segno(pos(M.densita), numero(M.densita, 0));
      else for (const rho of [1000, 2700, 4430, 7850]) segno(pos(rho), numero(rho, 0));
      nota.textContent = lista.length ? lista.map((M) => `${M.nome} ${numero(M.densita, 0)}`).join(' · ') : 'nessun materiale detto: grigio';
      if ([...pezzi.values()].some((R) => R.p.materiale === 'generico')) nota.textContent += ' · grigio: materiale non detto';
    } else {
      t.textContent = 'fattore di sicurezza · fs';
      bar.style.background = gradiente(coloreRischio);
      for (const fs of TAPPE_FS) segno(rischio(fs), fs === 1 ? 'fs ≤ 1' : 'fs ' + numero(fs, 2));
      if (!analisi) nota.textContent = 'nessuna analisi: i colori arrivano dopo il calcolo';
      else if (analisi.stato === 'in-corso') nota.textContent = 'calcolo in corso…';
      else if (analisi.stato === 'errore') { nota.textContent = 'il calcolo non è riuscito'; nota.classList.add('attenzione'); }
      else {
        nota.textContent = `${analisi.fs_min !== null ? 'fs min ' + numero(analisi.fs_min, 2) : ''}${analisi.sforzo_max_MPa !== null ? ' · σ max ' + numero(analisi.sforzo_max_MPa, 0) + ' MPa' : ''}${campo ? '' : campoErrore ? ' · campo non disponibile' : ' · campo in arrivo'}`;
        if (analisi.fs_min !== null && analisi.fs_min < 1) nota.classList.add('cede'); else if (campoErrore && !campo) nota.classList.add('attenzione');
      }
    }
    legenda.replaceChildren(t, bar, ticks, nota); // il rettangolo nuovo lo rilegge rettangoli(), al prossimo fotogramma
  }

  function aggiornaBarra() {
    titoloEl.textContent = `OLOGRAMMA // ${taglia(titolo, 80) || 'MODELLO'}`.toUpperCase();
    const vivi = [...pezzi.values()].filter((R) => !R.tolto);
    let kg = 0, conta = 0;
    for (const R of vivi) { const M = MATERIALI[R.p.materiale], v = volume(R.p); if (finito(v) && finito(M?.densita)) { kg += v * M.densita * 1e-9; conta++; } }
    const nomi = { ologramma: 'ologramma', solido: 'solido', 'raggi-x': 'raggi x', densita: 'densità', sforzi: 'sforzi' };
    contaEl.textContent = `${vivi.length} PEZZI${conta ? ' · ' + massaTesto(kg).toUpperCase() : ''} · ${nomi[vista.modo].toUpperCase()}`;
    descEl.textContent = taglia(descrizione, 300);
    ostacolo(2, descEl.textContent && descEl); // una descrizione lunga scende sotto la barra, dentro la zona del modello
  }

  // ---------------------------------------------------------------- inquadratura
  // Il cerchio più grande dove il modello sta senza toccare l'angolo della testa, la barra in alto e i bordi.
  function calcolaZona() {
    const W = innerWidth, H = innerHeight, a = angoloTesta(W, H), m = 0.035 * Math.min(W, H), alto = 0.09 * H, basso = H - m;
    const x0 = a.x0 - 16, y0 = a.y0 - 16, cand = [];
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 10; j++) {
      const cx = W * (0.25 + (0.5 * i) / 20), cy = alto + (basso - alto) * (0.3 + (0.4 * j) / 10);
      cand.push({ cx, cy, r: Math.min(cx - m, W - m - cx, cy - alto, basso - cy, Math.hypot(Math.max(0, x0 - cx), Math.max(0, y0 - cy))) });
    }
    // Il cerchio più grande e, fra quelli grandi quasi uguali, il più vicino al centro dello schermo: prima vinceva
    // il primo trovato, cioè il più a sinistra, e il modello stava al 30% della larghezza con mezzo schermo vuoto.
    const rMax = Math.max(...cand.map((z) => z.r)), dc = (z) => Math.hypot(z.cx - W / 2, z.cy - H / 2);
    const z = cand.filter((q) => q.r >= 0.97 * rMax).sort((p, q) => dc(p) - dc(q))[0];
    // x0…y1: dove possono stare i testi di quote ed etichette, cioè lo schermo sotto la barra e dentro i margini (l'angolo
    // del nucleo lo toglie chi li mette). Il quadrato del cerchio era stretto: le quote verticali del turbofan restavano fuori.
    zona = { ...z, x0: m, y0: alto, x1: W - m, y1: basso };
    camera.aspect = W / H;
    camera.setViewOffset(W, H, W / 2 - z.cx, H / 2 - z.cy, W, H);
    camera.updateProjectionMatrix();
  }

  function inquadra(dt, subito) {
    const k = subito ? 1 : 1 - Math.exp(-dt * 3.2);
    // ingombro di adesso (con l'esploso), solo dei pezzi visibili
    box.makeEmpty();
    for (const R of pezzi.values()) if (R.alfaT > 0) box.union(boxP.copy(R.box).translate(R.off));
    if (box.isEmpty()) return;
    const c = box.getCenter(v1);
    let r2 = 0;
    for (const R of pezzi.values()) {
      if (!(R.alfaT > 0)) continue;
      const s = R.sup, o = R.off;
      if (s) for (let i = 0; i < s.length; i += 3) r2 = Math.max(r2, (s[i] + o.x - c.x) ** 2 + (s[i + 1] + o.y - c.y) ** 2 + (s[i + 2] + o.z - c.z) ** 2);
      else if (!R.box.isEmpty()) { boxP.copy(R.box).translate(o); for (let q = 0; q < 8; q++) r2 = Math.max(r2, v2.set(q & 1 ? boxP.max.x : boxP.min.x, q & 2 ? boxP.max.y : boxP.min.y, q & 4 ? boxP.max.z : boxP.min.z).distanceToSquared(c)); }
    }
    const r = Math.max(1e-3, Math.sqrt(r2));
    // Un numero non finito qui resterebbe per sempre (lerp da NaN dà NaN, anche col modello dopo): si salta il fotogramma.
    // È successo con un file non ancora arrivato, il cui ingombro vuoto vale ±Infinity (prova del 7/11).
    if (!Number.isFinite(r) || !Number.isFinite(c.x + c.y + c.z)) return;
    if (subito || !Number.isFinite(cam.raggio + cam.centro.x + cam.centro.y + cam.centro.z)) { cam.centro.copy(c); cam.raggio = r; }
    else { cam.centro.lerp(c, k); cam.raggio += (r - cam.raggio) * k; }
    const tanMezzo = Math.tan((camera.fov * GRADI) / 2), th = Math.atan((zona.r / (innerHeight / 2)) * tanMezzo);
    const d = cam.raggio / Math.sin(th) / cam.zoom, cp = Math.cos(cam.pitch);
    camera.position.set(cam.centro.x + d * cp * Math.sin(cam.yaw), cam.centro.y + d * Math.sin(cam.pitch), cam.centro.z + d * cp * Math.cos(cam.yaw));
    camera.lookAt(cam.centro);
    camera.near = Math.max(d * 0.01, d - 3 * cam.raggio); camera.far = d + 4 * cam.raggio;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(); // etichette e quote proiettano con questa camera prima del render: senza, restavano indietro di un fotogramma
  }

  function ruota(dx, dy) {
    if (!finito(dx) || !finito(dy)) return;
    cam.yaw -= Math.max(-1, Math.min(1, dx)) * Math.PI * 1.4;
    cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + Math.max(-1, Math.min(1, dy)) * Math.PI * 0.9));
  }
  function zoom(f) { if (finito(f) && f > 0) cam.zoom = Math.max(0.3, Math.min(6, cam.zoom * Math.max(0.2, Math.min(5, f)))); }
  function reimposta() { cam.yaw = -0.62; cam.pitch = 0.3; cam.zoom = 1; for (const R of pezzi.values()) R.presaOff.set(0, 0, 0); }

  // Il pezzo sotto un punto dello schermo (pixel CSS). Con la sezione conta solo quello che resta; ai raggi X
  // vince un pezzo interno, che è quello che si sta guardando. Un pezzo da file si prende dal suo ingombro: il raycast
  // di three.js va triangolo per triangolo, e su un file da un milione di triangoli costava 60–65 ms a chiamata, ogni
  // 90 ms col cursore delle mani (l'HUD scendeva a 21 fps, revisione del 7/11).
  function sottoPunto(x, y) {
    if (!aperto) return null;
    raggio.setFromCamera(v1.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
    const corpi = [], colpi = [];
    for (const R of pezzi.values()) {
      if (!(R.alfa > 0.3) || R.tolto || !R.corpi.length) continue;
      if (R.p.forma !== 'file') { corpi.push(...R.corpi); continue; }
      const d = colpoIngombro(R);
      if (d !== null) colpi.push({ id: R.id, d });
    }
    for (const h of raggio.intersectObjects(corpi, false)) if (!vista.sezione || piano.distanceToPoint(h.point) >= 0) colpi.push({ id: h.object.userData.id, d: h.distance });
    if (!colpi.length) return null;
    colpi.sort((a, b) => a.d - b.d);
    if (vista.modo === 'raggi-x') { const dentro = colpi.find((h) => pezzi.get(h.id)?.p.interno); if (dentro) return dentro.id; }
    return colpi[0].id;
  }
  // Dove il raggio entra nell'ingombro del pezzo, spostato com'è adesso (esploso, presa, volo), o null. Con la sezione
  // conta la parte che resta: se il raggio entra dal lato tagliato, il colpo è dove passa il piano, se è dentro l'ingombro.
  function colpoIngombro(R) {
    const r = raggio.ray;
    boxP.copy(R.box).translate(R.off);
    if (!r.intersectBox(boxP, v2)) return null;
    if (!vista.sezione || piano.distanceToPoint(v2) >= 0) return v2.distanceTo(r.origin);
    const t = r.distanceToPlane(piano);
    if (t === null) return null;
    r.at(t, v2);
    return boxP.expandByScalar(1e-6 * misureModello.raggio).containsPoint(v2) ? t : null;
  }

  // ---------------------------------------------------------------- foto
  function chiediFoto() { foto.attesa = { versione, modello: numModello, da: performance.now() }; foto.pronto = performance.now(); }
  function fermo() {
    if (anim.apertura < anim.finoA || caricamenti) return false;
    if (Math.abs(anim.esploso - vista.esploso) > 0.003) return false;
    for (const R of pezzi.values()) if (Math.abs(R.alfa - R.alfaT) > 0.02 || R.volo) return false;
    return box.isEmpty() || cam.centro.distanceTo(box.getCenter(v1)) < 0.004 * cam.raggio;
  }
  function scatta() {
    const { versione: v, modello: m } = foto.attesa;
    foto.attesa = null; foto.inCorso = true;
    const src = renderer.domElement, c = document.createElement('canvas');
    const larga = (w, sorgente) => { c.width = w; c.height = Math.round((sorgente.height * w) / sorgente.width); c.getContext('2d').drawImage(sorgente, 0, 0, c.width, c.height); };
    larga(Math.min(960, src.width), src); // nello stesso fotogramma del render: preserveDrawingBuffer è false
    const codifica = (w) => new Promise((ok) => {
      if (w < c.width) { const d = document.createElement('canvas'); d.width = w; d.height = Math.round((c.height * w) / c.width); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); d.toBlob(ok, 'image/png'); }
      else c.toBlob(ok, 'image/png');
    });
    (async () => {
      for (const w of [c.width, 720, 480]) {
        const blob = await codifica(w);
        if (!blob) break;
        if (blob.size > 1.5e6 && w > 480) continue; // il contratto vuole al massimo 1,5 MB
        const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });
        if (b64 && m === numModello) onFoto(b64, v, m);
        break;
      }
    })().catch((e) => console.warn('ologramma: foto non riuscita', e)).finally(() => { foto.inCorso = false; });
  }

  // ---------------------------------------------------------------- aprire, aggiornare, chiudere
  function smontaTutto() {
    for (const R of pezzi.values()) libera(R);
    pezzi.clear();
    liberaCampo(); campoChiave = null; campoErrore = false; analisi = null; gruppi = []; etichetteGruppi = []; presa = null; sopra = null;
    etichette.forEach((e) => { e.textContent = ''; e.style.opacity = '0'; });
    quota.soggetto = null; quota.alfa = 0; quota.scelta = [null, null, null]; quotaLinee.visible = false;
    quoteEl.forEach((e) => { e.style.opacity = '0'; });
  }

  function mostra(stato) {
    if (!stato || typeof stato !== 'object') return;
    if (stato.aperto !== true) { chiudi(); return; }
    if (!finito(stato.modello) || !finito(stato.versione)) return;
    const nuovo = !aperto || stato.modello !== numModello;
    if (!nuovo && stato.versione <= versione) return;
    // Lo stato viene dal server, già normalizzato: si rinormalizza lo stesso, perché nella scena entrano solo dati controllati.
    const norm = new Map();
    for (const p of (Array.isArray(stato.pezzi) ? stato.pezzi : []).slice(0, 200)) {
      const r = normalizzaPezzo(p);
      if (r.pezzo && !norm.has(r.pezzo.id)) norm.set(r.pezzo.id, r.pezzo);
      else if (!r.pezzo) console.warn('ologramma: pezzo scartato', r.errori.slice(0, 2));
    }
    const tolti = new Set((Array.isArray(stato.tolti) ? stato.tolti : []).filter((id) => typeof id === 'string' && norm.has(id)));
    if (nuovo) {
      smontaTutto();
      numModello = stato.modello; aperto = true; anim.chiusura = null; anim.esploso = 0;
      vista = { ...PREDEFINITI.vista }; vistaServer = null; reimposta(); cam.pronta = false;
      passo.enabled = true; radice.classList.add('on');
    }
    const analisiPrima = analisi;
    for (const [id, R] of pezzi) if (!norm.has(id)) { libera(R); pezzi.delete(id); }
    for (const [id, p] of norm) {
      let R = pezzi.get(id);
      if (!R) { R = nuovoPezzo(p); pezzi.set(id, R); continue; }
      const k = chiaveGeo(p), q = chiavePosa(p), prima = R.p;
      R.p = p;
      if (k !== R.chiave || p.forma === 'file' && JSON.stringify(prima.misure) !== JSON.stringify(p.misure)) {
        R.chiave = k; smonta(R); R.errore = null;
        if (p.forma === 'file') carica(R); else monta(R, [geometria(p)]);
      } else if (q !== R.posa || prima.calcolo !== p.calcolo) { R.colorato = false; if (campo) colora(R); }
      if (q !== R.posa) { R.posa = q; posa(R); calcolaBox(R); }
      statoMateriale(R);
    }
    for (const [id, R] of pezzi) {
      const t = tolti.has(id);
      if (!t && R.tolto) { R.volo = null; R.voloOff.set(0, 0, 0); }
      R.tolto = t;
    }
    titolo = typeof stato.titolo === 'string' ? stato.titolo : ''; descrizione = typeof stato.descrizione === 'string' ? stato.descrizione : '';
    ricalcola();
    // la vista del server: si applicano solo i campi che il server ha cambiato, così un modo scelto a mano resta
    const vs = normalizzaVista(stato.vista, norm.keys(), PREDEFINITI.vista).vista;
    if (vs) {
      const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      for (const k of Object.keys(vs)) {
        if (!nuovo && vistaServer && uguali(vs[k], vistaServer[k])) continue;
        if (k === 'modo') impostaModo(vs.modo);
        else if (k === 'esploso') impostaEsploso(vs.esploso, !nuovo);
        else if (k === 'sezione') impostaSezione(vs.sezione);
        else if (k === 'selezionato') seleziona(vs.selezionato);
        else if (k === 'isolato') isola(vs.isolato);
        else if (k === 'rotazione_auto') vista.rotazione_auto = vs.rotazione_auto;
      }
      vistaServer = vs;
    }
    if (vista.selezionato && !pezzi.has(vista.selezionato)) seleziona(null);
    if (vista.isolato && !pezzi.has(vista.isolato)) isola(null);
    analisi = leggiAnalisi(stato.analisi);
    if (analisi?.campo) caricaCampo(analisi.campo);
    else if (campo && (!analisi || analisi.stato !== 'in-corso')) { liberaCampo(); campoChiave = null; for (const R of pezzi.values()) { R.colorato = false; statoMateriale(R); } }
    if (!nuovo && analisi?.stato === 'fatta' && (analisiPrima?.stato !== 'fatta' || analisiPrima.versione !== analisi.versione)) sfx?.calcolo?.();
    versione = stato.versione;
    for (const R of pezzi.values()) statoMateriale(R);
    aggiornaBarra(); aggiornaLegenda(); aggiornaScheda();
    if (nuovo) apri(); else for (const R of pezzi.values()) R.atterra = Math.min(R.atterra, anim.apertura);
    chiediFoto();
  }

  // Apertura come il report: il gruppo più grosso atterra per primo (0,9 s), poi gli altri uno alla volta;
  // i tempi vanno a sfx.report, che ci aggancia i suoi colpi.
  function apri() {
    calcolaZona();
    anim.apertura = 0;
    const n = gruppi.length, gap = n > 1 ? Math.min(0.11, 1.1 / (n - 1)) : 0, lands = [];
    gruppi.forEach((G, i) => {
      const t = i === 0 ? 0.9 : 1.34 + (i - 1) * gap;
      if (i) lands.push(t);
      for (const R of G.pezzi) R.atterra = t;
    });
    anim.finoA = (n > 1 ? 1.34 + (n - 2) * gap : 0.9) + 0.15;
    inquadra(0, true);
    sfx?.report?.({ hero: 0.9, lands });
  }

  function chiudi() {
    if (!aperto) return;
    aperto = false; anim.chiusura = 0; foto.attesa = null;
    radice.classList.remove('on'); scheda.classList.remove('on'); legenda.classList.remove('on');
    ostacolo(0, null); ostacolo(1, null);
    spegniCursore(); // chiuso durante una presa: alla riapertura il cursore non deve sembrare ancora «preso»
    impostaFaseMani('spente'); // le mani si fermano con l'ologramma; alla riapertura gesti.js ridice la sua fase
  }
  // Le mani escono senza un gesto che lo dica: gesti.js smette di mandare 'cursore'. Dopo 400 ms (12 rilevazioni a 30 Hz)
  // il cursore si spegne e il pezzo sotto non resta evidenziato; una presa senza mani è finita.
  function spegniCursore() { ultimoCursore = 0; sopra = null; presa = null; cursore.classList.remove('on', 'presa'); }
  // Le fasi di gesti.js, più 'spente' da stem.js quando le mani si fermano. A riposo il cursore si spegne subito: nessun
  // gesto arriva finché Tony non mostra il palmo, e la barra glielo dice; senza, sembrerebbe che le mani non vadano più.
  const TESTI_MANI = { riposo: 'mani: mostra il palmo', pronto: 'mani pronte', azione: 'mani pronte' };
  function impostaFaseMani(fase) {
    if (fase === faseMani) return;
    faseMani = fase;
    maniEl.textContent = TESTI_MANI[fase] || '';
    cursore.classList.toggle('azione', fase === 'azione');
    if (fase !== 'pronto' && fase !== 'azione') spegniCursore();
  }

  // ---------------------------------------------------------------- ogni fotogramma, prima del render dell'HUD
  function fotogramma(t, dt) {
    if (!passo.enabled) return;
    dt = Math.min(0.1, Math.max(0, finito(dt) ? dt : 0));
    orologio = (orologio + dt) % 3600;
    comuni.uTempo.value = orologio;
    comuni.uTremolio.value = 0.965 + 0.035 * Math.sin(orologio * 37.1) * Math.sin(orologio * 13.7 + 1.3); // tremolio leggero, senza caso
    if (anim.chiusura !== null) {
      anim.chiusura += dt;
      if (anim.chiusura >= 0.4) { smontaTutto(); passo.enabled = false; anim.chiusura = null; numModello = null; versione = -Infinity; return; }
    }
    if (ultimoCursore && performance.now() - ultimoCursore > 400) spegniCursore();
    anim.apertura += dt;
    anim.globale = anim.chiusura !== null ? 1 - liscio(0, 0.35, anim.chiusura) : 1;
    anim.esploso += (vista.esploso - anim.esploso) * (1 - Math.exp(-dt * 4));
    if (vista.rotazione_auto && !trascina) cam.yaw += dt * 0.25;
    const e = anim.esploso, s1 = liscio(0, 0.6, e), s2 = liscio(0.4, 1, e), D1 = misureModello.D1, R0 = misureModello.raggio;
    const kAlfa = 1 - Math.exp(-dt * 7), kPresa = 1 - Math.exp(-dt * 5);
    comuni.uFuoco.value += ((vista.selezionato ? 1 : 0) - comuni.uFuoco.value) * kAlfa;
    for (const R of pezzi.values()) {
      R.alfaT = R.tolto || (vista.isolato && vista.isolato !== R.id) ? 0 : 1;
      R.alfa += (R.alfaT - R.alfa) * kAlfa;
      if (Math.abs(R.alfa - R.alfaT) < 0.002) R.alfa = R.alfaT;
      const ent = liscio(R.atterra - 0.42, R.atterra, anim.apertura); // entrata: arriva dalla sua direzione di esploso
      if (R.volo) { R.volo.t += dt; R.voloOff.addScaledVector(R.volo.v, dt); if (R.volo.t > 0.8) R.volo = null; }
      if (presa?.id !== R.id) R.presaOff.multiplyScalar(1 - kPresa);
      R.off.copy(R.dir1).multiplyScalar(D1 * s1).addScaledVector(R.dir2, R.D2 * s2).add(R.presaOff).add(R.voloOff);
      if (ent < 1) R.off.addScaledVector(R.dir1.lengthSq() ? R.dir1 : R.dir2, -(1 - ent) * (1 - ent) * 0.35 * R0);
      R.nodo.position.copy(R.base).add(R.off);
      const a = R.alfa * ent * anim.globale, u = R.mat.corpo.uniforms;
      u.uAlfa.value = a;
      R.nodo.visible = a > 0.003;
      const sel = vista.selezionato === R.id ? 1 : sopra === R.id ? 0.5 : 0;
      u.uSel.value += (sel - u.uSel.value) * kAlfa; R.mat.spigoli.uniforms.uSel.value = u.uSel.value;
      trasparenza(R);
    }
    // scansione dell'apertura: una fascia luminosa che sale sul modello
    if (!box.isEmpty()) {
      const k = liscio(0, 1.5, anim.apertura);
      comuni.uSweep.value = box.min.y + (box.max.y - box.min.y) * (k * 1.2 - 0.1);
      comuni.uSweepA.value = 0.22 * (1 - liscio(1.2, 1.6, anim.apertura));
    }
    inquadra(dt, !cam.pronta); cam.pronta = true;
    aggiornaSezione();
    uTappo.uAlfa.value = anim.globale;
    uTappo.uSforzi.value = vista.modo === 'sforzi' && campo ? 1 : 0;
    contorno.material.uniforms.uAlfa.value = anim.globale;
    // rettangoli già occupati: scheda, legenda e descrizione, poi le quote, poi le etichette in ordine di volume del gruppo
    const posti = [...rettangoli()];
    aggiornaQuote(dt, posti);
    aggiornaEtichette(posti);
  }

  function aggiornaEtichette(posti) {
    const op = aperto ? liscio(0.15, 0.4, anim.esploso) * anim.globale : 0, W = innerWidth, H = innerHeight, a = angoloTesta(W, H);
    etichette.forEach((nodo, i) => {
      const G = etichetteGruppi[i];
      if (!G || op < 0.01) { nodo.style.opacity = '0'; return; }
      v1.set(0, 0, 0); let n = 0;
      for (const R of G.pezzi) if (R.alfa > 0.5) { v1.add(v2.copy(R.centro).add(R.off)); n++; }
      if (!n) { nodo.style.opacity = '0'; return; }
      v1.divideScalar(n).project(camera);
      const x = (v1.x * 0.5 + 0.5) * W, y = (-v1.y * 0.5 + 0.5) * H;
      let fuori = v1.z > 1 || x < 10 || x > W - 60 || y < 0.09 * H || y > H - 10 || (x > a.x0 - 40 && y > a.y0 - 20), alto = y - 7;
      // Niente etichette una sull'altra (nell'esploso del turbofan «compressore» e «turbina» si coprivano):
      // si prova una riga sopra o sotto, poi due; se non c'è posto, l'etichetta si nasconde.
      if (!fuori) {
        const w = larghezze[i], x0 = x + 1, x1 = x + 12 + w + 6;
        const libero = (t) => !posti.some((q) => x0 < q.x1 && q.x0 < x1 && t < q.y1 && q.y0 < t + 15);
        const d = [0, -16, 16, -32, 32].find((s) => libero(y - 7 + s));
        if (d === undefined) fuori = true; else { alto = y - 7 + d; posti.push({ x0, x1, y0: alto, y1: alto + 15 }); }
      }
      nodo.style.opacity = fuori ? '0' : op.toFixed(3);
      nodo.style.transform = `translate(${(x + 12).toFixed(1)}px, ${alto.toFixed(1)}px)`;
    });
  }

  // ---------------------------------------------------------------- quote in millimetri
  // Come in un disegno tecnico: per ogni asse del mondo l'ingombro del pezzo scelto (clic, presa o selezione), dove sta
  // adesso, esploso compreso. Senza pezzo scelto si quota il modello intero, più tenue, e nell'esploso la quota si spegne:
  // l'ingombro di un modello aperto non è una misura.
  const sA = { x: 0, y: 0 }, sB = { x: 0, y: 0 }, sC = { x: 0, y: 0 }, sO = { x: 0, y: 0 }, qC = new THREE.Vector3(), qS = new THREE.Vector3(), qM = new THREE.Vector3(), qP = new THREE.Vector3();
  const qBox = new THREE.Box3(), qPunti = Array.from({ length: 7 }, () => new THREE.Vector3());
  function schermo(v, s) { qP.copy(v).project(camera); s.x = (qP.x * 0.5 + 0.5) * innerWidth; s.y = (-qP.y * 0.5 + 0.5) * innerHeight; return qP.z < 1; }
  function nascondiQuote() { quotaLinee.visible = false; for (const e of quoteEl) e.style.opacity = '0'; }

  function aggiornaQuote(dt, posti) {
    const sel = vista.selezionato && pezzi.get(vista.selezionato);
    const vuole = !aperto || !pezzi.size ? null : sel && !sel.tolto && misurabile(sel) ? sel.id : '*';
    let bersaglio = 0;
    if (vuole && quota.soggetto === vuole) bersaglio = vuole === '*' ? 0.45 * (1 - liscio(0.02, 0.2, anim.esploso)) * liscio(anim.finoA, anim.finoA + 0.6, anim.apertura) : sel.alfa;
    quota.alfa += (bersaglio * anim.globale - quota.alfa) * (1 - Math.exp(-dt * 12));
    if (quota.soggetto !== vuole && quota.alfa < 0.02) { quota.soggetto = vuole; quota.alfa = 0; quota.scelta = [null, null, null]; } // cambio di soggetto: prima si spegne
    if (quota.alfa < 0.004 || !quota.soggetto) return nascondiQuote();
    qBox.makeEmpty();
    if (quota.soggetto === '*') { for (const R of pezzi.values()) if (R.alfaT > 0 && misurabile(R)) qBox.union(boxP.copy(R.box).translate(R.off)); }
    else { const R = pezzi.get(quota.soggetto); if (R && misurabile(R)) qBox.copy(R.box).translate(R.off); }
    if (qBox.isEmpty()) return nascondiQuote();
    qBox.getCenter(qC); qBox.getSize(qS);
    const lato = Math.max(qS.x, qS.y, qS.z), dist = Math.max(0.08 * lato, 0.03 * misureModello.raggio); // quanto la quota si stacca dall'ingombro
    const W = innerWidth, H = innerHeight, ang = angoloTesta(W, H), z = zona;
    if (!schermo(qC, sO)) return nascondiQuote(); // sO: il centro dell'ingombro sullo schermo
    quotaNuovo.fill(0);
    let n = 0; // segmenti scritti
    const segmento = (a, b) => { quotaNuovo.set([a.x, a.y, a.z, b.x, b.y, b.z], 6 * n++); };
    const testoTrova = (x, y, w, h) => { // il rettangolo del testo è libero? Dentro la zona, fuori dall'angolo del nucleo e dai posti presi
      const r = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
      if (r.x0 < z.x0 || r.x1 > z.x1 || r.y0 < z.y0 || r.y1 > z.y1) return null;
      if (r.x1 > ang.x0 - 16 && r.y1 > ang.y0 - 16) return null;
      return posti.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1) ? null : r;
    };
    const [P0, P1, Q0, Q1, U, T, X] = qPunti, lo = qBox.min, hi = qBox.max;
    const spigolo = (v, a, q) => v.copy(qC).setComponent((a + 1) % 3, (q & 1 ? hi : lo).getComponent((a + 1) % 3)).setComponent((a + 2) % 3, (q & 2 ? hi : lo).getComponent((a + 2) % 3));
    for (let a = 0; a < 3; a++) {
      const e = quoteEl[a], b = (a + 1) % 3, ha = qS.getComponent(a) / 2, ca = qC.getComponent(a);
      const testo = mmTesto(2 * ha) + ' MM';
      if (testo !== quota.testi[a]) {
        e.textContent = quota.testi[a] = testo;
        if (!quota.carattere && e.offsetWidth) quota.carattere = e.offsetWidth / testo.length; // Menlo: la larghezza va col numero di caratteri
      }
      const w = testo.length * (quota.carattere || 6.9), h = 12;
      // Otto posti: i quattro spigoli paralleli all'asse, con la quota che esce lungo uno dei due assi perpendicolari.
      // Vince un posto col testo dentro la zona e libero; fra questi il più lontano dal centro sullo schermo, cioè sul
      // contorno, con un po' di preferenza per il basso, e quello di prima vale il 12% in più: niente salti mentre gira.
      // Il più lontano e basta metteva la quota verticale del turbofan accanto al nucleo, col testo fuori dalla zona.
      let meglio = null;
      for (let q = 0; q < 4; q++) for (let t = 1; t <= 2; t++) {
        const asse = (a + t) % 3, verso = (asse === b ? q & 1 : q & 2) ? 1 : -1;
        spigolo(qM, a, q); U.set(0, 0, 0).setComponent(asse, verso);
        Q0.copy(qM).addScaledVector(U, dist).setComponent(a, ca - ha); Q1.copy(Q0).setComponent(a, ca + ha);
        if (!schermo(Q0, sA) || !schermo(Q1, sB) || !schermo(qM, sC)) continue;
        const ux = sB.x - sA.x, uy = sB.y - sA.y, lu = Math.hypot(ux, uy);
        if (lu < 18) continue; // l'asse punta verso la camera: non si quota
        const mx = (sA.x + sB.x) / 2, my = (sA.y + sB.y) / 2;
        let dx = mx - sC.x, dy = my - sC.y; // verso fuori, sullo schermo: dallo spigolo alla linea di quota
        const ld = Math.hypot(dx, dy);
        if (Math.abs(dx * uy - dy * ux) / lu < 6) continue; // la quota cadrebbe sullo spigolo
        dx /= ld; dy /= ld;
        const sporge = 5 + (Math.abs(dx) * w) / 2 + (Math.abs(dy) * h) / 2;
        let r = null;
        for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) if ((r = testoTrova(sA.x + ux * f + dx * sporge, sA.y + uy * f + dy * sporge, w, h))) break;
        const prima = quota.scelta[a]?.q === q && quota.scelta[a]?.asse === asse;
        const punti = (r ? 1e6 : 0) + (Math.hypot(mx - sO.x, my - sO.y) + 0.15 * (my - sO.y)) * (prima ? 1.12 : 1);
        if (!meglio || punti > meglio.punti) meglio = { q, asse, verso, punti, r };
      }
      quota.scelta[a] = meglio;
      if (!meglio?.r) { e.style.opacity = '0'; continue; } // senza un posto per il numero, niente quota
      // linee: due di riferimento staccate dal pezzo, la linea di quota e i due trattini a 45° fra l'asse e il lato
      spigolo(qM, a, meglio.q); U.set(0, 0, 0).setComponent(meglio.asse, meglio.verso);
      P0.copy(qM).setComponent(a, ca - ha); P1.copy(qM).setComponent(a, ca + ha);
      Q0.copy(P0).addScaledVector(U, dist); Q1.copy(P1).addScaledVector(U, dist);
      for (const P of [P0, P1]) segmento(T.copy(P).addScaledVector(U, 0.15 * dist), X.copy(P).addScaledVector(U, 1.3 * dist));
      segmento(Q0, Q1);
      T.set(0, 0, 0).setComponent(a, 1).add(U).normalize().multiplyScalar(0.22 * dist);
      for (const Q of [Q0, Q1]) segmento(X.copy(Q).sub(T), qP.copy(Q).add(T));
      posti.push(meglio.r);
      e.style.opacity = Math.min(1, quota.alfa * 1.6).toFixed(3);
      e.style.transform = `translate(${meglio.r.x0.toFixed(1)}px, ${meglio.r.y0.toFixed(1)}px)`;
    }
    // il buffer va alla GPU solo se è cambiato
    let cambiato = quotaGeo.drawRange.count !== 2 * n;
    for (let i = 0; !cambiato && i < 6 * n; i++) cambiato = Math.abs(quotaNuovo[i] - quotaBuf[i]) > 1e-4 * lato;
    if (cambiato) { quotaBuf.set(quotaNuovo); quotaGeo.attributes.position.needsUpdate = true; quotaGeo.setDrawRange(0, 2 * n); }
    quotaLinee.visible = n > 0;
    uQuota.uAlfa.value = 0.42 * quota.alfa;
  }

  // subito dopo il render dell'HUD, nello stesso fotogramma: qui il canvas si può ancora leggere
  function dopoRender() {
    if (!passo.enabled || !aperto || !foto.attesa || foto.inCorso || caricamenti) return;
    const ora = performance.now();
    if (fermo() || ora - Math.max(foto.pronto, foto.attesa.da) > 3000) scatta(); // il server aspetta 4 s dopo una modifica e 8 dopo mostra: non oltre 3 s
  }

  // ---------------------------------------------------------------- comandi, mouse, gesti
  function comando(nome, valore) {
    if (!aperto) return;
    switch (nome) {
      case 'esploso': impostaEsploso(Number(valore)); break;
      case 'sezione': impostaSezione(valore === null ? null : valore); break;
      case 'modo': impostaModo(valore); break;
      case 'seleziona': seleziona(typeof valore === 'string' ? valore : null); break;
      case 'isola': isola(typeof valore === 'string' ? valore : null); break;
      case 'ruota': if (valore && typeof valore === 'object') ruota(Number(valore.dx), Number(valore.dy)); break;
      case 'zoom': zoom(Number(valore)); break;
      case 'reset': reimposta(); break;
      case 'rotazione_auto': if (typeof valore === 'boolean') vista.rotazione_auto = valore; break;
    }
    aggiornaBarra();
  }

  function puntatore(ev) {
    if (!aperto || !ev) return;
    const x = Number(ev.clientX), y = Number(ev.clientY);
    switch (ev.type) {
      case 'pointerdown': if (finito(x) && finito(y)) trascina = { x, y, id: ev.pointerId, mosso: false }; break;
      case 'pointermove':
        if (trascina && ev.pointerId === trascina.id) {
          const dx = x - trascina.x, dy = y - trascina.y;
          if (!trascina.mosso && Math.hypot(dx, dy) > 4) trascina.mosso = true;
          if (trascina.mosso) { ruota(dx / innerWidth, dy / innerHeight); trascina.x = x; trascina.y = y; }
        }
        break;
      case 'pointerup':
        if (trascina && !trascina.mosso) { const id = sottoPunto(x, y); seleziona(id && id !== vista.selezionato ? id : null); }
        trascina = null;
        break;
      case 'pointercancel': trascina = null; break;
      case 'wheel': if (finito(ev.deltaY)) { ev.preventDefault?.(); zoom(Math.exp(-Math.max(-300, Math.min(300, ev.deltaY)) * 0.0015)); } break;
      case 'dblclick': { const id = sottoPunto(x, y); isola(id && id !== vista.isolato ? id : null); break; }
    }
  }

  // I gesti di gesti.js: coordinate 0..1 dello schermo. Muovono la camera come il mouse.
  function gesto(g) {
    if (!aperto || !g || typeof g !== 'object') return;
    const W = innerWidth, H = innerHeight, x = Number(g.x) * W, y = Number(g.y) * H;
    switch (g.tipo) {
      case 'stato': impostaFaseMani(['riposo', 'pronto', 'azione'].includes(g.fase) ? g.fase : 'spente'); break;
      case 'cursore': {
        if (!finito(x) || !finito(y)) return;
        cursore.classList.add('on');
        cursore.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const ora = (ultimoCursore = performance.now());
        if (ora - ultimoSopra > 90) { ultimoSopra = ora; sopra = sottoPunto(x, y); }
        break;
      }
      case 'ruota': ruota(Number(g.dx), Number(g.dy)); break;
      case 'zoom': zoom(Number(g.fattore)); break;
      case 'esplodi': if (finito(Number(g.delta))) impostaEsploso(vista.esploso + Number(g.delta), Math.abs(Number(g.delta)) > 0.2); break;
      case 'afferra': {
        const id = finito(x) && finito(y) ? sottoPunto(x, y) : null;
        if (!id) return;
        presa = { id }; seleziona(id); cursore.classList.add('presa'); sfx?.afferra?.();
        break;
      }
      case 'sposta': {
        const R = presa && pezzi.get(presa.id), dx = Number(g.dx), dy = Number(g.dy);
        if (!R || !finito(dx) || !finito(dy)) return;
        const alto = 2 * camera.position.distanceTo(cam.centro) * Math.tan((camera.fov * GRADI) / 2); // mondo visibile in altezza
        v1.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(Math.max(-1, Math.min(1, dx)) * alto * (W / H));
        v2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-Math.max(-1, Math.min(1, dy)) * alto);
        R.presaOff.add(v1).add(v2);
        break;
      }
      case 'lascia': presa = null; cursore.classList.remove('presa'); break;
      case 'lancia': { // solo il pezzo preso: un lancia senza presa non toglie quello che passa sotto il cursore
        const id = presa?.id, R = id && pezzi.get(id);
        presa = null; cursore.classList.remove('presa');
        if (!R || R.tolto) return;
        const vx = finito(Number(g.vx)) ? Number(g.vx) : 0, vy = finito(Number(g.vy)) ? Number(g.vy) : 0;
        const alto = 2 * camera.position.distanceTo(cam.centro) * Math.tan((camera.fov * GRADI) / 2);
        v1.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(vx * alto * (W / H));
        v2.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-vy * alto);
        R.volo = { v: v1.clone().add(v2).clampLength(0, 4 * misureModello.raggio), t: 0 };
        R.tolto = true;
        if (vista.selezionato === id) seleziona(null);
        sfx?.lancia?.();
        onTogli(id);
        break;
      }
    }
  }

  function ridimensiona() { calcolaZona(); rettOstacoli = null; }
  calcolaZona();
  addEventListener('resize', ridimensiona);

  return {
    mostra, chiudi, fotogramma, dopoRender, comando, puntatore, gesto, ridimensiona,
    get aperto() { return aperto; },
    /** Per le prove e per chi integra: lo stato locale, senza riferimenti interni. */
    info() {
      let triangoli = 0;
      for (const R of pezzi.values()) for (const c of R.corpi) triangoli += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3;
      return {
        aperto, modello: numModello, versione, pezzi: pezzi.size, tolti: [...pezzi.values()].filter((R) => R.tolto).map((R) => R.id), triangoli,
        caricamenti, fermo: aperto && fermo(), vista: JSON.parse(JSON.stringify(vista)), esploso: anim.esploso, colorati: [...pezzi.values()].filter((R) => R.colorato).length,
        errori: [...pezzi.values()].filter((R) => R.errore).map((R) => `${R.id}: ${R.errore}`), zona: { ...zona }, gruppi: gruppi.length,
        quote: { soggetto: quota.soggetto, alfa: +quota.alfa.toFixed(3), segmenti: quotaGeo.drawRange.count / 2 },
      };
    },
  };
}
