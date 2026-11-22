// blender-vivo.mjs — l'ologramma in Blender vero (mac/blender/vivo.py), senza server né cervello. Il modello lo fa
// ologramma.mjs (calcolo degli sforzi compreso), il messaggio blender.mjs, e la prova parla con vivo.py come il server.
// node prove/blender-vivo.mjs [--foto <cartella>] [--hud]
// Apre una finestra vera di Blender per circa un minuto. Con --hud prima apre anche l'HUD vero (Chrome a schermo intero,
// mani sulla foto di prova) e misura se le mani rallentano mentre Blender ridisegna davanti. Porte 4440 (Blender),
// 4436 (HTTP) e 9567 (CDP).
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOlogramma } from '../ologramma.mjs';
import { messaggioOlogramma } from '../blender.mjs';
import { calcolaInWorker } from '../fisica/struttura.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BLENDER = process.env.OSCAR_BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = process.argv.slice(2);
const HUD = ARGS.includes('--hud');
const FOTO = ARGS.includes('--foto') ? path.resolve(ARGS[ARGS.indexOf('--foto') + 1]) : null;
const PORTA_B = 4440, PORTA = 4436, CDP = 9567, ORIGINE = `http://localhost:${PORTA}`;
const GETTONE = crypto.randomUUID();
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-vivo-'));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn().catch(() => false); if (v || Date.now() > fine) return v; await pausa(passo); } }
let pass = 0, fail = 0;
const esito = (ok, nome, det = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${det !== '' ? `  —  ${det}` : ''}`); return ok; };
const davanti = () => { try { return execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'name', execFileSync('/usr/bin/lsappinfo', ['front']).toString().trim()]).toString().match(/^"\W*([^"]+)"/)?.[1] ?? '?'; } catch { return '?'; } };
if (FOTO) fs.mkdirSync(FOTO, { recursive: true });

// ---------------------------------------------------------------- il modello, come lo farebbe il server
const holo = createOlogramma({ cartella: LAVORO, calcola: (l) => calcolaInWorker(l, { timeout_s: 55 }) });
const MODELLO = {
  titolo: 'Staffa con cavo', pezzi: [
    { id: 'base', nome: 'Base', forma: 'scatola', misure: { x: 120, y: 8, z: 40 }, materiale: 'alluminio-6061', materiale_vero: 'alluminio 6061-T6', fattura: 'fresata', gruppo: 'staffa' },
    { id: 'braccio', nome: 'Braccio', forma: 'scatola', misure: { x: 8, y: 40, z: 40 }, posizione: [-56, 24, 0], materiale: 'alluminio-6061', gruppo: 'staffa' },
    { id: 'perno', nome: 'Perno', forma: 'cilindro', misure: { r: 6, h: 30 }, posizione: [40, 19, 0], materiale: 'acciaio-s355', colore: '#e0a030', esplodi: [0, 1, 0] },
    { id: 'cavo', nome: 'Cavo', forma: 'cavo', misure: { punti: [[-60, 50, 0], [0, 80, 20], [60, 50, 0]], r: 2 }, flusso: 'elettrico' },
  ],
};
let r = holo.esegui({ azione: 'mostra', modello: MODELLO });
r = holo.esegui({ azione: 'analizza', vincoli: [{ pezzo: 'braccio', faccia: '-x', tipo: 'incastro' }], carichi: [{ pezzo: 'base', faccia: '+x', forza_N: 1500, direzione: [0, -1, 0] }] });
if (r.attesa) await r.attesa;
const messaggio = () => messaggioOlogramma(holo.stato(), { campo: () => holo.campo(), controllaFile: (f) => ({ vero: f }), cartella: LAVORO });

// ---------------------------------------------------------------- Blender e il suo canale
let blender = null, conn = null, resto = '', rid = 0;
const risposte = new Map(), eventi = [];
async function avviaBlender() {
  blender = spawn(BLENDER, ['--factory-startup', '--disable-autoexec', '--window-maximized', '--python', path.join(ROOT, 'mac/blender/vivo.py'),
    '--', '--porta', String(PORTA_B), '--gettone', GETTONE], { stdio: ['ignore', 'pipe', 'pipe'] });
  blender.registro = '';
  blender.stdout.on('data', (d) => { blender.registro += d; });
  blender.stderr.on('data', (d) => { blender.registro += d; });
  conn = await attendi(() => new Promise((ok, ko) => { const c = net.connect(PORTA_B, '127.0.0.1', () => ok(c)); c.on('error', ko); }), 40_000, 300);
  if (!conn) return false;
  conn.on('data', (d) => {
    resto += d;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const m = JSON.parse(resto.slice(0, i)); resto = resto.slice(i + 1);
      if (m.rid != null) risposte.get(m.rid)?.(m); else if (m.evento) eventi.push(m);
    }
  });
  return true;
}
const manda = (m) => conn.write(JSON.stringify({ gettone: GETTONE, ...m }) + '\n');
const chiedi = (m, ms = 20_000) => new Promise((ok, ko) => {
  const id = ++rid, t = setTimeout(() => ko(new Error(`nessuna risposta a ${m.tipo}`)), ms);
  risposte.set(id, (x) => { clearTimeout(t); risposte.delete(id); ok(x); });
  manda({ ...m, rid: id });
});
const info = () => chiedi({ tipo: 'info' });
async function gesti(ms, fn) { const t0 = Date.now(); let k = 0; while (Date.now() - t0 < ms) { fn(k++); await pausa(16); } }
const foto = async (nome) => { if (FOTO) await chiedi({ tipo: 'foto', file: path.join(FOTO, `${nome}.png`) }); };
async function vista(v) { holo.esegui({ azione: 'modifica', vista: v }); return chiedi(messaggio(), 60_000); }

// ---------------------------------------------------------------- l'HUD vero, con un server statico finto
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
  const ev = async (e) => { const x = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (x.exceptionDetails) throw new Error(x.exceptionDetails.text); return x.result.value; };
  if (!(await attendi(() => ev("document.body?.classList.contains('ready') && typeof window.oscarOlogramma === 'function'"), 30_000))) throw new Error("l'HUD non è pronto");
  await ev("localStorage.setItem('oscar-mani', '1'), true");
  await ev("oscarOlogramma({ aperto: true, modello: 1, versione: 1, pezzi: [], tolti: [], analisi: null }), true"); // come un ologramma aperto: mani accese, nucleo fermo
  if (!(await attendi(() => ev('window.__misure.mani?.attive && window.__misure.mani.rilevazioni >= 30'), 40_000))) throw new Error('le mani non partono');
  return ev;
}
async function maniPer(ev, ms) {
  const a = await ev('[window.__misure.mani.rilevazioni, performance.now()]');
  await pausa(ms);
  const b = await ev('[window.__misure.mani.rilevazioni, performance.now()]');
  return Math.round(((b[0] - a[0]) / (b[1] - a[1])) * 10000) / 10;
}

function chiudi(codice) {
  try { conn?.destroy(); } catch {}
  try { blender?.kill('SIGTERM'); } catch {}
  try { ws?.close(); chrome?.kill('SIGTERM'); } catch {}
  server?.close();
  setTimeout(() => {
    try { if (blender && blender.exitCode === null) blender.kill('SIGKILL'); } catch {}
    fs.rmSync(LAVORO, { recursive: true, force: true });
    console.log(`\n${pass} PASS, ${fail} FAIL`);
    process.exit(codice);
  }, 2500);
}
const guardia = setTimeout(() => { console.log('la prova dura più di 4 minuti: fermata'); chiudi(1); }, 240_000);

try {
  let ev = null, soloHud = null;
  if (HUD) {
    ev = await avviaHud();
    await pausa(3000);
    soloHud = await maniPer(ev, 10_000);
    console.log(`HUD da solo, con l'ologramma aperto (nucleo fermo): mani ${soloHud} rilevazioni al secondo`);
  }
  esito(await avviaBlender(), 'Blender si apre con vivo.py e ascolta', blender.exitCode !== null ? blender.registro.slice(-300) : '');
  let i = await chiedi(messaggio(), 60_000);
  i = await info();
  esito(i.pezzi === 4 && i.modo === 'solido' && i.versione === holo.stato().versione, 'il modello arriva: 4 pezzi, in solido', JSON.stringify(i).slice(0, 160));
  await pausa(1000);
  const fronte = davanti();
  await foto('1-solido');

  i = await vista({ modo: 'sforzi' }); i = await info();
  esito(i.modo === 'sforzi' && i.sforzi === 3 && i.colorati > 100, 'sforzi: i tre pezzi calcolati prendono i colori del campo', `${i.sforzi} pezzi, ${i.colorati} vertici colorati`);
  await foto('2-sforzi');
  i = await vista({ modo: 'densita', esploso: 1 }); await pausa(900); i = await info();
  esito(i.modo === 'densita' && i.esploso === 1, 'densità ed esploso dal server', `${i.modo}, esploso ${i.esploso}`);
  await foto('3-densita-esploso');
  i = await vista({ modo: 'solido', esploso: 0, selezionato: 'base', sezione: { asse: 'z', posizione: 0, verso: 1 } }); i = await info();
  esito(i.sezione && i.selezionato === 'base', 'sezione e pezzo scelto: la scheda della base', `sezione ${i.sezione}, scelto ${i.selezionato}`);
  await foto('4-sezione-scheda');
  i = await vista({ sezione: null }); i = await info();
  esito(!i.sezione, 'la sezione si toglie');

  // Rotazione continua a 60 Hz, come un pizzico che trascina, mentre Blender conta i disegni
  manda({ tipo: 'misura', inizio: true });
  const misHud = HUD ? maniPer(ev, 10_000) : null;
  await gesti(10_000, (k) => manda({ tipo: 'ruota', dx: 0.004 * Math.sin(k / 40), dy: 0.002 * Math.cos(k / 55) }));
  const m = await chiedi({ tipo: 'misura' });
  esito(m.fps_p10 >= 45, 'Blender gira il modello ad almeno 45 fps (p10)', `mediana ${m.fps_mediana}, p10 ${m.fps_p10}; in primo piano ${fronte}`);
  esito(m.latenza_mediana_ms <= 25, 'dal gesto al disegno al massimo 25 ms di mediana', `mediana ${m.latenza_mediana_ms} ms, p90 ${m.latenza_p90_ms} ms, ${m.gesti} gesti`);
  if (HUD) {
    const conBlender = await misHud;
    console.log(`Blender che ridisegna davanti: mani dell'HUD ${conBlender} al secondo (da solo ${soloHud})`);
    esito(conBlender >= soloHud * 0.85, 'con Blender che ridisegna, le mani dell\'HUD perdono al massimo il 15%', `${soloHud} → ${conBlender}`);
  }

  const d0 = (await info()).distanza;
  for (let k = 0; k < 10; k++) { manda({ tipo: 'zoom', fattore: 1.04 }); await pausa(16); }
  esito((await info()).distanza < d0 * 0.75, 'due pizzichi avvicinano');
  manda({ tipo: 'stato', fase: 'azione' });
  let presa = null;
  for (const [x, y] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.55], [0.5, 0.6], [0.4, 0.55], [0.6, 0.5]]) {
    presa = (await chiedi({ tipo: 'afferra', x, y })).presa;
    if (presa) break;
  }
  esito(Boolean(presa), 'un pizzico tenuto prende il pezzo sotto il cursore', presa ?? 'nessun pezzo');
  if (presa) {
    for (let k = 0; k < 15; k++) { manda({ tipo: 'sposta', dx: 0.01, dy: -0.004 }); await pausa(16); }
    i = await info();
    esito(i.spostati === 1, 'il pezzo preso si sposta e resta dove lo lasci', `${i.spostati} spostato`);
    await chiedi({ tipo: 'lancia' });
    const togli = await attendi(async () => eventi.find((e) => e.evento === 'togli'), 2000);
    esito(togli?.id === presa, 'lanciato via: Blender lo nasconde e chiede al server di toglierlo', JSON.stringify(togli));
  }
  i = await chiedi({ tipo: 'ricomponi', risposta: true });
  i = await info();
  esito(i.esploso === 0 && i.spostati === 0, 'due pugni ricompongono: niente esploso, niente spostati', JSON.stringify({ esploso: i.esploso, spostati: i.spostati }));

  // La scheda: Tony cambia un campo e la modifica parte verso il server, con lo stesso update che userebbe lui
  eventi.length = 0;
  await chiedi({ tipo: 'imposta', id: 'base', campo: 'materiale_vero', valore: 'ottone' });
  await chiedi({ tipo: 'imposta', id: 'base', campo: 'misura', chiave: 'x', valore: 150 });
  await chiedi({ tipo: 'imposta', id: 'perno', campo: 'materiale', valore: 'titanio-ti6al4v' });
  const c = await attendi(async () => eventi.length >= 3 && eventi, 2000);
  esito(c && c[0].campi.materiale_vero === 'ottone' && c[1].campi.misure?.x === 150 && c[1].campi.misure?.y === 8 && c[2].campi.materiale === 'titanio-ti6al4v',
    'la scheda manda al server materiale, misure (in mm) e lega cambiati da Tony', JSON.stringify(c).slice(0, 200));
  holo.esegui({ azione: 'modifica', cambia: [{ id: 'base', materiale_vero: 'ottone', misure: { x: 150 } }] });
  eventi.length = 0;
  await chiedi(messaggio(), 60_000);
  await pausa(300);
  esito(eventi.length === 0, 'lo stato che torna dal server non fa ripartire altre modifiche', JSON.stringify(eventi));
  await foto('5-scheda-cambiata');
  clearTimeout(guardia);
  chiudi(fail ? 1 : 0);
} catch (e) {
  console.log(`errore: ${e.message}`);
  if (blender?.registro) console.log(blender.registro.split('\n').filter((l) => /Error|vivo|Traceback/.test(l)).slice(-8).join('\n'));
  clearTimeout(guardia);
  chiudi(1);
}
