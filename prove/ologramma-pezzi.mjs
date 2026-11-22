// ologramma-pezzi.mjs — prova le regole di Tony del 16/11 sulla scena vera (scena.js) in un Chrome headless sulla GPU:
// l'ologramma si muove solo quando lo muove lui, i pezzi spostati restano dove li lascia, e tornano a posto solo col gesto
// dei due pugni ('ricomponi'). Gira su public/lab-ologramma.html col turbofan di prova, senza server di O.S.C.A.R. né cervello.
//   node prove/ologramma-pezzi.mjs      circa 20 s, porte 4433 e 9564
// Una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4433, CDP = 9564, W = 1470, H = 956;
const CHROME = process.env.OSCAR_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// I file come li serve server.mjs: public/ alla radice, three da node_modules
const TIPI = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = p.startsWith('/three/') ? path.join(ROOT, 'node_modules', 'three') : path.join(ROOT, 'public');
  const f = path.join(base, p.startsWith('/three/') ? p.slice(7) : p);
  if (!f.startsWith(base) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(PORTA, '127.0.0.1');

const profilo = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-pezzi-'));
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } }));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${H}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  `http://127.0.0.1:${PORTA}/lab-ologramma.html?demo=turbofan`], { stdio: 'ignore' });
const guardia = setTimeout(() => { console.log('FAIL  la prova dura più di 2 minuti'); finisci(); }, 120000);

let ws, nId = 0;
const attese = new Map();
async function connetti() {
  for (let k = 0; k < 75; k++) {
    await pausa(200);
    try {
      const pag = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes('lab-ologramma'));
      if (pag) { ws = new WebSocket(pag.webSocketDebuggerUrl); break; }
    } catch {}
  }
  await new Promise((ok) => ws.addEventListener('open', ok));
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); attese.get(d.id)?.(d); attese.delete(d.id); });
}
const cdp = (method, params = {}) => new Promise((ok) => { const id = ++nId; attese.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
async function ev(espr) {
  const r = await cdp('Runtime.evaluate', { expression: espr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
function finisci() {
  clearTimeout(guardia);
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  server.close();
  fs.rmSync(profilo, { recursive: true, force: true });
  console.log(`\n${passati} passati, ${falliti} falliti`);
  process.exit(falliti ? 1 : 0);
}

const d = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : NaN);
const px = (v) => `${v.toFixed(1)} px`;
try {
  await connetti();
  let pronto = false;
  for (let k = 0; k < 100 && !pronto; k++) { await pausa(100); pronto = await ev('Boolean(window.__pronto) || window.__errore || false'); }
  if (typeof pronto === 'string') throw new Error(pronto);
  await ev('prova.attendi(8000)');
  await pausa(600);
  const P = 'pilone', ALTRO = 'fadec';
  const c0 = await ev('prova.centri()');
  esito(c0[P] && c0[ALTRO], 'il turbofan di prova è aperto e i pezzi si vedono', `${Object.keys(c0).length} pezzi`);

  await pausa(1500);
  let c = await ev('prova.centri()');
  esito(d(c[P], c0[P]) < 1 && d(c[ALTRO], c0[ALTRO]) < 1, 'senza mani né mouse il modello resta fermo', `pilone spostato di ${px(d(c[P], c0[P]))} in 1,5 s`);

  // mani: afferra, sposta di un decimo di schermo, lascia; il pezzo resta lì
  const [gx, gy] = [c0[P][0] / W, c0[P][1] / H];
  await ev(`prova.gesto({ tipo: 'afferra', x: ${gx}, y: ${gy} }), prova.gesto({ tipo: 'sposta', dx: 0.1, dy: 0 }), prova.gesto({ tipo: 'lascia' }), true`);
  await pausa(300);
  const subito = (await ev('prova.centri()'))[P];
  await pausa(1500);
  c = await ev('prova.centri()');
  esito(d(subito, c0[P]) > 0.05 * W && d(c[P], subito) < 2, 'con le mani: il pezzo lasciato resta dove l\'ha messo', `spostato di ${px(d(subito, c0[P]))}, poi in 1,5 s di ${px(d(c[P], subito))}`);
  esito(d(c[ALTRO], c0[ALTRO]) < 1, 'gli altri pezzi non si muovono', `fadec di ${px(d(c[ALTRO], c0[ALTRO]))}`);

  await ev("prova.gesto({ tipo: 'ricomponi' }), true");
  await pausa(1500);
  c = await ev('prova.centri()');
  esito(d(c[P], c0[P]) < 2, 'col gesto dei due pugni torna a posto', `a ${px(d(c[P], c0[P]))} dal posto di partenza`);

  // esploso e pezzo spostato insieme: ricomponi chiude anche l'esploso
  await ev(`prova.comando('esploso', 1), prova.gesto({ tipo: 'afferra', x: ${gx}, y: ${gy} }), prova.gesto({ tipo: 'sposta', dx: 0, dy: 0.08 }), prova.gesto({ tipo: 'lascia' }), true`);
  await pausa(1500);
  await ev("prova.gesto({ tipo: 'ricomponi' }), true");
  await pausa(2600); // l'esploso si chiude con costante 0,25 s: dopo 2,6 s resta meno di un millesimo
  const info = await ev('prova.info()');
  c = await ev('prova.centri()');
  esito(info.vista.esploso === 0 && d(c[P], c0[P]) < 2, 'ricomponi chiude anche l\'esploso', `esploso ${info.vista.esploso}, pilone a ${px(d(c[P], c0[P]))}`);

  // mouse: clic sul pilone lo seleziona, poi trascinarlo lo sposta e la camera non gira
  const [mx, my] = c0[P];
  const pt = (type, x, y) => `prova.puntatore({ type: '${type}', clientX: ${x}, clientY: ${y}, pointerId: 1 })`;
  await ev("prova.seleziona(null)"); // la presa con le mani l'aveva già selezionato, e un clic su un selezionato lo deseleziona
  await ev(`${pt('pointerdown', mx, my)}, ${pt('pointerup', mx, my)}, true`);
  const sel = (await ev('prova.info()')).vista.selezionato;
  await ev(`${pt('pointerdown', mx, my)}, ${pt('pointermove', mx + 40, my)}, ${pt('pointermove', mx + 90, my)}, ${pt('pointerup', mx + 90, my)}, true`);
  await pausa(1200);
  c = await ev('prova.centri()');
  esito(sel === P && Math.abs(c[P][0] - c0[P][0] - 90) < 15 && d(c[ALTRO], c0[ALTRO]) < 1,
    'col mouse: trascinando il pezzo selezionato si sposta lui, e resta lì', `selezionato ${sel}; pilone spostato di ${px(c[P][0] - c0[P][0])} in x, fadec di ${px(d(c[ALTRO], c0[ALTRO]))}`);

  // trascinando fuori dal pezzo selezionato si gira il modello, come prima
  await ev(`${pt('pointerdown', 60, 60)}, ${pt('pointermove', 140, 60)}, ${pt('pointermove', 220, 60)}, ${pt('pointerup', 220, 60)}, true`);
  await pausa(300);
  const c2 = await ev('prova.centri()');
  esito(d(c2[ALTRO], c[ALTRO]) > 10, 'trascinando altrove gira il modello', `fadec spostato di ${px(d(c2[ALTRO], c[ALTRO]))}`);
} catch (e) {
  esito(false, 'la prova è arrivata in fondo', e.message);
}
finisci();
