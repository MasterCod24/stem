// La voce di Nexus: Kokoro sul Mac (voce-kokoro.py, sempre acceso), e la voce del Mac se Kokoro non c'è o si ferma.
// Una risposta ha UNA sola voce dall'inizio alla fine: si decide alla prima frase e resta quella.
// Kokoro dice «Guardo subito.» in 0,37 s, `say` in 0,8–1,4 s, perché riparte e ricarica la voce a ogni frase (22/11).
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const run = (cmd, args) => new Promise((ok, ko) => execFile(cmd, args, { maxBuffer: 4e6 }, (e, out) => (e ? ko(e) : ok(String(out)))));
const FRASE_MS = 15_000; // l'HUD rinuncia a una frase dopo 15 s

// cartella: runtime/kokoro, con venv, modello e voci (installa-kokoro.sh). script: voce-kokoro.py.
// voce: una voce di Kokoro o una miscela («im_nicola:0.7+bm_george:0.3»); velocita: 1 è quella del modello.
export function createVoice({ cartella, script, voce = 'im_nicola', velocita = 1, macVoice, onLog = () => {} }) {
  const answers = new Map(); // risposta → { provider, said: quante frasi dette }

  // --- Kokoro: un processo solo, che riparte se muore ---
  const python = path.join(cartella, 'venv', 'bin', 'python');
  const installato = () => ['kokoro-v1.0.onnx', 'voices-v1.0.bin'].every((f) => fs.existsSync(path.join(cartella, f))) && fs.existsSync(python);
  let proc = null, pronto = false, buf = '', prossimo = 0, attesa = 2000;
  const inCorso = new Map(); // id → { ok, ko, timer }
  function avvia() {
    if (!installato()) { onLog(`[voce] Kokoro non è installato (${cartella}): uso la voce del Mac. Si installa con ./installa-kokoro.sh`); return; }
    const p = spawn(python, ['-I', script, cartella], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc = p; buf = '';
    let errori = '';
    p.stderr.on('data', (d) => { errori = (errori + d).slice(-600); });
    p.stdin.on('error', () => {}); // EPIPE se è appena morto: non deve far cadere il server
    p.stdout.on('data', (d) => {
      buf += d;
      let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const riga = buf.slice(0, k); buf = buf.slice(k + 1);
        let o; try { o = JSON.parse(riga); } catch { continue; }
        if (o.pronto) { pronto = true; attesa = 2000; onLog(`[voce] Kokoro pronto (${voce}, velocità ${velocita})`); continue; }
        const a = inCorso.get(o.id);
        if (!a) continue;
        inCorso.delete(o.id); clearTimeout(a.timer);
        if (o.wav) a.ok(Buffer.from(o.wav, 'base64')); else a.ko(new Error(`Kokoro: ${o.errore || 'nessun audio'}`));
      }
    });
    p.on('exit', (code, signal) => {
      if (proc !== p) return;
      proc = null; pronto = false;
      for (const a of inCorso.values()) { clearTimeout(a.timer); a.ko(new Error('Kokoro si è fermato')); }
      inCorso.clear();
      onLog(`[voce] Kokoro fermo (${code ?? signal}): riparto fra ${attesa / 1000} s. ${errori.trim().split('\n').slice(-2).join(' | ')}`);
      setTimeout(avvia, attesa).unref();
      attesa = Math.min(60_000, attesa * 2);
    });
  }
  avvia();

  function kokoroSpeak(text) {
    if (!pronto) return Promise.reject(new Error('Kokoro non è pronto'));
    return new Promise((ok, ko) => {
      const id = ++prossimo;
      const timer = setTimeout(() => { inCorso.delete(id); ko(new Error(`Kokoro: nessun audio entro ${FRASE_MS / 1000} s`)); }, FRASE_MS);
      inCorso.set(id, { ok: (data) => ok({ type: 'audio/wav', data, provider: 'kokoro' }), ko, timer });
      proc.stdin.write(JSON.stringify({ id, testo: text, voce, velocita }) + '\n');
    });
  }

  // --- La voce del Mac: quella scelta in Impostazioni → Accessibilità → Contenuti letti, se è italiana (anche una voce di Siri,
  // che non ha un nome da passare a "say -v": si usa solo come voce di sistema). Altrimenti la migliore italiana installata.
  let mac = macVoice || null, macLabel = ''; // null = da scegliere, '' = voce di sistema
  async function pickMacVoice() {
    if (mac !== null) return mac;
    const sys = await run('/usr/bin/defaults', ['read', 'com.apple.Accessibility', 'SpokenContentDefaultVoiceSelectionsByLanguage']).catch(() => '');
    const it = sys.split(/\}\s*,?/).find((b) => /boundLanguage\s*=\s*"?it"?\s*;/.test(b));
    const id = it?.match(/voiceId\s*=\s*"([^"]+)"/)?.[1];
    if (id) {
      mac = '';
      macLabel = /siri/i.test(id) ? `Siri (${id.split('.').pop()})` : id.split('.').pop();
      return mac;
    }
    const list = (await run('/usr/bin/say', ['-v', '?']).catch(() => '')).split('\n').filter((l) => /\bit_IT\b/.test(l));
    const names = list.map((l) => l.split(/\s{2,}|\s+it_IT/)[0].trim());
    const rank = (n) => (/luca/i.test(n) ? 0 : /alice/i.test(n) ? 2 : 4) - (/premium|enhanced|avanzat|migliorat/i.test(n) ? 1 : 0);
    mac = names.sort((a, b) => rank(a) - rank(b))[0] || 'Alice';
    macLabel = mac;
    return mac;
  }
  pickMacVoice();

  async function macSpeak(text) {
    const file = path.join(os.tmpdir(), `nexus-voce-${crypto.randomUUID()}.wav`); // nome unico: due frasi insieme non si pestano
    const v = await pickMacVoice();
    await run('/usr/bin/say', [...(v ? ['-v', v] : []), '-r', '185', '-o', file, '--data-format=LEI16@24000', '--', text]); // "--": una frase che inizia con "-" non è un'opzione
    const data = fs.readFileSync(file);
    fs.unlink(file, () => {});
    return { type: 'audio/wav', data, provider: 'mac' };
  }

  // Una frase della risposta `answer`. Se Kokoro sbaglia alla prima frase, tutta la risposta passa al Mac;
  // se sbaglia dopo, la frase si salta: meglio un buco che un'altra voce a metà.
  async function speak(text, answer) {
    let a = answers.get(answer);
    if (!a) {
      a = { provider: pronto ? 'kokoro' : 'mac', said: 0 };
      answers.set(answer, a);
      if (answers.size > 30) answers.delete(answers.keys().next().value);
    }
    if (a.provider === 'mac') { const out = await macSpeak(text); a.said++; return out; }
    const primo = a.said === 0;
    a.said++;
    try {
      return await kokoroSpeak(text);
    } catch (e) {
      onLog(`[voce] ${e.message}`);
      if (!primo) throw new Error('frase saltata per non cambiare voce');
      a.provider = 'mac';
      const out = await macSpeak(text); out.switched = true;
      return out;
    }
  }

  return {
    speak,
    get status() { return pronto ? { provider: 'kokoro', voce } : { provider: 'mac', voce: macLabel || mac || 'sistema' }; },
    get pid() { return proc?.pid; }, // per le prove
    ferma() { proc?.kill('SIGTERM'); proc = null; },
  };
}
