// mani-foto.mjs — banco delle mani su foto vere: MediaPipe HandLandmarker 0.10.35 vero, in un Chrome headless sulla GPU del
// Mac, su foto di mani vere; poi le stesse mani passano da gesti.js in Node. Serve a decidere con dei numeri, non a occhio:
// - quale 3D usare per il profilo (regola 2.2 di Tony): la z dei punti dell'immagine o i punti del mondo (worldLandmarks);
// - se un pugno o un pollice in su passano per pizzico con le soglie di oggi;
// - se il 10% di 1U di Tony (pollice e indice a meno di un decimo di palmo) è raggiungibile da un pizzico vero.
// node prove/mani-foto.mjs [cartella di lavoro] → una riga per mano, più PASS o FAIL per i controlli; esce con 0 solo se passa tutto.
// Porte 4491 (HTTP) e 9591 (CDP). Le foto stanno in runtime/modelli/ (fuori da git) e si scaricano solo se mancano; senza
// rete la prova lo dice e usa quelle che ci sono. Licenze: le immagini di prova di MediaPipe (Apache 2.0, repository
// google-ai-edge/mediapipe), «Gebaar - Okay.JPG» di Milliped (CC BY-SA 4.0) e «OK Sign.jpg» (CC BY 2.5) da Wikimedia Commons.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGesti, normale, inclinazione } from '../public/ologramma/gesti.js';
import { MEDIAPIPE } from '../public/ologramma/mani.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4491, CDP = 9591, ORIGINE = `http://localhost:${PORTA}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODELLI = path.join(ROOT, 'runtime', 'modelli');
const LAVORO = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'stem-mani-foto-'));

// nome sul disco → [cosa mostra, indirizzi da provare]
const MP = (n) => [`https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/${n}`, `https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/tasks/testdata/vision/${n}`];
const FOTO = {
  'prova-mani.jpg': ['due destre aperte, viste dal dorso (la foto di prova dell\'HUD)', MP('right_hands.jpg')],
  'thumb_up.jpg': ['pollice in su', MP('thumb_up.jpg')],
  'pointing_up.jpg': ['indice in su', MP('pointing_up.jpg')],
  'victory.jpg': ['vittoria (indice e medio)', MP('victory.jpg')],
  'fist.jpg': ['pugno', MP('fist.jpg')],
  'left_hands.jpg': ['due sinistre aperte', MP('left_hands.jpg')],
  'ok-gebaar.jpg': ['gesto OK, pollice e indice che si toccano (Commons, Milliped, CC BY-SA 4.0)', ['https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Gebaar_-_Okay.JPG/960px-Gebaar_-_Okay.JPG']],
  'ok-cc0.jpg': ['gesto OK davanti al viso (Commons, «OK Hand Gesture (cropped).jpg», CC0)', ['https://upload.wikimedia.org/wikipedia/commons/e/e5/OK_Hand_Gesture_%28cropped%29.jpg']],
  'ok-sign.jpg': ['gesto OK in primo piano, polso fuori dall\'immagine (Commons, «OK Sign.jpg», CC BY 2.5)', ['https://upload.wikimedia.org/wikipedia/commons/1/19/OK_Sign.jpg']],
};
// Le mani che MediaPipe deve trovare: solo nelle sue immagini di prova. Nelle foto di Commons il numero è un risultato
// (ok-sign.jpg, una mano in primo piano col polso tagliato, il 11/11 dava 0 mani).
const ATTESE = { 'prova-mani.jpg': 2, 'left_hands.jpg': 2, 'thumb_up.jpg': 1, 'pointing_up.jpg': 1, 'victory.jpg': 1, 'fist.jpg': 1 };

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- le foto: solo se mancano, e solo JPEG veri
fs.mkdirSync(MODELLI, { recursive: true });
const senzaRete = [];
for (const [nome, [, indirizzi]] of Object.entries(FOTO)) {
  const f = path.join(MODELLI, nome);
  if (fs.existsSync(f)) continue;
  let preso = false;
  for (const u of indirizzi) {
    try {
      const r = await fetch(u, { headers: { 'user-agent': 'STEM-prove/1.0 (banco delle mani, uso personale)' }, signal: AbortSignal.timeout(15000) });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b.length > 1000 && b.length < 5e6 && b[0] === 0xff && b[1] === 0xd8) { fs.writeFileSync(f, b); preso = true; break; }
    } catch { /* il prossimo indirizzo, o niente */ }
  }
  if (!preso) senzaRete.push(nome);
}
if (senzaRete.length) console.log(`(senza rete o senza risposta: mancano ${senzaRete.join(', ')}; la prova usa le altre)`);
const presenti = Object.keys(FOTO).filter((n) => fs.existsSync(path.join(MODELLI, n)));

// ---------------------------------------------------------------- il server: MediaPipe, il modello, le foto e una pagina
const PAGINA = `<!doctype html><meta charset="utf-8"><title>banco mani</title><script type="module">
const mp = await import('${MEDIAPIPE.bundle}');
const fileset = await mp.FilesetResolver.forVisionTasks('${MEDIAPIPE.wasm}');
const modello = new Uint8Array(await (await fetch('/modelli/hand_landmarker.task')).arrayBuffer());
let delegato = 'GPU', r;
const opzioni = (d) => ({ baseOptions: { modelAssetBuffer: modello, delegate: d }, runningMode: 'IMAGE', numHands: 2 });
try { r = await mp.HandLandmarker.createFromOptions(fileset, opzioni('GPU')); } catch { delegato = 'CPU'; r = await mp.HandLandmarker.createFromOptions(fileset, opzioni('CPU')); }
window.rileva = async (nome) => {
  const img = new Image(); img.src = '/foto/' + nome; await img.decode();
  const ris = r.detect(img);
  return { w: img.naturalWidth, h: img.naturalHeight, delegato, landmarks: ris.landmarks, world: ris.worldLandmarks, lati: ris.handedness.map((h) => h[0]?.categoryName ?? null) };
};
window.pronto = true;
</script>`;
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.task': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, ORIGINE).pathname;
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGINA);
  let f = null;
  if (p === '/modelli/hand_landmarker.task') f = path.join(MODELLI, 'hand_landmarker.task');
  else if (p.startsWith('/foto/') && presenti.includes(p.slice(6))) f = path.join(MODELLI, p.slice(6));
  else if (p.startsWith('/mediapipe/')) { const base = path.join(ROOT, 'node_modules/@mediapipe/tasks-vision'); f = path.join(base, decodeURIComponent(p.slice(11))); if (!f.startsWith(base + path.sep)) f = null; }
  if (!f) return res.writeHead(404).end();
  fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(d)));
});
await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));

// ---------------------------------------------------------------- Chrome headless sulla GPU, come prove/ologramma-hud.mjs
const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', '--use-fake-device-for-media-stream', 'about:blank'], { stdio: 'ignore' });
let ws = null, nId = 0;
const attese = new Map();
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(espressione) {
  const r = await cdp('Runtime.evaluate', { expression: espressione, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
// Chrome chiuso davvero (SIGKILL se dopo 4 s è ancora vivo), poi il server e il profilo; alla fine le porte devono essere libere
async function chiudiTutto() {
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
  for (let k = 0; k < 40 && chrome.exitCode === null && chrome.signalCode === null; k++) await pausa(100);
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await pausa(300);
  fs.rmSync(LAVORO, { recursive: true, force: true });
}
const guardia = setTimeout(async () => { console.log('FAIL  la prova dura più di 2 minuti'); await chiudiTutto(); process.exit(1); }, 120000);

const righe = [];
try {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!pagina) throw new Error(`Chrome non risponde sulla porta ${CDP}`);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); } };
  await cdp('Page.navigate', { url: ORIGINE + '/' });
  for (let k = 0; k < 150; k++) { await pausa(200); if (await ev('window.pronto === true').catch(() => false)) break; }
  if (!(await ev('window.pronto === true'))) throw new Error('MediaPipe non è partito nella pagina');

  // ---------------------------------------------------------------- le misure, mano per mano
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]), d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const indice = (q, d) => d(q[5], q[6]) + d(q[6], q[7]) + d(q[7], q[8]);
  let delegato = null;
  console.log('foto · mano · lato | inclinazione: z dell\'immagine / punti del mondo | pollice-indice in U: 2D, 3D immagine, mondo | diviso l\'indice: 2D, mondo | aperta | pizzico (rapporto)');
  for (const nome of presenti) {
    const r = await ev(`rileva(${JSON.stringify(nome)})`);
    delegato = r.delegato;
    const aspetto = r.w / r.h;
    // in gesti.js, come mani.js: x specchiate e lati scambiati; 12 fotogrammi uguali, così il filtro è fermo sull'immagine
    const mani = r.landmarks.map((L, i) => ({ lato: r.lati[i] === 'Left' ? 'Right' : r.lati[i] === 'Right' ? 'Left' : null, punti: L.map((q) => ({ x: 1 - q.x, y: q.y, z: q.z })) }));
    const g = createGesti({ innesco_ms: 0, aspetto });
    for (let k = 0; k < 12; k++) g.aggiorna(mani, 1000 + k * 33.3);
    const st = g.stato().mani;
    r.landmarks.forEach((L, i) => {
      const img = L.map((q) => [q.x * aspetto, q.y, q.z * aspetto]), W3 = r.world[i].map((q) => [q.x, q.y, q.z]);
      const incImg = inclinazione(normale(img[0], img[5], img[17])), incW = inclinazione(normale(W3[0], W3[5], W3[17]));
      const u2 = d2(img[4], img[8]) / d2(img[0], img[9]), u3 = d3(img[4], img[8]) / d3(img[0], img[9]), uW = d3(W3[4], W3[8]) / d3(W3[0], W3[9]);
      const i2 = d2(img[4], img[8]) / indice(img, d2), iW = d3(W3[4], W3[8]) / indice(W3, d3);
      const s = st[i] || {};
      const riga = { nome, mano: i, lato: r.lati[i], incImg, incW, u2, u3, uW, i2, iW, aperta: s.aperta, pizzico: s.pizzico, rapporto: s.rapporto, profilo: s.profilo, incGesti: s.inclinazione };
      righe.push(riga);
      const f = (v, d = 2) => v.toFixed(d).replace('.', ',');
      console.log(`${nome} · ${i} · ${riga.lato} | ${f(incImg, 0)}° / ${f(incW, 0)}° | ${f(u2)}, ${f(u3)}, ${f(uW)} | ${f(i2)}, ${f(iW)} | ${s.aperta ? 'sì' : 'no'}${s.profilo ? ' (profilo)' : ''} | ${s.pizzico ? 'sì' : 'no'} (${f(s.rapporto ?? NaN)})`);
    });
    if (!r.landmarks.length) console.log(`${nome} · nessuna mano trovata`);
  }

  // ---------------------------------------------------------------- i controlli
  console.log('');
  esito(delegato === 'GPU', 'MediaPipe gira sulla GPU', `delegato ${delegato}`);
  const di = (n) => righe.filter((r) => r.nome === n);
  const sue = presenti.filter((n) => ATTESE[n]);
  esito(sue.length > 0 && sue.every((n) => di(n).length === ATTESE[n]), 'MediaPipe trova le mani attese nelle sue immagini di prova', presenti.map((n) => `${n} ${di(n).length}`).join(', '));
  // la foto di prova dell'HUD: due mani aperte e non di profilo, quindi in ologramma-hud.mjs devono fare l'innesco
  if (presenti.includes('prova-mani.jpg')) esito(di('prova-mani.jpg').every((r) => r.aperta && !r.profilo), 'la foto di prova: due palmi aperti, non di profilo (l\'innesco dell\'HUD di prova)',
    di('prova-mani.jpg').map((r) => `${r.incImg.toFixed(0)}°`).join(', '));
  // nessuna posa chiusa è un palmo aperto
  const chiuse = ['fist.jpg', 'thumb_up.jpg', 'pointing_up.jpg', 'victory.jpg'].filter((n) => presenti.includes(n));
  esito(chiuse.every((n) => di(n).every((r) => !r.aperta)), 'pugno, pollice in su, indice in su e vittoria non sono palmi aperti', chiuse.map((n) => `${n} ${di(n).map((r) => (r.aperta ? 'aperta' : 'no')).join('/')}`).join(', '));
  // i gesti OK sono pizzichi con le soglie di oggi
  const ok = ['ok-gebaar.jpg', 'ok-cc0.jpg', 'ok-sign.jpg'].filter((n) => presenti.includes(n) && di(n).length);
  if (ok.length) esito(ok.every((n) => di(n).every((r) => r.pizzico)), 'i gesti OK (pollice e indice che si toccano) sono pizzichi con le soglie di oggi', ok.map((n) => di(n).map((r) => `${n} rapporto ${r.rapporto?.toFixed(2)}`).join(', ')).join('; '));
  // l'inclinazione di gesti.js è quella della z dell'immagine
  esito(righe.every((r) => Math.abs(r.incGesti - r.incImg) < 0.5), 'gesti.js misura l\'inclinazione dalla z dell\'immagine', `scarto massimo ${Math.max(...righe.map((r) => Math.abs(r.incGesti - r.incImg))).toFixed(2)}°`);
  // Quale 3D per il profilo: nelle foto di mani piatte davanti alla fotocamera (left_hands, prova-mani) l'inclinazione
  // vera è piccola, e la z dell'immagine deve dirlo
  const piatte = righe.filter((r) => r.nome === 'left_hands.jpg' || r.nome === 'prova-mani.jpg');
  if (piatte.length) esito(piatte.every((r) => r.incImg < 30), 'mani piatte davanti alla fotocamera: la z dell\'immagine dà meno di 30°',
    piatte.map((r) => `${r.nome} ${r.incImg.toFixed(0)}° (mondo ${r.incW.toFixed(0)}°)`).join(', '));
  const scarti = righe.map((r) => Math.abs(r.incImg - r.incW));
  console.log(`\ninclinazione, z dell'immagine contro punti del mondo: scarto mediano ${scarti.sort((a, b) => a - b)[scarti.length >> 1].toFixed(1)}°, massimo ${Math.max(...scarti).toFixed(1)}° su ${righe.length} mani`);
  const pz = righe.filter((r) => r.pizzico);
  console.log(`pizzichi: ${pz.length}; distanza pollice-indice in U (2D): ${pz.map((r) => `${r.nome} ${r.u2.toFixed(2)}`).join(', ') || '—'}; il 10% di Tony è 0,10 U`);
} catch (e) {
  esito(false, 'il banco gira', String(e?.message || e));
} finally {
  clearTimeout(guardia);
  await chiudiTutto();
  const porte = await new Promise((ok) => execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${PORTA}`, `-iTCP:${CDP}`, '-sTCP:LISTEN', '-t'], (e, out) => ok((out || '').trim())));
  esito(!porte && !fs.existsSync(LAVORO), 'Chrome e server chiusi, porte libere, profilo cancellato', porte ? `ancora in ascolto: ${porte}` : `${PORTA} e ${CDP}`);
}
console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exitCode = falliti ? 1 : 0;
