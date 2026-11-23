// salti.mjs — prova i fotogrammi dei salti delle mani (richiesta di Tony del 23/11), in due parti:
// 1. salti.mjs in Node: cosa salva, cosa rifiuta, il tetto del giorno, i nomi, la pulizia dopo 7 giorni;
// 2. mani.js in un Chrome headless sulla GPU, con MediaPipe vero: la foto di prova gira di qualche decina di gradi ogni
//    200 ms, così le punte delle dita saltano rispetto al palmo; si controllano le foto che escono (una al secondo, al
//    massimo N per apertura, con le ossa disegnate), il loro arrivo sul disco, il costo e la via della fotocamera
//    (quella finta di Chrome).
// node prove/salti.mjs [cartella di lavoro] → PASS o FAIL per caso; esce con 0 solo se passa tutto. Porte 4493 e 9593.
// Vuole runtime/modelli/hand_landmarker.task e prova-mani.jpg (vedi «Provare» nel CLAUDE.md).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creaSalti, SALTO_MAX_B } from '../salti.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4493, CDP = 9593, ORIGINE = `http://localhost:${PORTA}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MODELLI = path.join(ROOT, 'runtime', 'modelli');
const LAVORO = fs.mkdtempSync(path.join(process.argv[2] || os.tmpdir(), 'oscar-salti-'));

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const titolo = (t) => console.log(`\n== ${t}`);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

for (const f of ['hand_landmarker.task', 'prova-mani.jpg'])
  if (!fs.existsSync(path.join(MODELLI, f))) { console.log(`FAIL  manca runtime/modelli/${f}: vedi «Provare» nel CLAUDE.md`); process.exit(1); }
const VERA = fs.readFileSync(path.join(MODELLI, 'prova-mani.jpg'));
const finto = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 6, 7), Buffer.from([0xff, 0xd9])]);

// ---------------------------------------------------------------- 1. salti.mjs
titolo('salti.mjs: cosa salva, cosa rifiuta, la pulizia');
{
  const dir = path.join(LAVORO, 'disco');
  const S = creaSalti(dir, { perGiorno: 3 });
  const adesso = new Date(2026, 10, 23, 9, 5, 7, 42);
  let r = S.salva(VERA, 'ologramma', adesso);
  esito(r.ok && r.file === path.join(dir, '2026-11-23', '09-05-07-042-ologramma.jpg') && fs.readFileSync(r.file).equals(VERA),
    'un JPEG vero si salva intero, nella cartella del giorno, col nome dell\'ora', r.file && path.relative(dir, r.file));
  r = S.salva(VERA, 'ologramma', adesso);
  esito(r.ok && r.file.endsWith('09-05-07-042-1-ologramma.jpg'), 'due salti nello stesso millesimo: il secondo non sovrascrive il primo', r.file && path.basename(r.file));
  const storti = [
    ['un PNG', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100)]), 'ologramma'],
    ['un JPEG tagliato (senza la coda)', VERA.subarray(0, VERA.length - 100), 'ologramma'],
    ['un JPEG oltre il limite', finto(SALTO_MAX_B + 1), 'ologramma'],
    ['una vista sconosciuta', VERA, '../../fuori'],
    ['niente', null, 'ologramma'],
    ['una stringa', 'ffd8ff', 'ologramma'],
  ];
  for (const [nome, dati, vista] of storti) { r = S.salva(dati, vista, adesso); esito(!r.ok && r.codice === 400, `${nome}: 400`); }
  esito(S.salva(finto(SALTO_MAX_B), 'ologramma', adesso).ok, 'un JPEG grande proprio quanto il limite passa');
  r = S.salva(VERA, 'ologramma', adesso);
  esito(!r.ok && r.codice === 429 && fs.readdirSync(path.join(dir, '2026-11-23')).length === 3, 'oltre il tetto del giorno: 429, e niente file in più');
  esito(S.salva(VERA, 'ologramma', new Date(2026, 10, 24, 0, 0, 1)).ok, 'il giorno dopo il tetto riparte');

  // La pulizia: oggi e i 6 giorni prima restano; si tocca solo quello che ha il nome di un giorno
  const pulizia = path.join(LAVORO, 'pulizia'), P = creaSalti(pulizia);
  for (const n of ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-22', 'altro', '2026-11-1']) {
    fs.mkdirSync(path.join(pulizia, n), { recursive: true }); fs.writeFileSync(path.join(pulizia, n, 'a.jpg'), 'x');
  }
  fs.writeFileSync(path.join(pulizia, '2026-11-10'), 'un file, non una cartella');
  const via = P.pulisci(new Date(2026, 10, 23, 12));
  const restano = fs.readdirSync(pulizia).sort();
  esito(via.join() === '2026-11-10,2026-11-15,2026-11-16' && restano.join() === '2026-11-1,2026-11-17,2026-11-22,altro',
    'il 23/11 se ne vanno i giorni fino al 16/11; il 17 resta, e i nomi che non sono giorni pure', `via ${via.join(' ')} · restano ${restano.join(' ')}`);
  fs.mkdirSync(path.join(pulizia, '2026-11-26')); fs.mkdirSync(path.join(pulizia, '2026-11-27'));
  const via2 = P.pulisci(new Date(2026, 11, 3, 8));
  esito(via2.join() === '2026-11-17,2026-11-22,2026-11-26' && fs.existsSync(path.join(pulizia, '2026-11-27')), 'a cavallo del mese: il 3/12 resta dal 27/11', via2.join(' '));
  esito(P.salva(VERA, 'ologramma', new Date(2026, 11, 11, 8)).ok && !fs.existsSync(path.join(pulizia, '2026-11-27')), 'salvare pulisce: il 27/11 se ne va l\'11/12');
}

// ---------------------------------------------------------------- 2. mani.js con MediaPipe vero
// La pagina: la foto di prova su una tela che gira di `gradi` attorno al centro ogni 200 ms.
const PAGINA = `<!doctype html><meta charset="utf-8"><title>salti</title><script type="module">
import { createMani, disegnaSalto, inviaSalto } from '/ologramma/mani.js';
const img = new Image(); img.src = '/foto/prova-mani.jpg'; await img.decode();
const W = img.naturalWidth, H = img.naturalHeight;
const tela = document.createElement('canvas'); tela.width = W; tela.height = H;
const c = tela.getContext('2d');
let angolo = 0;
function disegna() { c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.translate(W / 2, H / 2); c.rotate(angolo * Math.PI / 180); c.translate(-W / 2, -H / 2); c.drawImage(img, 0, 0); }
disegna();
// misure, pixel quasi ciano (le ossa di adesso) e quanto varia la luce (una foto tutta uguale è una foto vuota)
async function guarda(blob) {
  const bm = await createImageBitmap(blob);
  const t = new OffscreenCanvas(bm.width, bm.height), x = t.getContext('2d'); x.drawImage(bm, 0, 0);
  const d = x.getImageData(0, 0, bm.width, bm.height).data;
  let ciano = 0, s = 0, s2 = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] < 90 && d[i + 1] > 190 && d[i + 2] > 190) ciano++; const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; }
  const n = d.length / 4;
  return { w: bm.width, h: bm.height, ciano, luce: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)), byte: blob.size };
}
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
window.giro = async ({ secondi, salti, gradi, invia = false, poiAzzera = 0 }) => {
  const foto = [];
  const m = createMani({ sorgente: 'immagine', immagine: tela, hz: 30, salti, onSalto: async (b, t) => {
    const f = { t, ...(await guarda(b)) };
    if (invia) f.http = (await inviaSalto(b, 'ologramma')).status;
    foto.push(f);
  } });
  await m.avvia();
  const cambia = setInterval(() => { angolo = angolo ? 0 : gradi; disegna(); }, 200);
  await dorme(secondi * 1000);
  const mis = m.misure;
  let dopo = null;
  if (poiAzzera) { await dorme(300); const n = foto.length; m.azzeraMisure(); await dorme(poiAzzera * 1000); await dorme(300); dopo = foto.length - n; }
  clearInterval(cambia); angolo = 0; disegna();
  m.ferma();
  await dorme(500); // le ultime foto in volo
  return { foto, salti: mis.gesti?.salti ?? null, rilevazioni: mis.rilevazioni, mani: mis.mani, dopo };
};
// il costo sincrono di una foto (la parte che ferma l'HUD), e la via della fotocamera finta di Chrome
const finta = [{ punti: Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + 0.02 * i, y: 0.4 + 0.01 * i, z: 0 })) }];
window.costo = async () => {
  const t = [];
  for (let k = 0; k < 12; k++) { const a = performance.now(); const p = disegnaSalto(tela, finta, finta); t.push(performance.now() - a); await p; }
  return t.slice(2).sort((a, b) => a - b);
};
window.camera = async () => {
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = s; document.body.appendChild(v);
  await v.play(); await dorme(400);
  const ms = []; let b;
  for (let k = 0; k < 8; k++) { const a = performance.now(); const p = disegnaSalto(v, finta, null); ms.push(performance.now() - a); b = await p; await dorme(150); }
  const r = await guarda(b);
  for (const tr of s.getTracks()) tr.stop(); v.remove();
  return { ...r, ms };
};
window.pronto = true;
</script>`;

const salvati = creaSalti(path.join(LAVORO, 'server'));
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.task': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const p = new URL(req.url, ORIGINE).pathname;
  if (req.method === 'POST' && p === '/api/mani/salto') { // come server.mjs, senza i controlli dell'origine (li prova ologramma-server.mjs)
    const parti = [];
    req.on('data', (d) => parti.push(d));
    req.on('end', () => {
      let b = {};
      try { b = JSON.parse(Buffer.concat(parti).toString('utf8')); } catch {}
      const r = salvati.salva(typeof b.jpeg === 'string' ? Buffer.from(b.jpeg, 'base64') : null, b.vista);
      res.writeHead(r.ok ? 204 : r.codice).end();
    });
    return;
  }
  if (p === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGINA);
  let f = null;
  if (p === '/modelli/hand_landmarker.task' || p === '/foto/prova-mani.jpg') f = path.join(MODELLI, path.basename(p));
  else if (p === '/ologramma/mani.js' || p === '/ologramma/gesti.js') f = path.join(ROOT, 'public', p);
  else if (p.startsWith('/mediapipe/')) { const base = path.join(ROOT, 'node_modules/@mediapipe/tasks-vision'); f = path.join(base, decodeURIComponent(p.slice(11))); if (!f.startsWith(base + path.sep)) f = null; }
  if (!f) return res.writeHead(404).end();
  fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }).end(d)));
});
await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));

const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' });
let ws = null, nId = 0;
const attese = new Map();
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(espressione) {
  const r = await cdp('Runtime.evaluate', { expression: espressione, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function chiudiTutto() {
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM');
  for (let k = 0; k < 40 && chrome.exitCode === null && chrome.signalCode === null; k++) await pausa(100);
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill('SIGKILL');
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await pausa(300);
  if (!process.argv[3]) fs.rmSync(LAVORO, { recursive: true, force: true }); // con un terzo argomento le foto restano, da guardare
}
const guardia = setTimeout(async () => { console.log('FAIL  la prova dura più di 2 minuti'); await chiudiTutto(); process.exit(1); }, 120000);

try {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!pagina) throw new Error(`Chrome non risponde sulla porta ${CDP}`);
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); } };
  await cdp('Page.navigate', { url: ORIGINE + '/' });
  for (let k = 0; k < 100; k++) { await pausa(100); if (await ev('window.pronto === true').catch(() => false)) break; }
  if (!(await ev('window.pronto === true'))) throw new Error('la pagina non è partita');

  titolo('mani.js: la foto gira, le dita saltano, le foto escono');
  // Previsione scritta prima: almeno 10 salti in 6 s (30 cambi di angolo, due mani); una foto al secondo, quindi 6–7;
  // ogni foto 30–60 KB, grande quanto la foto di prova, con le ossa in ciano.
  const W = 720, H = 382;
  const g1 = await ev('giro({ secondi: 6, gradi: 40, salti: { ogniMs: 1000, max: 50 }, invia: true })');
  const F = g1.foto, gap = F.slice(1).map((f, i) => f.t - F[i].t);
  esito(g1.salti >= 10, 'MediaPipe vede i salti della foto che gira', `${g1.salti} salti in 6 s, ${g1.rilevazioni} rilevazioni`);
  esito(F.length >= 5 && F.length <= 7 && Math.min(...gap) >= 900, 'una foto al secondo, non una a salto', `${F.length} foto, distanza minima ${Math.round(Math.min(...gap))} ms`);
  esito(F.every((f) => f.w === W && f.h === H), 'ogni foto è grande quanto la sorgente', F.map((f) => `${f.w}×${f.h}`).join(' '));
  esito(F.every((f) => f.ciano > 300), 'su ogni foto ci sono le ossa disegnate in ciano', F.map((f) => f.ciano).join(' '));
  esito(F.every((f) => f.byte > 5000 && f.byte < 120000), 'ogni foto pesa fra 5 e 120 KB', F.map((f) => `${(f.byte / 1000).toFixed(0)} KB`).join(' '));
  const giorno = fs.existsSync(salvati.cartella) ? fs.readdirSync(salvati.cartella) : [];
  const file = giorno.flatMap((g) => fs.readdirSync(path.join(salvati.cartella, g)).map((n) => path.join(salvati.cartella, g, n)));
  esito(F.every((f) => f.http === 204) && file.length === F.length && file.every((f) => /\d{2}-\d{2}-\d{2}-\d{3}(-\d+)?-ologramma\.jpg$/.test(f)),
    'inviaSalto le porta al server, che le scrive sul disco', `${file.length} file in ${giorno.join(' ')}: ${F.map((f) => f.http).join(' ')}`);
  if (file.length) console.log(`      una foto: ${file[0]}`);

  // Il tetto per apertura: 3 foto anche con ogniMs corto; azzeraMisure (un'apertura nuova) le fa ripartire
  const g2 = await ev('giro({ secondi: 3, gradi: 40, salti: { ogniMs: 100, max: 3 }, poiAzzera: 1.5 })');
  esito(g2.foto.length - g2.dopo === 3 && g2.dopo >= 1 && g2.dopo <= 3, 'al massimo N foto per apertura; un\'apertura nuova riparte da zero', `${g2.foto.length - g2.dopo} prima, ${g2.dopo} dopo l'azzeramento`);

  // Ferma: niente salti, niente foto
  const g3 = await ev('giro({ secondi: 2, gradi: 0, salti: { ogniMs: 100, max: 50 } })');
  esito(g3.foto.length === 0 && g3.salti === 0 && g3.mani === 2, 'con la foto ferma: nessun salto, nessuna foto', `${g3.salti} salti, ${g3.mani} mani, ${g3.foto.length} foto`);

  titolo('Il costo e la fotocamera');
  // Previsione: la parte sincrona di una foto (disegno e avvio della codifica) sotto i 3 ms
  const t = await ev('costo()');
  const med = t[t.length >> 1], mx = t[t.length - 1];
  esito(med < 3 && mx < 8, 'la parte sincrona di una foto costa poco all\'HUD', `mediana ${med.toFixed(2)} ms, massimo ${mx.toFixed(2)} ms su 10`);
  const v = await ev('camera()');
  esito(v.w === 640 && v.h === 480 && v.luce > 5 && v.ciano > 50, 'dalla fotocamera (quella finta di Chrome): 640×480, un\'immagine vera e le ossa sopra',
    `${v.w}×${v.h}, luce ±${v.luce.toFixed(1)}, ${v.ciano} px ciano, ${(v.byte / 1000).toFixed(0)} KB, ms ${v.ms.map((x) => x.toFixed(1)).join(' ')}`);
} catch (e) {
  esito(false, 'la prova si è fermata', e.message);
}
clearTimeout(guardia);
await chiudiTutto();
console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exit(falliti ? 1 : 0);
