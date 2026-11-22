// grafica-banco.mjs — banco di prova della grafica dell'HUD. Prende un modulo col contratto di public/nucleo.js
// (export TIMING, export async createScene(canvas, S) → { frame(t, clock, dt), anchor(), assembling(t), renderer, strato })
// e lo fa girare in un Chrome headless sulla GPU del Mac, grande come lo schermo di Tony (1470×956 punti a 2x).
// Per ogni stato: una foto in punti (PNG 1470×956), i fotogrammi contati in ogni secondo intero, il costo di un
// fotogramma con gl.finish() (ms: separa due moduli anche quando fanno tutti e due 60 fps), le chiamate di disegno,
// e anchor(). Scrive <uscita>/risultati.json e <uscita>/<stato>.png.
//
//   node prove/grafica-banco.mjs [--modulo public/nucleo.js] [--uscita <cartella>] [--porta 4471] [--cdp 9571] [--stati attesa,parla]
//                  [--secondi 4] [--costo 40] [--pausa 2]
//
// Il modulo è servito come /m/<nome>, con la sua cartella (import relativi ok); three come nell'HUD
// (/three/build/three.module.js e /three/examples/jsm/). Niente microfono, fotocamera né rete: solo questo server.
// Le misure di più banchi in parallelo si disturbano (stessa GPU): valgono solo quelle prese da soli.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const MODULO = path.resolve(arg('modulo', path.join(REPO, 'public/nucleo.js')));
const USCITA = path.resolve(arg('uscita', fs.mkdtempSync(path.join(os.tmpdir(), 'banco-'))));
const PORTA = Number(arg('porta', 4471)), CDP = Number(arg('cdp', 9571));
const SECONDI = Number(arg('secondi', 4)), COSTO = Number(arg('costo', 40)), PAUSA = Number(arg('pausa', 2));
const W = 1470, H = 956;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(MODULO)) { console.error(`modulo inesistente: ${MODULO}`); process.exit(2); }
fs.mkdirSync(USCITA, { recursive: true });
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-chrome-'));

// L'angolo del report e dell'ologramma (come angoloTesta della scena dell'HUD, tolta il 22/11): ultime 2 colonne e 2 righe di una griglia 12×6
function angolo(Wp, Hp) {
  const gw = Wp * (1 - 0.044), gh = Hp * (1 - 0.086), cw = (gw - 11 * 12) / 12, rh = (gh - 5 * 12) / 6;
  const x0 = 0.022 * Wp + 10 * (cw + 12), y0 = 0.06 * Hp + 4 * (rh + 12), x1 = 0.022 * Wp + gw, y1 = 0.06 * Hp + gh;
  return { dockX: (x0 + x1) / 2, dockY: y0 + 0.6 * (y1 - y0), x0, y0, x1, y1 };
}
const DOCK = angolo(W, H);

// t: secondi della formazione, fermi (null: scorrono da 10 s, formazione finita). audio/mic 'auto': voce finta.
// allarme: 0 normale, 1 attenzione (arancione), 2 critico (rosso). split: browser aperto a destra. dock: nell'angolo.
const TUTTI = {
  'formazione-1': { t: 1.0 },
  'formazione-3': { t: 3.0 },
  'formazione-5': { t: 5.0 },
  'rivelazione-6': { t: 6.0 },
  attesa: { mode: 'idle' },
  ascolto: { mode: 'listening', mic: 'auto', hearing: true },
  pensiero: { mode: 'thinking' },
  parla: { mode: 'speaking', audio: 'auto' },
  'allarme-1': { mode: 'idle', allarme: 1 },
  'allarme-2': { mode: 'thinking', allarme: 2 },
  browser: { mode: 'thinking', split: 1 },
  angolo: { mode: 'speaking', audio: 'auto', dock: 1 },
};
const NOMI = arg('stati', Object.keys(TUTTI).join(',')).split(',').filter((n) => TUTTI[n]);

const PAGINA = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>banco</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{position:fixed;inset:0;width:100%;height:100%;display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><canvas id="gl"></canvas><script type="module">
const { createScene, TIMING } = await import('/m/${encodeURIComponent(path.basename(MODULO))}');
const S = { mode: 'idle', audio: 0, mic: 0, split: 0, splitTarget: 0, dock: 0, dockTarget: 0, dockX: ${DOCK.dockX}, dockY: ${DOCK.dockY}, hearing: false, allarme: 0 };
const st = { t: null, audio: null, mic: null };
window.__imposta = (o) => {
  st.t = o.t ?? null; st.audio = o.audio ?? null; st.mic = o.mic ?? null;
  S.mode = o.mode || 'idle'; S.hearing = !!o.hearing; S.allarme = o.allarme || 0;
  S.splitTarget = o.split || 0; S.dockTarget = o.dock || 0;
  if (o.subito) { S.split = S.splitTarget; S.dock = S.dockTarget; }
  return true;
};
window.__S = S; window.__TIMING = TIMING;
const scene = await createScene(document.getElementById('gl'), S);
const t0 = performance.now();
let last = t0;
function voce(c) { // sillabe a raffiche, come lab.html
  const syl = Math.max(0, Math.sin(c * 11.0) * 0.6 + Math.sin(c * 4.3) * 0.4), frase = 0.5 + 0.5 * Math.sin(c * 0.9);
  return Math.min(1, syl * (0.45 + 0.55 * frase) * 1.3);
}
function passo(now, dt) {
  const clock = (now - t0) / 1000;
  const t = st.t ?? clock + 10;
  S.audio = st.audio === 'auto' ? voce(clock) : Number(st.audio) || 0;
  S.mic = st.mic === 'auto' ? 0.55 * voce(clock * 0.8 + 3) : Number(st.mic) || 0;
  S.split += (S.splitTarget - S.split) * Math.min(1, dt * 2.5);
  S.dock += (S.dockTarget - S.dock) * Math.min(1, dt * 6);
  scene.frame(t, clock % 3600, dt);
}
// fotogrammi contati in ogni secondo intero
const SEC = []; let sOra = null, sN = 0, nQuadri = 0;
function conta(now) { const s = Math.floor(now / 1000); nQuadri++; if (s !== sOra) { if (sOra !== null) SEC.push({ s: sOra, n: sN }); sOra = s; sN = 0; } sN++; }
let fermo = false;
function loop(now) {
  requestAnimationFrame(loop);
  if (fermo) return;
  conta(now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  passo(now, dt);
}
requestAnimationFrame(loop);
window.__secondi = (da) => SEC.filter((x) => x.s >= da).map((x) => x.n);
window.__ora = () => performance.now();
window.__ancora = () => scene.anchor();
window.__assembling = (t) => scene.assembling(t);
// costo: in Chrome gl.finish() non aspetta la GPU (0,1 ms a fotogramma col bagliore a 2205×1434, misurato il 10/11).
// readPixels sì: deve restituire i pixel veri. Quindi n fotogrammi di fila e una lettura sola alla fine: il tempo
// totale diviso n è il costo medio di un fotogramma, GPU compresa. Il ciclo rAF intanto è fermo.
window.__costo = (n) => {
  fermo = true;
  const gl = scene.renderer.getContext(), info = scene.renderer.info, px = new Uint8Array(4);
  const leggi = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const auto = info.autoReset; info.autoReset = false;
  let a0 = performance.now();
  for (let i = 0; i < 5; i++) passo(a0 + i * 16.7, 1 / 60); // riscaldamento
  leggi();
  const prove = [];
  for (let r = 0; r < 3; r++) { // tre giri da n: la mediana dei tre
    info.reset();
    const a = performance.now();
    for (let i = 0; i < n; i++) passo(a + i * 16.7, 1 / 60);
    leggi();
    prove.push((performance.now() - a) / n);
  }
  const tri = info.render.triangles, pts = info.render.points, lin = info.render.lines; // dell'ultimo giro, cioè di n fotogrammi
  info.autoReset = auto; fermo = false; last = performance.now();
  prove.sort((x, y) => x - y);
  return { medio_ms: +prove[1].toFixed(2), giri_ms: prove.map((x) => +x.toFixed(2)), chiamate: Math.round(info.render.calls / n), triangoli: Math.round(tri / n), punti: Math.round(pts / n), linee: Math.round(lin / n) };
};
window.__pronto = true;
</script></body></html>`;

// ---------------------------------------------------------------- server statico
const TIPI = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
const THREE_DIR = path.join(REPO, 'node_modules', 'three'), MDIR = path.dirname(MODULO);
const sotto = (base, rel) => { const f = path.resolve(base, '.' + path.sep + decodeURIComponent(rel)); return f.startsWith(base + path.sep) ? f : null; };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/' || p === '/banco.html') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); return res.end(PAGINA); }
  const f = p.startsWith('/three/') ? sotto(THREE_DIR, p.slice(7)) : p.startsWith('/m/') ? sotto(MDIR, p.slice(3)) : null;
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok, ko) => { server.once('error', ko); server.listen(PORTA, '127.0.0.1', ok); });

// ---------------------------------------------------------------- Chrome e CDP (come prove/ologramma-hud.mjs)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); } }
const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
// Risparmio energetico spento: a batteria sotto il 20% Chrome porta ogni pagina a 30 fps
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${H}`, '--force-device-scale-factor=2', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  'about:blank'], { stdio: 'ignore' });
const guardia = setTimeout(() => { console.error('il banco dura più di 6 minuti: chiudo'); chrome.kill('SIGKILL'); process.exit(1); }, 360000);

let ws = null, nId = 0;
const attese = new Map(), eccezioni = [], errori = [];
async function connetti() {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!pagina) throw new Error(`Chrome non risponde sulla porta ${CDP}`);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') eccezioni.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errori.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  };
}
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(espressione) {
  const r = await cdp('Runtime.evaluate', { expression: espressione, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function foto(nome) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } });
  const f = path.join(USCITA, `${nome}.png`);
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
}
const stat = (v) => { const s = [...v].sort((a, b) => a - b), q = (p) => s[Math.floor(p * (s.length - 1))]; return s.length ? { mediana: q(0.5), p10: q(0.1), minimo: s[0], conti: v } : null; };

const risultati = { modulo: MODULO, quando: new Date().toISOString(), schermo: `${W}×${H} punti a 2x`, stati: {} };
let codice = 0;
try {
  await connetti();
  for (const d of ['Page', 'Runtime']) await cdp(`${d}.enable`);
  let dentro = await ev('[innerWidth, innerHeight, devicePixelRatio]');
  if (dentro[0] !== W || dentro[1] !== H) { // headless toglie qualche punto alla finestra: lo si rimette
    const { windowId } = await cdp('Browser.getWindowForTarget');
    await cdp('Browser.setWindowBounds', { windowId, bounds: { width: 2 * W - dentro[0], height: 2 * H - dentro[1] } });
    await pausa(300);
    dentro = await ev('[innerWidth, innerHeight, devicePixelRatio]');
  }
  risultati.finestra = dentro;
  await cdp('Page.navigate', { url: `http://localhost:${PORTA}/banco.html` });
  if (!(await attendi(() => ev('window.__pronto === true').catch(() => false), 30000, 200))) throw new Error('la scena non parte: ' + [...eccezioni, ...errori].slice(0, 2).join(' | '));
  risultati.gpu = await ev(`(() => { const g = document.createElement('canvas').getContext('webgl2'), x = g.getExtension('WEBGL_debug_renderer_info');
    return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?'; })()`);
  risultati.timing = await ev('window.__TIMING');
  risultati.assembling = await ev('[0.5, 1, 2, 3, 4, 5, 6, 6.5, 7].map((t) => +window.__assembling(t).toFixed(3))');
  for (const nome of NOMI) {
    const o = TUTTI[nome];
    await ev(`window.__imposta(${JSON.stringify(o)})`);
    await pausa(PAUSA * 1000 + (o.split || o.dock ? 1500 : 0));
    const file = await foto(nome);
    const da = Math.ceil((await ev('window.__ora()')) / 1000) + 1; // dal prossimo secondo intero
    await pausa((SECONDI + 2) * 1000);
    const conti = (await ev(`window.__secondi(${da})`)).slice(0, SECONDI);
    const costo = await ev(`window.__costo(${COSTO})`);
    const ancora = await ev('window.__ancora()');
    risultati.stati[nome] = { foto: file, fps: stat(conti), costo, ancora };
    const f = risultati.stati[nome].fps;
    console.log(`${nome.padEnd(14)} fps ${f ? `${f.mediana} (p10 ${f.p10}, min ${f.minimo})` : '-'}  costo ${costo.medio_ms} ms (giri ${costo.giri_ms.join('/')})  chiamate ${costo.chiamate}  punti ${costo.punti}  linee ${costo.linee}  triangoli ${costo.triangoli}  ancora ${JSON.stringify(ancora)}`);
  }
} catch (e) {
  codice = 1;
  risultati.errore = String(e?.stack || e).split('\n').slice(0, 4).join(' | ');
  console.error('ERRORE', risultati.errore);
} finally {
  risultati.eccezioni = eccezioni; risultati.console = errori;
  if (eccezioni.length || errori.length) console.log('console:', [...eccezioni, ...errori].slice(0, 5).join(' | '));
  fs.writeFileSync(path.join(USCITA, 'risultati.json'), JSON.stringify(risultati, null, 2));
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
  await attendi(() => chrome.exitCode !== null || chrome.signalCode !== null, 4000);
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  clearTimeout(guardia);
  await pausa(300);
  fs.rmSync(LAVORO, { recursive: true, force: true });
  const porte = await new Promise((ok) => execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${PORTA}`, `-iTCP:${CDP}`, '-sTCP:LISTEN', '-t'], (e, out) => ok((out || '').trim())));
  if (porte) { console.error(`porte ancora aperte: ${porte}`); codice = 1; }
  console.log(`risultati in ${path.join(USCITA, 'risultati.json')}`);
  process.exit(codice);
}
