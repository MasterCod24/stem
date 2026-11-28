// voce.mjs — voice.mjs vero, senza server di O.S.C.A.R., contro un ElevenLabs finto in locale: senza chiave parla il Mac,
// con la chiave ElevenLabs; un errore passeggero fa saltare la frase senza cambiare voce; un rifiuto (crediti, chiave)
// passa al Mac per sempre, senza più chiedere a ElevenLabs. Circa 3 s.
// Con --rete [modelli…] usa invece ElevenLabs vero con la chiave di ~/STEM/.env (o ELEVENLABS_API_KEY): tre frasi in fila
// per modello, tempo e byte, e i file in runtime/prova-voce/ da ascoltare. Consuma circa 0,5 crediti a carattere (flash).
// node prove/voce.mjs → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoice } from '../voice.mjs';
import { configurazione } from '../config.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let ok = 0, ko = 0;
const esito = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); c ? ok++ : ko++; };

if (process.argv[2] === '--rete') {
  const envFile = ['.env', path.join(os.homedir(), 'STEM/.env')].map((f) => path.resolve(ROOT, f)).find((f) => fs.existsSync(f));
  const key = configurazione(envFile ? fs.readFileSync(envFile, 'utf8') : '', process.env).ELEVENLABS_API_KEY;
  if (!key) { console.log('Manca ELEVENLABS_API_KEY'); process.exit(1); }
  const modelli = process.argv.slice(3).length ? process.argv.slice(3) : ['eleven_flash_v2_5'];
  const frasi = ['Guardo subito.', 'Domani a Milano piove dalle tre, con dodici gradi e vento debole.',
    'Il Louvre ha avuto nove milioni di visitatori nel duemilaventicinque, più di ogni altro museo al mondo.'];
  const cartella = path.join(ROOT, 'runtime', 'prova-voce');
  fs.mkdirSync(cartella, { recursive: true });
  for (const model of modelli) {
    const log = [];
    const v = createVoice({ key, model, voiceId: process.env.ELEVENLABS_VOICE_ID || undefined, onLog: (l) => log.push(l) });
    for (const [i, f] of frasi.entries()) {
      const t = performance.now();
      const a = await v.speak(f).catch((e) => ({ errore: e.message }));
      const s = ((performance.now() - t) / 1000).toFixed(2);
      if (a.data) fs.writeFileSync(path.join(cartella, `${model}-${i + 1}.${a.type === 'audio/mpeg' ? 'mp3' : 'wav'}`), a.data);
      esito(a.type === 'audio/mpeg', `${model}, frase ${i + 1} (${f.length} car.)`, a.errore || `${s} s, ${a.data.length} B${a.type !== 'audio/mpeg' ? ', ' + JSON.stringify(v.status) : ''}`);
    }
    log.filter((l) => !l.includes('modello')).forEach((l) => console.log('   ', l));
  }
  console.log(`\nFile in ${cartella}`);
  console.log(`${ok} passati, ${ko} falliti`);
  process.exit(ko ? 1 : 0);
}

// ElevenLabs finto: risponde con `risposta` e conta le richieste
let risposta = { status: 200 }, richieste = [];
const finto = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    richieste.push({ url: req.url, key: req.headers['xi-api-key'], corpo: JSON.parse(corpo || '{}') });
    if (risposta.status === 200) return res.writeHead(200, { 'content-type': 'audio/mpeg' }).end(Buffer.from('ID3finto'));
    res.writeHead(risposta.status, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: risposta.detail || {} }));
  });
});
await new Promise((r) => finto.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${finto.address().port}`;
const wav = (a) => a?.type === 'audio/wav' && a.data.toString('latin1', 0, 4) === 'RIFF';

const senza = createVoice({ base });
esito(senza.status.provider === 'mac' && !senza.status.motivo, 'senza chiave: voce del Mac, e nessun motivo da mostrare', JSON.stringify(senza.status));
esito(wav(await senza.speak('Prova.')) && richieste.length === 0, 'senza chiave la frase è un WAV del Mac, e ElevenLabs non sente niente');

const log = [];
const v = createVoice({ key: 'chiave-finta', base, onLog: (l) => log.push(l) });
esito(v.status.provider === 'eleven' && v.status.voce === 'eleven_flash_v2_5', 'con la chiave: ElevenLabs, flash v2.5', JSON.stringify(v.status));
let a = await v.speak('Guardo subito.');
const r0 = richieste[0];
esito(a.type === 'audio/mpeg' && a.data.toString() === 'ID3finto', 'la frase arriva da ElevenLabs in MP3');
esito(r0?.url.startsWith('/v1/text-to-speech/AIJ0ViCZ83NSXLNIERjD?') && r0.key === 'chiave-finta', 'voce di Tony e chiave nell\'intestazione', r0?.url);
esito(r0?.corpo.text === 'Guardo subito.' && r0.corpo.model_id === 'eleven_flash_v2_5' && r0.corpo.language_code === 'it', 'testo, modello e italiano imposto', JSON.stringify(r0?.corpo));

const m = createVoice({ key: 'k', base, model: 'eleven_multilingual_v2' });
richieste = [];
await m.speak('Ciao.');
esito(richieste[0] && !('language_code' in richieste[0].corpo), 'multilingual v2: niente language_code, che rifiuterebbe');

risposta = { status: 500 };
const e500 = await v.speak('Questa si perde.').then(() => 'nessun errore', (e) => e.message);
esito(/ElevenLabs 500/.test(e500) && v.status.provider === 'eleven', 'errore passeggero (500): la frase si salta, niente voce del Mac', e500);
risposta = { status: 429 };
const e429 = await v.speak('Troppe insieme.').then(() => 'nessun errore', (e) => e.message);
esito(/ElevenLabs 429/.test(e429) && v.status.provider === 'eleven', '429: la frase si salta, ElevenLabs resta acceso', e429);
risposta = { status: 200 };
esito((await v.speak('Di nuovo.')).type === 'audio/mpeg', 'dopo un errore passeggero torna ElevenLabs');

risposta = { status: 402, detail: { status: 'quota_exceeded', message: 'crediti finiti' } };
richieste = [];
a = await v.speak('Questa frase è troppo lunga per i crediti che restano.');
esito(wav(a) && v.status.provider === 'mac' && /402/.test(v.status.motivo), 'crediti finiti (402): questa frase la dice il Mac, e lo stato lo spiega', JSON.stringify(v.status).slice(0, 140));
risposta = { status: 200 }; // anche se ElevenLabs tornasse a rispondere, la voce non torna indietro
const corta = await v.speak('Ok.');
esito(wav(corta) && richieste.length === 1, 'dopo il rifiuto anche le frasi corte sono del Mac: ElevenLabs non viene più chiamato', `${richieste.length} richieste`);
esito(log.filter((l) => /fino al riavvio/.test(l)).length === 1, 'il registro lo dice una volta sola', log.join(' | ').slice(0, 160));

risposta = { status: 401, detail: { status: 'invalid_api_key' } };
const k = createVoice({ key: 'scaduta', base });
esito(wav(await k.speak('Ciao.')) && k.status.provider === 'mac', 'chiave rifiutata (401): voce del Mac dalla prima frase', JSON.stringify(k.status).slice(0, 120));

finto.close();
console.log(`\n${ok} passati, ${ko} falliti`);
process.exit(ko ? 1 : 0);
