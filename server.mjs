// STEM — server locale: HUD, cervello (Claude Code sempre acceso), voce, browser (Playwright MCP), controllo del Mac.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBrain } from './brain.mjs';
import { createVoice } from './voice.mjs';
import { createMedia } from './media.mjs';
import { agenda, adesso, quandoIt, traQuanto } from './orologio.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(ROOT, 'runtime');
fs.mkdirSync(RUNTIME, { recursive: true });

// .env minimale: CHIAVE=valore, una per riga
const env = { ...process.env };
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(env.STEM_PORT || 4321);
const PW_PORT = Number(env.STEM_BROWSER_PORT || 8931);
const ELEVEN_KEY = env.ELEVENLABS_API_KEY || '';
let VOICE_ID = env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // George, finché non trovo una voce italiana
const VOICE_MODEL = env.ELEVENLABS_MODEL || 'eleven_v4_turbo'; // il più veloce ed emotivo, mezzo credito a carattere
// Opus 5.5 a effort medium. L'effort va scelto qui: se no il cervello eredita quello di Claude Code di Tony (xhigh, per programmare),
// e misurato il 5/11 (prove/latenza.mjs) xhigh tace fino a 10 s prima della prima parola, medium circa 2,3 s, Sonnet 0,8 s.
const MODEL = env.STEM_MODEL || 'claude-opus-5-5';
const EFFORT = env.STEM_EFFORT || 'medium';
const PERSONA = fs.readFileSync(path.join(ROOT, 'stem-persona.md'), 'utf8');

// File del Mac: STEM legge, crea e modifica solo nelle cartelle dei documenti. Fuori restano i file nascosti (.ssh, .config…),
// la Libreria (portachiavi, cookie) e la cartella di STEM (chiave, profili). Niente Terminale.
const HOME = process.env.HOME;
const FILE_DIRS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library/Mobile Documents/com~apple~CloudDocs']
  .map((d) => path.join(HOME, d)).filter((d) => fs.existsSync(d));
// Cartella di lavoro del cervello: vuota e FUORI dalla repository, così STEM ha una memoria sua
// e non mescola i suoi ricordi con quelli delle sessioni di sviluppo (prima condividevano ~/STEM)
const BRAIN = path.join(HOME, 'Library', 'Application Support', 'STEM', 'cervello');
fs.mkdirSync(BRAIN, { recursive: true });

// --- Finestre: HUD a sinistra, Google a destra ---
const CHROME = env.STEM_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = Number(env.STEM_CDP_PORT || 9333);
const launched = []; // Chrome avviati da STEM, da chiudere all'uscita
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchChrome(args) {
  const p = spawn(CHROME, ['--no-first-run', '--no-default-browser-check', ...args], { stdio: 'ignore', detached: true });
  p.on('error', (e) => console.error(`[chrome] ${e.message}`));
  launched.push(p);
}

async function cdpAlive() {
  try { return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

// La finestra di Google è un Chrome dedicato che resta aperto tra una domanda e l'altra:
// Playwright ci si collega via CDP invece di lanciarne (e chiuderne) uno a ogni risposta.
let browserPending = null; // un solo avvio alla volta, anche con due domande ravvicinate
function ensureBrowserWindow() {
  return (browserPending ??= openBrowserWindow().finally(() => { browserPending = null; }));
}
async function openBrowserWindow() {
  if (await cdpAlive()) { startScreencast(); return true; }
  launchChrome([`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(RUNTIME, 'browser-profile')}`,
    // dietro all'HUD a schermo intero la finestra è coperta: senza questi Chrome smetterebbe di disegnarla
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--window-size=1280,900', 'about:blank']);
  for (let i = 0; i < 40; i++) { if (await cdpAlive()) { startScreencast(); return true; } await sleep(250); }
  console.error('[chrome] la finestra di Google non risponde');
  return false;
}

// --- La pagina di Google dentro l'HUD: screencast CDP inoltrato come MJPEG su /api/screen ---
const screenClients = new Set();
let lastFrame = null, castWs = null;
function writeFrame(res, jpg) {
  if (res.writableLength > 2e6) return; // conta solo l'ultimo fotogramma
  res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
  res.write(jpg); res.write('\r\n');
}
async function startScreencast() {
  if (castWs) return;
  let info;
  try { info = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch { return; }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  castWs = ws;
  let id = 0, session = null, castTarget = null;
  const pages = new Map(); // targetId -> url
  const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, ...(sessionId && { sessionId }) }));
  const attach = (targetId) => { castTarget = targetId; session = null; send('Target.attachToTarget', { targetId, flatten: true }); };
  ws.addEventListener('open', () => send('Target.setDiscoverTargets', { discover: true }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') {
      const t = m.params.targetInfo;
      if (t.type !== 'page' || t.url.startsWith('devtools:')) return;
      // Una sola pagina: una scheda aperta da un'altra (link _blank, window.open, form…) viene chiusa
      // e il suo indirizzo riaperto nella scheda principale. Le pagine di Playwright non hanno opener: restano.
      if (t.openerId && castTarget && t.targetId !== castTarget) {
        if (t.url && t.url !== 'about:blank') {
          if (session) send('Page.navigate', { url: t.url }, session);
          send('Target.closeTarget', { targetId: t.targetId });
        } else if (m.method === 'Target.targetCreated') {
          setTimeout(() => send('Target.closeTarget', { targetId: t.targetId }), 3000); // popup vuoto: lo chiudo comunque
        }
        return;
      }
      if (t.targetId === castTarget && t.url !== pages.get(t.targetId)) {
        try { const host = new URL(t.url).hostname.replace(/^www\./, ''); if (host) brain.notify({ t: 'page', detail: host }); } catch {}
      }
      pages.set(t.targetId, t.url);
      if (!castTarget) attach(t.targetId);
    } else if (m.method === 'Target.targetDestroyed') {
      pages.delete(m.params.targetId);
      if (m.params.targetId === castTarget) { castTarget = null; const next = pages.keys().next().value; if (next) attach(next); }
    } else if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.targetId === castTarget) {
      session = m.params.sessionId;
      send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 1000 }, session);
    } else if (m.method === 'Page.screencastFrame' && m.sessionId === session) {
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, session);
      lastFrame = Buffer.from(m.params.data, 'base64');
      for (const res of screenClients) writeFrame(res, lastFrame);
    }
  });
  ws.addEventListener('close', () => { if (castWs === ws) castWs = null; });
  ws.addEventListener('error', () => {});
}

// --- Browser: Playwright MCP sempre acceso, collegato alla finestra di Google ---
const MCP_CONFIG = path.join(RUNTIME, 'mcp.json');
const MAC_MCP = path.join(ROOT, 'mac', 'mac-mcp.mjs');
fs.writeFileSync(MCP_CONFIG, JSON.stringify({
  mcpServers: {
    playwright: { type: 'http', url: `http://localhost:${PW_PORT}/mcp` },
    ...(fs.existsSync(MAC_MCP) && { mac: { command: process.execPath, args: [MAC_MCP] } }), // app, schermo, mouse e tastiera
  },
}));
const browser = spawn('npx', [
  '-y', '@playwright/mcp@0.0.83',
  '--port', String(PW_PORT),
  '--cdp-endpoint', `http://127.0.0.1:${CDP_PORT}`,
  '--init-script', path.join(ROOT, 'browser-fx.js'), // mirino e clic futuristici, tutto nella stessa scheda
], { cwd: RUNTIME, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let browserReady = false;
const watchBrowser = (d) => { if (String(d).includes('Listening')) browserReady = true; };
browser.stdout.on('data', watchBrowser);
browser.stderr.on('data', (d) => { watchBrowser(d); if (!browserReady || /error/i.test(d)) process.stderr.write(`[browser] ${d}`); });
browser.on('exit', (code) => { browserReady = false; console.error(`[browser] uscito (${code})`); });

// --- Cervello: un processo sempre acceso (brain.mjs) ---
const brain = createBrain({
  cwd: BRAIN,
  sessionFile: path.join(RUNTIME, 'cervello.json'), // quale conversazione riprendere dopo un riavvio
  onLog: (l) => { console.error(l); },
  args: [
    '--append-system-prompt', PERSONA,
    '--tools', 'Read,Write,Edit,Glob,Grep',
    '--add-dir', ...FILE_DIRS,
    '--mcp-config', MCP_CONFIG, '--strict-mcp-config',
    '--allowedTools', 'mcp__playwright', 'mcp__mac',
    '--disallowedTools', 'mcp__playwright__browser_tabs', // una sola pagina: niente schede nuove
    '--permission-mode', 'acceptEdits',    // modifiche approvate da sole, ma solo dentro FILE_DIRS
    '--permission-prompts', 'none',        // tutto il resto (fuori dalle cartelle) è negato senza chiedere
    ...(MODEL !== 'default' ? ['--model', MODEL] : []),
    ...(EFFORT !== 'default' ? ['--effort', EFFORT] : []),
  ],
});
const media = createMedia({ giphyKey: env.GIPHY_API_KEY || '', onLog: (l) => console.error(l) });

// --- Voce ---
// Senza ELEVENLABS_VOICE_ID scelgo da solo una voce maschile italiana tra quelle del tuo account
async function pickVoice() {
  if (!ELEVEN_KEY || env.ELEVENLABS_VOICE_ID) return;
  try {
    const r = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', { headers: { 'xi-api-key': ELEVEN_KEY } });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}`);
    const { voices = [] } = await r.json();
    // Col piano gratuito l'API rifiuta le voci della Voice Library (errore 402): restano quelle incluse o tue
    const sub = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': ELEVEN_KEY } })
      .then((x) => x.json()).catch(() => ({}));
    const usable = (v) => sub.tier !== 'free' || ['premade', 'cloned', 'generated'].includes(v.category);
    const italian = (v) => /ital/i.test(`${v.labels?.accent} ${v.labels?.language} ${v.description}`)
      || (v.verified_languages || []).some((l) => l.language === 'it' && (!l.accent || /ital|standard/i.test(l.accent)));
    const male = (v) => /male/i.test(v.labels?.gender || '') && !/female/i.test(v.labels?.gender || '');
    const v = voices.find((x) => usable(x) && italian(x) && male(x));
    if (v) { VOICE_ID = v.voice_id; console.log(`Voce: ${v.name}`); }
    else if (sub.tier === 'free') console.log('Piano gratuito: le voci maschili italiane della Voice Library richiedono un piano a pagamento. Uso George.');
    else console.log('Nessuna voce maschile italiana nel tuo account ElevenLabs: uso George. Aggiungine una dalla Voice Library.');
  } catch (e) { console.error(`[voce] ${e.message}`); }
}
pickVoice();
// Se passi a un piano a pagamento le voci italiane della Voice Library diventano usabili: ricontrollo ogni 10 minuti
setInterval(() => { if (VOICE_ID === 'JBFqnCBsd6RMkjVDRZzb') pickVoice(); }, 10 * 60 * 1000).unref();

const voice = createVoice({ key: ELEVEN_KEY, voiceId: () => VOICE_ID, model: VOICE_MODEL, macVoice: env.STEM_MAC_VOICE, onLog: (l) => console.error(l) });

// --- Registro dell'ascolto (runtime/ascolto.log, ultime 300 righe) ---
const LOG_FILE = path.join(RUNTIME, 'ascolto.log');
function appendLog(line) {
  const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean) : [];
  old.push(`${new Date().toLocaleString('it-IT')}  ${line}`);
  fs.writeFileSync(LOG_FILE, old.slice(-300).join('\n') + '\n');
}

// Stato dell'ascolto dell'HUD nel registro: solo quando cambia, e il microfono solo se passa da silenzio a suono o viceversa
let lastHud = '', silentPolls = 0, micState = '';
function noteHud(q) {
  const st = `ascolto=${q.get('ear')} lucchetto=${q.get('lock')} riconoscimento=${q.get('rec')} modo=${q.get('mode')}`;
  if (st !== lastHud) { appendLog(`HUD: ${st}`); lastHud = st; }
  const mic = Number(q.get('mic') || 0);
  silentPolls = mic < 0.002 ? silentPolls + 1 : 0;
  const now = silentPolls >= 6 ? 'muto' : mic >= 0.002 ? 'sente' : micState;
  if (now !== micState) { appendLog(now === 'muto' ? 'microfono: silenzio totale da 30 s (nessun segnale)' : `microfono: arriva suono (picco ${mic.toFixed(3)})`); micState = now; }
}

// --- Agenda: i compiti che il cervello si è segnato con «ricorda» (orologio.mjs) ---
// L'HUD chiede /api/status ogni 5 s: quando un compito è arrivato all'ora e STEM è fermo, chiede /api/ask con agenda:true
// e STEM parla per primo. Il messaggio contiene tutto il compito, perché dopo un riavvio il cervello non ricorda di averlo segnato.
function agendaText(due) {
  const now = Date.now();
  const righe = due.map((x) => {
    const tardi = now - x.quando > 2 * 60_000
      ? `, in ritardo di ${traQuanto(x.quando - now).replace(/ fa$/, '')} perché STEM era spento o il Mac in stop` : '';
    return `- per ${quandoIt(x.quando, now)}${tardi}: ${x.cosa}`;
  });
  const quali = due.length === 1 ? 'un compito che ti eri segnato' : 'alcuni compiti che ti eri segnato';
  return `[agenda] È l'ora di ${quali}. Tony non ha detto niente: parli tu per primo.\n${righe.join('\n')}`;
}

// --- Memoria: dopo 3 minuti di silenzio, o appena l'HUD si chiude, il cervello rilegge la conversazione e salva quello che vale ---
// Da solo salvava quasi niente (3 ricordi in 184 domande, al 1/11): chiederglielo al momento giusto è il meccanismo.
const MEMORY_TEXT = `[memoria] Tony non sta parlando: è il momento di fare memoria, e quello che scrivi adesso non viene letto ad alta voce.
Rileggi la conversazione da dove eri arrivato l'ultima volta che hai fatto memoria, e salva nella tua memoria quello che ti servirà nelle prossime conversazioni:
- le persone: chi sono per Tony e come si chiamano nelle sue app (per esempio il nome del contatto su WhatsApp);
- i gusti e le abitudini di Tony: film e serie già visti o che non gli piacciono, i posti, gli orari, come vuole le risposte;
- le correzioni: dove hai sbagliato e che cosa voleva invece.
Solo quello che varrà ancora tra un mese, niente cose di un giorno solo. Niente salute, soldi, password o fatti privati di altre persone, a meno che Tony non ti abbia chiesto di ricordarli. Se un ricordo c'è già, aggiornalo invece di farne un doppione. Se non c'è niente di nuovo, non scrivere niente.
Alla fine rispondi solo: fatto.`;
let memoryDue = false, memoryBusy = false, memoryTimer = 0;
function conversationTurn() { memoryDue = true; clearTimeout(memoryTimer); memoryTimer = setTimeout(rememberNow, 3 * 60_000); }
async function rememberNow() {
  clearTimeout(memoryTimer);
  if (!memoryDue || memoryBusy || brain.busy) return; // se sta lavorando, la fine di quel turno riarma l'attesa
  memoryDue = false; memoryBusy = true;
  console.error('[memoria] rileggo la conversazione');
  await brain.ask(`[adesso: ${adesso()}]\n${MEMORY_TEXT}`, () => {}); // nessuno ascolta: niente voce. Una domanda di Tony la interrompe
  memoryBusy = false;
}

// --- Avviato dall'app STEM (in background): quando chiudi l'HUD, STEM si spegne da solo ---
let hudSeen = 0, hudMissed = 0, hudOpening = false;
if (env.STEM_APP) {
  setInterval(() => { // 15 giri da 10 s senza notizie dall'HUD: è chiuso
    hudMissed++;
    if (hudMissed >= 2) rememberNow(); // 20 s senza HUD: la conversazione è finita, faccio memoria (anche di un compito che finisce dopo)
    const memoryPending = memoryBusy || memoryDue;
    if (hudMissed >= 15 && (!memoryPending || hudMissed >= 30)) { console.log('HUD chiuso: spengo STEM'); process.exit(0); } // aspetto la memoria, ma non più di 5 minuti
  }, 10000);
}

// --- HTTP ---
const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.headers.host !== `localhost:${PORT}` && req.headers.host !== `127.0.0.1:${PORT}`) return res.writeHead(403).end(); // niente DNS rebinding

  if (req.method === 'GET' && p === '/') return serveFile(res, path.join(ROOT, 'public', 'index.html'));
  if (req.method === 'GET' && p.startsWith('/three/')) {
    const f = path.normalize(path.join(ROOT, 'node_modules', 'three', p.slice(7)));
    if (!f.startsWith(path.join(ROOT, 'node_modules', 'three'))) return res.writeHead(403).end();
    return serveFile(res, f);
  }
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    const f = path.normalize(path.join(ROOT, 'public', p));
    if (!f.startsWith(path.join(ROOT, 'public'))) return res.writeHead(403).end();
    return serveFile(res, f);
  }

  // Le POST accettano solo l'HUD: una pagina web qualsiasi non deve poter comandare STEM
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
    if (!sameOrigin || !String(req.headers['content-type'] || '').startsWith('application/json')) return res.writeHead(403).end();
  }

  if (req.method === 'GET' && p === '/api/screen') {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return res.writeHead(403).end();
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store' });
    screenClients.add(res);
    if (lastFrame) writeFrame(res, lastFrame);
    res.on('close', () => screenClients.delete(res));
    return;
  }

  if (req.method === 'POST' && p === '/api/log') { // diagnostica di «Stem», solo locale
    const { line } = await readBody(req);
    if (line) appendLog(String(line).slice(0, 200));
    return res.writeHead(204).end();
  }

  if (p === '/api/status') {
    if (url.searchParams.has('hud')) { hudSeen = Date.now(); hudMissed = 0; noteHud(url.searchParams); }
    return res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ voice: voice.status, browser: browserReady, gifs: media.gifs, agenda: agenda.due().length }));
  }

  if (req.method === 'POST' && p === '/api/ask') {
    const body = await readBody(req);
    let text = String(body.text || '').trim();
    if (body.agenda) { // li tolgo dall'agenda subito: un secondo HUD, o il giro dopo, non li ripete
      const due = agenda.due();
      if (!due.length) return res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(JSON.stringify({ t: 'done' }) + '\n');
      agenda.remove(due.map((x) => x.id));
      console.error(`[agenda] parlo per primo: ${due.length} ${due.length === 1 ? 'compito' : 'compiti'}`);
      text = agendaText(due);
    }
    if (!text) return res.writeHead(400).end();
    text = `[adesso: ${adesso()}]\n${text}`; // l'ora a ogni domanda: Claude Code gli dà solo la data
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
    let open = true, pending = 0, finished = false;
    const write = (ev) => { if (open) res.write(JSON.stringify(ev) + '\n'); };
    const close = () => { if (open && finished && !pending) { res.end(JSON.stringify({ t: 'done' }) + '\n'); open = false; } };
    res.on('close', () => { open = false; });
    ensureBrowserWindow(); // se Tony ha chiuso la finestra di Google, la riapro (non blocca la risposta)
    let ignored = false;
    await brain.ask(text, (ev) => {
      if (ev.t === 'ignore') ignored = true;
      if (ev.t !== 'media') return write(ev);
      pending++; // GIF e animazioni: le cerco mentre STEM parla, arrivano quando sono pronte
      media.find(ev.kind, ev.q).then((m) => { if (m) write({ t: 'media', kind: ev.kind, ...m }); }).finally(() => { pending--; close(); });
    });
    finished = true; close();
    if (!ignored) conversationTurn(); // una frase non per STEM non è conversazione: niente memoria da fare
    return;
  }

  if (req.method === 'POST' && p === '/api/hud') { // l'app STEM, se STEM è già acceso, riapre l'HUD solo se non ce n'è uno
    if (!hudOpening && Date.now() - hudSeen > 12000) openHud();
    return res.writeHead(204).end();
  }

  if (req.method === 'POST' && p === '/api/stop') {
    brain.stop();
    return res.writeHead(204).end();
  }

  if (req.method === 'POST' && p === '/api/reset') { // nuova conversazione: il cervello riparte da zero
    brain.kill(true);
    return res.writeHead(204).end();
  }

  if (req.method === 'POST' && p === '/api/tts') { // sempre audio vero: ElevenLabs o voce del Mac, mai mescolate in una risposta
    const { text, answer } = await readBody(req);
    try {
      const a = await voice.speak(String(text || '').slice(0, 2000), String(answer || 'x'));
      return res.writeHead(200, { 'content-type': a.type, 'x-stem-voce': a.provider + (a.switched ? ';cambio' : '') }).end(a.data);
    } catch (e) {
      console.error(`[voce] ${e.message}`);
      return res.writeHead(502).end();
    }
  }

  res.writeHead(404).end();
});

server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Porta ${PORT} occupata: STEM è già acceso, riapro il suo HUD.`);
  await fetch(`http://127.0.0.1:${PORT}/api/hud`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`STEM online su http://localhost:${PORT}`);
  if (!ELEVEN_KEY) console.log('Voce ElevenLabs spenta: manca ELEVENLABS_API_KEY in .env (uso la voce del Mac).');
  if (env.STEM_NO_OPEN) return;
  // Prima il Chrome di Google, poi l'HUD: l'ultima finestra aperta prende il fuoco, e deve essere l'HUD a schermo intero
  hudOpening = true; // anche mentre aspetto Chrome: un secondo clic sull'app non apre un altro HUD
  ensureBrowserWindow().finally(openHud);
});

// HUD in una finestra-app sua, a schermo intero: profilo separato, audio libero di partire anche senza un clic
function openHud() {
  hudOpening = true;
  setTimeout(() => { hudOpening = false; }, 15000);
  launchChrome([`--user-data-dir=${path.join(RUNTIME, 'hud-profile')}`, `--app=http://localhost:${PORT}`, '--start-fullscreen',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows']);
}

// All'uscita, per qualunque motivo (Ctrl-C, finestra del Terminale chiusa, crash), spengo tutto quello che ho acceso
process.on('exit', () => {
  brain.kill();
  for (const p of [browser, ...launched]) { try { process.kill(-p.pid, 'SIGTERM'); } catch {} } // npx, server e Chrome di STEM
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
