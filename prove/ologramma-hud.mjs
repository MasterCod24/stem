// ologramma-hud.mjs — prova l'HUD vero (index.html e stem.js) con l'ologramma, in un Chrome headless sulla GPU del Mac.
// Il server finto qui dentro imita server.mjs: statico come lui (/, /three/, /mediapipe/, /modelli/) e con lo stato vero di
// ologramma.mjs, ma senza calcolo, cervello né voce; /api/ask segue un copione («modifica», «browser»).
// Niente fotocamera: le mani guardano la foto di prova (?debug&mani=immagine) e Chrome ha solo dispositivi finti.
// node prove/ologramma-hud.mjs [cartella di lavoro] [cartella delle foto] → PASS o FAIL per caso; esce con 0 solo se passa tutto.
// Porte 4431 (HTTP) e 9562 (CDP). Gli fps sono i fotogrammi di requestAnimationFrame contati in ogni secondo intero
// (window.__misure): sovrastimano quelli presentati, la misura per la soglia di Tony è la traccia del compositore.
// Il riconoscimento vocale qui è spento, nell'HUD vero no: il 7/11, mentre Chrome installava il modello italiano, con le
// mani i fotogrammi contati erano 52–58 al secondo invece di 60. Quindi questi numeri sono il caso migliore.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOlogramma } from '../ologramma.mjs';
import { DEMO_TURBOFAN, DEMO_STAFFA } from '../public/ologramma/demo.js';
import { massaTesto, normalizzaPezzo, ingombro } from '../public/ologramma/forme.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4431, CDP = 9562, ORIGINE = `http://localhost:${PORTA}`, W = 1470, H = 956; // lo schermo di Tony in punti, a 2x
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAVORO = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'stem-hud-'));
const FOTO = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'stem-hud-foto-'));
fs.mkdirSync(FOTO, { recursive: true });

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const titolo = (t) => console.log(`\n== ${t}`);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { // fino a ms, finché fn dà qualcosa di vero
  const fine = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); }
}

// ---------------------------------------------------------------- il server finto
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const BASI = [['/three/', path.join(ROOT, 'node_modules/three')], ['/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')], ['/', path.join(ROOT, 'public')]];
const MODELLI = ['hand_landmarker.task', 'prova-mani.jpg']; // da runtime/modelli solo questi due, come server.mjs
const registro = [], flussi = new Set(); // tutto quello che arriva dall'HUD, con l'ora; i flussi di /api/ask aperti
// Un STL binario da 300.000 triangoli (una sfera di 60 mm), servito come pezzo 'file': per il cursore delle mani su un file grande
const STL = (() => {
  const nLat = 300, nLon = 500, b = Buffer.alloc(84 + 50 * 2 * nLat * nLon), P = (i, j) => { const t = (Math.PI * i) / nLat, f = (2 * Math.PI * j) / nLon; return [60 * Math.sin(t) * Math.cos(f), 60 * Math.cos(t), 60 * Math.sin(t) * Math.sin(f)]; };
  b.writeUInt32LE(2 * nLat * nLon, 80);
  let o = 84;
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) {
    for (const tri of [[P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]]) {
      o += 12; for (const v of tri) for (const c of v) { b.writeFloatLE(c, o); o += 4; } o += 2;
    }
  }
  return b;
})();
const holo = createOlogramma({
  cartella: LAVORO, calcola: () => Promise.reject(new Error("niente calcolo nella prova dell'HUD")),
  onCambio: (s) => { registro.push({ via: 'cambio', v: s.versione, t: Date.now() }); for (const f of flussi) f.write(JSON.stringify({ t: 'holo', v: s.versione }) + '\n'); },
});
const json = (res, codice, d) => res.writeHead(codice, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(d));
function png(b64) { // firma e IHDR: larghezza, altezza e byte
  const b = Buffer.from(typeof b64 === 'string' ? b64 : '', 'base64');
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { byte: b.length, w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, ORIGINE).pathname;
    if (req.headers.host !== `localhost:${PORTA}` && req.headers.host !== `127.0.0.1:${PORTA}`) return res.writeHead(403).end();
    if (req.method === 'GET' && p.startsWith('/modelli/')) {
      const nome = p.slice(9);
      if (!MODELLI.includes(nome)) return res.writeHead(404).end();
      return res.writeHead(200, { 'content-type': MIME[path.extname(nome)] }).end(fs.readFileSync(path.join(ROOT, 'runtime/modelli', nome)));
    }
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      const [pre, base] = BASI.find(([a]) => p.startsWith(a)), f = path.join(base, p === '/' ? 'index.html' : decodeURIComponent(p.slice(pre.length)));
      if (!f.startsWith(base + path.sep)) return res.writeHead(403).end();
      return fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(d)));
    }
    let b = {};
    if (req.method === 'POST') { // come server.mjs: JSON e origine locale, o nessuna
      const o = req.headers.origin;
      if ((o && o !== ORIGINE && o !== `http://127.0.0.1:${PORTA}`) || !String(req.headers['content-type']).startsWith('application/json')) return res.writeHead(403).end();
      const parti = [];
      for await (const c of req) parti.push(c);
      b = JSON.parse(Buffer.concat(parti).toString() || '{}');
    }
    if (p === '/api/status') return json(res, 200, { voice: { provider: 'mac' }, browser: false, gifs: false, agenda: 0, ologramma: holo.stato().versione });
    if (req.method === 'GET' && p === '/api/ologramma') { registro.push({ via: 'get', t: Date.now() }); return json(res, 200, holo.stato()); }
    if (req.method === 'GET' && p.startsWith('/api/ologramma/file/')) { registro.push({ via: 'file', t: Date.now() }); return res.writeHead(200, { 'content-type': 'model/stl' }).end(STL); }
    if (req.method === 'POST' && p === '/api/ologramma' && b.azione === 'misura' && (req.headers.origin || req.headers['sec-fetch-site'])) { // come server.mjs, che la scrive nel registro
      registro.push({ via: 'misura', corpo: b, t: Date.now() });
      return res.writeHead(204).end();
    }
    if (req.method === 'POST' && p === '/api/ologramma') {
      const daHud = Boolean(req.headers.origin || req.headers['sec-fetch-site']), r = holo.esegui(b, { daHud }); // come server.mjs
      registro.push({ via: daHud ? 'hud' : 'strumento', corpo: b, codice: r.codice, t: Date.now() });
      if (!r.ok) return json(res, r.codice, { ok: false, errori: r.errori, ...(r.codice === 409 && { stato: holo.stato() }) });
      return json(res, 200, { ok: true, versione: r.versione });
    }
    if (req.method === 'POST' && p === '/api/ologramma/foto') {
      const s = holo.stato(), info = png(b.png), attuale = s.aperto && b.modello === s.modello && b.versione === s.versione;
      registro.push({ via: 'foto', modello: b.modello, versione: b.versione, attuale, ...info, t: Date.now() });
      return res.writeHead(attuale && info ? 204 : 409).end();
    }
    if (req.method === 'POST' && p === '/api/ask') { // copione, senza 'say': niente /api/tts
      const testo = String(b.text || '');
      registro.push({ via: 'ask', testo, t: Date.now() });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      if (/modifica/i.test(testo)) { // come il cervello: lo strumento, poi il cambio, che arriva all'HUD come evento 'holo'
        flussi.add(res);
        res.write(JSON.stringify({ t: 'mac', name: 'modifica_ologramma', detail: '' }) + '\n');
        setTimeout(() => holo.esegui({ azione: 'modifica', vista: { modo: 'raggi-x' } }), 300);
        setTimeout(() => { flussi.delete(res); res.end(); }, 1500);
      } else if (/browser/i.test(testo)) { // come server.mjs: il browser copre l'ologramma e il server lo chiude
        flussi.add(res);
        res.write(JSON.stringify({ t: 'show' }) + '\n');
        holo.esegui({ azione: 'chiudi' });
        setTimeout(() => { flussi.delete(res); res.end(); }, 300);
      }
      else res.end();
      return;
    }
    if (req.method === 'POST' && p === '/api/log') { registro.push({ via: 'log', riga: String(b.line || ''), t: Date.now() }); return res.writeHead(204).end(); }
    if (req.method === 'POST' && p === '/api/stop') return res.writeHead(204).end();
    return res.writeHead(404).end(); // /api/tts, /api/screen, campo e file 3D non servono a questa prova
  } catch (e) { if (!res.headersSent) json(res, 400, { ok: false, errori: [String(e.message)] }); }
});

// ---------------------------------------------------------------- Chrome e CDP
const profilo = path.join(LAVORO, 'chrome');
// Risparmio energetico di Chrome spento nel profilo di prova: a batteria sotto il 20% Chrome limita ogni pagina a 30 fps
// (misurato l'8/11: 30,6 rAF/s su una pagina vuota, 60,7 con questa preferenza), e la prova misurerebbe la batteria, non l'HUD.
fs.mkdirSync(profilo, { recursive: true });
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${H}`, '--force-device-scale-factor=2',
  '--use-fake-device-for-media-stream', // solo dispositivi finti: mai la fotocamera né il microfono veri
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', // come openHud
  'about:blank'], { stdio: 'ignore' });
const guardia = setTimeout(() => { console.log('FAIL  la prova dura più di 5 minuti'); chrome.kill('SIGKILL'); process.exit(1); }, 300000);

let ws = null, nId = 0;
const attese = new Map(), eccezioni = [], errori = [], host = new Map(), percorsi = new Map(); // percorsi: richieste al server di prova
async function connetti() {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!pagina) throw new Error(`Chrome non risponde sulla porta ${CDP}`);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); return; }
    if (d.method === 'Network.requestWillBeSent') {
      const u = d.params.request.url;
      if (/^https?:/.test(u)) { const x = new URL(u); host.set(x.host, (host.get(x.host) || 0) + 1); if (x.host === `localhost:${PORTA}`) percorsi.set(x.pathname, (percorsi.get(x.pathname) || 0) + 1); }
    }
    else if (d.method === 'Runtime.exceptionThrown') eccezioni.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errori.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
}
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(espressione) {
  const r = await cdp('Runtime.evaluate', { expression: espressione, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function vai(url) { // l'HUD è pronto quando la formazione è finita e c'è la scena
  await cdp('Page.navigate', { url });
  if (!(await attendi(() => ev("document.body?.classList.contains('ready') && typeof window.stemOlogrammaDemo === 'function'").catch(() => false), 25000, 200)))
    throw new Error(`l'HUD non è pronto: ${url}`);
}
const CODICI = { Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40] };
async function tasto(k) {
  const [code, vk] = CODICI[k] || [`Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0)], testo = k.length === 1 ? { text: k, unmodifiedText: k } : {};
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...testo });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  await pausa(80);
}
const mouse = (type, x, y, o = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...o });
async function clic(x, y, volte = 1) {
  for (let c = 1; c <= volte; c++) { await mouse('mousePressed', x, y, { buttons: 1, clickCount: c }); await mouse('mouseReleased', x, y, { buttons: 0, clickCount: c }); }
  await pausa(100);
}
async function trascina(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0, { buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, { buttons: 1 }); await pausa(16); }
  await mouse('mouseReleased', x1, y1, { buttons: 0, clickCount: 1 });
}
async function foto(nome) { // metà risoluzione, cioè i punti dello schermo
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 0.5 } });
  fs.writeFileSync(path.join(FOTO, `${nome}.png`), Buffer.from(r.data, 'base64'));
}
const TRASLA = String.raw`/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/`;
const testa = () => ev(`(() => { const m = ${TRASLA}.exec(document.getElementById('status').style.transform); return m && [+m[1], +m[2]]; })()`); // la scritta di stato segue la testa
const etichette = () => ev(`Object.fromEntries([...document.querySelectorAll('.holo-tag')].filter((e) => +e.style.opacity > 0.5)
  .map((e) => { const m = ${TRASLA}.exec(e.style.transform); return [e.textContent, [+m[1], +m[2]]]; }))`);
const scarto = (a, b) => { const k = Object.keys(a).filter((n) => b[n]); return k.length ? k.reduce((s, n) => s + Math.hypot(a[n][0] - b[n][0], a[n][1] - b[n][1]), 0) / k.length : NaN; };
// Quanto si allargano le etichette attorno al centro della zona, solo su quelle visibili prima e dopo: chi esce dallo schermo non conta
const allarga = (a, b, c) => { const k = Object.keys(a).filter((n) => b[n]), d = (p) => Math.hypot(p[0] - c.cx, p[1] - c.cy);
  return k.length ? k.reduce((s, n) => s + d(b[n]), 0) / k.reduce((s, n) => s + d(a[n]), 0) : NaN; };
// Quote: i lati dell'ingombro, da forme.js come li calcola scena.js, e i testi .holo-quota letti dal DOM («1.240 MM», «12,5 MM»)
const PEZZI_TURBOFAN = new Map(DEMO_TURBOFAN.pezzi.map((p) => { const n = normalizzaPezzo(structuredClone(p)).pezzo; return [n.id, n]; }));
const lati = (ids) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) { const g = ingombro(PEZZI_TURBOFAN.get(id)); for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], g.min[c]); max[c] = Math.max(max[c], g.max[c]); } }
  return [0, 1, 2].map((c) => max[c] - min[c]);
};
const leggiQuote = () => ev(`[...document.querySelectorAll('.holo-quota')].map((e) => { const r = e.getBoundingClientRect();
  return { asse: e.dataset.asse, testo: e.textContent, op: +e.style.opacity, r: [r.left, r.top, r.right, r.bottom] }; })`);
const mm = (t) => parseFloat(t.replace(/\s*MM$/, '').replace(/\./g, '').replace(',', '.'));
const tocca = (r, q) => q && r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3];
// Tre quote accese, con i valori dei lati (arrotondati come mmTesto), fuori dall'angolo del nucleo e dalla scheda, dentro la zona
async function controllaQuote(nome, attesi, { minimo = 0.5, massimo = 1 } = {}) {
  const q = await attendi(async () => { const x = await leggiQuote(); return x.filter((e) => e.op > minimo).length === 3 && x; }, 4000);
  if (!q) { const x = await leggiQuote(); return esito(false, nome, `quote accese: ${x.filter((e) => e.op > minimo).map((e) => e.testo).join(', ') || 'nessuna'}`); }
  const [a, z, card] = await Promise.all([ev("import('/ologramma/scena.js').then((m) => m.angoloTesta())"), ev('stemOlo.info().zona'),
    ev("(() => { const r = document.querySelector('.holo-card.on')?.getBoundingClientRect(); return r ? [r.left, r.top, r.right, r.bottom] : null; })()")]);
  const errori = [];
  for (const e of q) {
    const i = 'xyz'.indexOf(e.asse), v = mm(e.testo), tolleranza = attesi[i] < 99.95 ? 0.051 : 0.51;
    if (!(Math.abs(v - attesi[i]) <= tolleranza)) errori.push(`${e.asse} ${e.testo} invece di ${attesi[i].toFixed(2)}`);
    if (e.op > massimo) errori.push(`${e.asse} troppo accesa (${e.op})`);
    if (tocca(e.r, [a.x0, a.y0, W, H])) errori.push(`${e.asse} sull'angolo del nucleo`);
    if (tocca(e.r, card)) errori.push(`${e.asse} sulla scheda`);
    if (e.r[0] < z.x0 - 1 || e.r[2] > z.x1 + 1 || e.r[1] < z.y0 - 1 || e.r[3] > z.y1 + 1) errori.push(`${e.asse} fuori dalla zona`);
  }
  return esito(!errori.length, nome, errori.length ? errori.join('; ') : q.map((e) => `${e.asse} ${e.testo} (${e.op})`).join(', '));
}
const REPORT = "stemReport({ titolo: 'prova', blocchi: [{ tipo: 'testo', titolo: 'Blocco di prova', testo: 'Un testo qualunque.' }] })";

// 21 s, poi una lettura di window.__misure: i fotogrammi contati in ognuno degli ultimi 20 secondi interi, con mediana,
// p10 e minimo. Contati per secondo, perché la mediana degli intervalli nascondeva un HUD che alterna fotogrammi corti e
// lunghi (59,9 fps dagli intervalli contro i 55 della traccia del compositore, 7/11).
// Il modello è davvero disegnato? Luminosità media (verde e blu) del quadrato centrale della zona, da uno screenshot piccolo:
// il fondo nero sta sotto 0,1, l'ologramma acceso sopra 0,3
async function luce(z) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: z.cx - z.r / 2, y: z.cy - z.r / 2, width: z.r, height: z.r, scale: 0.1 } });
  return ev(`(async () => { const i = await createImageBitmap(await (await fetch('data:image/png;base64,${r.data}')).blob());
    const g = new OffscreenCanvas(i.width, i.height).getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, i.width, i.height).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k + 1] + d[k + 2];
    return s / (d.length / 4) / 510; })()`);
}
async function misuraFps(nome) {
  const leggi = () => ev('({ ...window.__misure, ora: performance.now() })');
  const prima = await leggi();
  await pausa(21000);
  const f = await leggi(), x = f.fps, contati = (1000 * (f.fotogrammi - prima.fotogrammi)) / (f.ora - prima.ora);
  const riga = `contati ${contati.toFixed(1)}, mediana ${x.mediana}, p10 ${x.p10}, minimo ${x.minimo}; per secondo ${(x.conti || []).join(' ')}`;
  esito(f.ologramma && x.secondi === 20 && x.conti?.length === 20 && [x.mediana, x.p10, x.minimo].every(Number.isInteger) && x.minimo <= x.p10 && x.p10 <= x.mediana,
    `${nome}: __misure.fps conta i fotogrammi in ogni secondo intero, con mediana, p10 e minimo`, riga);
  esito(contati >= 45 && x.mediana >= 45, `${nome}: sopra la soglia di Tony (45 fps) in 20 s`, riga);
  esito(x.p10 >= 45, `${nome}: anche il p10 dei secondi sopra 45 fps, cioè niente scatti frequenti`, `p10 ${x.p10}, minimo ${x.minimo}`);
  const l = await luce((await ev('stemOlo.info()')).zona);
  esito(l > 0.2, `${nome}: alla fine della misura il modello è disegnato`, `luminosità al centro ${l.toFixed(3)}`);
}

let script = null;
try {
  await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));
  await connetti();
  for (const d of ['Page', 'Runtime', 'Network']) await cdp(`${d}.enable`);
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); // i tasti arrivano alla pagina come a una finestra in primo piano

  titolo("Chrome come l'HUD di Tony");
  let dentro = await ev('[innerWidth, innerHeight, devicePixelRatio]');
  if (dentro[0] !== W || dentro[1] !== H) { // headless toglie qualche punto alla finestra: lo si rimette
    const { windowId } = await cdp('Browser.getWindowForTarget');
    await cdp('Browser.setWindowBounds', { windowId, bounds: { width: 2 * W - dentro[0], height: 2 * H - dentro[1] } });
    await pausa(300);
    dentro = await ev('[innerWidth, innerHeight, devicePixelRatio]');
  }
  esito(dentro[0] === W && dentro[1] === H && dentro[2] === 2, 'finestra interna grande come lo schermo di Tony', `${dentro[0]}×${dentro[1]} punti a ${dentro[2]}x`);
  // Niente riconoscimento vocale nel Chrome di prova: in un profilo nuovo l'HUD scaricherebbe il modello italiano di Chrome
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "for (const k of ['SpeechRecognition', 'webkitSpeechRecognition']) Object.defineProperty(window, k, { value: undefined })" });
  script = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('stem-mani', '0') } catch {}" })).identifier; // senza mani
  await vai(`${ORIGINE}/?debug`);
  const gpu = await ev(`(() => { const g = document.createElement('canvas').getContext('webgl2'), x = g.getExtension('WEBGL_debug_renderer_info');
    return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'senza WEBGL_debug_renderer_info'; })()`);
  esito(/Apple|Metal/.test(gpu) && !/SwiftShader|llvmpipe|software/i.test(gpu), 'WebGL sulla GPU vera, non in software', gpu);
  await ev("window.__pd = 0; addEventListener('pointerdown', () => window.__pd++); addEventListener('keydown', (e) => { window.__tasto = { key: e.key, impedito: e.defaultPrevented }; }); true");
  const libera = await testa(), angolo = await ev("import('/ologramma/scena.js').then((m) => m.angoloTesta())");

  titolo("Apertura: la testa nell'angolo, report e browser lasciano il posto");
  await ev("stemAsk('apri il browser'), true");
  const browser = await attendi(() => ev("document.body.classList.contains('browsing')"), 3000);
  await ev(`${REPORT}, true`);
  const report = await ev("document.getElementById('report').classList.contains('on') && !document.body.classList.contains('browsing')");
  esito(browser && report, "prima: il browser aperto da un evento 'show', poi un report al suo posto");
  const demo = await ev("stemOlogrammaDemo('turbofan')");
  await pausa(1500);
  const aperto = await ev("({ report: document.getElementById('report').classList.contains('on'), browsing: document.body.classList.contains('browsing'), olo: document.body.classList.contains('olo'), info: stemOlo.info() })");
  const inAngolo = await testa();
  esito(aperto.info.aperto && aperto.info.pezzi === demo.pezzi && aperto.info.pezzi > 50 && !aperto.report && !aperto.browsing && aperto.olo,
    'stemOlogrammaDemo apre il turbofan; report e browser si chiudono', `${aperto.info.pezzi} pezzi, ${aperto.info.triangoli} triangoli`);
  esito(Math.abs(inAngolo[0] - angolo.dockX) < 0.03 * W && inAngolo[1] > H / 2, "la testa va nell'angolo in basso a destra",
    `scritta di stato a (${inAngolo}) contro l'angolo (${angolo.dockX.toFixed(0)}, ${angolo.dockY.toFixed(0)}); prima a (${libera})`);
  titolo('Quote in millimetri');
  await controllaQuote("senza pezzo scelto: tre quote tenui, con i lati dell'ingombro del modello intero", lati(PEZZI_TURBOFAN.keys()), { minimo: 0.1, massimo: 0.75 });
  await foto('1-apertura');

  titolo('Mouse');
  const z = aperto.info.zona, pd0 = await ev('window.__pd');
  await clic(z.cx, z.cy);
  const scelto = await ev("({ s: stemOlo.info().vista.selezionato, scheda: document.querySelector('.holo-card.on')?.textContent || '' })");
  esito(typeof scelto.s === 'string' && scelto.scheda.length > 0, 'clic su un pezzo: lo sceglie e mostra la scheda', `${scelto.s}: «${scelto.scheda.slice(0, 70)}»`);
  esito((await ev('window.__pd')) > pd0, "il pointerdown arriva lo stesso alla finestra, che sblocca l'audio");
  if (typeof scelto.s === 'string') {
    await controllaQuote(`pezzo scelto (${scelto.s}): tre quote .holo-quota con i lati del suo ingombro`, lati([scelto.s]));
    const qi = await ev('stemOlo.info().quote');
    esito(qi.soggetto === scelto.s && qi.segmenti === 15, 'le quote sono linee: per asse due di riferimento, una di quota e due trattini', JSON.stringify(qi));
    await foto('1b-quote');
  }
  await clic(z.cx, z.cy, 2);
  const isolato = (await ev('stemOlo.info().vista')).isolato;
  await clic(z.cx, z.cy, 2);
  const rimesso = (await ev('stemOlo.info().vista')).isolato;
  esito(typeof isolato === 'string' && rimesso === null, 'doppio clic: isola il pezzo, e un altro doppio clic lo rimette con gli altri', `isolato ${isolato}`);

  titolo('Tasti e trascinamento');
  await tasto('e'); await pausa(2000);
  const v1 = await ev('stemOlo.info()'), et1 = await etichette();
  esito(v1.vista.esploso === 1 && Object.keys(et1).length >= 3, 'E: vista esplosa, con le etichette', `${Object.keys(et1).length} etichette visibili`);
  await foto('2-esploso');
  const selE = (await ev('stemOlo.info().vista')).selezionato;
  if (esito(typeof selE === 'string', 'nell\'esploso il pezzo resta scelto', String(selE))) {
    await controllaQuote(`esploso, pezzo scelto (${selE}): le quote lo seguono con gli stessi valori`, lati([selE]));
    await ev("stemOlo.comando('seleziona', null), true"); await pausa(900);
    const spente = (await leggiQuote()).filter((e) => e.op > 0.05);
    esito(!spente.length, "esploso senza pezzo scelto: la quota del modello intero si spegne", spente.map((e) => `${e.asse} ${e.op}`).join(', ') || 'tutte spente');
    await ev(`stemOlo.comando('seleziona', ${JSON.stringify(selE)}), true`); await pausa(900); // come prima, per le etichette qui sotto
  }
  await trascina(z.cx - 150, z.cy, z.cx + 150, z.cy + 60); await pausa(400);
  const et2 = await etichette();
  esito(scarto(et1, et2) > 15, 'trascinare col mouse gira il modello', `etichette spostate di ${scarto(et1, et2).toFixed(0)} punti in media`);
  await mouse('mouseWheel', z.cx, z.cy, { deltaX: 0, deltaY: -240 }); await pausa(500); // zoom di e^0,36 = 1,43
  const et3 = await etichette();
  esito(allarga(et2, et3, z) > 1.15, 'la rotella avvicina', `etichette ${allarga(et2, et3, z).toFixed(2)} volte più lontane dal centro`);
  await tasto('r'); await pausa(1200);
  const et4 = await etichette();
  esito(scarto(et1, et4) < 4, "R rimette la camera com'era", `scarto ${scarto(et1, et4).toFixed(2)} punti dalla vista di prima`);
  const modi = [];
  let tacche = null;
  for (const [i, k] of ['x', 'x', 'd', 'f', 'l', 'o'].entries()) {
    await tasto(k); modi.push((await ev('stemOlo.info().vista')).modo);
    if (i === 0) { await pausa(900); await foto('3-raggi-x'); }
    if (k === 'f') tacche = await ev("[...document.querySelectorAll('.holo-leg.on .ticks span')].map((s) => s.textContent + ' ' + parseFloat(s.style.left) + '%').join(' | ')");
  }
  esito(modi.join() === 'raggi-x,ologramma,densita,sforzi,solido,ologramma', "X, D, F, L, O cambiano il modo; X di nuovo torna all'ologramma", modi.join(' → '));
  // Colori lineari: rischio = 1/fs, la stessa funzione per la texture dello shader e per la legenda
  const scala = await ev("import('/ologramma/scena.js').then((m) => [10, 4, 2, 1.25, 1, 0.5].map(m.rischio))");
  esito(JSON.stringify(scala) === JSON.stringify([0.1, 0.25, 0.5, 0.8, 1, 1]) && tacche === 'fs 4 25% | fs 2 50% | fs 1,33 75% | fs ≤ 1 100%',
    'sforzi: rischio = 1/fs (fs 10 → 0,1, fs 2 → 0,5, rosso da fs 1), e la legenda ha le tappe fs 4, 2, 1,33 e ≤ 1', `${scala.join(', ')}; ${tacche}`);
  await tasto('e'); await pausa(1500);
  await tasto('s');
  const s1 = (await ev('stemOlo.info().vista')).sezione, assi = [s1?.asse];
  await pausa(1000); await foto('4-sezione');
  await tasto('ArrowUp'); const s2 = (await ev('stemOlo.info().vista')).sezione;
  await tasto('ArrowDown'); const s3 = (await ev('stemOlo.info().vista')).sezione;
  for (let i = 0; i < 3; i++) { await tasto('s'); assi.push((await ev('stemOlo.info().vista')).sezione?.asse ?? null); }
  esito(assi.join() === 'x,y,z,', 'S: sezione a giro sugli assi x, y, z, poi niente', assi.map(String).join(' → '));
  esito(s2?.posizione > s1?.posizione && Math.abs(s3?.posizione - s1?.posizione) < 1e-9, 'frecce: il taglio si sposta e torna', `${s1?.posizione.toFixed(1)} → ${s2?.posizione.toFixed(1)} → ${s3?.posizione.toFixed(1)} mm`);
  esito((await ev('window.__tasto')).impedito === true, "con l'ologramma aperto i tasti sono suoi (preventDefault)");

  titolo("Fotogrammi con l'ologramma aperto, senza mani (requestAnimationFrame, 20 s)");
  await pausa(1500);
  await misuraFps('senza mani');

  titolo('Esc');
  await tasto('Escape'); await pausa(1500);
  const chiuso = await ev("({ info: stemOlo.info(), olo: document.body.classList.contains('olo') })"), tornata = await testa();
  esito(!chiuso.info.aperto && !chiuso.olo, "Esc chiude l'ologramma");
  esito(Math.abs(tornata[0] - libera[0]) < 0.03 * W && Math.abs(tornata[1] - libera[1]) < 0.03 * H, 'la testa torna dove stava', `(${tornata}) contro (${libera})`);
  esito(!registro.some((r) => r.via === 'hud' || r.via === 'foto'), 'un ologramma di prova non scrive al server, né azioni né foto');
  await foto('5-esc');
  await tasto('e');
  esito((await ev('window.__tasto')).impedito === false, 'a ologramma chiuso i tasti non si toccano');

  titolo('Collegato al server (lo stato vero di ologramma.mjs, senza calcolo)');
  holo.esegui({ azione: 'mostra', modello: structuredClone(DEMO_TURBOFAN) });
  const M1 = holo.stato().modello, t0 = Date.now();
  const visto = await attendi(() => ev(`stemOlo.info().aperto && stemOlo.info().modello === ${M1}`), 7000);
  esito(visto, "/api/status porta la versione nuova: l'HUD rilegge e mostra", `dopo ${((Date.now() - t0) / 1000).toFixed(1)} s (il giro di /api/status è ogni 5 s)`);
  const ft = await attendi(() => registro.find((r) => r.via === 'foto' && r.modello === M1), 6000), letto = registro.find((r) => r.via === 'get' && r.t >= t0);
  esito(ft?.attuale && ft.w <= 960 && ft.byte <= 1.5e6, 'foto della versione mostrata, al server', ft ? `${ft.w}×${ft.h}, ${ft.byte} B, ${ft.t - letto.t} ms dopo la lettura dello stato` : 'nessuna foto');
  const barra = await ev("[...document.querySelectorAll('.holo-top span')].map((s) => s.textContent).join(' | ')"), kg = massaTesto(holo.stato().massa_kg);
  esito(barra.includes(` · ${kg.toUpperCase()} · `) && holo.stato().massa_kg > 2000, "la massa nell'HUD con la regola del testo per il cervello", `${barra}; nel testo «Massa ${kg}»`);
  holo.esegui({ azione: 'modifica', titolo: 'Turbofan in titanio' });
  const titoloNuovo = await attendi(() => ev("document.querySelector('.holo-top span').textContent").then((t) => /TURBOFAN IN TITANIO/.test(t) && t), 7000);
  esito(titoloNuovo, 'modifica col titolo: la barra dell\'HUD si aggiorna', titoloNuovo || '');
  const n0 = registro.length;
  await ev("stemAsk('modifica la vista'), true");
  const piccola = await attendi(() => ev("document.getElementById('small').textContent").then((s) => /OLOGRAMMA/.test(s) && s), 2000);
  const raggi = await attendi(() => ev("stemOlo.info().vista.modo === 'raggi-x'"), 3000);
  const cambio = registro.slice(n0).find((r) => r.via === 'cambio'), dopoCambio = cambio && registro.slice(registro.indexOf(cambio)).find((r) => r.via === 'get');
  esito(raggi && dopoCambio && dopoCambio.t - cambio.t < 1000, "evento 'holo' durante un turno: l'HUD rilegge subito", dopoCambio ? `${dopoCambio.t - cambio.t} ms dal cambio alla lettura` : 'nessuna lettura');
  esito(piccola, 'etichetta dello strumento sotto la scritta di stato', piccola || '');
  const zz = (await ev('stemOlo.info()')).zona, gx = zz.cx / W, gy = zz.cy / H;
  const nLancia = registro.length; // il 7/11 un lancia senza presa toglieva il pezzo sotto il cursore
  await ev(`stemOlo.gesto({ tipo: 'lascia' }), stemOlo.gesto({ tipo: 'lancia', x: ${gx}, y: ${gy}, vx: 1.5, vy: 0 }), true`);
  await pausa(800);
  esito(!registro.slice(nLancia).some((r) => r.via === 'hud') && (await ev('stemOlo.info().tolti.length')) === 0, 'un lancia senza presa non toglie niente');
  // le mani escono: gesti.js smette di mandare 'cursore', e il cursore si spegne da solo
  await ev(`stemOlo.gesto({ tipo: 'cursore', x: ${gx}, y: ${gy} }), true`);
  const curSubito = await ev("!!document.querySelector('.holo-cur.on')");
  await pausa(700);
  const curDopo = await ev("!!document.querySelector('.holo-cur.on')");
  esito(curSubito && !curDopo, 'il cursore si spegne quando i gesti smettono', `acceso ${curSubito}, 700 ms dopo l'ultimo gesto ${curDopo}`);
  await ev(`stemOlo.gesto({ tipo: 'afferra', x: ${gx}, y: ${gy} }), stemOlo.gesto({ tipo: 'lancia', x: ${gx}, y: ${gy}, vx: 1.5, vy: 0 }), true`);
  const togli = await attendi(() => registro.find((r) => r.via === 'hud' && r.corpo.azione === 'togli'), 3000);
  const toltoHud = togli && await attendi(() => ev(`stemOlo.info().versione === ${holo.stato().versione}`), 3000);
  esito(togli?.codice === 200 && togli.corpo.modello === M1 && holo.stato().tolti.includes(togli.corpo.id) && toltoHud,
    "lancio con le mani: togli al server col numero del modello, poi l'HUD rilegge", togli ? JSON.stringify(togli.corpo) : 'niente');
  await tasto('z');
  const rimetti = await attendi(() => registro.find((r) => r.via === 'hud' && r.corpo.azione === 'rimetti'), 3000);
  const rimessoHud = rimetti && await attendi(() => ev(`stemOlo.info().tolti.length === 0 && stemOlo.info().versione === ${holo.stato().versione}`), 3000);
  esito(rimetti?.codice === 200 && rimetti.corpo.id === togli?.corpo.id && holo.stato().tolti.length === 0 && rimessoHud, "Z rimette l'ultimo pezzo tolto", rimetti ? JSON.stringify(rimetti.corpo) : 'niente');
  await ev(`stemOlo.gesto({ tipo: 'cursore', x: ${gx}, y: ${gy} }), stemOlo.gesto({ tipo: 'afferra', x: ${gx}, y: ${gy} }), true`); // Esc durante una presa
  await tasto('Escape');
  const curEsc = await ev("document.querySelector('.holo-cur').className");
  esito(!/\b(on|presa)\b/.test(curEsc), 'chiuso durante una presa: il cursore si spegne e non resta «preso»', curEsc);
  const chiudi = await attendi(() => registro.find((r) => r.via === 'hud' && r.corpo.azione === 'chiudi'), 3000);
  await pausa(300);
  esito(chiudi?.codice === 200 && chiudi.corpo.modello === M1 && !holo.stato().aperto && !(await ev('stemOlo.info().aperto')),
    'Esc: chiudi col numero del modello, e il server lo segna chiuso', chiudi ? JSON.stringify(chiudi.corpo) : 'niente');
  holo.esegui({ azione: 'mostra', modello: structuredClone(DEMO_STAFFA) });
  const MA = holo.stato().modello;
  await attendi(() => ev(`stemOlo.info().aperto && stemOlo.info().modello === ${MA}`), 7000);
  holo.esegui({ azione: 'mostra', modello: structuredClone(DEMO_TURBOFAN) }); // il cervello fa un modello nuovo, l'HUD non l'ha ancora visto
  const MB = holo.stato().modello, n1 = registro.length;
  await tasto('Escape');
  const conflitto = await attendi(() => registro.slice(n1).find((r) => r.via === 'hud' && r.corpo.azione === 'chiudi'), 3000);
  const nuovo = await attendi(() => ev(`stemOlo.info().aperto && stemOlo.info().modello === ${MB}`), 3000);
  esito(conflitto?.codice === 409 && conflitto.corpo.modello === MA && nuovo && holo.stato().aperto, "Esc su un modello vecchio: 409, e l'HUD mostra quello nuovo",
    conflitto ? `chiudi del modello ${conflitto.corpo.modello} → ${conflitto.codice}; ora si vede il ${MB}` : 'niente');
  const n2 = registro.length;
  await ev("stemAsk('apri il browser'), true");
  const coperto = await attendi(() => ev("!stemOlo.info().aperto && document.body.classList.contains('browsing')"), 3000);
  await pausa(300);
  esito(coperto && !holo.stato().aperto && !registro.slice(n2).some((r) => r.via === 'hud'), "un 'show' chiude l'ologramma nell'HUD e nel server (lo fa il server, l'HUD non scrive)");
  holo.esegui({ azione: 'modifica', vista: { modo: 'solido' } });
  const tornato = await attendi(() => ev("stemOlo.info().aperto && stemOlo.info().vista.modo === 'solido' && !document.body.classList.contains('browsing')"), 7000);
  esito(tornato, 'la modifica dopo lo riporta, al posto del browser');
  const n3 = registro.length;
  await ev(`${REPORT}, true`);
  const coperto2 = await ev("!stemOlo.info().aperto && document.getElementById('report').classList.contains('on')");
  await tasto('Escape'); await pausa(800); // il report sparisce in 450 ms
  const dopoEsc = { coperto: coperto2, server: holo.stato().aperto, scritto: registro.slice(n3).some((r) => r.via === 'hud'), report: await ev("document.getElementById('report').classList.contains('on')") };
  esito(dopoEsc.coperto && dopoEsc.server && !dopoEsc.scritto && !dopoEsc.report, "un report locale (stemReport) chiude l'ologramma nell'HUD; poi Esc chiude il report senza scrivere al server", JSON.stringify(dopoEsc));

  titolo("Comandi a voce con l'ologramma aperto (stemSente: una frase finita, senza microfono)");
  const sente = async (frase) => { // una frase come dal riconoscimento; poi quello che l'HUD ne ha fatto: registro e domanda
    const n = registro.length;
    if (!(await ev("typeof stemSente === 'function'"))) return { riga: 'stemSente non c\'è', chiesto: false };
    await ev(`stemSente(${JSON.stringify(frase)}), true`);
    await pausa(1300); // 700 ms per unire le frasi, poi la domanda
    const nuovi = registro.slice(n);
    return { riga: nuovi.find((r) => r.via === 'log')?.riga || '', chiesto: nuovi.some((r) => r.via === 'ask' && r.testo === frase) };
  };
  const FRASI = ['esplodilo', 'rimontalo', 'togli il coperchio', 'rimettilo', 'taglialo a metà', 'chiudilo'];
  const chiusi = [];
  for (const f of FRASI) chiusi.push(await sente(f));
  esito(!(await ev('stemOlo.info().aperto')) && chiusi.every((x) => !x.chiesto && x.riga.startsWith('non per STEM')), "a ologramma chiuso il filtro è quello di prima: nessuna di queste è per STEM", chiusi.map((x) => x.riga.split(';')[0]).join(', '));
  holo.esegui({ azione: 'modifica', vista: { modo: 'ologramma' } });
  await attendi(() => ev('stemOlo.info().aperto'), 7000);
  const aperti = [];
  for (const f of FRASI) aperti.push(await sente(f));
  esito(aperti.every((x) => x.chiesto && x.riga === 'domanda (comando)'), "a ologramma aperto un verbo dell'ologramma basta, anche da solo e dopo 25 s: va al cervello come comando", aperti.map((x) => `${x.chiesto ? 'chiesta' : 'NO'} (${x.riga})`).join(', '));
  const altro = await sente('sì');
  esito(!altro.chiesto && altro.riga.startsWith('non per STEM'), "anche a ologramma aperto un «sì» da solo resta non per STEM", altro.riga);
  await tasto('Escape');

  titolo("Un pezzo da file grande (300.000 triangoli): il cursore delle mani non lo scorre triangolo per triangolo");
  await ev("stemOlogramma({ aperto: true, modello: -1000, versione: 1, titolo: 'File grande', descrizione: '', pezzi: [{ id: 'grande', forma: 'file', misure: { file: '/Users/tony/Documents/prova.stl' } }], tolti: [], carichi: [], vincoli: [], massa_kg: null, ingombro_mm: null, analisi: null }), true");
  const caricato = await attendi(() => ev('stemOlo.info().triangoli >= 3e5 && stemOlo.info().caricamenti === 0 && stemOlo.info().fermo'), 20000, 200);
  const zf = (await ev('stemOlo.info()')).zona;
  const costi = await ev(`(async () => { const ms = []; for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 120)); const a = performance.now();
    stemOlo.gesto({ tipo: 'cursore', x: ${zf.cx / W}, y: ${zf.cy / H} }); ms.push(performance.now() - a); } return ms.sort((a, b) => a - b); })()`);
  await clic(zf.cx, zf.cy);
  const sceltoFile = (await ev('stemOlo.info().vista')).selezionato;
  esito(caricato && costi[3] < 3 && sceltoFile === 'grande', 'il cursore sul file costa meno di 3 ms (prima un raycast su ogni triangolo), e il clic sceglie il pezzo',
    `${costi.map((x) => x.toFixed(2)).join(', ')} ms; scelto ${sceltoFile}`);
  await tasto('Escape');

  titolo('Mani: la foto di prova al posto della fotocamera (?debug&mani=immagine, 30 Hz)');
  await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
  script = (await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.removeItem('stem-mani') } catch {}" })).identifier; // la preferenza predefinita
  await vai(`${ORIGINE}/?debug&mani=immagine`);
  await ev("stemOlogrammaDemo('turbofan')");
  const partite = await attendi(() => ev('window.__misure.mani?.attive && window.__misure.mani.rilevazioni >= 30'), 20000, 200);
  const m1 = await ev('window.__misure.mani');
  const dita = await ev("({ dita: document.querySelectorAll('#dita i.on').length, cursore: !!document.querySelector('.holo-cur.on') })");
  esito(partite && m1.delegato === 'GPU', "MediaPipe parte da solo all'apertura, con la preferenza predefinita", `delegato ${m1.delegato}, avvio ${m1.avvio_ms} ms, ${m1.mani} mani viste`);
  esito(m1.mani > 0 && dita.dita === 2 * m1.mani && dita.cursore, 'pollice e indice di ogni mano, più il cursore dei gesti', JSON.stringify(dita));
  await pausa(1000);
  await misuraFps('con due mani');
  await foto('6-mani');
  const m2 = await ev('window.__misure.mani');
  console.log(`      mani: detectForVideo mediana ${m2.detect_ms.mediana} ms, p90 ${m2.detect_ms.p90}, massimo ${m2.detect_ms.massimo}, primo ${m2.detect_ms.primo}; ${m2.rilevazioni_s} rilevazioni al secondo`);
  const scaricati = () => ['/mediapipe/wasm/vision_wasm_internal.wasm', '/modelli/hand_landmarker.task'].map((x) => percorsi.get(x) || 0).join('+');
  const prima2 = { rete: scaricati(), script: await ev("document.querySelectorAll('script').length") };
  await tasto('m'); await pausa(300);
  const spente = await ev("({ attive: window.__misure.mani.attive, scelta: localStorage.getItem('stem-mani'), avviso: document.getElementById('warn').textContent, dita: document.querySelectorAll('#dita i.on').length })");
  await tasto('m');
  const tRiaccese = Date.now(), riaccese = await attendi(() => ev("window.__misure.mani.attive && localStorage.getItem('stem-mani') === '1'"), 10000, 50);
  esito(!spente.attive && spente.scelta === '0' && /spente/i.test(spente.avviso) && spente.dita === 0 && riaccese, 'M spegne e riaccende le mani, e la scelta resta', JSON.stringify(spente));
  const dopo2 = { rete: scaricati(), script: await ev("document.querySelectorAll('script').length") };
  esito(riaccese && prima2.rete === '1+1' && dopo2.rete === prima2.rete && dopo2.script === prima2.script, 'riaccese, le mani riusano il rilevatore: niente wasm né modello riscaricati, niente <script> in più',
    `wasm+modello ${prima2.rete} → ${dopo2.rete}, <script> ${prima2.script} → ${dopo2.script}, attive dopo ${Date.now() - tRiaccese} ms`);
  const n4 = registro.length;
  await tasto('Escape'); await pausa(500);
  const fine = await ev("({ attive: window.__misure.mani.attive, video: document.querySelectorAll('video').length, dita: document.querySelectorAll('#dita i.on').length, aperto: stemOlo.info().aperto })");
  esito(!fine.attive && fine.video === 0 && fine.dita === 0 && !fine.aperto, 'alla chiusura le mani si fermano', JSON.stringify(fine));
  const mis = (await attendi(() => registro.slice(n4).find((r) => r.via === 'misura'), 2000))?.corpo;
  esito(mis && mis.secondi >= 20 && [mis.fps.mediana, mis.fps.p10, mis.fps.minimo].every(Number.isInteger) && mis.fps.minimo <= mis.fps.p10 && mis.fps.p10 <= mis.fps.mediana &&
    Number.isFinite(mis.detect_ms) && mis.prova === true, "alla chiusura l'HUD manda al server la misura delle mani: secondi, fps per secondo, detect", JSON.stringify(mis));

  titolo('MediaPipe che non parte');
  await cdp('Network.setBlockedURLs', { urls: ['*/mediapipe/*'] });
  await vai(`${ORIGINE}/?debug&mani=immagine`);
  await ev("stemOlogrammaDemo('staffa')");
  const avviso = await attendi(() => ev("document.getElementById('warn').textContent").then((t) => /^mani:/.test(t) && t), 8000, 200);
  const resta = await ev('({ aperto: stemOlo.info().aperto, mani: window.__misure.mani })');
  esito(avviso && resta.aperto && !resta.mani?.attive, "un avviso a schermo, e l'ologramma resta col mouse", avviso || '');
  await cdp('Network.setBlockedURLs', { urls: [] });
  await tasto('Escape');

  titolo('Rete e console');
  const altri = [...host.keys()].filter((h) => h !== `localhost:${PORTA}`);
  esito(altri.length === 0, 'richieste solo al server di prova: niente font né altro da internet', JSON.stringify(Object.fromEntries(host)));
  esito(eccezioni.length === 0 && errori.length === 0, 'nessuna eccezione né errore in console', [...eccezioni, ...errori].slice(0, 3).join(' | '));
} catch (e) {
  esito(false, 'la prova si è fermata', String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
} finally {
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
  esito(!porte, 'Chrome e server chiusi, porte libere', porte ? `ancora in ascolto: ${porte}` : `${PORTA} e ${CDP}`);
  console.log(`\nFoto in ${FOTO}\n${passati} PASS, ${falliti} FAIL`);
  process.exit(falliti ? 1 : 0);
}
