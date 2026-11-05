// Il cervello di STEM: un solo processo Claude Code sempre acceso (stream-json in ingresso e in uscita).
// Niente avvio a ogni domanda: dalla seconda in poi il primo testo arriva in circa un secondo invece di tre.
// Una domanda nuova interrompe quella in corso (control_request interrupt) senza uccidere il processo.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Segnali che STEM scrive nel testo e che non vanno letti ad alta voce:
//   [ignora]        la frase non era per lui: nessuna risposta
//   [[mostra]]      compito complesso: apri il pannello del browser nell'HUD
//   [gif: parole]   GIF simpatica (GIPHY)      [anim: words]   animazione che spiega (Wikimedia Commons)
const TAG = /\[\[?\s*([a-zà-ù]+)\s*(?::\s*([^\]]*?))?\s*\]\]?/gi;

// Dopo un riavvio di STEM riprendo la conversazione di prima, se l'ultima risposta è di meno di 2 ore fa:
// riaprendo l'HUD poco dopo, "e il secondo film che mi hai detto?" ha ancora senso. Più in là vale la memoria.
const RESUME_MS = 2 * 3600_000;

export function createBrain({ cwd, args, sessionFile, onLog = () => {} }) {
  let child = null, buf = '', stderr = '';
  let turn = null;          // turno in corso
  let waiting = null;       // domanda da mandare appena il turno interrotto si chiude
  let respawnTimer = 0;

  let bornAt = 0, fails = 0;
  let sessionId = null, resume = true; // se il processo muore riparte nella stessa conversazione (tranne dopo un reset)
  try { const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8')); if (Date.now() - s.at < RESUME_MS) sessionId = s.id; } catch {}
  const saveSession = () => { try { fs.writeFileSync(sessionFile, JSON.stringify({ id: sessionId, at: Date.now() })); } catch {} };
  function start() {
    if (child) return;
    bornAt = Date.now();
    const extra = resume && sessionId ? ['--resume', sessionId] : [];
    if (extra.length) onLog('[cervello] riprendo la conversazione di prima');
    const c = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', ...extra, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    child = c;
    resume = true;
    buf = ''; stderr = '';
    c.stdout.on('data', (d) => { if (child === c) onData(d); }); // righe arrivate dopo la morte: non devono riscrivere sessionId
    c.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    c.stdin.on('error', () => {}); // EPIPE se il processo è appena morto: non deve far cadere il server
    let gone = false;
    const died = (why) => { // 'exit' oppure, se il programma non parte proprio, solo 'error' + 'close'
      if (gone) return; gone = true;
      onLog(`[cervello] fermo (${why}) ${stderr.trim().slice(-300)}`);
      if (child === c) child = null;
      const quick = Date.now() - bornAt < 20000;
      // Ripreso e morto subito (conversazione sparita o rovinata): riparto da una nuova, se no riproverei la stessa all'infinito
      if (quick && extra.length && sessionId) { onLog('[cervello] non riesco a riprendere la conversazione: ne apro una nuova'); sessionId = null; }
      fails = quick ? fails + 1 : 0; // se muore appena nato, aspetto sempre di più (prima di endTurn, che può farlo ripartire)
      if (turn) endTurn({ error: 'Il cervello si è fermato.' });
      clearTimeout(respawnTimer);
      if (!child) respawnTimer = setTimeout(start, Math.min(60000, 1500 * 2 ** fails));
    };
    c.on('error', (e) => died(e.message));
    c.on('exit', (code, signal) => died(code ?? signal));
    c.on('close', (code) => died(`chiuso ${code}`));
  }

  const send = (o) => { try { child?.stdin.write(JSON.stringify(o) + '\n'); } catch {} };

  function onData(chunk) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.session_id) sessionId = o.session_id;
      if (!turn) continue;
      if (o.type === 'stream_event') {
        const e = o.event;
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') { turn.text += e.delta.text; speakable(false); }
        if (e.type === 'content_block_stop') speakable(true);
      } else if (o.type === 'assistant') {
        for (const c of o.message?.content || []) if (c.type === 'tool_use') toolEvent(c);
      } else if (o.type === 'result') {
        endTurn(o.is_error && !turn.interrupted ? { error: 'Ho perso il filo.' } : {});
      }
    }
  }

  // Testo → frasi da dire. I segnali tra parentesi quadre diventano eventi e spariscono dal parlato.
  function speakable(all) {
    const T = turn;
    if (T.ignored) return;
    let text = T.text.slice(T.used);
    let open = text.lastIndexOf('['); const close = text.lastIndexOf(']');
    if (open > 0 && text[open - 1] === '[') open--; // [[mostra]] spezzato a metà tra due pezzi
    const hold = !all && open > close ? text.slice(open) : ''; // segnale non ancora chiuso: aspetto
    if (hold) text = text.slice(0, open);
    T.used += text.length;
    text = text.replace(TAG, (_, name, arg) => {
      const n = name.toLowerCase();
      if (n === 'ignora' && !T.spoke) { T.ignored = true; T.emit({ t: 'ignore' }); }
      else if (n === 'mostra') T.emit({ t: 'show' });
      else if ((n === 'gif' || n === 'anim') && arg) T.emit({ t: 'media', kind: n, q: arg.trim() });
      return ' ';
    }).replace(/[*_#`>\[\]]/g, '');
    if (T.ignored) return;
    T.speech += text;
    // La prima frase parte anche se è cortissima ("Certo!"), così la voce comincia subito;
    // dopo, le frasi sotto gli 8 caratteri si uniscono alla successiva invece di bloccare tutto
    let m;
    while ((m = T.speech.match(T.spoke ? /^([\s\S]{8,}?[.!?…])(\s+)/ : /^([\s\S]{2,}?[.!?…])(\s+)/))) {
      say(m[1]);
      T.speech = T.speech.slice(m[0].length);
    }
    if (all && T.speech.trim()) { say(T.speech); T.speech = ''; }
  }
  function say(s) {
    const clean = s.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    turn.spoke = true;
    turn.emit({ t: 'say', s: clean });
  }

  function toolEvent(c) {
    const T = turn;
    if (c.name.startsWith('mcp__playwright__')) {
      const name = c.name.replace('mcp__playwright__browser_', '');
      let detail = '';
      if (c.input?.url) { try { detail = new URL(c.input.url).hostname.replace(/^www\./, ''); } catch {} }
      T.browserActions++;
      T.emit({ t: 'tool', name, detail });
      // Rete di sicurezza: se STEM non ha detto [[mostra]] ma sta facendo una ricerca lunga, il pannello si apre lo stesso
      if (T.browserActions === 4) T.emit({ t: 'show' });
    } else if (c.name === 'mcp__mac__mostra_report') { // il report va all'HUD così com'è: lo strumento serve solo a dargli una forma
      T.emit({ t: 'report', titolo: c.input?.titolo, blocchi: c.input?.blocchi });
    } else if (c.name.startsWith('mcp__mac__')) {
      T.emit({ t: 'mac', name: c.name.replace('mcp__mac__', ''), detail: String(c.input?.nome || '').slice(0, 40) });
    } else { // file: nell'HUD solo il nome, mai il contenuto
      const f = c.input?.file_path || c.input?.path || c.input?.pattern || '';
      T.emit({ t: 'file', name: c.name, detail: path.basename(String(f)) });
    }
  }

  function endTurn({ error } = {}) {
    const T = turn;
    if (!T) return;
    if (!T.ignored && !T.interrupted) speakable(true);
    if (error && !T.interrupted) T.emit({ t: 'error', s: error });
    if (sessionFile && sessionId) saveSession(); // anche l'ora dell'ultima risposta: dice se dopo un riavvio vale la pena riprenderla
    turn = null;
    T.resolve();
    if (waiting) { const w = waiting; waiting = null; begin(w); }
  }

  function begin(w) {
    start();
    turn = { emit: w.onEvent, resolve: w.resolve, text: '', used: 0, speech: '', spoke: false, ignored: false, interrupted: false, browserActions: 0 };
    send({ type: 'user', message: { role: 'user', content: w.text } });
  }

  // Una domanda nuova: se ce n'è una in corso la interrompo, poi parto appena il processo ha chiuso il turno
  function ask(text, onEvent) {
    return new Promise((resolve) => {
      const w = { text, onEvent, resolve };
      if (waiting) { waiting.resolve(); waiting = w; return; }
      if (!turn) return begin(w);
      waiting = w;
      interrupt();
    });
  }

  function interrupt() {
    if (!turn || turn.interrupted) return;
    turn.interrupted = true;
    send({ type: 'control_request', request_id: `stop-${Date.now()}`, request: { subtype: 'interrupt' } });
    const T = turn;
    setTimeout(() => { if (turn === T) { onLog('[cervello] interruzione lenta: riavvio'); child?.kill('SIGTERM'); } }, 4000);
  }

  function stop() { if (waiting) { waiting.resolve(); waiting = null; } interrupt(); }
  function kill(reset = false) {
    if (reset) { resume = false; sessionId = null; try { fs.unlinkSync(sessionFile); } catch {} }
    child?.kill('SIGTERM');
  }
  function notify(ev) { turn?.emit(ev); } // eventi esterni (es. il sito cambiato) verso la domanda in corso

  start(); // acceso subito: la prima domanda non aspetta l'avvio
  return { ask, stop, kill, notify, get busy() { return Boolean(turn); } };
}
