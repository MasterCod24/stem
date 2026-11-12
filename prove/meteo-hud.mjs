// meteo-hud.mjs — prova la vista meteo nell'HUD vero (index.html, nexus.js, meteo/vista.js), in un Chrome headless sulla GPU.
// Il server finto qui dentro serve i file come server.mjs e dà a GET /api/meteo le previsioni vere di Open-Meteo (Milano), poi
// le stesse con tre avvisi aggiunti a mano. Il radar è quello vero di RainViewer: la prova vuole la rete.
// Fa le foto, prova mouse, tastiera e gesti (gesti finti mandati alla vista, come li manda gesti.js) e misura gli fps con le
// mani accese sulla foto di prova (?debug&mani=immagine), la regola di Tony: sopra 45.
//   node prove/meteo-hud.mjs [cartella delle foto] → PASS o FAIL per caso; esce con 0 solo se passa tutto. Porte 4432 e 9563.
// Gli fps sono fotogrammi di requestAnimationFrame contati in ogni secondo intero (window.__misure): il caso migliore, col
// riconoscimento vocale spento e la foto al posto della fotocamera.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeteo } from '../meteo.mjs';
import { H } from '../public/meteo/dati.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4432, CDP = 9563, ORIGINE = `http://localhost:${PORTA}`, W = 1470, Hh = 956;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meteo-hud-'));
const FOTO = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meteo-foto-'));
fs.mkdirSync(FOTO, { recursive: true });

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const titolo = (t) => console.log(`\n== ${t}`);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); } }

// ---------------------------------------------------------------- i dati: veri, poi con tre avvisi
const m = createMeteo({ cartella: LAVORO });
const vero = await m.mostra({ luogo: 'Milano' });
if (!vero.ok) { console.log(`FAIL  Open-Meteo: ${vero.errori.join('; ')}`); process.exit(1); }
const conAvvisi = structuredClone(vero.dati), adesso = Date.now();
conAvvisi.ora.pressione = 1000; conAvvisi.ora.raffiche = 95;
for (const o of conAvvisi.ore) {
  o.pressione = 1000 - ((o.t - adesso) / H) * 1.4; // −4,2 hPa in 3 ore
  if (o.t > adesso + 2 * H && o.t <= adesso + 4 * H) { o.codice = 95; o.prob = 85; }
}
let DATI = vero.dati, misura = null; // misura: l'ultima POST «misura» delle mani

// ---------------------------------------------------------------- il server finto
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const BASI = [['/three/', path.join(ROOT, 'node_modules/three')], ['/mediapipe/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')], ['/', path.join(ROOT, 'public')]];
const json = (res, c, d) => res.writeHead(c, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(d));
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, ORIGINE).pathname;
  if (req.method === 'GET' && p.startsWith('/modelli/')) {
    const f = path.join(ROOT, 'runtime/modelli', path.basename(p));
    return fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] }).end(d)));
  }
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    const [pre, base] = BASI.find(([a]) => p.startsWith(a)), f = path.join(base, p === '/' ? 'index.html' : decodeURIComponent(p.slice(pre.length)));
    if (!f.startsWith(base + path.sep)) return res.writeHead(403).end();
    return fs.readFile(f, (e, d) => (e ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(d)));
  }
  const parti = [];
  for await (const c of req) parti.push(c);
  let corpo = {};
  try { corpo = JSON.parse(Buffer.concat(parti).toString() || '{}'); } catch {}
  if (p === '/api/status') return json(res, 200, { voice: { provider: 'mac' }, browser: false, gifs: false, agenda: 0, ologramma: 0 });
  if (req.method === 'GET' && p === '/api/meteo') return json(res, 200, DATI);
  if (p === '/api/ask') return res.writeHead(200, { 'content-type': 'application/x-ndjson' }).end();
  if (p === '/api/log' || p === '/api/stop') return res.writeHead(204).end();
  if (req.method === 'POST' && p === '/api/ologramma' && corpo.azione === 'misura') { misura = corpo; return res.writeHead(204).end(); }
  return res.writeHead(404).end();
});
await new Promise((ok) => server.listen(PORTA, '127.0.0.1', ok));

// ---------------------------------------------------------------- Chrome e CDP
const profilo = path.join(LAVORO, 'chrome');
fs.mkdirSync(profilo, { recursive: true });
fs.writeFileSync(path.join(profilo, 'Local State'), JSON.stringify({ performance_tuning: { battery_saver_mode: { state: 0 } } })); // niente tetto a 30 fps a batteria
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profilo}`, '--mute-audio', '--no-first-run',
  '--no-default-browser-check', `--window-size=${W},${Hh}`, '--force-device-scale-factor=2', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
const guardia = setTimeout(() => { console.log('FAIL  la prova dura più di 4 minuti'); chrome.kill('SIGKILL'); process.exit(1); }, 240000);

let ws = null, nId = 0;
const attese = new Map(), eccezioni = [], errori = [], host = new Map();
async function connetti() {
  let pagina;
  for (let k = 0; k < 75 && !pagina; k++) { await pausa(200); try { pagina = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  ws = new WebSocket(pagina.webSocketDebuggerUrl);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
  ws.onmessage = (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id && attese.has(d.id)) { const a = attese.get(d.id); attese.delete(d.id); d.error ? a.ko(new Error(d.error.message)) : a.ok(d.result); return; }
    if (d.method === 'Network.requestWillBeSent') { const u = d.params.request.url; if (/^https?:/.test(u)) { const x = new URL(u).host; host.set(x, (host.get(x) || 0) + 1); } }
    else if (d.method === 'Runtime.exceptionThrown') eccezioni.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errori.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
}
const cdp = (method, params = {}) => new Promise((ok, ko) => { const i = ++nId; attese.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params })); });
async function ev(e) {
  const r = await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function vai(url) {
  await cdp('Page.navigate', { url });
  if (!(await attendi(() => ev("document.body?.classList.contains('ready') && typeof window.nexusMeteo === 'function'").catch(() => false), 25000, 200))) throw new Error(`l'HUD non è pronto: ${url}`);
}
async function foto(nome) {
  const r = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: Hh, scale: 0.5 } });
  fs.writeFileSync(path.join(FOTO, `${nome}.png`), Buffer.from(r.data, 'base64'));
}
const mouse = (type, x, y, o = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...o });
async function trascina(x0, y0, x1, y1) {
  await mouse('mousePressed', x0, y0, { buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, { buttons: 1 }); await pausa(16); }
  await mouse('mouseReleased', x1, y1, { buttons: 0, clickCount: 1 });
  await pausa(100);
}
const TASTI = { ArrowRight: ['ArrowRight', 39], Escape: ['Escape', 27], 0: ['Digit0', 48] };
async function tasto(k) {
  const [code, vk] = TASTI[k], t = k.length === 1 ? { text: k, unmodifiedText: k } : {};
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...t });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  await pausa(80);
}
const info = () => ev('nexusVistaMeteo()?.info()');
const centro = (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, r.left]; })()`);
const gesto = (g) => ev(`nexusVistaMeteo().gesto(${JSON.stringify(g)})`);
// un pizzico breve: afferra e lascia nello stesso fotogramma, come li manda gesti.js
const pizzico = (x, y) => ev(`(() => { const v = nexusVistaMeteo(); v.gesto(${JSON.stringify({ tipo: 'afferra', x, y })}); v.gesto({ tipo: 'lascia' }); })()`);

try {
  await connetti();
  await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
  // il viewport di --window-size perde l'altezza delle barre (813 invece di 956 punti): lo schermo di Tony si impone qui
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: Hh, deviceScaleFactor: 2, mobile: false });

  titolo('Apertura con le previsioni vere di Milano e il radar vero');
  await vai(`${ORIGINE}/?debug`);
  const t0 = Date.now();
  await ev('nexusMeteo()');
  await pausa(1300);
  await foto('meteo-1-entrata');
  const pronta = await attendi(async () => { const i = await info(); return i?.radar?.n > 0 && i.radar.scaricate >= i.radar.n && i; }, 25000, 250);
  esito(Boolean(pronta), 'le 13 mappe del radar scaricate e ricolorate', pronta ? `${pronta.radar.n} mappe in ${((Date.now() - t0) / 1000).toFixed(1)} s, mattonelle ${pronta.radar.set}` : JSON.stringify((await info())?.radar));
  await pausa(1500);
  await foto('meteo-2-vero');
  const dom = await ev(`({ classe: document.body.classList.contains('meteo'), titolo: document.querySelector('.m-titolo').textContent, frase: document.querySelector('.m-l-frase').textContent,
    vento: document.querySelector('.m-v-kmh').textContent, segmenti: document.querySelectorAll('.m-t-righe .m-barra i.on').length, eco: document.querySelector('.m-r-eco').textContent,
    radarOra: document.querySelector('.m-r-ora').textContent, bordi: getComputedStyle(document.getElementById('colonna-dx')).opacity })`);
  esito(dom.classe && dom.titolo.includes('MILANO') && dom.frase.length > 10, 'titolo e frase della timeline', `${dom.titolo} | ${dom.frase}`);
  esito(dom.vento !== '—' && dom.segmenti > 10, 'vento e barre del profilo termico scritti', `${dom.vento} km/h, ${dom.segmenti} segmenti accesi`);
  esito(/DBZ|NIENTE|NESSUNA ECO/.test(dom.eco) && /FA/.test(dom.radarOra), 'riga del radar: ora della mappa ed eco più vicina', `${dom.radarOra} | ${dom.eco}`);
  esito(dom.bordi === '0', 'i micro-dati ai bordi si spengono, come col report');
  const fuori = [...host.keys()].filter((h) => h !== `localhost:${PORTA}`);
  esito(fuori.every((h) => /^(api|tilecache)\.rainviewer\.com$/.test(h)), "fuori da Nexus l'HUD chiede solo a RainViewer", fuori.map((h) => `${h} ×${host.get(h)}`).join(', '));

  titolo('Mouse e tastiera');
  const [rx, ry] = await centro('.m-cerchio'), prima = (await info()).radar;
  await trascina(rx, ry, rx + 120, ry + 60);
  const dopo = (await info()).radar;
  esito(dopo.centro[0] < prima.centro[0] && dopo.centro[1] < prima.centro[1], 'trascinare il radar sposta la mappa con la mano', `${prima.centro.map((x) => x.toFixed(5))} → ${dopo.centro.map((x) => x.toFixed(5))}`);
  await mouse('mouseWheel', rx, ry, { deltaX: 0, deltaY: -300 }); await pausa(150);
  const z = (await info()).radar.raggio;
  esito(z < 150, 'la rotella avvicina il radar', `${z.toFixed(0)} km`);
  await mouse('mousePressed', rx, ry, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', rx, ry, { clickCount: 1 });
  await mouse('mousePressed', rx, ry, { buttons: 1, clickCount: 2 }); await mouse('mouseReleased', rx, ry, { clickCount: 2 }); await pausa(150);
  const r0 = (await info()).radar;
  esito(r0.raggio === 150 && Math.abs(r0.centro[0] - prima.centro[0]) < 1e-9, 'il doppio clic rimette il radar sul luogo, a 150 km');
  const [lx, ly, lw, , ll] = await centro('.m-l-area');
  await mouse('mousePressed', ll + lw * 0.75, ly, { buttons: 1, clickCount: 1 }); await mouse('mouseReleased', ll + lw * 0.75, ly, { clickCount: 1 }); await pausa(200);
  const scelto = (await info()).tCur, atteso = Date.now() - 2 * H + 0.75 * 14 * H;
  esito(scelto !== null && Math.abs(scelto - atteso) < 5 * 60_000, 'un clic sulla timeline sceglie quell\'ora (a tre quarti: +8,5 h)', scelto ? `${((scelto - Date.now()) / H).toFixed(2)} h` : 'null');
  await foto('meteo-3-timeline');
  await tasto('ArrowRight');
  const piu = (await info()).tCur;
  esito(Math.abs(piu - scelto - 15 * 60_000) < 1000, 'freccia a destra: un quarto d\'ora avanti');
  await tasto('0');
  esito((await info()).tCur === null, '0 torna ad adesso, col radar che gira');

  titolo('Gesti delle mani (come li manda gesti.js)');
  await gesto({ tipo: 'stato', fase: 'pronto' });
  await gesto({ tipo: 'cursore', x: rx / W, y: ry / Hh });
  const c0 = (await info()).radar.centro;
  await gesto({ tipo: 'stato', fase: 'azione' });
  for (let i = 0; i < 5; i++) await gesto({ tipo: 'ruota', dx: 0.01, dy: 0 });
  await gesto({ tipo: 'stato', fase: 'pronto' });
  const c1 = (await info()).radar.centro;
  esito(c1[0] < c0[0], 'pizzico e trascina sul radar: la mappa segue la mano', `${(c0[0] - c1[0]).toExponential(2)} del mondo`);
  await gesto({ tipo: 'cursore', x: (ll + lw * 0.3) / W, y: ly / Hh });
  await gesto({ tipo: 'stato', fase: 'azione' });
  await gesto({ tipo: 'ruota', dx: (lw * 0.25) / W, dy: 0 }); // un quarto della timeline: 3,5 ore
  await gesto({ tipo: 'stato', fase: 'pronto' });
  const tg = (await info()).tCur;
  esito(tg !== null && Math.abs(tg - Date.now() - 3.5 * H) < 5 * 60_000, 'pizzico e trascina sulla timeline: un quarto della sua larghezza sono 3,5 ore', tg ? `+${((tg - Date.now()) / H).toFixed(2)} h` : 'null');
  await gesto({ tipo: 'zoom', fattore: 2 });
  esito(Math.abs((await info()).radar.raggio - 75) < 0.01, 'due pizzichi che si allargano del doppio: radar da 150 a 75 km');
  await pizzico((ll + lw * 0.5) / W, ly / Hh);
  const tc = (await info()).tCur;
  esito(tc !== null && Math.abs(tc - (Date.now() + 5 * H)) < 5 * 60_000, 'pizzico breve sulla timeline: quell\'ora (metà: +5 h)', tc ? `+${((tc - Date.now()) / H).toFixed(2)} h` : 'null');
  await foto('meteo-4-gesti');
  const [vx, vy] = await centro('.m-vento');
  await pizzico(vx / W, vy / Hh);
  esito((await info()).tCur === null, 'pizzico breve fuori da radar e timeline: torna ad adesso');
  await pizzico(rx / W, ry / Hh);
  esito((await info()).radar.raggio === 150, 'pizzico breve sul radar: lo rimette sul luogo');
  await gesto({ tipo: 'afferra', x: rx / W, y: ry / Hh }); await pausa(400);
  await gesto({ tipo: 'lancia', x: rx / W, y: ry / Hh, vx: 1.2, vy: 0 });
  await pausa(600);
  const chiusa = await ev("({ aperta: nexusVistaMeteo().aperto, classe: document.body.classList.contains('meteo'), vista: getComputedStyle(document.getElementById('meteo')).display })");
  esito(!chiusa.aperta && !chiusa.classe && chiusa.vista === 'none', 'prendi e lancia: la vista si chiude', JSON.stringify(chiusa));

  titolo('Avvisi: calo di pressione, temporale e raffiche');
  DATI = conAvvisi;
  await ev('nexusMeteo()');
  await attendi(async () => (await ev("document.querySelectorAll('.m-avviso').length")) > 0, 3000);
  await pausa(1200);
  await foto('meteo-5-avvisi');
  const av = await ev("[...document.querySelectorAll('.m-avviso')].map((e) => ({ classe: e.className, testo: e.querySelector('p').textContent, colore: getComputedStyle(e).color }))");
  esito(av.length === 3 && av[0].classe.includes('l2') && av[0].classe.includes('primo'), 'tre avvisi, il rosso (raffiche 95 km/h) per primo e lampeggiante', av.map((x) => `${x.classe.replace('m-avviso ', '')}: ${x.testo}`).join(' | '));
  esito(av.some((x) => /CALO BAROMETRICO RAPIDO: −4,2 HPA/.test(x.testo)) && av.some((x) => /TEMPORALE/.test(x.testo)), 'calo barometrico −4,2 hPa e temporale');
  await tasto('Escape'); await pausa(600);
  esito(!(await ev("document.body.classList.contains('meteo')")), 'Esc chiude la vista');

  titolo('Fotogrammi con le mani accese (foto di prova al posto della fotocamera)');
  DATI = vero.dati;
  await vai(`${ORIGINE}/?debug&mani=immagine`);
  await ev('nexusMeteo()');
  const mani = await attendi(() => ev('window.__misure.mani?.attive'), 30000, 250);
  esito(Boolean(mani), 'le mani partono con la meteo aperta');
  await attendi(async () => { const i = await info(); return i?.radar?.scaricate >= i?.radar?.n && i.radar.n > 0; }, 20000, 250);
  for (const giro of [1, 2]) {
    await pausa(11000);
    const f = await ev('window.__misure.fps'), mm = await ev('window.__misure.mani');
    esito(f.p10 >= 45, `giro ${giro}: p10 sopra 45 fps (la regola di Tony)`, `mediana ${f.mediana}, p10 ${f.p10}, minimo ${f.minimo} su ${f.secondi} s; detect ${mm?.detect_ms?.mediana} ms`);
  }
  await foto('meteo-6-mani');
  misura = null;
  await tasto('Escape');
  await attendi(() => misura, 3000);
  esito(misura?.vista === 'meteo' && misura.secondi >= 10 && Number.isFinite(misura.fps?.p10), 'chiudendo la meteo l\'HUD manda la misura delle mani, segnata «meteo»', misura ? `${misura.secondi} s, p10 ${misura.fps.p10}` : 'non arrivata');

  titolo('Console');
  esito(!eccezioni.length, 'nessuna eccezione', eccezioni.slice(0, 3).join(' | '));
  const veri = errori.filter((e) => !/favicon|404/.test(e));
  esito(!veri.length, 'nessun errore in console', veri.slice(0, 3).join(' | '));
} catch (e) {
  esito(false, 'la prova si è fermata', e.stack?.split('\n').slice(0, 3).join(' '));
} finally {
  clearTimeout(guardia);
  chrome.kill('SIGTERM'); server.close();
  await pausa(500);
  console.log(`\nFoto in ${FOTO}\n${passati} passati, ${falliti} falliti`);
  process.exit(falliti ? 1 : 0);
}
