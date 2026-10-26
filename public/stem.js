// STEM — stato, HUD, push-to-talk, voce.
import { createScene, T } from './scene.js';

const S = { mode: 'idle', audio: 0, mic: 0, split: 0, splitTarget: 0 };
const $ = (id) => document.getElementById(id);
const MODES = { idle: 'IN ATTESA', listening: 'IN ASCOLTO', thinking: 'ELABORO', speaking: 'PARLO' };
function setMode(m) {
  S.mode = m; document.body.dataset.mode = m; $('mode').textContent = MODES[m];
  if (m === 'idle') { scheduleWake(); if (document.body.classList.contains('browsing')) showScreen(false); }
  else if (m !== 'idle') clearTimeout(screenTimer);
}

// ---------- HUD: anelli stile JARVIS, tratto pulito stile Tesla ----------
const hud = $('hud');
const hx = hud.getContext('2d');
let W = 0, Hh = 0, DPR = 1;
function sizeHud() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; Hh = innerHeight;
  hud.width = W * DPR; hud.height = Hh * DPR;
  hx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
sizeHud();
addEventListener('resize', sizeHud);

const bars = new Float32Array(144);
let spin = 0;
function drawHud(t, dt, at) {
  hx.clearRect(0, 0, W, Hh);
  const cx = at.x, cy = at.y, R = at.r;
  const reveal = Math.min(1, Math.max(0, (t - 4.6) / 1.6));
  if (reveal <= 0) return;
  const ease = 1 - Math.pow(1 - reveal, 3);
  const speed = S.mode === 'thinking' ? 0.9 : S.mode === 'listening' ? 0.35 : 0.08;
  spin += dt * speed;
  hx.lineCap = 'round';
  const blue = (a) => `rgba(62, 166, 255, ${a})`;
  const ice = (a) => `rgba(190, 225, 255, ${a})`;

  // anello sottile completo
  hx.strokeStyle = ice(0.1 * ease); hx.lineWidth = 1;
  hx.beginPath(); hx.arc(cx, cy, R * 1.06, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ease); hx.stroke();

  // tacche graduate
  for (let i = 0; i < 180; i++) {
    if (i / 180 > ease) break;
    const a = i / 180 * Math.PI * 2 + spin * 0.4;
    const major = i % 15 === 0;
    const r1 = R * 1.1, r2 = r1 + (major ? 9 : 4);
    hx.strokeStyle = ice(major ? 0.32 : 0.12);
    hx.beginPath(); hx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); hx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); hx.stroke();
  }

  // archi che ruotano in senso opposto
  hx.lineWidth = 2;
  for (let k = 0; k < 3; k++) {
    const a0 = -spin + k * (Math.PI * 2 / 3);
    hx.strokeStyle = blue(0.42 * ease);
    hx.beginPath(); hx.arc(cx, cy, R * 1.2, a0, a0 + 0.55 * ease); hx.stroke();
  }
  hx.lineWidth = 1;
  hx.strokeStyle = ice(0.08 * ease);
  hx.beginPath(); hx.arc(cx, cy, R * 1.26, spin * 0.6, spin * 0.6 + Math.PI * 1.2 * ease); hx.stroke();

  // barre radiali: voce di STEM o microfono di Tony
  const level = S.mode === 'speaking' ? S.audio : S.mode === 'listening' ? S.mic : S.mode === 'idle' ? S.mic * 0.45 : 0;
  for (let i = 0; i < bars.length; i++) {
    const n = 0.5 + 0.5 * Math.sin(i * 0.9 + t * 7) * Math.sin(i * 0.37 - t * 3);
    const target = 1.5 + level * 26 * n + (S.mode === 'thinking' ? 4 * Math.max(0, Math.sin(i * 0.26 - t * 6)) : 0);
    bars[i] += (target - bars[i]) * Math.min(1, dt * 14);
    const a = i / bars.length * Math.PI * 2 - Math.PI / 2;
    const r1 = R * 0.985, r2 = r1 - bars[i];
    hx.strokeStyle = (S.mode === 'listening' ? 'rgba(127, 224, 255, ' : 'rgba(110, 190, 255, ') + (0.16 + Math.min(0.6, bars[i] / 30)) * ease + ')';
    hx.beginPath(); hx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); hx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); hx.stroke();
  }

  // indici cardinali
  hx.fillStyle = ice(0.28 * ease);
  hx.font = '400 9px Inter, sans-serif';
  hx.textAlign = 'center';
  const marks = ['000', '090', '180', '270'];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 - Math.PI / 2;
    hx.fillText(marks[i], cx + Math.cos(a) * R * 1.33, cy + Math.sin(a) * R * 1.33 + 3);
  }
}

// ---------- Orologio e stato dei sistemi ----------
function tickClock() {
  const d = new Date();
  $('clock').querySelector('.time').textContent = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  $('clock').querySelector('.date').textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}
tickClock(); setInterval(tickClock, 10000);

let voiceMode = 'eleven';
async function pollStatus() {
  try {
    const s = await (await fetch('/api/status?hud=1')).json(); // ?hud=1: il server sa che un HUD è aperto
    $('d-brain').className = 'dot on';
    $('d-voice').className = 'dot ' + (s.voice ? 'on' : 'warn');
    $('v-voice').textContent = s.voice ? 'ElevenLabs' : 'Sistema';
    voiceMode = s.voice ? 'eleven' : 'system';
    $('d-browser').className = 'dot ' + (s.browser ? 'on' : 'warn');
    $('v-browser').textContent = s.browser ? 'Pronto' : 'Avvio';
  } catch {
    $('d-brain').className = 'dot warn';
  }
}
pollStatus(); setInterval(pollStatus, 5000);

// ---------- Azione nel browser (solo cosa sta facendo, mai cosa dice) ----------
const VERBS = {
  navigate: 'Apro', navigate_back: 'Torno indietro', click: 'Clicco', type: 'Scrivo', fill_form: 'Compilo',
  snapshot: 'Leggo la pagina', take_screenshot: 'Guardo', press_key: 'Premo un tasto', hover: 'Indico',
  select_option: 'Scelgo', wait_for: 'Attendo', tabs: 'Schede', evaluate: 'Analizzo', drag: 'Trascino',
  handle_dialog: 'Finestra', file_upload: 'Carico', close: 'Chiudo', resize: 'Ridimensiono', find: 'Cerco nella pagina',
};
let screenTimer = 0;
function showScreen(on) { // il browser dentro l'HUD: si apre quando STEM naviga, si chiude 15 s dopo che ha finito
  clearTimeout(screenTimer);
  if (on) { document.body.classList.add('browsing'); S.splitTarget = 1; }
  else screenTimer = setTimeout(() => { document.body.classList.remove('browsing'); S.splitTarget = 0; }, 15000);
}
function showAction(name, detail) {
  $('p-what').textContent = (VERBS[name] || name.replace(/_/g, ' ')).toUpperCase();
  if (detail) $('p-host').textContent = '· ' + detail;
  showScreen(true);
}

// ---------- Audio: riproduzione in coda con analisi del volume ----------
let ctx = null, outAnalyser = null, micAnalyser = null;
const buf = new Uint8Array(1024);
function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    outAnalyser = ctx.createAnalyser(); outAnalyser.fftSize = 1024;
    outAnalyser.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}
async function ensureMic() {
  if (micAnalyser) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(micAnalyser);
  } catch { /* senza indicatore del microfono si vive lo stesso */ }
}
function rms(an) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

let generation = 0;          // ogni nuova domanda invalida audio e risposte precedenti
let queue = [];              // promesse di audio, in ordine
let playing = false;
let streamDone = true;
let currentSource = null;
let fakeLevel = 0;

// ElevenLabs (piano gratuito) accetta al massimo 2 sintesi in parallelo: oltre, risponde 429
let ttsActive = 0;
const ttsWaiting = [];
const ttsSlot = () => new Promise((go) => { if (ttsActive < 2) { ttsActive++; go(); } else ttsWaiting.push(go); });
const ttsFree = () => { const next = ttsWaiting.shift(); if (next) next(); else ttsActive--; };

function speak(text) {
  const gen = generation;
  const job = voiceMode === 'eleven'
    ? ttsSlot().then(() => (gen !== generation // risposta annullata nel frattempo: non spendo caratteri
      ? { kind: 'system', text: '' }
      : fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
        .then(async (r) => (r.ok ? { kind: 'audio', data: await r.arrayBuffer() } : { kind: 'system', text }))
        .catch(() => ({ kind: 'system', text }))))
      .finally(ttsFree)
    : Promise.resolve({ kind: 'system', text });
  queue.push({ gen, job });
  if (!playing) playNext();
}

async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    if (streamDone && (S.mode === 'speaking' || S.mode === 'thinking')) setMode('idle');
    return;
  }
  playing = true;
  const clip = await item.job;
  if (item.gen !== generation) return; // risposta annullata: silence() ha già azzerato coda e stato
  setMode('speaking');
  ensureAudio();
  if (clip.kind === 'audio') {
    try {
      const audio = await ctx.decodeAudioData(clip.data);
      if (item.gen !== generation) return;
      const src = ctx.createBufferSource();
      src.buffer = audio;
      src.connect(outAnalyser);
      currentSource = src;
      src.onended = () => { if (currentSource === src) currentSource = null; if (item.gen === generation) playNext(); };
      src.start();
      return;
    } catch { clip.kind = 'system'; clip.text = clip.text || ''; }
  }
  systemSpeak(clip.text || '', () => { if (item.gen === generation) playNext(); });
}

let itVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('it'));
  itVoice = vs.find((v) => /luca|paolo|diego/i.test(v.name)) || vs[0] || null;
}
speechSynthesis.onvoiceschanged = pickVoice; pickVoice();
function systemSpeak(text, done) {
  if (!text) return done();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'it-IT'; if (itVoice) u.voice = itVoice; u.rate = 1.02; u.pitch = 0.9;
  u.onboundary = () => { fakeLevel = 0.5; };
  u.onend = u.onerror = () => { fakeLevel = 0; done(); };
  speechSynthesis.speak(u);
}

function silence() {
  generation++;
  queue = [];
  playing = false;
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
  speechSynthesis.cancel();
}

// ---------- Cervello ----------
let controller = null;
async function ask(text) {
  stopRec();
  silence();
  const gen = generation;
  controller?.abort();
  controller = new AbortController();
  setMode('thinking');
  streamDone = false;
  try {
    const r = await fetch('/api/ask', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }), signal: controller.signal,
    });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += dec.decode(value, { stream: true });
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, i); rest = rest.slice(i + 1);
        if (!line.trim() || gen !== generation) continue;
        const ev = JSON.parse(line);
        if (ev.t === 'say') speak(ev.s);
        else if (ev.t === 'tool') { showAction(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        else if (ev.t === 'page') $('p-host').textContent = '· ' + ev.detail;
        else if (ev.t === 'error') speak('Ho perso il filo, signore. Riprova tra un attimo.');
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') speak('Non riesco a raggiungere il mio cervello. Il server è acceso?');
  } finally {
    if (gen === generation) {
      streamDone = true;
      if (!playing && queue.length === 0) setMode('idle');
    }
  }
}

// ---------- Ascolto: barra spaziatrice oppure la parola «Stem» ----------
// Chrome tiene un solo riconoscimento vocale alla volta: o quello che aspetta «Stem», o quello del push-to-talk.
// «Stem» si ascolta solo sul Mac (riconoscimento locale), così l'audio della stanza non va a nessun server.
// Il push-to-talk, che parte solo quando lo chiedi tu, usa il riconoscimento di Google, più preciso.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LOCAL = { langs: ['it-IT'], processLocally: true };
// «Stem» tra le prime tre parole, anche se il riconoscitore lo scrive con una lettera diversa (sten, stam, stemm, steam…)
const NOT_WAKE = new Set(['item', 'step', 'stei', 'sto']);
const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
function lev1(a, b) { // distanza di modifica ≤ 1?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function findWake(transcript) { // -> il testo dopo «Stem», oppure null
  const words = transcript.trim().split(/\s+/);
  for (let i = 0; i < Math.min(3, words.length); i++) {
    const w = norm(words[i]);
    if (w.length >= 3 && !NOT_WAKE.has(w) && lev1(w, 'stem')) return words.slice(i + 1).join(' ').replace(/^[\s,.:;!?]+/, '');
  }
  return null;
}
const report = (line) => fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) }).catch(() => {});
let rec = null, recKind = '', holding = false;
let wake = 'prep'; // prep | install | click | on | denied | nolocal
let wakeTimer = 0, wakeWait = 0, wakeBackoff = 300, wakeFails = 0;
const DEBUG = new URLSearchParams(location.search).has('debug');
// ?debug&wav=file.wav: «Stem» ascolta quel file invece del microfono (prove senza voce)
const DEBUG_WAV = DEBUG && new URLSearchParams(location.search).get('wav');
let debugTrack = null;
async function loadDebugTrack() {
  const c = new AudioContext();
  const b = await c.decodeAudioData(await (await fetch(DEBUG_WAV)).arrayBuffer());
  const dest = c.createMediaStreamDestination();
  const src = c.createBufferSource(); src.buffer = b; src.loop = true; src.connect(dest); src.start();
  debugTrack = dest.stream.getAudioTracks()[0];
}
const dbg = (...a) => { if (DEBUG) (window.__wakeLog ||= []).push(`${(performance.now() / 1000).toFixed(1)}s ${a.join(' ')}`); };
const EAR = { prep: 'Preparo…', install: 'Installo…', click: 'Clic per attivare', on: '«Stem»', denied: 'Microfono negato', nolocal: 'Non disponibile' };

function newRec(local) {
  const r = new SR();
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true;
  if (local) r.processLocally = true;
  return r;
}
function stopRec() {
  clearTimeout(wakeWait);
  if (!rec) return;
  const r = rec; rec = null; recKind = '';
  r.onresult = r.onerror = r.onend = null;
  try { r.abort(); } catch {}
}
function interrupt() { silence(); controller?.abort(); fetch('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' } }); }
function showEar() {
  const waiting = wake === 'on' && !earLock;
  $('d-ear').className = 'dot ' + (wake === 'on' && !waiting ? 'on' : 'warn');
  $('v-ear').textContent = waiting ? 'In un altro HUD' : EAR[wake];
}
// Chrome tiene un solo riconoscimento per processo: con due HUD aperti si interromperebbero a vicenda all'infinito.
// Ascolta solo l'HUD che ha il lucchetto; un secondo HUD aspetta che il primo si chiuda.
let earLock = !navigator.locks;
navigator.locks?.request('stem-ear', () => { earLock = true; showEar(); scheduleWake(300); return new Promise(() => {}); });
function micDenied() { wake = 'denied'; showEar(); warn('Serve il permesso del microfono.'); }

// Il modello italiano locale si scarica una volta; se Chrome vuole un gesto, basta un clic o la barra spaziatrice
async function prepareWake() {
  if (!SR || typeof SR.available !== 'function') { wake = 'nolocal'; return showEar(); }
  let st = await SR.available(LOCAL).catch(() => 'unavailable');
  if (st === 'downloadable' || st === 'downloading') {
    wake = 'install'; showEar();
    const ok = await SR.install(LOCAL).catch(() => false);
    st = ok ? 'available' : await SR.available(LOCAL).catch(() => 'unavailable');
  }
  wake = st === 'available' ? 'on' : st === 'downloadable' ? 'click' : 'nolocal';
  dbg('prepareWake', st, '->', wake);
  showEar();
  scheduleWake(300);
}

// Push-to-talk
let heard = '', interim = '', wantSend = false;
function startListening() {
  ensureAudio(); ensureMic();
  if (wake === 'click') prepareWake();
  if (S.mode === 'speaking' || S.mode === 'thinking') interrupt();
  if (!SR) { warn('Il riconoscimento vocale richiede Google Chrome.'); return; }
  const hadRec = Boolean(rec);
  stopRec(); clearTimeout(wakeTimer);
  heard = ''; interim = ''; wantSend = false;
  setMode('listening');
  setTimeout(beginPTT, hadRec ? 180 : 0); // dopo un abort Chrome vuole un attimo prima di ripartire
}
function beginPTT() {
  if (!holding) return;
  const r = newRec(false); rec = r; recKind = 'ptt';
  r.onresult = (e) => {
    if (wake === 'denied') prepareWake(); // il permesso ora c'è: riaccendo anche «Stem»
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
  };
  let failed = '';
  r.onerror = (e) => { if (e.error === 'not-allowed') micDenied(); else if (e.error !== 'no-speech') failed = e.error; };
  r.onend = () => {
    if (rec !== r) return;
    rec = null; recKind = '';
    if (holding && failed) { // errore vero: lo dico invece di riprovare in un ciclo continuo
      warn(failed === 'network' ? 'Sono offline: il push-to-talk usa Google.' : failed === 'audio-capture' ? 'Microfono non disponibile.' : `Ascolto non riuscito (${failed}).`);
      holding = false;
    }
    if (holding) { heard += interim; interim = ''; return beginPTT(); } // Chrome ha chiuso la sessione ma stai ancora parlando
    const text = (heard + interim).trim();
    if (wantSend && text) ask(text);
    else setMode('idle');
  };
  try { r.start(); } catch { if (rec === r) { rec = null; recKind = ''; } setTimeout(beginPTT, 200); }
}
function stopListening() {
  wantSend = true;
  const r = rec;
  if (r && recKind === 'ptt') { setTimeout(() => r.stop(), 250); return; } // un quarto di secondo per l'ultima parola
  const text = (heard + interim).trim(); // la sessione si era già chiusa da sola
  if (text) ask(text);
  else if (S.mode === 'listening') setMode('idle');
}

// Parola di attivazione: in attesa ascolta sempre; dopo «Stem» prende la domanda, anche nella stessa frase
function scheduleWake(ms = 300) {
  clearTimeout(wakeTimer);
  if (wake === 'on') wakeTimer = setTimeout(startWake, ms);
}
function startWake() {
  if (wake !== 'on' || !earLock) return;
  if (rec || holding || S.mode !== 'idle') return scheduleWake(1000); // occupato: riprovo tra un secondo
  const r = newRec(true); rec = r; recKind = 'wake';
  dbg('wake start');
  ensureAudio(); ensureMic(); // l'anello si muove quando parli: così vedi che ti sente
  let wakeAt = -1, text = '', confirmed = false;
  const mine = () => rec === r;
  const send = () => { if (!mine()) return; if (!confirmed) return reset(); stopRec(); ask(text); };
  const reset = () => { if (!mine()) return; stopRec(); setMode('idle'); };
  r.onresult = (e) => {
    if (!mine()) return;
    wakeBackoff = 300; wakeFails = 0;
    const res = e.results;
    dbg('result', [...res].map((x) => `${x.isFinal ? 'F' : 'i'}:${x[0].transcript}`).join(' | '));
    if (wakeAt < 0) {
      for (let i = e.resultIndex; i < res.length; i++) if (findWake(res[i][0].transcript) !== null) { wakeAt = i; break; }
      if (wakeAt < 0) {
        // per la diagnosi: solo la prima parola delle frasi finite, e solo in runtime/ascolto.log
        const last = res[res.length - 1];
        if (last.isFinal) report(`nessun «Stem»; prima parola: "${norm(last[0].transcript.trim().split(/\s+/)[0] || '')}"`);
        return;
      }
      ensureAudio(); ensureMic(); setMode('listening');
      report('«Stem» riconosciuto');
    }
    const after = findWake(res[wakeAt][0].transcript);
    if (after === null) { if (res[wakeAt].isFinal) reset(); return; } // falso allarme, corretto dal riconoscitore
    confirmed = res[wakeAt].isFinal;
    text = after;
    for (let i = wakeAt + 1; i < res.length; i++) text += ' ' + res[i][0].transcript;
    text = text.trim();
    // Parte quando hai finito: 1,5 s senza parole nuove; se dopo «Stem» non dici niente, rinuncia dopo 8 s
    clearTimeout(wakeWait);
    wakeWait = setTimeout(() => (text ? send() : reset()), text ? 1500 : 8000);
  };
  r.onerror = (e) => {
    dbg('wake error', e.error, e.message || '');
    if (e.error !== 'no-speech' && e.error !== 'aborted') report(`errore ascolto: ${e.error}`);
    if (e.error === 'not-allowed') return micDenied();
    if (e.error === 'service-not-allowed' || e.error === 'language-not-supported') { wake = 'nolocal'; return showEar(); }
    if (e.error === 'network' || e.error === 'audio-capture' || e.error === 'aborted') { // 'aborted' qui viene da fuori: stopRec toglie i gestori prima
      wakeBackoff = Math.min(10000, wakeBackoff * 2);
      if (e.error === 'aborted' && wakeFails === 0) report('ascolto interrotto da un altro riconoscimento vocale');
      if (++wakeFails === 5) warn(e.error === 'audio-capture' ? 'Il microfono non risponde: «Stem» non mi sente.' : '«Stem» non riesce a partire.');
    }
  };
  r.onend = () => { // Chrome chiude la sessione dopo un po' di silenzio: si riparte
    dbg('wake end');
    if (!mine()) return;
    rec = null; recKind = '';
    clearTimeout(wakeWait);
    if (wakeAt >= 0 && text && confirmed) return ask(text);
    if (S.mode === 'listening') setMode('idle'); else scheduleWake(wakeBackoff);
  };
  try { if (debugTrack) r.start(debugTrack); else r.start(); } catch { if (mine()) { rec = null; recKind = ''; } scheduleWake(1000); }
}

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat || holding) return;
    holding = 'key'; startListening();
  } else if (e.code === 'Escape') { // annulla tutto, anche un ascolto già partito
    wantSend = false; heard = ''; interim = '';
    stopRec(); interrupt(); setMode('idle');
  }
});
addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (holding !== 'key') return;
  holding = false; stopListening();
});
addEventListener('blur', () => { if (holding) { holding = false; stopListening(); } });
addEventListener('pointerdown', (e) => { // un clic sblocca audio e «Stem»; tenuto premuto, parli come con lo spazio
  ensureAudio(); if (wake === 'click') prepareWake();
  if (e.button !== 0 || holding) return;
  holding = 'pointer'; startListening();
});
const release = () => { if (holding === 'pointer') { holding = false; stopListening(); } };
addEventListener('pointerup', release);
addEventListener('pointercancel', release);

function warn(msg) {
  const w = $('warn'); w.textContent = msg; w.style.display = 'block';
  clearTimeout(warn.t); warn.t = setTimeout(() => { w.style.display = 'none'; }, 4000);
}

// ---------- Avvio ----------
if (new URLSearchParams(location.search).has('debug')) window.stemAsk = ask; // prove senza microfono
showEar();
if (DEBUG_WAV) await loadDebugTrack();
prepareWake();
const scene = await createScene($('gl'), S);
const t0 = performance.now();
let last = t0;
const freeze = new URLSearchParams(location.search).get('t'); // ?t=3 ferma la formazione a 3 secondi (per le prove)
setTimeout(() => document.body.classList.add('ready'), freeze ? 0 : (T.eyes + 0.4) * 1000);
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = freeze ? Number(freeze) : (now - t0) / 1000;
  const out = outAnalyser && currentSource ? Math.min(1, rms(outAnalyser) * 4.5) : fakeLevel * (0.6 + 0.4 * Math.sin(t * 23));
  S.audio += (out - S.audio) * Math.min(1, dt * 18);
  const mic = micAnalyser && (S.mode === 'listening' || S.mode === 'idle') ? Math.min(1, rms(micAnalyser) * 6) : 0;
  S.split += (S.splitTarget - S.split) * Math.min(1, dt * 2.5);
  S.mic += (mic - S.mic) * Math.min(1, dt * 18);
  scene.frame(t, (now - t0) / 1000, dt);
  drawHud(t, dt, scene.anchor());
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
