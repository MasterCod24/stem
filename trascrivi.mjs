// trascrivi.mjs — i vocali di Telegram diventano testo sul Mac, senza mandare l'audio a nessuno (richiesta di Tony del 17/11).
// ffmpeg porta il vocale (OGG/Opus) a WAV 16 kHz mono, whisper.cpp (whisper-cli di Homebrew) lo trascrive in italiano col
// modello large-v3-turbo q5, che sta in runtime/modelli e si usa solo se l'impronta SHA-256 è quella giusta.
// ffmpeg e whisper-cli si cercano nel PATH, che avvia-app.sh apre su /opt/homebrew/bin.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scelta di Tony del 17/11 fra i modelli di ggerganov/whisper.cpp: il migliore per l'italiano fra quelli sotto i 600 MB
export const MODELLO_WHISPER = {
  nome: 'ggml-large-v3-turbo-q5_0.bin',
  origine: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
  byte: 574041195,
  sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
};

const esegui = (cmd, args, ms) => new Promise((ok, ko) =>
  execFile(cmd, args, { timeout: ms, maxBuffer: 2 ** 20 }, (e, out) => (e ? ko(e) : ok(out))));

export function createTrascrittore({ cartella }) {
  const file = path.join(cartella, MODELLO_WHISPER.nome);
  let controllo = null; // una volta sola per avvio: l'impronta di 574 MB costa un paio di secondi
  async function modelloGiusto() {
    controllo ??= (async () => {
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st || st.size !== MODELLO_WHISPER.byte) return false;
      const h = createHash('sha256');
      for await (const pezzo of fs.createReadStream(file)) h.update(pezzo);
      return h.digest('hex') === MODELLO_WHISPER.sha256;
    })();
    const ok = await controllo;
    if (!ok) controllo = null; // magari lo si scarica dopo: si ricontrolla al prossimo vocale
    return ok;
  }

  // Il testo del vocale; un errore con un messaggio breve, senza il contenuto
  return async function trascrivi(audio) {
    if (!(await modelloGiusto())) throw new Error(`manca il modello di Whisper (${MODELLO_WHISPER.nome} in runtime/modelli)`);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexus-vocale-'));
    try {
      const ogg = path.join(dir, 'vocale.oga'), wav = path.join(dir, 'vocale.wav');
      await fs.promises.writeFile(ogg, audio);
      try { await esegui('ffmpeg', ['-v', 'error', '-i', ogg, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 30_000); }
      catch (e) { throw new Error(e.code === 'ENOENT' ? 'manca ffmpeg (Homebrew)' : 'ffmpeg non riesce a leggere il vocale'); }
      let out;
      try { out = await esegui('whisper-cli', ['-m', file, '-l', 'it', '-nt', '-np', '-f', wav], 120_000); }
      catch (e) { throw new Error(e.code === 'ENOENT' ? 'manca whisper-cli (Homebrew, whisper-cpp)' : e.killed ? 'whisper oltre 120 s' : 'whisper si è fermato con un errore'); }
      return out.replace(/\s+/g, ' ').trim();
    } finally {
      fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {}); // l'audio non resta sul disco
    }
  };
}
