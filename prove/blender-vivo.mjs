// blender-vivo.mjs — un modello aperto in Blender (finestra vera) e comandato coi gesti dell'HUD, senza Tony né cervello.
// node prove/blender-vivo.mjs [file.blend] [--hud] [--foto <cartella>]
// Senza --hud: Blender da solo. Gesti finti a 60 Hz su mac/blender/vivo.py: rotazione, zoom, esploso, presa, spostamento,
// lancio e ricomponi, con fotogrammi al secondo e ritardo arrivo → disegno.
// Con --hud: prima l'HUD vero (Chrome a schermo intero, mani sulla foto di prova) da solo, poi Blender davanti. Misura se
// le mani dell'HUD rallentano quando la finestra di Blender lo copre. Porte 4440 (Blender), 4436 (HTTP) e 9567 (CDP).
// Apre finestre vere sullo schermo per circa un minuto.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BLENDER = process.env.OSCAR_BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const FILE = ARGS.find((a) => a.endsWith('.blend')) || path.join(os.homedir(), 'Documents/Nexus-Blender/turbofan-cfm56/v1/modello.blend');
const HUD = ARGS.includes('--hud');
const FOTO = ARGS.includes('--foto') ? path.resolve(ARGS[ARGS.indexOf('--foto') + 1]) : null;
const PORTA_B = 4440, PORTA = 4436, CDP = 9567, ORIGINE = `http://localhost:${PORTA}`;
const GETTONE = crypto.randomUUID();
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-vivo-'));
const RECENTI = path.join(os.homedir(), 'Library/Application Support/Blender/5.2/config/recent-files.txt');
const recentiPrima = fs.existsSync(RECENTI) ? fs.readFileSync(RECENTI) : null; // la prova non deve finire fra i file recenti di Tony
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 200) { const fine = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > fine) return v; await pausa(passo); } }
let pass = 0, fail = 0;
const esito = (ok, nome, det = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${det !== '' ? `  —  ${det}` : ''}`); return ok; };
const davanti = () => { try { return execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'name', execFileSync('/usr/bin/lsappinfo', ['front']).toString().trim()]).toString().match(/^"\W*([^"]+)"/)?.[1] ?? '?'; } catch { return '?'; } };
if (FOTO) fs.mkdirSync(FOTO, { recursive: true });

// ---------------------------------------------------------------- Blender e il suo canale
let blender = null, conn = null, resto = '';
const risposte = [];
function avviaBlender() {
  blender = spawn(BLENDER, ['--factory-startup', '--disable-autoexec', '--window-maximized', FILE, '--python', path.join(ROOT, 'mac/blender/vivo.py'),
    '--', '--porta', String(PORTA_B), '--gettone', GETTONE], { stdio: ['ignore', 'pipe', 'pipe'] });
  blender.registro = '';
  blender.stdout.on('data', (d) => { blender.registro += d; });
  blender.stderr.on('data', (d) => { blender.registro += d; });
}
async function collega() {
  conn = await attendi(() => new Promise((ok, ko) => { const c = net.connect(PORTA_B, '127.0.0.1', () => ok(c)); c.on('error', ko); }), 40_000, 300);
  if (!conn) return false;
  conn.on('data', (d) => { resto += d; let i; while ((i = resto.indexOf('\n')) >= 0) { const r = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1); risposte.shift()?.(r); } });
  return true;
}
const manda = (m) => conn.write(JSON.stringify({ gettone: GETTONE, ...m }) + '\n');
const chiedi = (m, ms = 10_000) => new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error(`nessuna risposta a ${m.tipo}`)), ms); risposte.push((r) => { clearTimeout(t); ok(r); }); manda({ ...m, risposta: true }); });
async function gesti(ms, fn) { const t0 = Date.now(); let k = 0; while (Date.now() - t0 < ms) { fn(k++); await pausa(16); } }
const foto = async (nome) => { if (FOTO) { await chiedi({ tipo: 'foto', file: path.join(FOTO, `${nome}.png`) }); } };

// ---------------------------------------------------------------- l'HUD vero, con un server statico finto (come mani-delegato.mjs)
let chrome = null, server = null, ws = null;
async function avviaHud() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
  const BASI = [['/three/', path.join(ROOT, 'node_modules/three')], ['/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')], ['/', path.join(ROOT, 'public')]];
  server = http.createServer(async (req, res) => {
    const p = new URL(req.url, ORIGINE).pathname;
    for await (const _ of req);
    if (p.startsWith('/modelli/')) {
      const nome = p.slice(9);
      if (!['hand_landmarker.task', 'prova-mani.jpg'].includes(nome)) return res.writeHead(404).end();
      return res.writeHead(200, { 'content-type': MIME[path.extname(nome)] }).end(fs.readFileSync(path.join(ROOT, 'runtime/modelli', nome)));
    }
    if (p === '/api/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ voice: { provider: 'mac' }, browser: false, gifs: false, agenda: 0, ologramma: 0 }));
    if (p.startsWith('/api/')) return res.writeHead(req.method === 'POST' ? 204 : 404).end();
    const [pre, base] = BASI.find(([a]) => p.startsWith(a)), f = path.join(base, p === '/' ? 'index.html' : decodeURIComponent(p.slice(pre.length)));
    if (!f.startsWith(base + path.sep)) return res.writeHead(403).end();
    fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(d)));
  });
  await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));
  const profilo = path.join(LAVORO, 'chrome');
  fs.mkdirSync(profilo, { recursive: true });
  fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
  // Gli stessi flag di openHud in server.mjs, più la fotocamera e il microfono finti e il CDP
  chrome = spawn(CHROME, [`--user-data-dir=${profilo}`, '--app=about:blank', '--start-fullscreen', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${CDP}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], { stdio: 'ignore' });
  const pagina = await attendi(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'), 20_000);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  let n = 0; const attese = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); } };
  const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++n; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
  // Niente riconoscimento vocale: un profilo nuovo scarica il modello italiano e sporca le misure (CLAUDE.md)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.webkitSpeechRecognition; delete window.SpeechRecognition;' });
  await cdp('Page.navigate', { url: `${ORIGINE}/?debug&mani=immagine` });
  const ev = async (e) => { const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  if (!(await attendi(() => ev("document.body?.classList.contains('ready') && typeof window.oscarOlogrammaDemo === 'function'"), 30_000))) throw new Error("l'HUD non è pronto");
  await ev("localStorage.setItem('oscar-mani', '1'), true");
  // L'HUD del piano nuovo non disegna ologrammi: qui uno minimo (una scatola da 1 mm) serve solo ad accendere le mani
  await ev(`oscarOlogramma(${JSON.stringify({ aperto: true, modello: 1, versione: 1, titolo: 'mani', descrizione: '', tolti: [], carichi: [], vincoli: [],
    pezzi: [{ id: 'p', nome: 'p', forma: 'scatola', misure: { x: 1, y: 1, z: 1 } }], massa_kg: null, ingombro_mm: null, analisi: null,
    vista: { esploso: 0, sezione: null, modo: 'ologramma', selezionato: null, isolato: null } })}), true`);
  if (!(await attendi(() => ev('window.__misure.mani?.attive && window.__misure.mani.rilevazioni >= 30'), 40_000))) throw new Error('le mani non partono');
  return ev;
}
async function maniPer(ev, ms) { // rilevazioni al secondo e fotogrammi della pagina in una finestra di ms
  const a = await ev('[window.__misure.mani.rilevazioni, performance.now()]');
  await pausa(ms);
  const b = await ev('[window.__misure.mani.rilevazioni, performance.now()]'), f = await ev('window.__misure.fps');
  return { hz: Math.round(((b[0] - a[0]) / (b[1] - a[1])) * 10000) / 10, conti: f.conti.slice(-Math.floor(ms / 1000)) };
}

function chiudi(codice) {
  try { conn?.destroy(); } catch {}
  try { blender?.kill('SIGTERM'); } catch {}
  try { ws?.close(); chrome?.kill('SIGTERM'); } catch {}
  server?.close();
  setTimeout(() => {
    try { if (blender && blender.exitCode === null) blender.kill('SIGKILL'); } catch {}
    if (recentiPrima !== null) fs.writeFileSync(RECENTI, recentiPrima); else fs.rmSync(RECENTI, { force: true });
    fs.rmSync(LAVORO, { recursive: true, force: true });
    console.log(`\n${pass} PASS, ${fail} FAIL`);
    process.exit(codice);
  }, 2500);
}
const guardia = setTimeout(() => { console.log('la prova dura più di 4 minuti: fermata'); chiudi(1); }, 240_000);

try {
  let ev = null, prima = null;
  if (HUD) {
    ev = await avviaHud();
    await pausa(3000);
    prima = { ...(await maniPer(ev, 12_000)), davanti: davanti() };
    console.log(`HUD davanti (${prima.davanti}): mani ${prima.hz} rilevazioni al secondo, fps per secondo ${prima.conti.join(' ')}`);
  }
  avviaBlender();
  esito(await collega(), 'Blender si apre con vivo.py e ascolta sulla porta', blender.exitCode !== null ? blender.registro.slice(-300) : '');
  const i0 = await chiedi({ tipo: 'info' }, 30_000);
  esito(i0.pezzi > 0, 'il modello è caricato', `${i0.pezzi} pezzi, raggio ${i0.raggio}`);
  await pausa(1500);
  const fronte = davanti();
  console.log(`in primo piano: ${fronte}`);
  await foto('1-apertura');

  // Rotazione continua a 60 Hz, come un pizzico che trascina, mentre Blender conta i disegni: una volta con la finestra di
  // Blender dove si è aperta, una volta portata davanti (open -a la attiva, perché è già aperta)
  const giri = [];
  for (const quale of HUD ? ['dietro', 'davanti'] : ['davanti']) {
    if (quale === 'davanti' && HUD) { execFileSync('/usr/bin/open', ['-a', path.dirname(path.dirname(path.dirname(BLENDER)))]); await pausa(2500); }
    const fr = davanti();
    manda({ tipo: 'misura', inizio: true });
    const misHud = HUD ? maniPer(ev, 10_000) : null;
    await gesti(10_000, (k) => manda({ tipo: 'ruota', dx: 0.004 * Math.sin(k / 40), dy: 0.002 * Math.cos(k / 55) }));
    const m = await chiedi({ tipo: 'misura' });
    console.log(`Blender ${quale} (in primo piano ${fr}): Blender fps mediana ${m.fps_mediana}, p10 ${m.fps_p10}; gesto → disegno ${m.latenza_mediana_ms} ms (p90 ${m.latenza_p90_ms})` +
      (HUD ? `; mani dell'HUD ${(await misHud).hz} al secondo, fps per secondo ${(await misHud).conti.join(' ')}` : ''));
    giri.push({ quale, fr, m, hud: HUD ? await misHud : null });
  }
  if (HUD) { // Blender davanti ma fermo: se le mani tornano a pieno ritmo, a frenarle è il disegno di Blender, non la finestra coperta
    const f = await maniPer(ev, 8000);
    console.log(`Blender davanti e fermo (in primo piano ${davanti()}): mani dell'HUD ${f.hz} al secondo, fps per secondo ${f.conti.join(' ')}`);
  }
  const g = giri.at(-1);
  esito(g.m.fps_p10 >= 45, 'Blender gira il modello ad almeno 45 fps (p10)', `mediana ${g.m.fps_mediana}, p10 ${g.m.fps_p10}, minimo ${g.m.fps_minimo}`);
  esito(g.m.latenza_mediana_ms <= 25, 'dal gesto al disegno al massimo 25 ms di mediana', `mediana ${g.m.latenza_mediana_ms} ms, p90 ${g.m.latenza_p90_ms} ms, ${g.m.gesti} gesti`);
  if (HUD) {
    esito(/blender/i.test(g.fr), 'nella seconda misura Blender è davanti', g.fr);
    for (const x of giri) esito(x.hud.hz >= prima.hz * 0.85, `con Blender ${x.quale} le mani dell'HUD non perdono più del 15%`, `${prima.hz} → ${x.hud.hz} al secondo`);
  }
  await foto('2-ruotato');

  for (let k = 0; k < 20; k++) { manda({ tipo: 'esplodi', delta: 0.05 }); await pausa(16); }
  const i1 = await chiedi({ tipo: 'info' });
  esito(i1.esploso === 1 && i1.spostati > 0, 'due mani che si allargano esplodono il modello', `esploso ${i1.esploso}, ${i1.spostati} pezzi spostati`);
  await foto('3-esploso');
  const d0 = i1.distanza;
  for (let k = 0; k < 10; k++) { manda({ tipo: 'zoom', fattore: 1.04 }); await pausa(16); }
  const i2 = await chiedi({ tipo: 'info' });
  esito(i2.distanza < d0 * 0.75, 'due pizzichi avvicinano', `distanza ${d0} → ${i2.distanza}`);

  manda({ tipo: 'stato', fase: 'azione' });
  let presa = null;
  for (const [x, y] of [[0.5, 0.5], [0.45, 0.5], [0.55, 0.5], [0.5, 0.45], [0.5, 0.55], [0.4, 0.5], [0.6, 0.5]]) {
    manda({ tipo: 'cursore', x, y });
    presa = (await chiedi({ tipo: 'afferra', x, y })).presa;
    if (presa) break;
  }
  esito(Boolean(presa), 'un pizzico tenuto prende il pezzo sotto il cursore', presa ?? 'nessun pezzo al centro');
  if (presa) {
    for (let k = 0; k < 15; k++) { manda({ tipo: 'sposta', dx: 0.01, dy: -0.004 }); await pausa(16); }
    await foto('4-spostato');
    await chiedi({ tipo: 'lascia' });
    await chiedi({ tipo: 'afferra', x: 0.65, y: 0.44 }); // dove il pezzo è finito, all'incirca
    const i3 = await chiedi({ tipo: 'lancia' });
    esito(i3.nascosti >= 0, 'un pezzo lanciato via sparisce (se era ancora sotto il cursore)', `nascosti ${i3.nascosti}, tolti ${i3.tolti.join(', ') || 'nessuno'}`);
  }
  const i4 = await chiedi({ tipo: 'ricomponi' });
  esito(i4.esploso === 0 && i4.spostati === 0 && i4.nascosti === 0, 'due pugni ricompongono tutto', JSON.stringify(i4));
  await foto('5-ricomposto');
  clearTimeout(guardia);
  chiudi(fail ? 1 : 0);
} catch (e) {
  console.log(`errore: ${e.message}`);
  if (blender?.registro) console.log(blender.registro.split('\n').filter((l) => /Error|vivo|Traceback/.test(l)).slice(-8).join('\n'));
  clearTimeout(guardia);
  chiudi(1);
}
