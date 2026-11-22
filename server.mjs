// Nexus — server locale: HUD, cervello (Claude Code sempre acceso), voce, browser (Playwright MCP), controllo del Mac.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createBrain } from './brain.mjs';
import { createVoice } from './voice.mjs';
import { createMedia } from './media.mjs';
import { agenda, adesso, quandoIt, traQuanto } from './orologio.mjs';
import { createOlogramma } from './ologramma.mjs';
import { createMeteo } from './meteo.mjs';
import { calcolaInWorker } from './fisica/struttura.mjs';
import { MODELLO_MANI } from './public/ologramma/mani.js';
import { testoMisure } from './public/ologramma/gesti.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.join(ROOT, 'runtime');
fs.mkdirSync(RUNTIME, { recursive: true });

// .env minimale: CHIAVE=valore, una per riga. Le variabili date a mano vincono: una prova con NEXUS_PORT=4422
// non deve finire sulla porta del Nexus vero perché .env dice 4321.
const env = { ...process.env };
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
// NEXUS_CERVELLO (solo per le prove): un Nexus di prova che vive tutto in quella cartella. Il cervello ci lavora, il server
// ci scrive i suoi file (conversazione, mcp.json, ologramma, ascolto.log) e le cartelle dei documenti sono le sue
// sottocartelle: così una prova non scrive nella memoria vera, non riprende la sua conversazione e non legge i file di Tony.
const PROVA = env.NEXUS_CERVELLO ? path.resolve(env.NEXUS_CERVELLO) : null;
const STATO = PROVA || RUNTIME;
if (PROVA) fs.mkdirSync(PROVA, { recursive: true });

const PORT = Number(env.NEXUS_PORT || 4321);
const PW_PORT = Number(env.NEXUS_BROWSER_PORT || 8931);
// Sonnet 5.5, scelta di Tony del 12/11. Due effort, chiesti da Tony lo stesso giorno: low per la voce (prima parola in
// 0,6–0,7 s di mediana), high per i compiti che il cervello annuncia con [[pensa]]: ologrammi, ricerche a più passaggi,
// report, sforzi. Le misure di prove/latenza.mjs stanno nel CLAUDE.md. L'effort va scelto qui: se no il cervello eredita
// quello di Claude Code di Tony (per programmare).
const MODEL = env.NEXUS_MODEL || 'claude-sonnet-5-5';
const EFFORT = env.NEXUS_EFFORT || 'low';
const EFFORT_PENSA = env.NEXUS_EFFORT_PENSA || 'high';
const effortDi = (e) => (e === 'default' ? undefined : e);
// La riga [sentito: …] che precede ogni frase di Tony: perché l'HUD l'ha fatta passare (nexus.js, addressed)
const SENTITO = { nome: 'col nome', conversazione: 'senza nome, cominciata nei 15 secondi dopo che hai finito di parlare' };
// Il secondo tempo di un compito annunciato con [[pensa]]: lo stesso turno di Tony, con l'effort alto
const PENSA_TEXT = '[pensa] Adesso hai più tempo per ragionare: fai il compito che hai appena annunciato, senza ripetere la frase che hai già detto.';
// Il giro di confronto (richiesta di Tony del 17/11): con le foto vere accanto alla foto dell'HUD il cervello diceva «fatto,
// stilizzate» senza correggere niente (prova sulle AirPods). Uno solo, dopo la prima vista, come il [pensa]
const CONFRONTO_TEXT = '[confronto] Prima di chiudere, rimetti a confronto la foto dell\'HUD con le foto vere che ti ha dato mcp__mac__mostra_ologramma: ' +
  'forma, proporzioni, curve, pezzi mancanti o fuori posto. Trova le tre differenze più grandi e correggi le due più grandi, rifacendo i pezzi con ' +
  'mcp__mac__costruisci_in_blender e aggiornandoli con mcp__mac__modifica_ologramma. Se l\'oggetto ha un dentro, guardalo anche in raggi-x contro la foto «dentro». ' +
  'Poi di\' a Tony in una frase cosa hai corretto, senza ripetere quello che hai già detto.';
const PERSONA = fs.readFileSync(path.join(ROOT, 'nexus-persona.md'), 'utf8');

// File del Mac: Nexus legge, crea e modifica solo nelle cartelle dei documenti. Fuori restano i file nascosti (.ssh, .config…),
// la Libreria (portachiavi, cookie) e la cartella del progetto (chiave, profili). Niente Terminale.
const HOME = process.env.HOME;
const FILE_DIRS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Library/Mobile Documents/com~apple~CloudDocs']
  .map((d) => path.join(PROVA || HOME, d)).filter((d) => fs.existsSync(d));
const DOCUMENTI = path.join(PROVA || HOME, 'Documents');
// Cartella di lavoro del cervello: vuota e FUORI dalla repository, così Nexus ha una memoria sua
// e non mescola i suoi ricordi con quelli delle sessioni di sviluppo (prima condividevano ~/STEM)
const BRAIN = PROVA || path.join(HOME, 'Library', 'Application Support', 'Nexus', 'cervello');
fs.mkdirSync(BRAIN, { recursive: true });

// --- Finestre: HUD a sinistra, Google a destra ---
const CHROME = env.NEXUS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = Number(env.NEXUS_CDP_PORT || 9333);
const launched = []; // Chrome avviati da Nexus, da chiudere all'uscita
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
const MCP_CONFIG = path.join(STATO, 'mcp.json');
const MAC_MCP = path.join(ROOT, 'mac', 'mac-mcp.mjs');
fs.writeFileSync(MCP_CONFIG, JSON.stringify({
  mcpServers: {
    playwright: { type: 'http', url: `http://localhost:${PW_PORT}/mcp` },
    // app, schermo, mouse, tastiera e ologrammi; la porta dagli argomenti, perché .env non arriva ai processi figli
    // --blender: dove costruisci_in_blender scrive i GLB, dentro Documenti perché l'HUD apre i file solo dalle cartelle di Tony
    ...(fs.existsSync(MAC_MCP) && { mac: { command: process.execPath, args: [MAC_MCP, '--porta', String(PORT),
      ...(FILE_DIRS.includes(DOCUMENTI) ? ['--blender', path.join(DOCUMENTI, 'Nexus-Blender')] : [])] } }),
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
  effort: effortDi(EFFORT),
  sessionFile: path.join(STATO, 'cervello.json'), // quale conversazione riprendere dopo un riavvio
  impronta: createHash('sha256').update(PERSONA).digest('hex').slice(0, 16), // persona cambiata: conversazione nuova
  onLog: (l) => { console.error(l); },
  args: [
    '--append-system-prompt', PERSONA,
    // WebSearch e WebFetch: per sapere com'è fatto un oggetto vero prima di costruirne l'ologramma. Non passano dal browser
    // a vista, che alla quarta azione apre il pannello e chiude l'ologramma, e più ricerche partono nella stessa mossa.
    '--tools', 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch',
    ...(FILE_DIRS.length ? ['--add-dir', ...FILE_DIRS] : []), // vuoto, --add-dir si prenderebbe l'opzione dopo
    '--mcp-config', MCP_CONFIG, '--strict-mcp-config',
    '--allowedTools', 'mcp__playwright', 'mcp__mac', 'WebSearch', 'WebFetch',
    '--disallowedTools', 'mcp__playwright__browser_tabs', // una sola pagina: niente schede nuove
    '--permission-mode', 'acceptEdits',    // modifiche approvate da sole, ma solo dentro FILE_DIRS
    '--permission-prompts', 'none',        // tutto il resto (fuori dalle cartelle) è negato senza chiedere
    ...(MODEL !== 'default' ? ['--model', MODEL] : []),
    ...(EFFORT !== 'default' ? ['--effort', EFFORT] : []),
  ],
});
const media = createMedia({ giphyKey: env.GIPHY_API_KEY || '', onLog: (l) => console.error(l) });

// --- Voce: Kokoro sul Mac (voice.mjs, voce-kokoro.py), la voce del Mac se Kokoro non c'è ---
const voice = createVoice({ cartella: path.join(RUNTIME, 'kokoro'), script: path.join(ROOT, 'voce-kokoro.py'),
  voce: env.NEXUS_VOCE || 'im_nicola', velocita: Number(env.NEXUS_VOCE_VELOCITA) || 1, macVoice: env.NEXUS_MAC_VOICE, onLog: (l) => console.error(l) });

// --- Registro dell'ascolto (runtime/ascolto.log, ultime 300 righe) ---
const LOG_FILE = path.join(STATO, 'ascolto.log');
function appendLog(line) {
  const old = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean) : [];
  old.push(`${new Date().toLocaleString('it-IT')}  ${line}`);
  fs.writeFileSync(LOG_FILE, old.slice(-300).join('\n') + '\n');
}

// Stato dell'ascolto dell'HUD nel registro: solo quando cambia, e il microfono solo se passa da silenzio a suono o viceversa.
// Il riconoscitore no: Chrome lo chiude dopo qualche secondo di silenzio e l'HUD lo riapre, e quel via e vai era 133 righe
// su 300 (registro al 19/11), cioè la storia ridotta a poche ore.
let lastHud = '', silentPolls = 0, micState = '';
function noteHud(q) {
  const st = `ascolto=${q.get('ear')} lucchetto=${q.get('lock')} modo=${q.get('mode')}`;
  if (st !== lastHud) { appendLog(`HUD: ${st}`); lastHud = st; }
  const mic = Number(q.get('mic') || 0);
  silentPolls = mic < 0.002 ? silentPolls + 1 : 0;
  const now = silentPolls >= 6 ? 'muto' : mic >= 0.002 ? 'sente' : micState;
  if (now !== micState) { appendLog(now === 'muto' ? 'microfono: silenzio totale da 30 s (nessun segnale)' : `microfono: arriva suono (picco ${mic.toFixed(3)})`); micState = now; }
}

// --- Agenda: i compiti che il cervello si è segnato con «ricorda» (orologio.mjs) ---
// L'HUD chiede /api/status ogni 5 s: quando un compito è arrivato all'ora e Nexus è fermo, chiede /api/ask con agenda:true
// e Nexus parla per primo. Il messaggio contiene tutto il compito, perché dopo un riavvio il cervello non ricorda di averlo segnato.
function agendaText(due) {
  const now = Date.now();
  const righe = due.map((x) => {
    const tardi = now - x.quando > 2 * 60_000
      ? `, in ritardo di ${traQuanto(x.quando - now).replace(/ fa$/, '')} perché eri spento o il Mac era in stop` : ''; // al cervello, che lo può ripetere a voce: niente nome
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
  // nessuno ascolta: niente voce, e niente fretta, quindi l'effort alto. Una domanda di Tony la interrompe
  await brain.ask(`[adesso: ${adesso()}]\n${MEMORY_TEXT}`, () => {}, { effort: effortDi(EFFORT_PENSA) });
  memoryBusy = false;
}

// --- Avviato dall'app Nexus (in background): quando chiudi l'HUD, Nexus si spegne da solo ---
let hudSeen = 0, hudMissed = 0, hudOpening = false;
if (env.NEXUS_APP) {
  setInterval(() => { // 15 giri da 10 s senza notizie dall'HUD: è chiuso
    hudMissed++;
    if (hudMissed >= 2) rememberNow(); // 20 s senza HUD: la conversazione è finita, faccio memoria (anche di un compito che finisce dopo)
    const memoryPending = memoryBusy || memoryDue;
    if (hudMissed >= 15 && (!memoryPending || hudMissed >= 30)) { console.log('HUD chiuso: spengo Nexus'); process.exit(0); } // aspetto la memoria, ma non più di 5 minuti
  }, 10000);
}

// --- Una domanda per il cervello (/api/ask) ---
// Il primo turno a effort basso, poi il [pensa] e il [confronto] se servono, tutto nella stessa risposta. onEvent riceve gli
// eventi del cervello; la promessa si risolve a risposta finita.
async function rispondi(text, onEvent) {
  ensureBrowserWindow(); // se Tony ha chiuso la finestra di Google, la riapro (non blocca la risposta)
  let ignored = false, pensa = false, guardato = false;
  const modelloPrima = holoOra.modello;
  const ev = (e) => {
    if (e.t === 'ignore') ignored = true;
    if (e.t === 'pensa') { pensa = true; return; }
    if (e.t === 'mac' && e.name === 'guarda_oggetto_vero') guardato = true;
    onEvent(e);
  };
  const primo = await brain.ask(text, ev, { effort: effortDi(EFFORT) });
  let interrotto = primo.interrotto;
  // [[pensa]]: il cervello ha detto la frase breve a effort basso e ha chiuso il turno. Il lavoro vero parte subito, con
  // l'effort alto, nella stessa risposta. Una volta sola, e mai se nel frattempo Tony ha chiesto altro.
  if (pensa && !ignored && !interrotto) {
    console.error('[cervello] ci penso a fondo');
    interrotto = (await brain.ask(`[adesso: ${adesso()}]\n${PENSA_TEXT}`, ev, { effort: effortDi(EFFORT_PENSA) })).interrotto;
  }
  // [confronto]: in questa risposta ha guardato l'oggetto vero e aperto un ologramma nuovo, con l'HUD acceso (senza la
  // sua foto non c'è confronto). Un giro solo, con l'effort alto, nella stessa risposta; mai dopo un'interruzione.
  if (guardato && !ignored && !interrotto && holoOra.aperto && holoOra.modello !== modelloPrima && Date.now() - hudSeen < 15_000) {
    console.error('[cervello] confronto col vero');
    await brain.ask(`[adesso: ${adesso()}]\n${CONFRONTO_TEXT}`, ev, { effort: effortDi(EFFORT_PENSA) });
  }
  if (!ignored) conversationTurn(); // una frase non per Nexus non è conversazione: niente memoria da fare
}

// --- Ologramma: lo stato sta solo qui (ologramma.mjs). Gli strumenti del cervello (mac-mcp.mjs) e l'HUD lo cambiano con
// POST /api/ologramma; l'HUD lo rilegge quando la versione cresce e manda la foto di quello che mostra.
const riassunto = (s) => ({ modello: s.modello, versione: s.versione, aperto: s.aperto, file: s.pezzi.some((x) => x.forma === 'file' && !s.tolti.includes(x.id)) });
let holoOra = { modello: 0, versione: 0, aperto: false, file: false }; // da onCambio: /api/status non copia tutto lo stato a ogni giro
const holo = createOlogramma({
  cartella: STATO,
  // 55 s, dentro i 60 che il server aspetta: il cervello riceve sempre un risultato o un errore, non «ancora in corso»
  calcola: (lavoro) => calcolaInWorker(lavoro, { timeout_s: 55 }),
  onCambio: (s) => { holoOra = riassunto(s); brain.notify({ t: 'holo', v: s.versione }); },
});
holo.carica();
holoOra = riassunto(holo.stato());
// Un ologramma rimasto aperto quando Nexus si è spento non riappare da solo all'avvio dopo: resta, chiuso, e si riapre a voce
if (holoOra.aperto) holo.esegui({ azione: 'chiudi' });

// --- Meteo (meteo.mjs): lo strumento mostra_meteo chiede qui le previsioni di un luogo; i dati vanno all'HUD dentro il turno
// del cervello (evento 'meteo') e il riassunto torna al cervello. L'HUD aperto li rilegge con GET /api/meteo ogni 5 minuti.
const meteo = createMeteo({ cartella: STATO, onLog: (l) => console.error(l) });

let holoFoto = null;          // l'ultima foto dell'HUD: { modello, versione, png } in base64
const fotoAttese = new Set(); // gli strumenti che aspettano la foto di una versione
function aspettaFoto(modello, versione, ms) {
  return new Promise((risolvi) => {
    const a = { modello, versione, risolvi: (png) => { clearTimeout(timer); fotoAttese.delete(a); risolvi(png); } };
    const timer = setTimeout(() => a.risolvi(null), ms);
    fotoAttese.add(a);
  });
}
// La foto che accompagna la risposta allo strumento, oppure la riga che dice al cervello perché non c'è.
// Un modello nuovo aspetta 8 s come i pezzi da file: l'entrata del turbofan finisce a 3,0 s, la foto arrivava a 3,1–3,3 s
// e una volta a 6,6 s, dopo i 4 s che il cervello aspettava. Dopo una modifica bastano 4 s.
async function fotoPer(versione, prima, nuovo = false) {
  const o = holoOra;
  if (!o.aperto) return {};
  if (holoFoto && holoFoto.modello === o.modello && holoFoto.versione >= versione) return { png: holoFoto.png };
  if (versione === prima) return { nota: 'Foto: nessuna nuova, perché non è cambiato niente.' };
  if (Date.now() - hudSeen > 15_000) return { nota: "Senza foto: l'HUD non è acceso, quindi non puoi vedere il risultato." };
  const s = o.file || nuovo ? 8 : 4; // i pezzi da file vanno prima scaricati e letti
  const png = await aspettaFoto(o.modello, versione, s * 1000);
  return png ? { png } : { nota: `Senza foto: l'HUD non l'ha mandata entro ${s} s.` };
}
// Un PNG vero, nei limiti del contratto: al massimo 1,5 MB e 960 px di larghezza
function pngValido(b) {
  if (!b || b.length < 33 || b.length > 1.5e6) return false;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString('latin1', 12, 16) !== 'IHDR') return false;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  return w >= 1 && w <= 960 && h >= 1 && h <= 4096;
}

// La misura delle mani nelle condizioni vere (la regola di Tony: mani solo sopra 45 fps sul suo M2), che l'HUD manda alla
// chiusura dell'ologramma o della meteo (vista: 'meteo') se le mani sono state accese almeno 10 s: la prossima sessione la legge nel registro, senza
// chiedere a Tony. Dall'HUD arrivano solo numeri, controllati qui; il testo della riga è del server.
// gesti, facoltativo (un HUD vecchio non lo manda): le misure d'uso vero di gesti.js, che servono a tarare sulle mani di
// Tony le soglie oggi non misurate. testoMisure le controlla (solo numeri finiti nei loro limiti) e ne fa il resto della riga.
// Se sono storte si scartano solo loro: gli fps servono alla regola dei 45 fps, e un campo nuovo di misure() dimenticato in
// LIMITI_MISURE non deve farli sparire dal registro per sempre (revisione dell'11/11).
function rigaMani(b) {
  const n = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const f = b.fps, gesti = testoMisure(b.gesti);
  if (!n(b.secondi, 86400) || b.secondi < 10 || !Number.isInteger(b.secondi) || f === null || typeof f !== 'object' ||
    !['mediana', 'p10', 'minimo'].every((k) => n(f[k], 1000)) || !(b.detect_ms === null || n(b.detect_ms, 1e4)) ||
    (b.prova !== undefined && typeof b.prova !== 'boolean') || (b.vista !== undefined && b.vista !== 'meteo')) return null;
  const r = Math.round; // fotogrammi contati e millisecondi interi: niente virgole che si confondono con quelle della riga
  return `[${b.vista === 'meteo' ? 'meteo' : 'ologramma'}] mani accese ${b.secondi} s${b.prova ? ' (foto di prova al posto della fotocamera)' : ''}: ` +
    `fps mediana ${r(f.mediana)}, p10 ${r(f.p10)}, minimo ${r(f.minimo)}, detect ${b.detect_ms === null ? '—' : `${r(b.detect_ms)} ms`}` +
    (gesti ?? '; misure dei gesti scartate (storte)');
}

// GET /api/ologramma/file/<modello>/<id>: solo il file di un pezzo dello stato attuale, mai un percorso scelto dall'HUD.
// Il file vero (dopo realpath) deve stare in una cartella di Tony, fuori dalle cartelle nascoste, con un'estensione 3D.
const MIME_3D = { glb: 'model/gltf-binary', stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf', ply: 'application/octet-stream' };
const FILE_3D_MAX = 200 * 2 ** 20;
const FILE_VERI = FILE_DIRS.map((d) => { try { return fs.realpathSync(d); } catch { return null; } }).filter(Boolean);
async function serviFile3D(res, p) {
  const no = (codice) => res.writeHead(codice, { 'cache-control': 'no-store' }).end();
  const m = p.match(/^\/api\/ologramma\/file\/(\d+)\/([a-z0-9][a-z0-9_-]{0,39})$/), s = holo.stato();
  const pezzo = m && Number(m[1]) === s.modello && s.pezzi.find((x) => x.id === m[2] && x.forma === 'file');
  if (!pezzo) return no(404);
  let vero, fh;
  try { vero = await fs.promises.realpath(pezzo.misure.file); } catch { return no(404); }
  const dir = FILE_VERI.find((d) => vero.startsWith(d + path.sep)), tipo = MIME_3D[path.extname(vero).slice(1).toLowerCase()];
  if (!dir || !tipo || vero.slice(dir.length + 1).split(path.sep).some((x) => x.startsWith('.'))) return no(403);
  try {
    const st = await fs.promises.stat(vero); // prima di aprire: open() su una FIFO resterebbe fermo
    if (!st.isFile()) return no(403);
    if (st.size > FILE_3D_MAX) return no(413);
    fh = await fs.promises.open(vero, 'r');
    const st2 = await fh.stat(); // lo stesso file di prima, anche se nel frattempo il percorso è cambiato
    if (!st2.isFile() || st2.size > FILE_3D_MAX) { await fh.close(); return no(403); }
    res.writeHead(200, { 'content-type': tipo, 'content-length': st2.size, 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' });
    pipeline(fh.createReadStream(), res, () => {}); // chiude il file anche se l'HUD smette di leggere
  } catch {
    await fh?.close().catch(() => {});
    if (res.headersSent) res.destroy(); else no(404);
  }
}

// --- Le mani: MediaPipe da node_modules e il modello da runtime/modelli, che non è nella repository ---
const MODELLI = path.join(RUNTIME, 'modelli');
const DA_MODELLI = ['hand_landmarker.task', 'prova-mani.jpg'];
// Se il modello manca lo scarico una volta, in background: entra in runtime/ solo se byte e SHA-256 sono quelli di mani.js
async function scaricaModelloMani() {
  const file = path.join(MODELLI, 'hand_landmarker.task'), tmp = `${file}.${process.pid}.tmp`, attesi = MODELLO_MANI.byte;
  if (fs.existsSync(file)) return;
  try {
    const r = await fetch(MODELLO_MANI.origine, { signal: AbortSignal.timeout(180_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parti = [];
    let n = 0;
    for await (const pezzo of r.body) { if ((n += pezzo.length) > attesi) break; parti.push(pezzo); }
    const dati = Buffer.concat(parti), sha = createHash('sha256').update(dati).digest('hex');
    if (n !== attesi || sha !== MODELLO_MANI.sha256) {
      console.error(`[mani] il modello scaricato non è quello atteso (${n > attesi ? 'più di ' : ''}${Math.min(n, attesi)} B su ${attesi}, ` +
        `SHA-256 ${sha.slice(0, 12)}… invece di ${MODELLO_MANI.sha256.slice(0, 12)}…): buttato`);
      return;
    }
    fs.mkdirSync(MODELLI, { recursive: true });
    fs.writeFileSync(tmp, dati);
    fs.renameSync(tmp, file);
    console.error(`[mani] modello delle mani scaricato e controllato (${n} B)`);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    console.error(`[mani] non riesco a scaricare il modello delle mani: ${e.message}`);
  }
}
scaricaModelloMani();

// --- HTTP ---
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.glb': 'model/gltf-binary', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
};
const PUBLIC = path.join(ROOT, 'public'), THREE = path.join(ROOT, 'node_modules', 'three'), MP = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');

// Le pagine di Nexus non si aprono dentro una pagina di un'altra origine: l'HUD è il telecomando di Nexus, e in un iframe di
// un sito qualsiasi partirebbe lo stesso, con microfono e fotocamera già permessi (provato l'8/11). Stessa origine sì:
// lab-mani.html mette lab-ologramma.html in un iframe.
const NIENTE_CORNICI = { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'" };
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...NIENTE_CORNICI }).end(data);
  });
}

// Il percorso di un file sotto base, o null se la richiesta prova a uscirne (il confine è path.sep: «three-x» non è «three»)
const sotto = (base, rel) => { const f = path.normalize(path.join(base, rel)); return f.startsWith(base + path.sep) ? f : null; };

// Il corpo JSON di una POST, al massimo max byte; un JSON rotto, o che non è un oggetto, vale {}: «null» faceva cadere il
// server, che lo destrutturava. Oltre il limite risponde TROPPO subito: prima req.destroy() lasciava la promessa appesa per
// sempre, perché 'end' non arrivava più.
const TROPPO = Symbol('corpo troppo grande');
function readBody(req, max) {
  return new Promise((resolve) => {
    if (Number(req.headers['content-length']) > max) return resolve(TROPPO);
    const parti = [];
    let n = 0;
    req.on('data', (d) => { if ((n += d.length) <= max) parti.push(d); else { parti.length = 0; resolve(TROPPO); } });
    req.on('end', () => {
      if (n > max) return;
      try { const v = JSON.parse(Buffer.concat(parti).toString('utf8') || '{}'); resolve(v !== null && typeof v === 'object' ? v : {}); } catch { resolve({}); }
    });
    req.on('close', () => resolve(TROPPO)); // il client se n'è andato a metà: nessuno aspetta la risposta
  });
}

const json = (res, codice, dati) => res.writeHead(codice, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(dati));
// Una pagina di un altro sito, o di un'altra porta, non deve leggere le API né scrivere nel registro con /api/status:
// i browser mandano sempre sec-fetch-site, curl e i processi locali no
const daFuori = (req) => req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (req.headers.host !== `localhost:${PORT}` && req.headers.host !== `127.0.0.1:${PORT}`) return res.writeHead(403).end(); // niente DNS rebinding
  if (/^\/(api|mediapipe|modelli)\//.test(p) && daFuori(req)) return res.writeHead(403).end(); // con ogni metodo: HEAD passerebbe senza preflight

  if (req.method === 'GET' && p === '/') return serveFile(res, path.join(PUBLIC, 'index.html'));
  if (req.method === 'GET' && p.startsWith('/modelli/')) { // solo i due file delle mani, mai il resto di runtime/
    const nome = p.slice(9);
    return DA_MODELLI.includes(nome) ? serveFile(res, path.join(MODELLI, nome)) : res.writeHead(404).end();
  }
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    const f = p.startsWith('/three/') ? sotto(THREE, p.slice(7)) : p.startsWith('/mediapipe/') ? sotto(MP, p.slice(11)) : sotto(PUBLIC, p);
    return f ? serveFile(res, f) : res.writeHead(403).end();
  }

  // Le POST accettano solo l'HUD e i processi locali: una pagina web qualsiasi non deve poter comandare Nexus
  let body = {};
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
    if (!sameOrigin || !String(req.headers['content-type'] || '').startsWith('application/json')) return res.writeHead(403).end();
    body = await readBody(req, p === '/api/ologramma/foto' ? 2 * 2 ** 20 : p === '/api/ologramma' ? 2 ** 20 : 1e5);
    if (body === TROPPO) return res.writeHead(413).end(); // il resto del corpo lo legge e lo butta Node: niente reset a metà risposta
  }

  if (req.method === 'GET' && p === '/api/screen') {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store' });
    screenClients.add(res);
    if (lastFrame) writeFrame(res, lastFrame);
    res.on('close', () => screenClients.delete(res));
    return;
  }

  if (req.method === 'POST' && p === '/api/log') { // diagnostica di «Nexus», solo locale
    const { line } = body;
    if (line) appendLog(String(line).slice(0, 200));
    return res.writeHead(204).end();
  }

  if (p === '/api/status') {
    if (url.searchParams.has('hud')) { hudSeen = Date.now(); hudMissed = 0; noteHud(url.searchParams); }
    return res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ voice: voice.status, browser: browserReady, gifs: media.gifs, agenda: agenda.due().length, ologramma: holoOra.versione }));
  }

  if (req.method === 'GET' && p === '/api/ologramma') return json(res, 200, holo.stato());

  if (req.method === 'POST' && p === '/api/ologramma') {
    // L'HUD è un browser e manda sempre origin e sec-fetch-site, che una pagina non può togliere; il processo MCP del
    // cervello non li manda. Così dall'HUD passano solo togli, rimetti e chiudi (lo decide ologramma.mjs), più la misura.
    const daHud = Boolean(req.headers.origin || req.headers['sec-fetch-site']);
    if (daHud && body.azione === 'misura') { // gli fps con le mani, alla chiusura dell'ologramma: una riga nel registro
      const riga = rigaMani(body);
      if (!riga) return json(res, 400, { ok: false, errori: ['misura: servono solo numeri, nei loro limiti'] });
      console.error(riga);
      return res.writeHead(204).end();
    }
    const prima = holoOra.versione, r = holo.esegui(body, { daHud });
    if (!r.ok) return json(res, r.codice, { ok: false, errori: r.errori, ...(r.codice === 409 && { stato: holo.stato() }) });
    if (daHud) return json(res, 200, { ok: true, versione: r.versione });
    let fine = r, timer = 0;
    if (r.attesa) { // prima la fine del calcolo, poi la foto della versione che ne esce
      fine = (await Promise.race([r.attesa, new Promise((ok) => { timer = setTimeout(ok, 60_000, null); })]))
        ?? { ...r, testo: `${r.testo}\nDopo 60 s il calcolo non è ancora finito: fra poco i numeri li dà modifica_ologramma senza campi.` };
      clearTimeout(timer);
    }
    const { png, nota } = await fotoPer(fine.versione, prima, body.azione === 'mostra');
    return json(res, 200, { ok: true, versione: fine.versione, testo: nota ? `${fine.testo}\n${nota}` : fine.testo, ...(png && { foto: png }) });
  }

  if (req.method === 'POST' && p === '/api/ologramma/foto') { // dall'HUD, dopo aver mostrato una versione nuova
    const { modello, versione, png } = body, o = holoOra;
    if (!o.aperto || modello !== o.modello || versione !== o.versione) return json(res, 409, { ok: false, errori: ['la foto non è della versione attuale: rileggi lo stato'] });
    const b = typeof png === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(png) ? Buffer.from(png, 'base64') : null;
    if (!pngValido(b)) return json(res, 400, { ok: false, errori: ['serve un PNG in base64, largo al massimo 960 px e grande al massimo 1,5 MB'] });
    holoFoto = { modello, versione, png: b.toString('base64') };
    for (const a of fotoAttese) if (a.modello === modello && a.versione <= versione) a.risolvi(holoFoto.png);
    return res.writeHead(204).end();
  }

  if (req.method === 'GET' && p === '/api/ologramma/campo') { // fs per voxel, Float32 in ordine i + nx·(j + ny·k)
    const c = holo.campo();
    if (!c) return res.writeHead(404, { 'cache-control': 'no-store' }).end();
    if (url.searchParams.get('v') !== String(c.versione)) return res.writeHead(409, { 'cache-control': 'no-store' }).end(); // un campo vecchio su un modello nuovo mentirebbe
    return res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': c.fs.byteLength, 'cache-control': 'no-store' })
      .end(Buffer.from(c.fs.buffer, c.fs.byteOffset, c.fs.byteLength));
  }

  if (req.method === 'GET' && p.startsWith('/api/ologramma/file/')) return serviFile3D(res, p);

  if (req.method === 'GET' && p === '/api/meteo') { // l'HUD aperto: gli ultimi dati, riscaricati se hanno più di 10 minuti
    const d = await meteo.attuale();
    return d ? json(res, 200, d) : res.writeHead(404, { 'cache-control': 'no-store' }).end();
  }

  if (req.method === 'POST' && p === '/api/meteo') { // solo dallo strumento del cervello: l'HUD non sceglie luoghi
    if (req.headers.origin || req.headers['sec-fetch-site']) return res.writeHead(403).end();
    if (body.chiudi === true) { brain.notify({ t: 'meteo', chiudi: true }); return json(res, 200, { ok: true, testo: 'Vista meteo chiusa.' }); }
    const r = await meteo.mostra({ luogo: body.luogo, paese: body.paese });
    if (!r.ok) return json(res, r.codice, { ok: false, errori: r.errori });
    if (holoOra.aperto) holo.esegui({ azione: 'chiudi' }); // una vista grande alla volta: come il report, la meteo chiude l'ologramma
    brain.notify({ t: 'meteo', dati: r.dati });
    const spento = Date.now() - hudSeen > 15_000 ? "\nL'HUD non è acceso: Tony non vede la vista, digli i numeri a voce." : '';
    return json(res, 200, { ok: true, testo: r.testo + spento });
  }

  if (req.method === 'POST' && p === '/api/ask') {
    let text = String(body.text || '').trim();
    if (body.agenda) { // li tolgo dall'agenda subito: un secondo HUD, o il giro dopo, non li ripete
      const due = agenda.due();
      if (!due.length) return res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end(JSON.stringify({ t: 'done' }) + '\n');
      agenda.remove(due.map((x) => x.id));
      console.error(`[agenda] parlo per primo: ${due.length} ${due.length === 1 ? 'compito' : 'compiti'}`);
      text = agendaText(due);
    }
    if (!text) return res.writeHead(400).end();
    // Perché la frase è passata dal filtro dell'HUD: senza nome può essere la TV o Tony che parla con altri, e la persona
    // decide [ignora] su questa riga. Solo i valori noti: dall'HUD non entra testo libero.
    const sentito = !body.agenda && Object.hasOwn(SENTITO, body.why) && SENTITO[body.why]; // hasOwn: «constructor» non passa
    text = `[adesso: ${adesso()}]\n${sentito ? `[sentito: ${sentito}]\n` : ''}${text}`; // l'ora a ogni domanda: Claude Code gli dà solo la data
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
    let open = true, pending = 0, finished = false;
    const write = (ev) => { if (open) res.write(JSON.stringify(ev) + '\n'); };
    const close = () => { if (open && finished && !pending) { res.end(JSON.stringify({ t: 'done' }) + '\n'); open = false; } };
    res.on('close', () => { open = false; });
    const onEvent = (ev) => {
      if (ev.t !== 'media') {
        write(ev);
        // Un report o il pannello del browser coprono l'ologramma nell'HUD: si chiude anche qui, che ne è l'unico padrone.
        // Prima il server lo credeva aperto, e il cervello riceveva la foto vecchia di un ologramma che Tony non vedeva.
        if (ev.t === 'show' || (ev.t === 'report' && Array.isArray(ev.blocchi) && ev.blocchi.length)) holo.esegui({ azione: 'chiudi' });
        return;
      }
      pending++; // GIF e animazioni: le cerco mentre Nexus parla, arrivano quando sono pronte
      media.find(ev.kind, ev.q).then((m) => { if (m) write({ t: 'media', kind: ev.kind, ...m }); }).finally(() => { pending--; close(); });
    };
    await rispondi(text, onEvent);
    finished = true; close();
    return;
  }

  if (req.method === 'POST' && p === '/api/hud') { // l'app Nexus, se Nexus è già acceso, riapre l'HUD solo se non ce n'è uno
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

  if (req.method === 'POST' && p === '/api/tts') { // sempre audio vero: Kokoro o voce del Mac, mai mescolate in una risposta
    const { text, answer } = body;
    try {
      const a = await voice.speak(String(text || '').slice(0, 2000), String(answer || 'x'));
      return res.writeHead(200, { 'content-type': a.type, 'x-nexus-voce': a.provider + (a.switched ? ';cambio' : '') }).end(a.data);
    } catch (e) {
      console.error(`[voce] ${e.message}`);
      return res.writeHead(502).end();
    }
  }

  res.writeHead(404).end();
});

server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log(`Porta ${PORT} occupata: Nexus è già acceso, riapro il suo HUD.`);
  await fetch(`http://127.0.0.1:${PORT}/api/hud`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});
  process.exit(0);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Nexus online su http://localhost:${PORT}`);
  if (env.NEXUS_NO_OPEN) return;
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
  brain.kill(); voice.ferma();
  for (const p of [browser, ...launched]) { try { process.kill(-p.pid, 'SIGTERM'); } catch {} } // npx, server e Chrome di Nexus
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
