// hud-foto.mjs — l'HUD vero (public/index.html e oscar.js) in un Chrome headless sulla GPU del Mac, con un server finto:
// cervello a copione, voce finta (un tono a sillabe), stato fisso. Fa una sequenza di foto dei momenti che contano.
//   node prove/hud-foto.mjs [--uscita <cartella>] [--porta 4481] [--cdp 9581] [--solo casa,report]
// Niente microfono né fotocamera veri (dispositivi finti), niente rete: solo questo server. Il riconoscimento vocale è finto
// (disponibile ma muto), così l'HUD è «in ascolto» senza scaricare il modello italiano; le frasi arrivano da oscarSente/oscarParziale.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { createOlogramma } from '../ologramma.mjs';

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
function png(w, h) { // una foto finta per le schede: un gradiente blu notte, PNG vero
  const blocco = (tipo, dati) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), t = Buffer.from(tipo); l.writeUInt32BE(dati.length); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, dati])) >>> 0); return Buffer.concat([l, t, dati, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const righe = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (3 * w + 1) + 1 + 3 * x; righe[o] = 10 + (40 * x) / w; righe[o + 1] = 40 + (90 * y) / h; righe[o + 2] = 70 + (110 * (x + y)) / (w + h); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), blocco('IHDR', ihdr), blocco('IDAT', zlib.deflateSync(righe)), blocco('IEND', Buffer.alloc(0))]);
}
const FOTO = png(640, 360);
// Le schede (27/11): una risposta con tre frasi e due schede, ognuna subito dopo la frase che la nomina, e la foto della prima
const MUSEI = [[300, { t: 'say', s: 'Guardo subito.' }], [400, { t: 'say', s: 'Il Louvre domina con circa nove milioni di visitatori nel duemilaventicinque.' }],
  [5, { t: 'vedi', id: 'a1', nome: 'Louvre', tipo: "museo d'arte", numeri: ['9,05 mln visitatori (2025)'], fonte: 'theartnewspaper.com' }],
  [5, { t: 'say', s: "Al secondo posto c'è il Museo d'Orsay, con circa tre milioni e ottocentomila." }],
  [5, { t: 'vedi', id: 'a2', nome: "Museo d'Orsay", tipo: "museo d'arte", numeri: ['3,8 mln visitatori (2025)', 'aperto dal 1986'], fonte: 'theartnewspaper.com' }],
  [200, { t: 'vedi-foto', id: 'a1', url: '/api/schede/foto/a1' }]];

// ---------------------------------------------------------------- un ologramma con la ricerca sui pezzi
// Lo stato è quello vero di ologramma.mjs (senza calcolo): l'HUD lo legge da GET /api/ologramma dopo l'evento «holo», come
// con il cervello. Dal 22/11 lo disegna Blender: qui si guarda solo che l'HUD gli lasci il posto.
const OLO = createOlogramma({ cartella: path.join(LAVORO, 'stato'), calcola: () => { throw new Error('questa prova non calcola'); } });
const PORTATILE = { titolo: 'Portatile di prova', descrizione: 'Cinque pezzi per provare la scheda con la ricerca.', vista: { selezionato: 'scocca' }, pezzi: [
  { id: 'scocca', nome: 'Scocca inferiore', forma: 'scatola', misure: { x: 304, y: 6, z: 215 }, materiale: 'alluminio-6061',
    materiale_vero: 'alluminio 6063 riciclato al 100%, anodizzato, blu mezzanotte', // 60
    fattura: 'fresata da un blocco estruso, poi sabbiata e anodizzata; le sedi delle viti sono filettate dopo e i bordi smussati da un utensile diamantato' }, // 140
  { id: 'schermo', nome: 'Schermo', forma: 'scatola', misure: { x: 304, y: 200, z: 4 }, posizione: [0, 103, -105], rotazione: [-12, 0, 0],
    materiale_vero: 'vetro alluminosilicato su pannello IPS', fattura: '<img src=x onerror=alert(1)> laminato al pannello, bordi incollati' }, // senza chiave del calcolo
  { id: 'batteria', nome: 'Batteria', forma: 'scatola', misure: { x: 220, y: 4, z: 90 }, posizione: [0, 5, 40], interno: true, materiale_vero: 'polimeri di litio, 52,6 Wh', fattura: 'quattro celle a sacchetto incollate' },
  { id: 'scheda', nome: 'Scheda logica', forma: 'scatola', misure: { x: 180, y: 2, z: 40 }, posizione: [0, 5, -60], interno: true, materiale: 'generico' },
  { id: 'cerniera', nome: 'Cerniera', forma: 'cilindro', misure: { r: 4, h: 250 }, posizione: [0, 7, -108], rotazione: [0, 0, 90], materiale: 'acciaio-s235' },
] };
// ---------------------------------------------------------------- server finto
let guasto = false; // true: /api/status risponde 500 (server che non c'è più)
const TIPI = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.css': 'text/css' };
const PUB = path.join(REPO, 'public'), THREE_DIR = path.join(REPO, 'node_modules', 'three'), MP = path.join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const sotto = (base, rel) => { const f = path.resolve(base, '.' + path.sep + decodeURIComponent(rel)); return f === base || f.startsWith(base + path.sep) ? f : null; };
let ultimoPerche; // il perché dell'ultima domanda: il server vero ne fa la riga [sentito] per il cervello
const corpo = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
async function copione(res, testo) { // il cervello finto: eventi NDJSON con le loro pause
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  const passi = /musei/i.test(testo) ? MUSEI.map(([ms, e]) => [ms, e.id ? { ...e, id: `${e.id}-${testo.length}` } : e.url ? { ...e, id: `a1-${testo.length}`, url: `${e.url}-${testo.length}` } : e])
    : /scheda/i.test(testo) // una ricerca senza browser (eventi «web»), poi l'ologramma: «schermo» sceglie il pezzo senza chiave
    ? [[200, { t: 'web', name: 'ricerca', detail: '' }], [700, { t: 'web', name: 'pagina', detail: 'ifixit.com' }],
      [1300, () => ({ t: 'holo', v: OLO.esegui(/schermo/.test(testo) ? { azione: 'modifica', vista: { selezionato: 'schermo' } } : /niente/.test(testo) ? { azione: 'modifica', vista: { selezionato: 'scheda' } } : { azione: 'mostra', modello: PORTATILE }).versione })],
      [300, { t: 'say', s: 'Ecco il portatile.' }]]
    : /browser/i.test(testo)
    ? [[200, { t: 'tool', name: 'browser_navigate', detail: 'google.com' }], [300, { t: 'show' }], [900, { t: 'tool', name: 'browser_snapshot' }], [1500, { t: 'say', s: 'Ecco, ho aperto Google.' }]]
    : [[400, { t: 'mac', name: 'agenda', detail: '' }], [1900, { t: 'say', s: 'Domani a Torino sole, massima quattordici gradi.' }], [150, { t: 'say', s: 'Porta comunque una giacca.' }]];
  for (const [ms, ev] of passi) { await pausa(ms); if (res.destroyed) return; res.write(JSON.stringify(typeof ev === 'function' ? ev() : ev) + '\n'); }
  res.end();
}
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api/status') { if (guasto) { res.writeHead(500); return res.end(); } res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ voice: { provider: 'mac', voce: 'Siri (Paolo)' }, browser: true, gifs: false, agenda: 0, ologramma: 0 })); }
  if (p === '/api/ask') { const b = await corpo(req); ultimoPerche = b.why; return copione(res, b.text || ''); }
  if (p.startsWith('/api/schede/foto/')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(FOTO); }
  if (p === '/api/tts') { await corpo(req); res.writeHead(200, { 'content-type': 'audio/wav' }); return res.end(VOCE); }
  if (p === '/api/ologramma' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(OLO.stato())); }
  if (p === '/api/ologramma') { const r = OLO.esegui(await corpo(req), { daHud: true }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: r.ok, versione: r.versione })); } // Esc dall'HUD
  if (p.startsWith('/api/')) { await corpo(req); res.writeHead(204); return res.end(); }
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
let codice = 0;
const modo = () => ev('document.body.dataset.mode');
// Un controllo che può fallire: una riga PASS o FAIL, e con un FAIL la prova esce con 1
let controlli = 0, falliti = 0;
function controlla(ok, nome, dettagli = '') { controlli++; if (!ok) { falliti++; codice = 1; } console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`); return ok; }
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
    try { localStorage.setItem('oscar-mani', '0') } catch {}` });

  // Avvio: la formazione ferma a 1, 3,5 e 6 secondi
  if (!SOLO || ['avvio-03', 'avvio-07', 'avvio-11'].some((n) => SOLO.has(n))) {
    // l'avvio del 27/11: goccia fatta a 0,85 s, pronto a 1,45 s
    for (const [t, nome] of [[0.3, 'avvio-03'], [0.7, 'avvio-07'], [1.1, 'avvio-11']]) { await vai(`?debug&t=${t}`, false); await pausa(2500); await foto(nome); }
  }
  await vai('?debug');
  await pausa(2500); await foto('casa');
  // Nome parlato, sigla puntata e trascrizioni vicine.
  const SI = ['Oscar', 'oscar,', 'O.S.C.A.R.', 'Oskar'], NO = ['cosa', 'tasca', 'scarto', 'osare', 'mosca'];
  const nomi = await ev(`${JSON.stringify([...SI, ...NO])}.map((w) => window.oscarNome(w))`);
  controlla(Array.isArray(nomi) && nomi.slice(0, SI.length).every(Boolean) && nomi.slice(SI.length).every((x) => !x),
    'Oscar e la sigla puntata svegliano; le altre parole di prova no', JSON.stringify([...SI, ...NO].map((w, i) => `${w} ${nomi?.[i] ? 'sì' : 'no'}`)));
  // Il filtro dal 12/11: senza nome passa solo una frase cominciata nei 15 s dopo che O.S.C.A.R. ha parlato. Qui O.S.C.A.R. non ha
  // ancora parlato, quindi comandi, saluti e verbi dell'ologramma da soli non arrivano al cervello.
  const senzaNome = [];
  for (const f of ['dimmi che ore sono', 'ciao', 'puoi aprire il browser', 'esplodilo', 'boh']) {
    const prima = ultimoPerche;
    await ev(`oscarSente(${JSON.stringify(f)}); true`); await pausa(1100);
    senzaNome.push(`${f}: ${await ev("document.getElementById('esito').textContent")}${ultimoPerche !== prima ? ' (CHIESTA)' : ''}`);
  }
  await foto('non-per-oscar');
  controlla(senzaNome.every((x) => x.endsWith('NON PER O.S.C.A.R.')), 'senza nome e fuori dalla finestra non passa niente: comandi, saluti, verbi dell\'ologramma', senzaNome.join(' | '));
  await ev("oscarParziale('oscar dimmi che tempo fa domani a'); true"); await pausa(700); await foto('ascolto-parziale');
  await ev("oscarParziale(''); oscarSente('oscar dimmi che tempo fa domani a Torino'); true"); await pausa(1000); await foto('ascolto-esito');
  const esitoNome = await attendi(() => ev("document.getElementById('esito').textContent").then((t) => t === 'PER O.S.C.A.R. · NOME' && t), 3000, 100);
  controlla(esitoNome === 'PER O.S.C.A.R. · NOME', 'chiamato «oscar», la scheda dell\'ascolto scrive PER O.S.C.A.R. · NOME', esitoNome || await ev("document.getElementById('esito').textContent"));
  await attendi(() => ultimoPerche === 'nome', 3000, 100);
  controlla(ultimoPerche === 'nome', 'la domanda arriva al server col suo perché (nome)', String(ultimoPerche));
  await pausa(900); await foto('pensiero');
  await attendi(async () => (await modo()) === 'speaking', 6000); await pausa(500); await foto('parla');
  // 1,5 s: una frase senza parole di almeno tre lettere entro 1,2 s dalla fine della voce è presa per eco (isEcho)
  await attendi(async () => (await modo()) === 'idle', 12000); await pausa(1500);
  ultimoPerche = undefined;
  await ev("oscarSente('sì'); true");
  await attendi(() => ultimoPerche === 'conversazione', 3000, 100);
  const esitoSi = await ev("document.getElementById('esito').textContent");
  controlla(ultimoPerche === 'conversazione' && esitoSi === 'PER O.S.C.A.R. · CONVERSAZIONE', 'subito dopo la risposta un «sì» da solo passa, come conversazione', `${esitoSi}; perché ${ultimoPerche}`);
  await attendi(async () => (await modo()) === 'speaking', 6000); await attendi(async () => (await modo()) === 'idle', 12000); await pausa(800);
  await ev("oscarAllarme('prova', 1, 'CALCOLO DEGLI SFORZI FALLITO'); true"); await pausa(1500); await foto('allarme-1');
  await ev("oscarAllarme('prova', 2, 'SERVER NON RAGGIUNGIBILE'); true"); await pausa(1500); await foto('allarme-2');
  await ev("oscarAllarme('prova', 0); true"); await pausa(600);
  // Le schede (27/11): compaiono all'inizio della loro frase più la quota del nome, la voce non aspetta, la precedente si riduce
  await ev("oscarAsk('dimmi i musei di Parigi'); true");
  await attendi(() => ev("window.__tempi.schede.length >= 2"), 12000); await pausa(450); await foto('schede');
  const T = await ev("JSON.parse(JSON.stringify(window.__tempi))"), info = await ev("oscarCorsia.info()");
  const frase = (w) => T.frasi.findLast((f) => f.s.includes(w)), scheda = (id) => T.schede.findLast((x) => x.id.startsWith(id));
  const quota = (f, w) => f.s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').indexOf(w) / f.s.length;
  // «Museo d'Orsay»: il nome comincia da «Museo», ed è lì che l'HUD lo fa comparire
  const scarti = [['a1', 'Louvre', 'louvre'], ['a2', 'Orsay', 'museo']].map(([id, w, n]) => { const f = frase(w), x = scheda(id); return f && x ? Math.round(x.mostrata - (f.partita + quota(f, n) * f.durata * 1000)) : null; });
  controlla(scarti.every((d) => d !== null && d >= -30 && d <= 80), 'ogni scheda compare quando la sua frase arriva al nome (entro −30/+80 ms)', `scarti ${scarti.join(', ')} ms`);
  const prima = T.frasi.findLast((f) => f.s === 'Guardo subito.'), meteo = T.frasi.find((f) => f.s.startsWith('Domani a Torino'));
  const buchi = ['Louvre', 'Orsay'].map((w) => { const f = frase(w), i = T.frasi.indexOf(f), p = T.frasi[i - 1]; return Math.round(f.partita - (p.partita + p.durata * 1000)); });
  controlla(prima.partita - prima.ricevuta < 150 && buchi.every((b) => b < 60), 'la voce non aspetta le schede: prima frase subito, nessun buco fra le frasi',
    `prima frase ${Math.round(prima.partita - prima.ricevuta)} ms (senza schede, la meteo: ${meteo ? Math.round(meteo.partita - meteo.ricevuta) : '?'} ms); fra le frasi ${buchi.join(', ')} ms`);
  controlla(info.schede.length === 2 && info.schede[0].stato === 'grande' && info.schede[0].nome === "Museo d'Orsay" && info.schede[1].stato === 'riga' && info.schede[1].foto,
    'la nuova è grande, la precedente ridotta a una riga e con la sua foto', JSON.stringify(info.schede));
  // con l'ologramma aperto le schede arrivano e non lo chiudono
  await ev("oscarOlogramma({ aperto: true, versione: 1 }); true"); await pausa(300);
  await ev("oscarAsk('ancora i musei di Parigi'); true");
  await attendi(() => ev("oscarCorsia.info().schede.length >= 2"), 12000);
  controlla(await ev("window.__misure.ologramma === true && document.body.classList.contains('olo')"), "le schede non chiudono l'ologramma");
  await ev("oscarOlogramma({ aperto: false, versione: 2 }); true");
  await attendi(async () => (await modo()) === 'idle', 12000); await pausa(500);
  await ev("oscarAsk('apri il browser'); true"); await pausa(2600); await foto('browser');
  await attendi(async () => (await modo()) === 'idle', 12000);
  await tasto('Escape', 'Escape', 27); await pausa(800);
  // fluidità dell'entrata: gli intervalli fra i fotogrammi nei primi 2 s (criterio scritto prima del 27/11: nessuno oltre 50 ms)
  await ev("window.__gap = []; { let p = 0; const f = (n) => { if (p) __gap.push(n - p); if (p && n - p > 20) (window.__lunghi ||= []).push([Math.round(p - window.__gap0), Math.round(n - p)]); p = n; if (n - (window.__gap0 ||= n) < 2000) requestAnimationFrame(f); }; requestAnimationFrame(f); } true");
  await ev(`oscarReport({ titolo: 'Realtà virtuale nel 2026', blocchi: [
    { tipo: 'testo', titolo: 'Il mercato', testo: 'Le spedizioni di visori sono cresciute del 12% rispetto al 2025, trainate dai modelli leggeri.', fonte: 'IDC' },
    { tipo: 'dato', titolo: 'Visori venduti', valore: '9,4 mln', testo: 'Nel mondo, primi tre trimestri.', fonte: 'IDC' },
    { tipo: 'grafico', titolo: 'Quote', valori: [{ etichetta: 'Meta', valore: 62 }, { etichetta: 'Apple', valore: 14 }, { etichetta: 'Sony', valore: 9 }, { etichetta: 'Altri', valore: 15 }], unita: '%', testo: 'Quote di mercato.', fonte: 'IDC' },
    { tipo: 'testo', titolo: 'Cosa cambia', testo: 'Lenti pancake e schermi micro-OLED riducono peso e calore.', fonte: 'Wikipedia' },
    { tipo: 'dato', titolo: 'Peso medio', valore: '410 g', testo: 'Contro i 520 g del 2023.' },
    { tipo: 'testo', titolo: 'Limiti', testo: 'Batteria e prezzo restano i freni principali.' } ] }); true`);
  await pausa(3000); await foto('report');
  const gap = await ev("(() => { const g = window.__gap.slice().sort((a, b) => b - a); return { n: g.length, max: +g[0].toFixed(1), oltre34: g.filter((x) => x > 34).length, p99: +g[Math.floor(g.length * 0.01)].toFixed(1) }; })()");
  controlla(gap.max < 50, "l'entrata del report è fluida: nessun fotogramma oltre 50 ms", `${gap.n} fotogrammi, il più lungo ${gap.max} ms, ${gap.oltre34} oltre 34 ms; oltre 20 ms (da quando, quanto): ${JSON.stringify(await ev('window.__lunghi || []'))}`);
  // fino al 27/11 le schede «dato» prendevano la classe delle scritte attorno al nucleo, che col report si spengono: non si vedevano mai
  const dati = await ev(`[...document.querySelectorAll('#report .card.dato')].map((c) => { const s = getComputedStyle(c); return [s.opacity, s.position, c.textContent.includes('9,4 mln') || c.textContent.includes('410 g')].join(' '); })`);
  controlla(dati.length === 2 && dati.every((d) => d === '1 relative true'), 'nel report le schede «dato» si vedono, al loro posto nella griglia', dati.join(' | '));
  await ev("oscarParziale('oscar chiudi il report'); true"); await pausa(600); await foto('report-ascolto');
  await ev("oscarParziale(''); true");
  await tasto('Escape', 'Escape', 27); await pausa(1200);
  // La ricerca sui pezzi: gli eventi «web» come etichetta piccola. Poi l'ologramma, che dal 22/11 si vede in Blender:
  // l'HUD accende le mani e smette di disegnare, la scheda dei pezzi sta in Blender, Esc lo chiude anche nel server
  if (!SOLO || SOLO.has('ricerca-web')) {
    await ev("oscarAsk('fammi la scheda del portatile'); true");
    const piccola = await attendi(() => ev("(() => { const e = document.getElementById('small'); return e.classList.contains('on') && e.textContent === 'LEGGO · IFIXIT.COM' ? e.textContent : ''; })()"), 4000, 50);
    controlla(piccola === 'LEGGO · IFIXIT.COM', "l'evento «web» di una pagina compare come etichetta piccola, col solo nome del sito", piccola || await ev("document.getElementById('small').textContent"));
    controlla(await ev("!document.body.classList.contains('browsing')"), 'una ricerca senza browser non apre il pannello del browser');
    await foto('ricerca-web');
    const olo = await attendi(() => ev("document.body.classList.contains('olo')"), 8000);
    const f0 = await ev('window.__misure.fotogrammi'); await pausa(1000);
    controlla(olo && !(await ev("document.querySelector('.holo-card') !== null")) && (await ev('window.__misure.ologramma')),
      "con l'ologramma aperto l'HUD lascia il posto a Blender: niente scheda nell'HUD, e la misura lo sa");
    await attendi(async () => (await modo()) === 'idle', 12000);
    await tasto('Escape', 'Escape', 27); await pausa(1500);
    controlla(OLO.stato().aperto === false && !(await ev("document.body.classList.contains('olo')")), "Esc chiude l'ologramma anche nello stato del server finto", `fotogrammi contati ${f0}`);
  }
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
  console.log(`${fatte.length} foto in ${USCITA}; controlli: ${controlli - falliti} PASS, ${falliti} FAIL`);
  process.exit(codice);
}
