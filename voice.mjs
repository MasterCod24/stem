// La voce di O.S.C.A.R.: ElevenLabs con la voce scelta da Tony il 28/11 («Daniel», dalla Voice Library), se in .env c'è
// ELEVENLABS_API_KEY; altrimenti quella del Mac, con `say`.
// Le due voci non si alternano mai: fino al 22/11 succedeva coi crediti quasi finiti (le frasi corte passavano, le lunghe
// no). Ora un rifiuto di ElevenLabs (chiave, permessi, crediti, piano: ogni 4xx tranne 408 e 429) spegne ElevenLabs fino
// al riavvio del server, e da quella frase parla il Mac. Un errore passeggero (rete, 5xx, 429) fa saltare solo quella
// frase: l'HUD la salta, come fa già con ogni frase persa.
// La voce del Mac è quella scelta in Impostazioni → Accessibilità → Contenuti letti, se è italiana (anche una voce di Siri,
// che non ha un nome da passare a "say -v": si usa solo come voce di sistema); altrimenti la migliore italiana installata.
// OSCAR_MAC_VOICE la scavalca.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((ok, ko) => execFile(cmd, args, { maxBuffer: 4e6 }, (e, out) => (e ? ko(e) : ok(String(out)))));

export function createVoice({
  key = '', voiceId = 'cYUwsivXsYhRnPTjXRI4', model = 'eleven_flash_v2_5', macVoice,
  base = 'https://api.elevenlabs.io', onLog = () => {},
} = {}) {
  let spenta = key ? '' : 'manca ELEVENLABS_API_KEY'; // perché ElevenLabs non parla: vuoto = parla
  let mac = macVoice || null, label = ''; // null = da scegliere, '' = voce di sistema
  async function scegli() {
    if (mac !== null) return mac;
    const sys = await run('/usr/bin/defaults', ['read', 'com.apple.Accessibility', 'SpokenContentDefaultVoiceSelectionsByLanguage']).catch(() => '');
    const it = sys.split(/\}\s*,?/).find((b) => /boundLanguage\s*=\s*"?it"?\s*;/.test(b));
    const id = it?.match(/voiceId\s*=\s*"([^"]+)"/)?.[1];
    if (id) {
      mac = '';
      label = /siri/i.test(id) ? `Siri (${id.split('.').pop()})` : id.split('.').pop();
      return mac;
    }
    const list = (await run('/usr/bin/say', ['-v', '?']).catch(() => '')).split('\n').filter((l) => /\bit_IT\b/.test(l));
    const names = list.map((l) => l.split(/\s{2,}|\s+it_IT/)[0].trim());
    const rank = (n) => (/luca/i.test(n) ? 0 : /alice/i.test(n) ? 2 : 4) - (/premium|enhanced|avanzat|migliorat/i.test(n) ? 1 : 0);
    mac = names.sort((a, b) => rank(a) - rank(b))[0] || 'Alice';
    label = mac;
    return mac;
  }
  scegli();

  // Una frase in WAV: say scrive un file, che si legge e si cancella
  async function macSpeak(text) {
    const file = path.join(os.tmpdir(), `oscar-voce-${crypto.randomUUID()}.wav`); // nome unico: due frasi insieme non si pestano
    const v = await scegli();
    await run('/usr/bin/say', [...(v ? ['-v', v] : []), '-r', '185', '-o', file, '--data-format=LEI16@24000', '--', text]); // "--": una frase che inizia con "-" non è un'opzione
    const data = fs.readFileSync(file);
    fs.unlink(file, () => {});
    return { type: 'audio/wav', data };
  }

  // Una frase in MP3 da ElevenLabs, o null se ElevenLabs si è appena spento
  async function elevenSpeak(text) {
    const r = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      // La lingua imposta: è una voce spagnola, e su una frase corta il riconoscimento della lingua può sbagliare.
      // I modelli v2.5 la accettano, multilingual v2 la rifiuta.
      body: JSON.stringify({ text, model_id: model, ...(/v2_5/.test(model) ? { language_code: 'it' } : {}) }),
      signal: AbortSignal.timeout(10_000), // una connessione bloccata non deve lasciare O.S.C.A.R. muto: l'HUD salta la frase
    });
    if (r.ok) return { type: 'audio/mpeg', data: Buffer.from(await r.arrayBuffer()) };
    const err = `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`;
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
      if (!spenta) { spenta = err; onLog(`[voce] ${err}. Da adesso, fino al riavvio, parla la voce del Mac`); }
      return null;
    }
    throw new Error(err);
  }

  async function speak(text) {
    if (!spenta) { const a = await elevenSpeak(text); if (a) return a; }
    return macSpeak(text);
  }

  onLog(spenta ? `[voce] voce del Mac (${spenta})` : `[voce] ElevenLabs, voce ${voiceId}, modello ${model}`);
  return {
    speak,
    get status() {
      return spenta ? { provider: 'mac', voce: label || mac || 'sistema', ...(key ? { motivo: spenta } : {}) } : { provider: 'eleven', voce: model };
    },
  };
}
