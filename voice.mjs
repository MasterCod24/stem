// La voce di STEM. Una risposta ha UN solo fornitore dall'inizio alla fine: mai più ElevenLabs → Mac → ElevenLabs.
// Prima la causa era il piano gratuito: con pochi crediti rimasti le frasi corte passavano e quelle lunghe no.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((ok, ko) => execFile(cmd, args, { maxBuffer: 4e6 }, (e, out) => (e ? ko(e) : ok(String(out)))));

export function createVoice({ key, voiceId, model, macVoice, onLog = () => {} }) {
  const COST = /turbo|flash|conversational/.test(model) ? 0.5 : 1; // crediti per carattere
  const MIN_CREDITS = 400;                                          // sotto questa soglia una risposta intera non ci sta
  let credits = null, exhausted = !key, mac = macVoice || null;
  const answers = new Map();                                        // risposta → { provider, said: [frasi già dette] }

  async function refreshCredits() {
    if (!key) return;
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(8000) });
      const s = r.ok ? await r.json() : {};
      if (!Number.isFinite(s.character_limit) || !Number.isFinite(s.character_count)) throw new Error(`risposta ${r.status}`); // non tocco lo stato
      credits = s.character_limit - s.character_count;
      exhausted = credits < MIN_CREDITS;
      onLog(`[voce] ElevenLabs: ${credits} crediti${exhausted ? ' (finiti: uso la voce del Mac)' : ''}`);
    } catch (e) { onLog(`[voce] crediti non letti: ${e.message}`); }
  }
  refreshCredits();
  setInterval(refreshCredits, 10 * 60 * 1000).unref(); // si rinnovano da soli: me ne accorgo entro 10 minuti

  // La migliore voce italiana installata sul Mac: Luca avanzata/premium se c'è, poi Alice
  async function pickMacVoice() {
    if (mac) return mac;
    const list = (await run('/usr/bin/say', ['-v', '?']).catch(() => '')).split('\n').filter((l) => /\bit_IT\b/.test(l));
    const names = list.map((l) => l.split(/\s{2,}|\s+it_IT/)[0].trim());
    const rank = (n) => (/luca/i.test(n) ? 0 : /alice/i.test(n) ? 2 : 4) - (/premium|enhanced|avanzat|migliorat/i.test(n) ? 1 : 0);
    mac = names.sort((a, b) => rank(a) - rank(b))[0] || 'Alice';
    onLog(`[voce] voce del Mac: ${mac}`);
    return mac;
  }
  pickMacVoice();

  async function macSpeak(text) {
    const file = path.join(os.tmpdir(), `stem-voce-${crypto.randomUUID()}.wav`); // nome unico: due frasi insieme non si pestano
    await run('/usr/bin/say', ['-v', await pickMacVoice(), '-r', '185', '-o', file, '--data-format=LEI16@24000', '--', text]); // "--": una frase che inizia con "-" non è un'opzione
    const data = fs.readFileSync(file);
    fs.unlink(file, () => {});
    return { type: 'audio/wav', data, provider: 'mac' };
  }

  async function elevenSpeak(text, said) {
    const body = {
      text, model_id: model,
      // Continuità tra una frase e l'altra: senza contesto ogni frase parte "da zero" e la voce suona piatta
      previous_text: said.slice(-2).join(' ') || undefined,
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: 1.04 },
    };
    if (/v2_5/.test(model)) body.language_code = 'it';
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = typeof voiceId === 'function' ? voiceId() : voiceId; // può cambiare dopo l'avvio (scelta automatica)
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
        method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000), // una connessione bloccata non deve lasciare STEM muto
      });
      if (r.ok) {
        if (credits !== null) credits -= Math.ceil(text.length * COST);
        return { type: 'audio/mpeg', data: Buffer.from(await r.arrayBuffer()), provider: 'eleven' };
      }
      const err = await r.text();
      if (r.status === 429 && attempt === 0) { await new Promise((ok) => setTimeout(ok, 500)); continue; } // troppe richieste insieme: riprovo una volta
      if (/quota|credits|paid_plan/i.test(err)) exhausted = true;
      throw new Error(`ElevenLabs ${r.status}: ${err.slice(0, 160)}`);
    }
  }

  // Una frase della risposta `answer`. Il fornitore si decide alla prima frase e resta quello.
  async function speak(text, answer) {
    let a = answers.get(answer);
    if (!a) {
      a = { provider: !exhausted && (credits === null || credits >= MIN_CREDITS) ? 'eleven' : 'mac', said: [], elevenOk: 0, inflight: 0 };
      answers.set(answer, a);
      if (answers.size > 30) answers.delete(answers.keys().next().value);
    }
    if (a.provider === 'mac') { const out = await macSpeak(text); a.said.push(text); return out; }
    a.inflight++;
    try {
      const out = await elevenSpeak(text, a.said);
      a.elevenOk++; a.said.push(text);
      return out;
    } catch (e) {
      onLog(`[voce] ${e.message}`);
      // Se in questa risposta ElevenLabs ha già parlato (o sta parlando) NON passo al Mac: meglio saltare una frase che cambiare voce.
      // La risposta dopo partirà direttamente con la voce giusta.
      if (a.elevenOk || a.inflight > 1) { exhausted = exhausted || /quota|credits/i.test(e.message); throw new Error('frase saltata per non cambiare voce'); }
      a.provider = 'mac';
      const out = await macSpeak(text); a.said.push(text); out.switched = true;
      return out;
    } finally { a.inflight--; }
  }

  return { speak, get status() { return { provider: exhausted ? 'mac' : 'eleven', credits, mac } } };
}
