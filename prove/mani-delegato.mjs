// mani-delegato.mjs — MediaPipe sulla GPU o sulla CPU, con un ologramma pesante aperto: quale tiene più fps nell'HUD?
// La domanda viene dalle sessioni vere: dopo il 12/11, con gli ologrammi Blender aperti, il detect è salito da 7–17 a 16–22 ms
// e il p10 è sceso sotto 45. L'ipotesi: sulla GPU detectForVideo aspetta, sul thread principale, che la GPU finisca anche
// il disegno dell'ologramma; sulla CPU non c'è quell'attesa, ma c'è il conto sul thread.
// L'HUD vero (index.html, oscar.js) in un Chrome headless sulla GPU del Mac, con la ventola Blender da 290 mila triangoli
// (~/Documents/OSCAR-Blender/ventola: disco, ogiva, nervature e 18 pale) e la foto di prova al posto della fotocamera, 30 Hz.
// Tre casi a giri alterni, due giri: mani spente, mani sulla GPU (?debug), mani sulla CPU (?debug&delegato=CPU).
// Ogni caso: 4 s per assestarsi, poi 20 secondi interi contati da window.__misure, e i tempi di detectForVideo.
// node prove/mani-delegato.mjs → una riga per caso e il confronto. Porte 4435 (HTTP) e 9566 (CDP). Circa 3 minuti.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4435, CDP = 9566, ORIGINE = `http://localhost:${PORTA}`, W = 1470, H = 956;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const documenti = path.join(os.homedir(), 'Documents');
const nuovaVentola = path.join(documenti, 'OSCAR-Blender', 'ventola');
const VENTOLA = fs.existsSync(nuovaVentola) ? nuovaVentola : path.join(documenti, 'Nexus-Blender', 'ventola');
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-delegato-'));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 200) { const fine = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > fine) return v; await pausa(passo); } }

for (const f of ['runtime/modelli/hand_landmarker.task', 'runtime/modelli/prova-mani.jpg'].map((x) => path.join(ROOT, x)).concat(['disco', 'ogiva', 'nervature', 'pala'].map((x) => path.join(VENTOLA, `${x}.glb`)))) {
  if (!fs.existsSync(f)) { console.log(`manca ${f}: vedi «Provare» nel CLAUDE.md`); process.exit(1); }
}

// La ventola come la apre il cervello: pezzi «file» con centra false, le pale ruotate di 20° l'una
const FILE = { 'ogiva': 'ogiva.glb', 'nervature': 'nervature.glb', 'disco': 'disco.glb' };
const pezzi = [
  { id: 'ogiva', nome: 'ogiva', forma: 'file', misure: { file: path.join(VENTOLA, 'ogiva.glb'), centra: false }, gruppo: 'ogiva', esplodi: [0, 0, 1.2] },
  { id: 'nervature', nome: 'nervature', forma: 'file', misure: { file: path.join(VENTOLA, 'nervature.glb'), centra: false }, gruppo: 'ogiva', interno: true, esplodi: [0, 0, 1.2] },
  { id: 'disco', nome: 'disco', forma: 'file', misure: { file: path.join(VENTOLA, 'disco.glb'), centra: false }, gruppo: 'disco', esplodi: [0, 0, -0.6] },
];
for (let k = 0; k < 18; k++) {
  const a = (20 * k * Math.PI) / 180, id = `pala-${k + 1}`;
  FILE[id] = 'pala.glb';
  pezzi.push({ id, nome: `pala ${k + 1}`, forma: 'file', misure: { file: path.join(VENTOLA, 'pala.glb'), centra: false }, rotazione: [0, 0, 20 * k], esplodi: [-Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0] });
}
const STATO = { aperto: true, modello: 1, versione: 1, titolo: 'Ventola (Blender)', descrizione: '', pezzi, tolti: [], carichi: [], vincoli: [],
  vista: { esploso: 0, sezione: null, modo: 'ologramma', selezionato: null, isolato: null }, massa_kg: null, ingombro_mm: null, analisi: null };

// ---------------------------------------------------------------- il server finto: statico come server.mjs, più i file della ventola
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const BASI = [['/three/', path.join(ROOT, 'node_modules/three')], ['/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')], ['/', path.join(ROOT, 'public')]];
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, ORIGINE).pathname;
  for await (const _ of req); // il corpo delle POST non serve
  if (p.startsWith('/modelli/')) {
    const nome = p.slice(9);
    if (!['hand_landmarker.task', 'prova-mani.jpg'].includes(nome)) return res.writeHead(404).end();
    return res.writeHead(200, { 'content-type': MIME[path.extname(nome)] }).end(fs.readFileSync(path.join(ROOT, 'runtime/modelli', nome)));
  }
  const m = p.match(/^\/api\/ologramma\/file\/1\/([a-z0-9-]+)$/);
  if (m && FILE[m[1]]) return res.writeHead(200, { 'content-type': 'model/gltf-binary' }).end(fs.readFileSync(path.join(VENTOLA, FILE[m[1]])));
  if (p === '/api/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ voice: { provider: 'mac' }, browser: false, gifs: false, agenda: 0, ologramma: 0 }));
  if (p.startsWith('/api/')) return res.writeHead(req.method === 'POST' ? 204 : 404).end();
  const [pre, base] = BASI.find(([a]) => p.startsWith(a)), f = path.join(base, p === '/' ? 'index.html' : decodeURIComponent(p.slice(pre.length)));
  if (!f.startsWith(base + path.sep)) return res.writeHead(403).end();
  fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(d)));
});
await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));

// ---------------------------------------------------------------- Chrome headless sulla GPU, Risparmio energetico spento
const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${H}`, '--force-device-scale-factor=2', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  'about:blank'], { stdio: 'ignore' });
const fine = (codice) => { try { chrome.kill('SIGTERM'); } catch {} server.close(); setTimeout(() => { fs.rmSync(LAVORO, { recursive: true, force: true }); process.exit(codice); }, 1500); };
const guardia = setTimeout(() => { console.log('la prova dura più di 7 minuti: fermata'); fine(1); }, 420_000);

let ws, nId = 0;
const attese = new Map();
let pagina;
for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); } };
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(e) {
  const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
await cdp('Runtime.enable');

async function caso(nome, mani, delegato) {
  await cdp('Page.navigate', { url: `${ORIGINE}/?debug&mani=immagine${delegato === 'CPU' ? '&delegato=CPU' : ''}` });
  if (!(await attendi(() => ev("document.body?.classList.contains('ready') && typeof window.oscarOlogramma === 'function'"), 30_000))) throw new Error(`${nome}: l'HUD non è pronto`);
  await ev(`localStorage.setItem('oscar-mani', '${mani ? '1' : '0'}'), true`);
  await ev(`oscarOlogramma(${JSON.stringify(STATO)}), true`);
  const caricato = await attendi(() => ev('oscarOlo.info().triangoli >= 280000 && oscarOlo.info().triangoli'), 30_000);
  if (mani && !(await attendi(() => ev('window.__misure.mani?.attive && window.__misure.mani.rilevazioni >= 30'), 30_000))) throw new Error(`${nome}: le mani non partono`);
  await pausa(4000);
  const prima = await ev('window.__misure.mani?.rilevazioni ?? 0');
  await pausa(21_000);
  const f = await ev('window.__misure'), x = f.fps, d = f.mani?.detect_ms;
  const r = { nome, triangoli: caricato, mediana: x.mediana, p10: x.p10, minimo: x.minimo, detect: mani ? d : null, delegato: f.mani?.delegato ?? null, rilevazioni: (f.mani?.rilevazioni ?? 0) - prima };
  console.log(`${nome.padEnd(16)} fps mediana ${x.mediana}, p10 ${x.p10}, minimo ${x.minimo}` +
    (mani ? `; detect mediana ${d.mediana} ms, p90 ${d.p90}, massimo ${d.massimo} (${r.delegato}, ${r.rilevazioni} rilevazioni in 21 s)` : '') + `; ${caricato} triangoli; per secondo ${x.conti.join(' ')}`);
  return r;
}

const giri = [];
try {
  for (let g = 1; g <= 2; g++) {
    console.log(`\n== giro ${g}`);
    giri.push({ spente: await caso(`spente ${g}`, false), gpu: await caso(`GPU ${g}`, true, 'GPU'), cpu: await caso(`CPU ${g}`, true, 'CPU') });
  }
} catch (e) { console.log(`errore: ${e.message}`); clearTimeout(guardia); fine(1); }
clearTimeout(guardia);
const cpuVince = giri.every((g) => g.cpu.p10 >= g.gpu.p10 + 3 && g.cpu.mediana >= g.gpu.mediana - 1);
console.log(`\nCriterio scritto prima: la CPU vince se in tutti e due i giri il suo p10 supera quello della GPU di almeno 3 e la mediana non scende di più di 1.`);
console.log(`Esito: ${cpuVince ? 'vince la CPU' : 'resta la GPU'} (${giri.map((g, i) => `giro ${i + 1}: p10 GPU ${g.gpu.p10}, CPU ${g.cpu.p10}, spente ${g.spente.p10}`).join('; ')})`);
fine(0);
