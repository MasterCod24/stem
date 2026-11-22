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

// ---------------------------------------------------------------- un ologramma con la ricerca sui pezzi
// Lo stato è quello vero di ologramma.mjs (senza calcolo): l'HUD lo legge da GET /api/ologramma dopo l'evento «holo», come
// con il cervello. I testi sono ai limiti (60 e 140 caratteri): la scheda, larga al massimo 300 px, deve mandarli a capo.
// La fattura dello schermo è scritta come HTML: deve restare testo. La fonte per pezzo è stata tolta l'11/11.
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
const SCHEDA_ATTESA = PORTATILE.pezzi[0];
// La molecola d'acqua col campo colore (11/11): ossigeno rosso, idrogeni bianchi, legami senza colore (il ciano di sempre).
// Angolo H-O-H 104,5°, distanza O-H 200 mm in scala (le sfere hanno i raggi chiesti, 76 e 53 mm): i legami vanno dalla
// superficie di una sfera all'altra, 5 mm dentro a ogni capo. con: false è la stessa molecola senza colori, per confrontare.
const META = (104.5 / 2) * Math.PI / 180, DOH = 200, RO = 76, RH = 53;
function acqua(con = true) {
  const pezzi = [{ id: 'ossigeno', nome: 'Ossigeno', forma: 'sfera', misure: { r: RO }, ...(con ? { colore: '#e53935' } : {}) }];
  for (const s of [1, -1]) {
    const dx = s * Math.sin(META), dy = -Math.cos(META), da = RO - 5, a = DOH - RH + 5, m = (da + a) / 2, n = s > 0 ? 1 : 2;
    pezzi.push({ id: `idrogeno-${n}`, nome: 'Idrogeno', forma: 'sfera', misure: { r: RH }, posizione: [DOH * dx, DOH * dy, 0], ...(con ? { colore: '#FFF' } : {}) });
    pezzi.push({ id: `legame-${n}`, nome: 'Legame', forma: 'cilindro', misure: { r: 10, h: a - da }, posizione: [m * dx, m * dy, 0], rotazione: [0, 0, s * META * 180 / Math.PI] });
  }
  return { titolo: "Molecola d'acqua", descrizione: 'Ossigeno rosso, idrogeni bianchi: il campo colore dei pezzi.', pezzi };
}
// Tavolozza: tre grigi e il nero per l'ordine di chiarezza, quattro tinte, un rosso interno (s8, più tenue in ologramma) e un
// bianco (s9) che la prova sceglie alla fine, per vedere la selezione su un colore chiaro
const TAVOLOZZA = { titolo: 'Tavolozza', pezzi: ['#ffffff', '#808080', '#202020', '#000000', '#e53935', '#1e88e5', '#43a047', '#fdd835', '#e53935', '#ffffff'].map((c, i) => ({
  id: `s${i}`, forma: 'sfera', misure: { r: 40 }, posizione: [(i % 5) * 120 - 240, i < 5 ? 70 : -70, 0], colore: c, interno: i === 8 })) };
// Se i testi non sono proprio ai limiti, la prova non prova quello che dice (il 11/11 erano 61 e 144: tagliati, e il controllo falliva)
for (const [k, n] of [['materiale_vero', 60], ['fattura', 140]]) if (Array.from(SCHEDA_ATTESA[k]).length !== n) throw new Error(`${k} della prova deve avere ${n} caratteri`);

// ---------------------------------------------------------------- server finto
let guasto = false; // true: /api/status risponde 500 (server che non c'è più)
const TIPI = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.css': 'text/css' };
const PUB = path.join(REPO, 'public'), THREE_DIR = path.join(REPO, 'node_modules', 'three'), MP = path.join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const sotto = (base, rel) => { const f = path.resolve(base, '.' + path.sep + decodeURIComponent(rel)); return f === base || f.startsWith(base + path.sep) ? f : null; };
let ultimoPerche; // il perché dell'ultima domanda: il server vero ne fa la riga [sentito] per il cervello
const corpo = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => { s += d; }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });
async function copione(res, testo) { // il cervello finto: eventi NDJSON con le loro pause
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  const passi = /scheda/i.test(testo) // una ricerca senza browser (eventi «web»), poi l'ologramma: «schermo» sceglie il pezzo senza chiave
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
// La scheda del pezzo com'è nella pagina: righe [chiave, valore], misure, cosa esce dai bordi e quali scritte dell'ologramma copre
const SCHEDA = `(() => { const c = document.querySelector('.holo-card'), r = c.getBoundingClientRect();
  const copre = (e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && Number(getComputedStyle(e).opacity) > 0.05 && !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom); };
  return { on: c.classList.contains('on'), nome: c.querySelector('b')?.textContent || '', righe: [...c.querySelectorAll('div')].map((d) => [d.querySelector('.k').textContent, d.querySelector('.v').textContent]),
    larga: r.width, alta: r.height, basso: r.bottom, esce: c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll('.v, b')].some((v) => [...v.getClientRects()].some((q) => q.right > r.right + 0.5 || q.left < r.left - 0.5)),
    elementi: c.querySelectorAll('img, script, a, iframe, svg').length, allarme: typeof window.__xss,
    copre: ['.holo-top', '.holo-desc', '.holo-leg.on', '.holo-tag', '.holo-quota'].filter((s) => [...document.querySelectorAll(s)].some(copre)) }; })()`;
const riga = (c, k) => (c.righe.find((x) => x[0] === k) || [])[1];

// ---------------------------------------------------------------- il campo colore dei pezzi
// I colori di prima, scritti qui come in scena.js prima del campo colore: un pezzo senza colore deve averli identici
const hexLin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const PRIMA = { linea: hexLin(0x2595a6), alta: hexLin(0x37d0e7), solido: [0.135, 0.185, 0.2], scuro: [0.002, 0.014, 0.02] };
const stessi = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const CAMPI_U = ['colA', 'colB', 'spigoli', 'fill', 'rim', 'amb', 'i', 'opaco', 'campo'];
const ugualiU = (a, b, campi = CAMPI_U) => campi.every((k) => (Array.isArray(a?.[k]) ? stessi(a[k], b?.[k]) : a?.[k] === b?.[k]));
// Media dei pixel di un quadrato di lato px (CSS) attorno a (x, y), da uno screenshot: [R, G, B] in 0..255
async function pixel([x, y], lato = 8) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: x - lato / 2, y: y - lato / 2, width: lato, height: lato, scale: 1 } });
  return ev(`(async () => { const i = await createImageBitmap(await (await fetch('data:image/png;base64,${r.data}')).blob());
    const g = new OffscreenCanvas(i.width, i.height).getContext('2d'); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, i.width, i.height).data, s = [0, 0, 0]; for (let k = 0; k < d.length; k += 4) for (let c = 0; c < 3; c++) s[c] += d[k + c];
    return s.map((v) => Math.round(v / (d.length / 4))); })()`);
}
const mostraOlo = (st) => ev(`oscarOlogramma(${JSON.stringify(st)}).pezzi`);
const modoOlo = async (m) => { await ev(`oscarOlo.comando('modo', ${JSON.stringify(m)}); true`); await pausa(150); return ev('oscarOlo.colori()'); };
const MODI_TUTTI = ['ologramma', 'solido', 'raggi-x', 'densita', 'sforzi'];
async function coloriPerModo() { const o = {}; for (const m of MODI_TUTTI) o[m] = await modoOlo(m); await modoOlo('ologramma'); return o; }
// Rosso: R nettamente sopra G e B. Bianco: tre canali vicini, e più chiari del fondo. Con un margine del 15% passava anche
// il grigio azzurro del solido senza colore (92, 106, 110: provato togliendo il colore dalla scena), con l'8% no.
const rosso = (p) => p[0] >= 1.6 * Math.max(p[1], p[2]) && p[0] - Math.max(p[1], p[2]) >= 25;
const bianco = (p, fondo) => Math.max(...p) - Math.min(...p) <= 0.08 * Math.max(...p) + 3 && (p[0] + p[1] + p[2]) / 3 >= (fondo[0] + fondo[1] + fondo[2]) / 3 + 15;

async function provaColore() {
  // tinta: la funzione che porta un colore nella fascia di un modo. Ordine dei grigi, pavimento, tetto e tinte
  const T = await ev(`import('/ologramma/scena.js').then((m) => { const L = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b, o = {};
    for (const f of [0.226, 0.472, 0.172]) o[f] = ['#ffffff', '#808080', '#202020', '#000000', '#e53935', '#1e88e5'].map((h) => { const c = m.tinta(h, f); return [c.r, c.g, c.b, L(c)]; });
    return o; })`);
  for (const [k, [w, g, s, n, r, b]] of Object.entries(T)) {
    const f = Number(k);
    const tutti = [w, g, s, n, r, b];
    controlla(Math.abs(w[3] - f) < 1e-6 && w[3] > g[3] && g[3] > s[3] && s[3] >= n[3] && n[3] > 0.1 * f, `tinta, fascia ${f}: #ffffff prende la fascia, #808080 e #202020 sotto in ordine, il nero resta sopra lo zero`,
      [w, g, s, n].map((c) => c[3].toFixed(4)).join(' > '));
    controlla(tutti.every((c) => c[3] <= f + 1e-9 && Math.max(c[0], c[1], c[2]) <= 0.9 + 1e-9) && r[0] > 3 * Math.max(r[1], r[2]) && b[2] > 1.5 * Math.max(b[0], b[1]),
      `tinta, fascia ${f}: nessun colore sopra la fascia né un canale sopra 0,9; il rosso resta rosso e il blu blu`, `rosso ${r.slice(0, 3).map((v) => v.toFixed(3))}, blu ${b.slice(0, 3).map((v) => v.toFixed(3))}`);
  }

  // La stessa molecola senza colori, poi con: gli uniform per modo
  OLO.esegui({ azione: 'mostra', modello: acqua(false) });
  await mostraOlo(OLO.stato()); await pausa(2500);
  const senza = await coloriPerModo();
  const ids = Object.keys(senza.ologramma);
  controlla(ids.length === 5 && ids.every((id) => stessi(senza.ologramma[id].colA, PRIMA.linea) && stessi(senza.ologramma[id].colB, PRIMA.alta) && stessi(senza.ologramma[id].spigoli, PRIMA.alta) &&
    stessi(senza.solido[id].colA, PRIMA.solido) && stessi(senza.solido[id].colB, PRIMA.alta) && stessi(senza.solido[id].spigoli, PRIMA.scuro)),
    'senza colore i pezzi hanno i colori di prima: ciano in ologramma, il grigio azzurro nel solido, spigoli scuri');
  OLO.esegui({ azione: 'mostra', modello: acqua(true) });
  await mostraOlo(OLO.stato()); await pausa(2500);
  const con = await coloriPerModo();
  const m0 = (await ev('oscarOlo.info()')).montaggi;
  for (const m of ['raggi-x', 'densita', 'sforzi']) {
    controlla(ids.every((id) => ugualiU(con[m][id], senza[m][id])), `in ${m} gli uniform di ogni pezzo sono quelli della molecola senza colori`,
      `ossigeno colA ${con[m].ossigeno?.colA.map((v) => v.toFixed(3))}`);
  }
  for (const m of ['ologramma', 'solido']) {
    controlla(['legame-1', 'legame-2'].every((id) => ugualiU(con[m][id], senza[m][id])) && !stessi(con[m].ossigeno.colA, senza[m].ossigeno.colA) && !stessi(con[m]['idrogeno-1'].colA, senza[m]['idrogeno-1'].colA),
      `in ${m} i legami senza colore restano come prima, ossigeno e idrogeni cambiano`);
  }
  // i pixel al centro degli atomi, col fondo dal punto speculare agli idrogeni rispetto all'ossigeno (122 mm sopra, fuori dalla sfera da 76)
  for (const m of ['ologramma', 'solido']) {
    const c = await modoOlo(m); await pausa(1200);
    const O = c.ossigeno.centro, H1 = c['idrogeno-1'].centro, H2 = c['idrogeno-2'].centro;
    const F = [2 * O[0] - (H1[0] + H2[0]) / 2, 2 * O[1] - (H1[1] + H2[1]) / 2];
    const po = await pixel(O), p1 = await pixel(H1), p2 = await pixel(H2), pf = await pixel(F);
    controlla(rosso(po), `${m}: al centro dell'ossigeno il rosso è nettamente sopra verde e blu`, `ossigeno ${po}, fondo ${pf}`);
    controlla(bianco(p1, pf) && bianco(p2, pf), `${m}: al centro degli idrogeni tre canali vicini, più chiari del fondo`, `idrogeni ${p1} e ${p2}, fondo ${pf}`);
    await foto(`molecola-${m}`);
  }
  // un cambio di solo colore: versione nuova, materiale aggiornato, nessuna geometria montata di nuovo
  await modoOlo('ologramma');
  OLO.esegui({ azione: 'modifica', cambia: [{ id: 'ossigeno', colore: '#1e88e5' }] });
  await mostraOlo(OLO.stato()); await pausa(300);
  let c = await ev('oscarOlo.colori()'), m1 = (await ev('oscarOlo.info()')).montaggi;
  const blu = c.ossigeno.colA;
  controlla(m1 === m0 && blu[2] > 2 * Math.max(blu[0], blu[1]), 'cambio di solo colore: l\'ossigeno diventa blu senza montare geometrie nuove', `montaggi ${m0} → ${m1}, colA ${blu.map((v) => v.toFixed(3))}`);
  OLO.esegui({ azione: 'modifica', cambia: [{ id: 'ossigeno', colore: '' }] });
  await mostraOlo(OLO.stato()); await pausa(300);
  c = await ev('oscarOlo.colori()'); m1 = (await ev('oscarOlo.info()')).montaggi;
  const COLORI = ['colA', 'colB', 'spigoli', 'fill', 'rim']; // amb resta quello dell'ultimo modo opaco: in ologramma non conta
  controlla(m1 === m0 && ugualiU(c.ossigeno, senza.ologramma.ossigeno, COLORI) && ugualiU(c['idrogeno-1'], con.ologramma['idrogeno-1'], COLORI), 'colore vuoto: l\'ossigeno torna al ciano di prima, gli idrogeni restano bianchi', `montaggi ${m1}`);
  // la tavolozza, solo da guardare: ordine dei grigi, nero visibile, tinte, interno più tenue (s8) e scelto più acceso (s9)
  OLO.esegui({ azione: 'mostra', modello: TAVOLOZZA });
  await mostraOlo(OLO.stato()); await pausa(3000);
  // i pixel al centro di ogni sfera, solo stampati: sono i numeri con cui si guardano le foto
  const centri = async (nome) => { const c = await ev('oscarOlo.colori()'), r = [];
    for (const [id, x] of Object.entries(c)) r.push(`${id} ${TAVOLOZZA.pezzi.find((p) => p.id === id).colore} ${await pixel(x.centro)}`);
    console.log(`      ${nome}: ${r.join('; ')}`); };
  await foto('tavolozza-ologramma'); await centri('tavolozza in ologramma');
  await modoOlo('solido'); await pausa(1200); await foto('tavolozza-solido'); await centri('tavolozza nel solido');
  await ev("oscarOlo.comando('seleziona', 's9'); true"); await pausa(1500); await foto('tavolozza-scelta'); await centri('tavolozza nel solido, s9 scelto');
  await tasto('Escape', 'Escape', 27); await pausa(1500);
}

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
  if (!SOLO || ['avvio-1', 'avvio-3', 'avvio-6'].some((n) => SOLO.has(n))) {
    for (const [t, nome] of [[1, 'avvio-1'], [3.5, 'avvio-3'], [6, 'avvio-6']]) { await vai(`?debug&t=${t}`, false); await pausa(2500); await foto(nome); }
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
  await ev("oscarAsk('apri il browser'); true"); await pausa(2600); await foto('browser');
  await attendi(async () => (await modo()) === 'idle', 12000);
  await tasto('Escape', 'Escape', 27); await pausa(800);
  await ev(`oscarReport({ titolo: 'Realtà virtuale nel 2026', blocchi: [
    { tipo: 'testo', titolo: 'Il mercato', testo: 'Le spedizioni di visori sono cresciute del 12% rispetto al 2025, trainate dai modelli leggeri.', fonte: 'IDC' },
    { tipo: 'dato', titolo: 'Visori venduti', valore: '9,4 mln', testo: 'Nel mondo, primi tre trimestri.', fonte: 'IDC' },
    { tipo: 'grafico', titolo: 'Quote', valori: [{ etichetta: 'Meta', valore: 62 }, { etichetta: 'Apple', valore: 14 }, { etichetta: 'Sony', valore: 9 }, { etichetta: 'Altri', valore: 15 }], unita: '%', testo: 'Quote di mercato.', fonte: 'IDC' },
    { tipo: 'testo', titolo: 'Cosa cambia', testo: 'Lenti pancake e schermi micro-OLED riducono peso e calore.', fonte: 'Wikipedia' },
    { tipo: 'dato', titolo: 'Peso medio', valore: '410 g', testo: 'Contro i 520 g del 2023.' },
    { tipo: 'testo', titolo: 'Limiti', testo: 'Batteria e prezzo restano i freni principali.' } ] }); true`);
  await pausa(3000); await foto('report');
  await ev("oscarParziale('oscar chiudi il report'); true"); await pausa(600); await foto('report-ascolto');
  await ev("oscarParziale(''); true");
  await tasto('Escape', 'Escape', 27); await pausa(1200);
  // La ricerca sui pezzi: gli eventi «web» come etichetta piccola, poi la scheda del pezzo scelto con materiale e fattura
  if (!SOLO || ['ricerca-web', 'scheda-ricerca', 'scheda-schermo'].some((n) => SOLO.has(n))) {
    await ev("oscarAsk('fammi la scheda del portatile'); true");
    const piccola = await attendi(() => ev("(() => { const e = document.getElementById('small'); return e.classList.contains('on') && e.textContent === 'LEGGO · IFIXIT.COM' ? e.textContent : ''; })()"), 4000, 50);
    controlla(piccola === 'LEGGO · IFIXIT.COM', "l'evento «web» di una pagina compare come etichetta piccola, col solo nome del sito", piccola || await ev("document.getElementById('small').textContent"));
    controlla(await ev("!document.body.classList.contains('browsing')"), 'una ricerca senza browser non apre il pannello del browser');
    await foto('ricerca-web');
    await attendi(() => ev("document.querySelector('.holo-card.on') !== null"), 8000); await pausa(3000);
    let c = await ev(SCHEDA);
    const P = SCHEDA_ATTESA;
    controlla(c.on && c.nome === P.nome && riga(c, 'materiale') === `${P.materiale_vero} · calcolato come alluminio 6061-T6 · 2700 kg/m³` && riga(c, 'fattura') === P.fattura && riga(c, 'fonte') === undefined,
      'scheda con la ricerca: materiale vero e «calcolato come» la chiave, fattura, e nessuna riga della fonte', JSON.stringify(c.righe.slice(0, 3)));
    controlla(c.larga <= 300.5 && !c.esce && c.copre.length === 0 && c.basso < H, 'testi ai limiti (60 e 140 caratteri): la scheda resta entro 300 px, niente esce e non copre altre scritte',
      `${Math.round(c.larga)} × ${Math.round(c.alta)} px, fino a y ${Math.round(c.basso)}; copre: ${c.copre.join(', ') || 'niente'}`);
    await foto('scheda-ricerca');
    await attendi(async () => (await modo()) === 'idle', 12000);
    await ev("oscarAsk('ora la scheda dello schermo'); true");
    await attendi(() => ev("document.querySelector('.holo-card b')?.textContent === 'Schermo'"), 8000); await pausa(1500);
    c = await ev(SCHEDA);
    controlla(riga(c, 'materiale') === 'vetro alluminosilicato su pannello IPS' && riga(c, 'fonte') === undefined, 'senza chiave non c\'è «calcolato come», e la fonte non compare', JSON.stringify(c.righe.slice(0, 3)));
    controlla(riga(c, 'fattura').startsWith('<img src=x onerror=alert(1)>') && c.elementi === 0 && c.allarme === 'undefined', 'una fattura scritta come HTML resta testo: nessun elemento nella scheda');
    controlla(!c.esce && c.copre.length === 0, 'anche questa non esce e non copre altre scritte', `copre: ${c.copre.join(', ') || 'niente'}`);
    await foto('scheda-schermo');
    await attendi(async () => (await modo()) === 'idle', 12000);
    await ev("oscarAsk('e la scheda di un pezzo con niente'); true");
    await attendi(() => ev("document.querySelector('.holo-card b')?.textContent === 'Scheda logica'"), 8000); await pausa(800);
    c = await ev(SCHEDA);
    controlla(riga(c, 'materiale') === 'non detto (si disegna, non si calcola)' && riga(c, 'fattura') === undefined && riga(c, 'fonte') === undefined, 'un pezzo senza ricerca: «non detto», senza riga fattura', JSON.stringify(c.righe.slice(0, 2)));
    await attendi(async () => (await modo()) === 'idle', 12000);
    await tasto('Escape', 'Escape', 27); await pausa(1500);
    controlla(OLO.stato().aperto === false, "Esc chiude l'ologramma anche nello stato del server finto");
  }
  // Il campo colore dei pezzi: la molecola d'acqua in ologramma e solido, i pixel al centro degli atomi, e gli uniform di
  // densità e sforzi uguali a quelli della stessa molecola senza colori
  if (!SOLO || ['molecola-ologramma', 'molecola-solido', 'tavolozza-ologramma', 'tavolozza-solido', 'tavolozza-scelta'].some((n) => SOLO.has(n))) await provaColore();
  await ev("oscarOlogrammaDemo('turbofan').then(() => true)"); await pausa(3500); await foto('ologramma');
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
  console.log(`${fatte.length} foto in ${USCITA}; controlli: ${controlli - falliti} PASS, ${falliti} FAIL`);
  process.exit(codice);
}
