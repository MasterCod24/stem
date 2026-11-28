// eco.mjs — quanto della voce di O.S.C.A.R. sente il riconoscitore, con le casse e il microfono veri del Mac: col microfono suo
// (come fino al 28/11) e sulla traccia di getUserMedia con la cancellazione dell'eco (come dal 28/11, microfono() in oscar.js).
// La voce di O.S.C.A.R. la suona Chrome; quella di «Tony» la suona afplay, fuori da Chrome, come una persona nella stanza.
// Le due frasi le dice la voce del Mac (niente crediti). Fa parlare il Mac ad alta voce per circa un minuto e mezzo e usa il
// microfono: O.S.C.A.R. va spento prima (sentirebbe tutto), e la stanza in silenzio.
//   node prove/eco.mjs [giri]        giri: per esempio oggi:doppio,aec:doppio (di base tutti e sei)
// Il modello vocale italiano lo prende dal profilo dell'HUD (runtime/hud-profile), clonato in una cartella temporanea.
// Misurato il 28/11 (MacBook Air, casse e microfono suoi, la frase di Warm Agent da 27 parole al posto di quella del Mac):
// col microfono suo 25 parole su 27, sulla traccia con l'AEC 0; con le due voci insieme, col microfono suo la frase di Tony
// spariva tutta, sull'AEC arrivava intera, due giri su due.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HUD = [path.join(REPO, 'runtime', 'hud-profile'), path.join(os.homedir(), 'STEM', 'runtime', 'hud-profile')].find((d) => fs.existsSync(d)) || '';
const PORTA = 4602, CDP = 9602;
const OSCAR = 'Buonasera. I sistemi sono operativi e la batteria è al settantotto per cento. Domani a Milano pioverà dalle tre del pomeriggio, con dodici gradi.';
const TONY = 'Aspetta, volevo dire domani mattina, prima delle nove, non stasera.';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
if (!HUD || !fs.existsSync(path.join(HUD, 'SODALanguagePacks'))) { console.log('Manca il modello vocale in runtime/hud-profile: apri O.S.C.A.R. una volta'); process.exit(1); }
if (await fetch('http://localhost:4321/api/status').then((r) => r.ok, () => false)) { console.log('O.S.C.A.R. è acceso: spegnilo prima, sentirebbe la prova'); process.exit(1); }

const LAVORO = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-eco-')), SITO = path.join(LAVORO, 'sito'), PROFILO = path.join(LAVORO, 'profilo');
fs.mkdirSync(SITO); fs.mkdirSync(PROFILO);
execFileSync('/bin/cp', ['-cR', path.join(HUD, 'SODA'), path.join(HUD, 'SODALanguagePacks'), PROFILO]); // -c: clone APFS, nessuna copia vera
fs.writeFileSync(path.join(PROFILO, 'Local State'), fs.readFileSync(path.join(HUD, 'Local State'), 'utf8').replaceAll(HUD + '/', PROFILO + '/'));
const voce = execFileSync('/usr/bin/say', ['-v', '?']).toString().split('\n').find((l) => /\bit_IT\b/.test(l))?.split(/\s{2,}|\s+it_IT/)[0].trim();
execFileSync('/usr/bin/say', [...(voce ? ['-v', voce] : []), '-o', path.join(SITO, 'frase.wav'), '--data-format=LEI16@24000', '--', OSCAR]);
execFileSync('/usr/bin/say', [...(voce ? ['-v', voce] : []), '-r', '200', '-o', path.join(LAVORO, 'tony.aiff'), '--', TONY]);
fs.writeFileSync(path.join(SITO, 'index.html'), `<!doctype html><meta charset="utf-8"><title>prova eco</title><body style="background:#000;color:#0ff;font:16px Menlo">prova eco
<script>
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let ctx, buf;
window.prepara = async () => {
  ctx = new AudioContext();
  buf = await ctx.decodeAudioData(await (await fetch('frase.wav')).arrayBuffer());
  return { disponibile: await SR.available({ langs: ['it-IT'], processLocally: true }), durata: buf.duration };
};
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
// oggi: come l'HUD fino al 28/11 (getUserMedia con l'AEC aperto per il livello, il riconoscitore col microfono suo); aec: sulla traccia
window.prova = async (modo, suona) => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const r = new SR(); r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.processLocally = true;
  const finali = []; let errore = '';
  r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal && e.results[i][0].transcript.trim()) finali.push(e.results[i][0].transcript.trim()); };
  r.onerror = (e) => { errore = e.error; };
  const avviato = new Promise((ok) => { r.onaudiostart = ok; setTimeout(ok, 4000); });
  if (modo === 'aec') r.start(stream.getAudioTracks()[0]); else r.start();
  await avviato; await pausa(800);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  if (suona) src.start();
  await pausa(buf.duration * 1000 + 3000);
  r.stop(); await pausa(1000);
  stream.getTracks().forEach((t) => t.stop());
  return { errore, finali };
};
</script>`);
const server = http.createServer((q, r) => { const f = path.join(SITO, q.url === '/' ? 'index.html' : q.url.slice(1)); if (!f.startsWith(SITO) || !fs.existsSync(f)) return r.writeHead(404).end(); r.writeHead(200, { 'content-type': f.endsWith('.wav') ? 'audio/wav' : 'text/html' }).end(fs.readFileSync(f)); }).listen(PORTA, '127.0.0.1');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [`--user-data-dir=${PROFILO}`, `--remote-debugging-port=${CDP}`, '--no-first-run', '--no-default-browser-check',
  '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--window-size=500,300', `http://localhost:${PORTA}/`], { stdio: 'ignore' });
const parole = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const dellaFrase = (testo, frase) => { const p = new Set(parole(frase)); return parole(testo).filter((w) => p.has(w)).length; };
let ok = 0, ko = 0;
const esito = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); c ? ok++ : ko++; };
try {
  let ws;
  for (let i = 0; i < 40 && !ws; i++) { await pausa(500); try { ws = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes(String(PORTA)))?.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); await new Promise((r) => (sock.onopen = r));
  let id = 0; const attese = new Map();
  sock.onmessage = (m) => { const o = JSON.parse(m.data); attese.get(o.id)?.(o); };
  const valuta = (expression) => new Promise((r) => { const n = ++id; attese.set(n, r); sock.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })); })
    .then((o) => o.result?.result?.value ?? { errore: o.result?.exceptionDetails?.exception?.description });
  await pausa(1500);
  const p = await valuta('prepara()');
  console.log(`riconoscitore locale: ${p.disponibile}; frase di O.S.C.A.R. ${p.durata?.toFixed(1)} s, ${parole(OSCAR).length} parole; di Tony ${parole(TONY).length} parole`);
  const ris = {};
  for (const giro of (process.argv[2] || 'oggi:sua,aec:sua,oggi:fuori,aec:fuori,oggi:doppio,aec:doppio').split(',')) {
    const [modo, come] = giro.split(':');
    const attesa = valuta(`prova(${JSON.stringify(modo)}, ${come !== 'fuori'})`);
    if (come !== 'sua') { await pausa(come === 'doppio' ? 4500 : 2500); spawn('/usr/bin/afplay', [path.join(LAVORO, 'tony.aiff')]); }
    const r = await attesa, testo = (r.finali || []).join(' ');
    ris[giro] = { oscar: dellaFrase(testo, OSCAR), tony: dellaFrase(testo, TONY) };
    console.log(`${giro.padEnd(12)} O.S.C.A.R. ${ris[giro].oscar}, Tony ${ris[giro].tony}${r.errore ? `, errore ${r.errore}` : ''}  «${testo.slice(0, 140)}»`);
    await pausa(1500);
  }
  const N = parole(TONY).length;
  if (ris['aec:sua']) esito(ris['aec:sua'].oscar <= 2, "sulla traccia con l'AEC il riconoscitore non sente la voce di O.S.C.A.R.", `${ris['aec:sua'].oscar} parole (col microfono suo ${ris['oggi:sua']?.oscar ?? '?'})`);
  if (ris['aec:fuori']) esito(ris['aec:fuori'].tony >= 0.8 * N, 'una voce fuori da Chrome passa intera', `${ris['aec:fuori'].tony} su ${N}`);
  if (ris['aec:doppio']) esito(ris['aec:doppio'].tony >= 0.8 * N && ris['aec:doppio'].oscar <= 2, "con le due voci insieme sente Tony e non O.S.C.A.R.", `Tony ${ris['aec:doppio'].tony} su ${N}, O.S.C.A.R. ${ris['aec:doppio'].oscar} (col microfono suo: Tony ${ris['oggi:doppio']?.tony ?? '?'}, O.S.C.A.R. ${ris['oggi:doppio']?.oscar ?? '?'})`);
  sock.close();
} finally {
  chrome.kill('SIGTERM'); server.close();
  await pausa(1500);
  fs.rmSync(LAVORO, { recursive: true, force: true });
  console.log(`${ok} passati, ${ko} falliti`);
  process.exitCode = ko ? 1 : 0;
}
