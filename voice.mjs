// La voce di O.S.C.A.R.: quella del Mac, con `say`. È la voce scelta in Impostazioni → Accessibilità → Contenuti letti, se è
// italiana (anche una voce di Siri, che non ha un nome da passare a "say -v": si usa solo come voce di sistema); altrimenti la
// migliore italiana installata. OSCAR_MAC_VOICE la scavalca.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((ok, ko) => execFile(cmd, args, { maxBuffer: 4e6 }, (e, out) => (e ? ko(e) : ok(String(out)))));

export function createVoice({ macVoice } = {}) {
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
  async function speak(text) {
    const file = path.join(os.tmpdir(), `oscar-voce-${crypto.randomUUID()}.wav`); // nome unico: due frasi insieme non si pestano
    const v = await scegli();
    await run('/usr/bin/say', [...(v ? ['-v', v] : []), '-r', '185', '-o', file, '--data-format=LEI16@24000', '--', text]); // "--": una frase che inizia con "-" non è un'opzione
    const data = fs.readFileSync(file);
    fs.unlink(file, () => {});
    return { type: 'audio/wav', data };
  }

  return { speak, get status() { return { provider: 'mac', voce: label || mac || 'sistema' }; } };
}
