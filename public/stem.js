// STEM — l'HUD: ascolto sempre acceso, voce, pannello del browser, GIF, suoni. La grafica sta in humanoid.js.
import { showReport, hideReport, reportDock } from './report.js';
const S = { mode: 'idle', audio: 0, mic: 0, split: 0, splitTarget: 0, dock: 0, dockTarget: 0, hearing: false };
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const dbg = (...a) => { if (DEBUG) (window.__earLog ||= []).push(`${(performance.now() / 1000).toFixed(1)}s ${a.join(' ')}`); };

// ---------- Stato e scritta "STATUS" accanto alla testa ----------
const LABELS = { idle: 'STATUS: LISTENING', listening: 'STATUS: LISTENING', thinking: 'STATUS: PROCESSING', speaking: 'STATUS: SPEAKING' };
let booting = true;
function setMode(m) {
  if (S.mode !== m && sfx) { if (m === 'thinking') sfx.think?.(true); else if (S.mode === 'thinking') sfx.think?.(false); }
  if (S.mode === 'speaking' && m !== 'speaking') spokeUntil = performance.now();
  S.mode = m; document.body.dataset.mode = m;
  if (m === 'idle') { if (document.body.classList.contains('browsing')) showScreen(false); }
  else clearTimeout(screenTimer);
}
function drawStatus(t, at) {
  // con il report aperto la testa sta nell'angolo in basso a destra: la scritta va sopra, centrata e corta, per non finire sulle schede
  const docked = S.dock > 0.5, el = $('status');
  const x = Math.round(docked ? at.x : at.x + at.r * 1.35), y = Math.round(docked ? at.y - at.r * 1.7 : at.y - at.r * 0.35);
  const center = docked ? ' translateX(-50%)' : '';
  el.style.transform = `translate(${x}px, ${y}px)${center}`;
  $('small').style.transform = `translate(${x}px, ${y + 22}px)${center}`;
  // GIF accanto alla testa: a destra, oppure a sinistra quando a destra c'è il browser
  const mx = S.split > 0.5 ? Math.round(at.x - at.r * 1.35 - 300) : x;
  $('media').style.transform = `translate(${Math.max(16, mx)}px, ${y + 48}px)`;
  if (booting) { el.textContent = `ASSEMBLING... ${Math.min(99, Math.round(scene.assembling(t) * 100))}%`; return; }
  el.textContent = ear !== 'on' && S.mode === 'idle' ? `STATUS: MIC OFF  (${EAR_TEXT[ear]})`.toUpperCase()
    : S.mode === 'speaking' && S.audio > 0.35 && !docked ? 'STATUS: SPEAKING  INTENSITY: HIGH' : LABELS[S.mode];
}

// ---------- Stato dei sistemi (al server, per il registro: solo stati, niente audio né testo) ----------
// La risposta dice anche quanti compiti dell'agenda sono arrivati all'ora: se STEM è fermo e nessuno sta parlando, parla per primo
let micPeak = 0;
async function pollStatus() {
  try {
    const q = new URLSearchParams({ hud: 1, ear: ear, lock: earLock ? 1 : 0, rec: rec ? 'ear' : '-', mic: micPeak.toFixed(3), mode: S.mode });
    micPeak = 0;
    const st = await (await fetch('/api/status?' + q)).json();
    if (st.agenda > 0 && S.mode === 'idle' && !S.hearing && !pending) { report('agenda: STEM parla per primo'); ask('', { agenda: true }); }
  } catch {}
}
setTimeout(pollStatus, 0); setInterval(pollStatus, 5000);

// ---------- Pannello del browser: solo per i compiti complessi (STEM lo chiede con [[mostra]]) ----------
let screenTimer = 0;
function showScreen(on) { // si chiude 15 s dopo che STEM ha finito
  clearTimeout(screenTimer);
  if (on) { document.body.classList.add('browsing'); S.splitTarget = 1; }
  else screenTimer = setTimeout(() => { document.body.classList.remove('browsing'); S.splitTarget = 0; }, 15000);
}
const VERBS = {
  navigate: 'Apro', navigate_back: 'Torno indietro', click: 'Clicco', type: 'Scrivo', fill_form: 'Compilo',
  snapshot: 'Leggo la pagina', take_screenshot: 'Guardo', press_key: 'Premo un tasto', hover: 'Indico',
  select_option: 'Scelgo', wait_for: 'Attendo', evaluate: 'Analizzo', drag: 'Trascino', find: 'Cerco nella pagina',
};
function showAction(name, detail) {
  $('p-what').textContent = (VERBS[name] || name.replace(/_/g, ' ')).toUpperCase();
  if (detail) $('p-host').textContent = '· ' + detail;
}

// File e Mac: un'etichetta discreta sotto la scritta di stato, niente pannello
const SMALL_VERBS = { Read: 'Leggo', Write: 'Creo', Edit: 'Modifico', Glob: 'Cerco file', Grep: 'Cerco nei file',
  schermo: 'Guardo lo schermo', clic: 'Clicco', scrivi: 'Scrivo', tasti: 'Tasti', apri_app: 'Apro', chiudi_app: 'Chiudo', scorri: 'Scorro', trascina: 'Trascino',
  ricorda: 'Segno in agenda', agenda: 'Guardo l\'agenda' };
let smallTimer = 0;
function showSmall(name, detail) {
  $('small').textContent = `${SMALL_VERBS[name] || name.replace(/_/g, ' ')}${detail ? ' · ' + detail : ''}`.toUpperCase();
  $('small').classList.add('on');
  clearTimeout(smallTimer);
  smallTimer = setTimeout(() => $('small').classList.remove('on'), 6000);
}

// ---------- Report a schermo intero (STEM lo manda con lo strumento mostra_report) ----------
function openReport(r) {
  const plan = showReport(r);
  if (!plan) return closeReport(); // zero blocchi: STEM lo sta chiudendo
  sfx?.report(plan);
  clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0; // il report prende il posto del browser
  Object.assign(S, reportDock()); S.dockTarget = 1;
}
function closeReport() { hideReport(); S.dockTarget = 0; }
addEventListener('resize', () => { if (S.dockTarget) Object.assign(S, reportDock()); });

// ---------- GIF e animazioni accanto alla testa ----------
let mediaTimer = 0;
function showMedia(m) {
  const box = $('media'), img = $('media-img');
  img.onload = () => {
    $('media-title').textContent = (m.kind === 'anim' ? 'ESEMPIO · ' : '') + (m.title || '').toUpperCase().slice(0, 48);
    box.classList.add('on');
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(hideMedia, m.kind === 'anim' ? 16000 : 9000);
  };
  img.src = m.url;
}
function hideMedia() { $('media').classList.remove('on'); }

// ---------- Audio: una coda, una sola voce (il server decide ElevenLabs o Mac per l'intera risposta) ----------
let ctx = null, outAnalyser = null, micAnalyser = null, sfx = null;
const buf = new Uint8Array(1024);
async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    outAnalyser = ctx.createAnalyser(); outAnalyser.fftSize = 1024;
    outAnalyser.connect(ctx.destination);
    try { const { createSfx } = await import('./sfx.js'); sfx = createSfx(ctx); sfx.out.connect(ctx.destination); } catch (e) { console.warn('suoni non disponibili', e); }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
async function ensureMic() {
  if (micAnalyser || !ctx) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(micAnalyser);
  } catch {}
}
function rms(an) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

const PAGE = crypto.randomUUID(); // la stessa risposta non si confonde con quelle di un HUD ricaricato
let generation = 0, queue = [], playing = false, streamDone = true, currentSource = null, ttsAbort = new AbortController();
let spokeThisAnswer = false;
// Mai più di 2 sintesi insieme: il piano di ElevenLabs ne accetta 2
let ttsActive = 0;
const ttsWaiting = [];
const ttsSlot = () => new Promise((go) => { if (ttsActive < 2) { ttsActive++; go(); } else ttsWaiting.push(go); });
const ttsFree = () => { const next = ttsWaiting.shift(); if (next) next(); else ttsActive--; };

const recentSpoken = []; // frasi davvero riprodotte di recente, con l'ora: servono a riconoscere l'eco della sua voce
function speak(text) {
  const gen = generation, signal = AbortSignal.any([ttsAbort.signal, AbortSignal.timeout(15000)]); // annullabile, e mai bloccata per sempre
  const job = ttsSlot().then(() => (gen !== generation ? null // risposta annullata: non spendo caratteri
    : fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, answer: `${PAGE}:${gen}` }), signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))).finally(ttsFree);
  job.text = text;
  queue.push({ gen, job });
  if (!playing) playNext();
}
async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    if (streamDone && (S.mode === 'speaking' || S.mode === 'thinking')) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); }
    else if (!streamDone && S.mode === 'speaking') setMode('thinking'); // la frase è finita ma STEM sta ancora lavorando
    return;
  }
  playing = true;
  const data = await item.job;
  if (item.gen !== generation) return; // risposta annullata: silence() ha già azzerato tutto
  if (!data) return playNext();         // frase persa: meglio un salto che un'altra voce
  await ensureAudio();
  try {
    const audio = await ctx.decodeAudioData(data);
    if (item.gen !== generation) return;
    const src = ctx.createBufferSource();
    src.buffer = audio; src.connect(outAnalyser);
    currentSource = src;
    spokeThisAnswer = true;
    recentSpoken.push({ text: item.job.text || '', at: performance.now() + audio.duration * 1000 }); if (recentSpoken.length > 4) recentSpoken.shift();
    if (S.mode !== 'speaking') setMode('speaking');
    src.onended = () => { if (currentSource === src) currentSource = null; if (item.gen === generation) playNext(); };
    src.start();
  } catch { playNext(); }
}
function silence() {
  generation++;
  ttsAbort.abort(); ttsAbort = new AbortController(); // le sintesi della risposta vecchia liberano subito i posti
  queue = []; playing = false;
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
}

// ---------- Cervello ----------
let controller = null, lastReplyAt = -1e9;
async function ask(text, { agenda = false } = {}) { // agenda: niente testo, il server prende i compiti arrivati all'ora
  silence();
  spokeThisAnswer = false; earlySent = '';
  const gen = generation;
  controller?.abort();
  controller = new AbortController();
  setMode('thinking');
  sfx?.ack();
  streamDone = false;
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(agenda ? { agenda } : { text }), signal: controller.signal });
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
        else if (ev.t === 'show') { closeReport(); showScreen(true); } // ricerca nuova: il report vecchio lascia il posto al browser
        else if (ev.t === 'report') openReport(ev);
        else if (ev.t === 'tool') { showAction(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        else if (ev.t === 'page') $('p-host').textContent = '· ' + ev.detail;
        else if (ev.t === 'file' || ev.t === 'mac') { showSmall(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        else if (ev.t === 'media') showMedia(ev);
        else if (ev.t === 'ignore') { report('frase non per STEM (ignorata dal cervello)'); lastReplyAt = -1e9; } // niente finestra di conversazione
        else if (ev.t === 'error') speak('Ho perso il filo, scusami. Riprova tra un attimo.');
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') speak('Non riesco a raggiungere il mio cervello. Il server è acceso?');
  } finally {
    if (gen === generation) { streamDone = true; if (!playing && queue.length === 0) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); } }
  }
}
function interrupt() { silence(); controller?.abort(); fetch('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' } }); setMode('idle'); }

// ---------- Ascolto sempre acceso (riconoscimento locale: l'audio della stanza non esce dal Mac) ----------
// Chrome tiene un solo riconoscimento per processo: con due HUD aperti si interromperebbero. Ascolta chi ha il lucchetto.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LOCAL = { langs: ['it-IT'], processLocally: true };
let rec = null, ear = 'prep', earLock = !navigator.locks, earTimer = 0, earBackoff = 300, earFails = 0;
const EAR_TEXT = { prep: 'preparo', install: 'installo il modello italiano', click: 'clic per attivare', on: 'acceso', denied: 'microfono negato', nolocal: 'non disponibile' };
navigator.locks?.request('stem-ear', () => { earLock = true; scheduleEar(300); return new Promise(() => {}); });

const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const report = (line) => fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) }).catch(() => {});
function lev1(a, b) { // distanza di modifica ≤ 1?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
const NOT_NAME = new Set(['item', 'step', 'stei', 'sto', 'tema', 'ste']); // "Ste" è un diminutivo di Stefano
// Storpiature reali del riconoscitore: "System" (locale it-IT), "Charge them" per "Ciao STEM" (memoria di STEM)
const NAME_ALIASES = new Set(['system', 'sistem', 'sistemm', 'charge']);
// "Stemma" (registro del 1/11: due richieste perse) è anche una parola vera: vale come nome solo a inizio frase o dopo un saluto
const NAME_AT_START = new Set(['stemma']);
const isName = (w) => { const n = norm(w); return n.length >= 3 && !NOT_NAME.has(n) && (lev1(n, 'stem') || NAME_ALIASES.has(n)); };
const COMMANDS = /^(apri|chiudi|cerca|trova|dimmi|dammi|fammi|mostrami|fai|crea|scrivi|leggi|leggimi|metti|ricordami|calcola|traduci|spiegami|raccontami|avvia|controlla|prepara|manda|riassumi|aiutami|puoi|potresti|sai|mi\s+(dici|fai|trovi|apri|cerchi|spieghi|racconti))\b/i;
const STOP = /^(stop|basta|zitto|fermati|aspetta|silenzio)\b/i;
const GREETING = /^(buongiorno|buon\s?giorno|buonasera|buona\s?sera|buonanotte|ciao|ehi|ehy|hey|salve|eccomi|sono\s+tornato)\b/i;
const FOLLOW_UP_MS = 25000;

// Per il registro: la prima parola e quella più simile a "stem" (per scoprire come il riconoscitore storpia il nome), mai la frase
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function clue(text) {
  const words = text.trim().split(/\s+/).map(norm).filter(Boolean);
  const best = words.map((w) => [w, editDistance(w, 'stem')]).sort((x, y) => x[1] - y[1])[0];
  return `${words.length} parole; prima: "${words[0] || ''}"` + (best && best[1] <= 3 ? `; più simile a stem: "${best[0]}" (distanza ${best[1]})` : '');
}

// È per STEM? Il nome (anche storpiato), la conversazione in corso, o un comando all'inizio della frase
function addressed(text) {
  const words = text.trim().split(/\s+/);
  const nameAt = words.findIndex((w, i) => isName(w) || (NAME_AT_START.has(norm(w)) && (i === 0 || (i === 1 && GREETING.test(words[0])))));
  if (nameAt >= 0) return { why: 'nome', text: [...words.slice(0, nameAt), ...words.slice(nameAt + 1)].join(' ').replace(/^[\s,.:;!?]+/, '').trim() || 'Ciao!' };
  if (words.length < 2) return GREETING.test(text.trim()) ? { why: 'saluto', text } : null; // un "sì" isolato è quasi sempre per altri, un "ciao" no
  if (performance.now() - lastReplyAt < FOLLOW_UP_MS && S.mode !== 'thinking') return { why: 'conversazione', text };
  if (COMMANDS.test(text.trim())) return { why: 'comando', text };
  if (GREETING.test(text.trim()) && words.length <= 5) return { why: 'saluto', text }; // "Buongiorno!": se poi non era per lui, il cervello risponde [ignora]
  return null;
}

async function prepareEar() {
  if (!SR || typeof SR.available !== 'function') { ear = 'nolocal'; return; }
  let st = await SR.available(LOCAL).catch(() => 'unavailable');
  if (st === 'downloadable' || st === 'downloading') {
    ear = 'install';
    const ok = await SR.install(LOCAL).catch(() => false);
    st = ok ? 'available' : await SR.available(LOCAL).catch(() => 'unavailable');
  }
  ear = st === 'available' ? 'on' : st === 'downloadable' ? 'click' : 'nolocal';
  if (ear !== 'on') { warn(`Ascolto: ${EAR_TEXT[ear]}.`); if (ear === 'nolocal') retryEar(); }
  scheduleEar(300);
}
let retryTimer = 0;
function retryEar() { clearTimeout(retryTimer); retryTimer = setTimeout(prepareEar, 45000); } // permesso dato dopo, modello reinstallato…
function scheduleEar(ms = 300) { clearTimeout(earTimer); if (ear === 'on' && earLock) earTimer = setTimeout(startEar, ms); }

// ?debug&wav=file.wav: l'ascolto sente quel file invece del microfono (prove senza voce)
let debugTrack = null;
async function loadDebugTrack(file) {
  const c = new AudioContext();
  const b = await c.decodeAudioData(await (await fetch(file)).arrayBuffer());
  const dest = c.createMediaStreamDestination();
  const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(dest); s.start();
  debugTrack = dest.stream.getAudioTracks()[0];
}

let earlySent = '', earlyTimer = 0, joinTimer = 0, pending = '', heardAt = 0, spokeUntil = -1e9;
// Eco: le ultime parole di STEM arrivano al riconoscitore anche dopo che ha smesso di parlare.
// Le scarto se arrivano entro 1,2 s dalla fine o se somigliano per più del 60% a ciò che ha appena detto.
function echoWords() { // parole dette da STEM negli ultimi 6 secondi
  const now = performance.now();
  return new Set(recentSpoken.filter((r) => now - r.at < 6000).flatMap((r) => r.text.split(/\s+/).map(norm)));
}
function isEcho(text) {
  const words = text.split(/\s+/);
  if (words.some(isName)) return false;
  const w = words.map(norm).filter((x) => x.length > 2);
  if (w.length < 1) return performance.now() - spokeUntil < 1200;
  const said = echoWords();
  const similar = w.filter((x) => said.has(x)).length / w.length > 0.6;
  return similar || (performance.now() - spokeUntil < 1200 && w.filter((x) => said.has(x)).length > 0);
}
// Mentre parla o lavora: "stop", "basta"… oppure il nome, in qualunque punto della frase, tolte le parole della sua eco
function wantsStop(text) {
  const said = echoWords();
  const mine = text.split(/\s+/).filter((x) => !said.has(norm(x)));
  return mine.some((x) => STOP.test(x) || isName(x));
}
function startEar() {
  if (ear !== 'on' || !earLock || rec) return;
  const r = new SR();
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.processLocally = true;
  rec = r;
  ensureAudio().then(ensureMic); // l'anello e i cerchi si muovono quando parli
  r.onresult = (e) => {
    earBackoff = 300; earFails = 0;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], text = res[0].transcript.trim();
      if (!text) continue;
      if (res.isFinal) heard(text); else interim += ' ' + text;
    }
    onInterim(interim.trim());
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed') { ear = 'denied'; warn('Serve il permesso del microfono.'); retryEar(); return; }
    if (e.error === 'service-not-allowed' || e.error === 'language-not-supported') { ear = 'nolocal'; retryEar(); return; }
    if (e.error !== 'no-speech') {
      earBackoff = Math.min(10000, earBackoff * 2);
      if (++earFails === 5) report(`ascolto in errore: ${e.error}`);
    }
  };
  r.onend = () => { if (rec === r) { rec = null; S.hearing = false; scheduleEar(earBackoff); } }; // Chrome chiude dopo un po' di silenzio: riparto
  try { if (debugTrack) r.start(debugTrack); else r.start(); } catch { rec = null; scheduleEar(1000); }
}

// Parole parziali: mentre parli STEM ti "guarda" (cerchi del sonar); se ti fermi 0,8 s su una richiesta, parte già
function onInterim(text) {
  S.hearing = Boolean(text);
  if (!text) return;
  dbg('parziale', text, '| modo', S.mode);
  heardAt = performance.now();
  const said = echoWords();
  if ((S.mode === 'speaking' || S.mode === 'thinking') && text.split(/\s+/).some((x) => STOP.test(x) && !said.has(norm(x)))) {
    interrupt(); report('fermato a voce'); return; // "stop" funziona anche mentre clicca e scrive, senza aspettare la fine della frase
  }
  if (S.mode === 'speaking' || isEcho(text)) return; // mentre parla, e subito dopo, ignora l'eco della sua voce
  if (pending) clearTimeout(joinTimer); // stai ancora parlando: la frase non è finita
  clearTimeout(earlyTimer);
  const a = addressed(pending ? `${pending} ${text}` : text);
  if (!a) return;
  if (S.mode === 'idle') { setMode('listening'); sfx?.listen(); }
  earlyTimer = setTimeout(() => {
    if (a.text.split(/\s+/).length < 3 || norm(a.text) === norm(earlySent)) return;
    earlySent = a.text; report(`parto in anticipo (${a.why})`); ask(a.text);
  }, 800);
}

// Frase finita: decido se è per STEM, poi aspetto 0,6 s nel caso continui
function heard(text) {
  dbg('finale', text, '| modo', S.mode);
  S.hearing = false;
  clearTimeout(earlyTimer);
  if (S.mode === 'speaking' || S.mode === 'thinking') { // si può interrompere: "stop", "basta", oppure chiamandolo per nome
    if (wantsStop(text)) {
      interrupt(); report('interrotto a voce');
      const a = addressed(text);
      if (a && a.why === 'nome' && !STOP.test(a.text) && a.text.split(/\s+/).length > 1) ask(a.text);
      return;
    }
    if (S.mode === 'speaking') return;
  }
  if (isEcho(text)) { report('scartata: eco della voce di STEM'); return; }
  pending = pending ? `${pending} ${text}` : text;
  clearTimeout(joinTimer);
  // Solo il nome ("Stem…"): aspetto di più, probabilmente stai per dire la domanda
  const onlyName = pending.trim().split(/\s+/).every(isName);
  joinTimer = setTimeout(() => {
    const full = pending; pending = '';
    const a = addressed(full);
    dbg('decido', full, '->', a ? a.why + ': ' + a.text : 'non per STEM');
    if (!a) { report(`non per STEM; ${clue(full)}`); if (S.mode === 'listening') setMode('idle'); return; }
    // già partito in anticipo con lo stesso identico testo: non ricomincio; se è cambiato anche di una parola, riparto
    const sameAsEarly = earlySent && norm(a.text) === norm(earlySent);
    earlySent = '';
    if (sameAsEarly) return;
    report(`domanda (${a.why})`);
    ask(a.text);
  }, onlyName ? 2000 : 700);
}

// ---------- Tastiera e mouse: niente più push-to-talk. Esc zittisce, un clic sblocca l'audio se Chrome lo blocca ----------
addEventListener('keydown', (e) => { if (e.code === 'Escape') { pending = ''; earlySent = ''; interrupt(); closeReport(); } });
addEventListener('pointerdown', () => { ensureAudio(); if (ear !== 'on' && ear !== 'install') prepareEar(); });

function warn(msg) {
  const w = $('warn'); w.textContent = msg; w.style.display = 'block';
  clearTimeout(warn.t); warn.t = setTimeout(() => { w.style.display = 'none'; }, 5000);
}

// ---------- Avvio ----------
if (DEBUG) { window.stemAsk = ask; window.stemReport = openReport; } // prove senza microfono e senza ricerca
if (DEBUG && params.get('wav')) await loadDebugTrack(params.get('wav'));
prepareEar();
const { createScene, TIMING } = await import('./humanoid.js');
const scene = await createScene($('gl'), S);
// Se il Mac fa perdere il contesto grafico (sospensione, GPU riavviata) i campi precalcolati vanno rifatti: ricarico l'HUD
$('gl').addEventListener('webglcontextlost', (e) => e.preventDefault());
$('gl').addEventListener('webglcontextrestored', () => location.reload());
const freeze = params.get('t'); // ?t=3 ferma la formazione a 3 secondi (per le prove)
const t0 = performance.now();
let last = t0, revealed = false;
ensureAudio().then(() => { if (!freeze) sfx?.boot(); });
let lastActive = 0, skip = false;
function loop(now) {
  requestAnimationFrame(loop);
  // In attesa e senza nessuno che parla da 20 s: 20 fotogrammi al secondo bastano, la GPU (e la batteria) ringraziano
  if (booting || S.mode !== 'idle' || S.hearing || S.split > 0.01 || $('media').classList.contains('on')) lastActive = now;
  if (now - lastActive > 20000) { skip = !skip; if (skip || now - last < 45) return; }
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = freeze ? Number(freeze) : (now - t0) / 1000;
  if (!revealed && t >= TIMING.reveal) { revealed = true; if (!freeze) sfx?.reveal(); }
  if (booting && t >= TIMING.ready) { booting = false; document.body.classList.add('ready'); }
  const out = outAnalyser && currentSource ? Math.min(1, rms(outAnalyser) * 4.5) : 0;
  S.audio += (out - S.audio) * Math.min(1, dt * 18);
  const mic = micAnalyser && S.mode !== 'speaking' ? Math.min(1, rms(micAnalyser) * 6) : 0;
  S.mic += (mic - S.mic) * Math.min(1, dt * 18);
  if (micAnalyser) micPeak = Math.max(micPeak, rms(micAnalyser));
  if (S.mode === 'listening' && !S.hearing && !pending && performance.now() - heardAt > 4000) setMode('idle');
  S.split += (S.splitTarget - S.split) * Math.min(1, dt * 2.5);
  S.dock += (S.dockTarget - S.dock) * Math.min(1, dt * 6); // nell'angolo in mezzo secondo: prima che atterri il protagonista
  scene.frame(t, ((now - t0) / 1000) % 3600, dt); // orologio che riparte ogni ora: in float32 resta preciso anche dopo giorni
  drawStatus(t, scene.anchor());
}
requestAnimationFrame(loop);
