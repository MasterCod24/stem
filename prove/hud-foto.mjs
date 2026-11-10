// hud-foto.mjs — l'HUD vero (public/index.html e stem.js) in un Chrome headless sulla GPU del Mac, con un server finto:
// cervello a copione, voce finta (un tono a sillabe), stato fisso. Fa una sequenza di foto dei momenti che contano.
//   node prove/hud-foto.mjs [--uscita <cartella>] [--porta 4481] [--cdp 9581] [--solo casa,report]
// Niente microfono né fotocamera veri (dispositivi finti), niente rete: solo questo server. Il riconoscimento vocale è finto
// (disponibile ma muto), così l'HUD è «in ascolto» senza scaricare il modello italiano; le frasi arrivano da stemSente/stemParziale.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const USCITA = path.resolve(arg('uscita', fs.mkdtempSync(path.join(os.tmpdir(), 'hud-foto-'))));
const PORTA = Number(arg('porta', 4481)), CDP = Number(arg('cdp', 9581));
const SOLO = arg('solo', '') ? new Set(arg('solo', '').split(',')) : null;
const W = 1470, H = 956, ORIGINE = `http://localhost:${PORTA}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(USCITA, { recursive: true });
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-foto-chrome-'));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); } }

// ---------------------------------------------------------------- voce finta: 1,8 s di tono a sillabe, WAV 16 bit
function wav(secondi = 1.8, hz = 22050) {
  const n = Math.round(secondi * hz), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / hz, sill = Math.abs(Math.sin(Math.PI * 4.2 * t)) ** 0.6, v = Math.sin(2 * Math.PI * 180 * t) * 0.5 + Math.sin(2 * Math.PI * 360 * t) * 0.2;
    b.writeInt16LE(Math.round(v * sill * 0.8 * 32767), 44 + i * 2); }
  return b;
}
const VOCE = wav();

// ---------------------------------------------------------------- server finto
let guasto = false; // true: /api/status risponde 500 (server che non c'è più)
const TIPI = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.css': 'text/css' };
const PUB = path.join(REPO, 'public'), THREE_DIR = path.join(REPO, 'node_modules', 'three'), MP = path.join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const sotto = (base, rel) => { const f = path.resolve(base, '.' + path.sep + decodeURIComponent(rel)); return f === base || f.startsWith(base + path.sep) ? f : null; };
const corpo = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
async function copione(res, testo) { // il cervello finto: eventi NDJSON con le loro pause
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  const passi = /browser/i.test(testo)
    ? [[200, { t: 'tool', name: 'browser_navigate', detail: 'google.com' }], [300, { t: 'show' }], [900, { t: 'tool', name: 'browser_snapshot' }], [1500, { t: 'say', s: 'Ecco, ho aperto Google.' }]]
    : [[400, { t: 'mac', name: 'agenda', detail: '' }], [1900, { t: 'say', s: 'Domani a Torino sole, massima quattordici gradi.' }], [150, { t: 'say', s: 'Porta comunque una giacca.' }]];
  for (const [ms, ev] of passi) { await pausa(ms); if (res.destroyed) return; res.write(JSON.stringify(ev) + '\n'); }
  res.end();
}
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/status') { if (guasto) { res.writeHead(500); return res.end(); } res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ voice: { provider: 'mac', credits: 0, mac: 'Siri Paolo' }, browser: true, gifs: false, agenda: 0, ologramma: 0 })); }
  if (p === '/api/ask') return copione(res, (await corpo(req)).text || '');
  if (p === '/api/tts') { await corpo(req); res.writeHead(200, { 'content-type': 'audio/wav', 'x-stem-voce': 'mac' }); return res.end(VOCE); }
  if (p === '/api/ologramma' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ aperto: false, versione: 0 })); }
  if (p.startsWith('/api/')) { await corpo(req); res.writeHead(p === '/api/ologramma' ? 200 : 204, { 'content-type': 'application/json' }); return res.end(p === '/api/ologramma' ? '{"versione":0}' : undefined); }
  if (p === '/__guasto') { guasto = new URL(req.url, 'http://x').searchParams.get('on') === '1'; res.writeHead(204); return res.end(); }
  const f = p === '/' ? path.join(PUB, 'index.html') : p.startsWith('/three/') ? sotto(THREE_DIR, p.slice(7)) : p.startsWith('/mediapipe/') ? sotto(MP, p.slice(11)) : sotto(PUB, p.slice(1));
  if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok, ko) => { server.once('error', ko); server.listen(PORTA, '127.0.0.1', ok); });

// ---------------------------------------------------------------- Chrome e CDP
const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${H}`, '--force-device-scale-factor=2', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  'about:blank'], { stdio: 'ignore' });
const guardia = setTimeout(() => { console.error('dura più di 6 minuti: chiudo'); chrome.kill('SIGKILL'); process.exit(1); }, 360000);
let ws = null, nId = 0;
const attese = new Map(), eccezioni = [], errori = [], host = new Set();
async function connetti() {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!pagina) throw new Error(`Chrome non risponde sulla porta ${CDP}`);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); return; }
    if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (/^https?:/.test(u)) host.add(new URL(u).host); }
    else if (d.method === 'Runtime.exceptionThrown') eccezioni.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 400));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errori.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  };
}
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(espressione) {
  const r = await cdp('Runtime.evaluate', { expression: espressione, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const fatte = [];
async function foto(nome) {
  if (SOLO && !SOLO.has(nome)) return;
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } });
  const f = path.join(USCITA, `${nome}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); fatte.push(nome);
  console.log(`foto  ${nome}`);
}
async function vai(query, pronto = true) {
  await cdp('Page.navigate', { url: `${ORIGINE}/${query}` });
  if (pronto && !(await attendi(() => ev("document.body?.classList.contains('ready') === true").catch(() => false), 25000, 200))) throw new Error(`l'HUD non è pronto: ${query}`);
}
async function tasto(k, code, vk) { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await pausa(100); }
const modo = () => ev('document.body.dataset.mode');

let codice = 0;
try {
  await connetti();
  for (const d of ['Page', 'Runtime', 'Network']) await cdp(`${d}.enable`);
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  let dentro = await ev('[innerWidth, innerHeight]');
  if (dentro[0] !== W || dentro[1] !== H) {
    const { windowId } = await cdp('Browser.getWindowForTarget');
    await cdp('Browser.setWindowBounds', { windowId, bounds: { width: 2 * W - dentro[0], height: 2 * H - dentro[1] } });
    await pausa(300);
  }
  // Riconoscimento finto: disponibile, ma non sente niente da solo
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `class FintoSR { static available() { return Promise.resolve('available'); } static install() { return Promise.resolve(true); }
    start() {} stop() {} abort() {} }
    Object.defineProperty(window, 'SpeechRecognition', { value: FintoSR }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: FintoSR });
    try { localStorage.setItem('stem-mani', '0') } catch {}` });

  // Avvio: la formazione ferma a 1, 3,5 e 6 secondi
  if (!SOLO || ['avvio-1', 'avvio-3', 'avvio-6'].some((n) => SOLO.has(n))) {
    for (const [t, nome] of [[1, 'avvio-1'], [3.5, 'avvio-3'], [6, 'avvio-6']]) { await vai(`?debug&t=${t}`, false); await pausa(2500); await foto(nome); }
  }
  await vai('?debug');
  await pausa(2500); await foto('casa');
  await ev("stemParziale('stem dimmi che tempo fa domani a'); true"); await pausa(700); await foto('ascolto-parziale');
  await ev("stemParziale(''); stemSente('stem dimmi che tempo fa domani a Torino'); true"); await pausa(1000); await foto('ascolto-esito');
  await pausa(900); await foto('pensiero');
  await attendi(async () => (await modo()) === 'speaking', 6000); await pausa(500); await foto('parla');
  await attendi(async () => (await modo()) === 'idle', 12000); await pausa(800);
  await ev("stemSente('boh'); true"); await pausa(1200); await foto('non-per-stem');
  await ev("stemAllarme('prova', 1, 'CALCOLO DEGLI SFORZI FALLITO'); true"); await pausa(1500); await foto('allarme-1');
  await ev("stemAllarme('prova', 2, 'SERVER NON RAGGIUNGIBILE'); true"); await pausa(1500); await foto('allarme-2');
  await ev("stemAllarme('prova', 0); true"); await pausa(600);
  await ev("stemAsk('apri il browser'); true"); await pausa(2600); await foto('browser');
  await attendi(async () => (await modo()) === 'idle', 12000);
  await tasto('Escape', 'Escape', 27); await pausa(800);
  await ev(`stemReport({ titolo: 'Realtà virtuale nel 2026', blocchi: [
    { tipo: 'testo', titolo: 'Il mercato', testo: 'Le spedizioni di visori sono cresciute del 12% rispetto al 2025, trainate dai modelli leggeri.', fonte: 'IDC' },
    { tipo: 'dato', titolo: 'Visori venduti', valore: '9,4 mln', testo: 'Nel mondo, primi tre trimestri.', fonte: 'IDC' },
    { tipo: 'grafico', titolo: 'Quote', valori: [{ etichetta: 'Meta', valore: 62 }, { etichetta: 'Apple', valore: 14 }, { etichetta: 'Sony', valore: 9 }, { etichetta: 'Altri', valore: 15 }], unita: '%', testo: 'Quote di mercato.', fonte: 'IDC' },
    { tipo: 'testo', titolo: 'Cosa cambia', testo: 'Lenti pancake e schermi micro-OLED riducono peso e calore.', fonte: 'Wikipedia' },
    { tipo: 'dato', titolo: 'Peso medio', valore: '410 g', testo: 'Contro i 520 g del 2023.' },
    { tipo: 'testo', titolo: 'Limiti', testo: 'Batteria e prezzo restano i freni principali.' } ] }); true`);
  await pausa(3000); await foto('report');
  await ev("stemParziale('stem chiudi il report'); true"); await pausa(600); await foto('report-ascolto');
  await ev("stemParziale(''); true");
  await tasto('Escape', 'Escape', 27); await pausa(1200);
  await ev("stemOlogrammaDemo('turbofan').then(() => true)"); await pausa(3500); await foto('ologramma');
  await tasto('e', 'KeyE', 69); await pausa(2500); await foto('ologramma-esploso');
  await tasto('Escape', 'Escape', 27); await pausa(1500);
  await fetch(`${ORIGINE}/__guasto?on=1`); await pausa(11500); await foto('server-perso'); await fetch(`${ORIGINE}/__guasto?on=0`);
  const fuori = [...host].filter((h) => h !== `localhost:${PORTA}`);
  console.log(`altri siti chiesti: ${fuori.length ? fuori.join(', ') : 'nessuno'}`);
} catch (e) {
  codice = 1; console.error('ERRORE', String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
  if (eccezioni.length || errori.length) { console.log('CONSOLE:', [...eccezioni, ...errori].slice(0, 6).join('\n  ')); codice = 1; }
  else console.log('console pulita');
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
  console.log(`${fatte.length} foto in ${USCITA}`);
  process.exit(codice);
}
