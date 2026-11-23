// I fotogrammi dei salti delle mani (richiesta di Tony del 23/11). Il 17/11 le mani hanno fatto 240 salti in una sessione,
// «il cursore saltava», e la causa (luce, distanza, sfondo, mano di profilo) il registro non la dice: conta i salti e
// basta. Ora l'HUD manda il fotogramma di ogni salto (mani.js, disegnaSalto), al più uno al secondo e 50 per apertura.
// Sono foto di Tony e della stanza: restano solo sul Mac, in <stato>/salti/<giorno>/<ora>-<vista>.jpg, e le cartelle dei
// giorni più vecchi di 7 si cancellano da sole. «Era successo anche ieri?» è la cartella di ieri accanto a quella di oggi.
import fs from 'node:fs';
import path from 'node:path';

// Un 640×480 a qualità 0,7 pesa 43 KB sulla foto di prova (23/11): il resto è margine per una stanza piena di dettagli
export const SALTO_MAX_B = 350_000;
const PER_GIORNO = 500; // dieci aperture piene: al massimo 175 MB, di solito una ventina
const GIORNI = 7;
const GIORNO = /^\d{4}-\d{2}-\d{2}$/;

const due = (n, k = 2) => String(n).padStart(k, '0');
const giorno = (d) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`; // l'ora del Mac, non UTC
const ora = (d) => `${due(d.getHours())}-${due(d.getMinutes())}-${due(d.getSeconds())}-${due(d.getMilliseconds(), 3)}`;

export function creaSalti(cartella, { giorni = GIORNI, perGiorno = PER_GIORNO } = {}) {
  // Oggi e i giorni-1 prima restano; delle cartelle tocca solo quelle col nome di un giorno, il resto non è suo
  function pulisci(adesso = new Date()) {
    const limite = giorno(new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate() - giorni));
    let nomi = [];
    try { nomi = fs.readdirSync(cartella); } catch { return []; }
    const via = nomi.filter((n) => GIORNO.test(n) && n <= limite).sort();
    for (const n of via) fs.rmSync(path.join(cartella, n), { recursive: true, force: true });
    return via;
  }

  // jpeg: Buffer con un JPEG intero (SOI in testa, EOI in coda); vista: 'ologramma' o 'meteo'.
  // → { ok: true, file } oppure { ok: false, codice }: 400 se non va, 429 oltre il tetto del giorno
  function salva(jpeg, vista, adesso = new Date()) {
    const n = Buffer.isBuffer(jpeg) ? jpeg.length : 0;
    if (n < 4 || n > SALTO_MAX_B || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff || jpeg[n - 2] !== 0xff || jpeg[n - 1] !== 0xd9
      || (vista !== 'ologramma' && vista !== 'meteo')) return { ok: false, codice: 400 };
    pulisci(adesso);
    const dir = path.join(cartella, giorno(adesso));
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).length >= perGiorno) return { ok: false, codice: 429 };
    for (let i = 0; ; i++) { // due salti nello stesso millesimo: il secondo prende un numero, non sovrascrive
      const file = path.join(dir, `${ora(adesso)}${i ? `-${i}` : ''}-${vista}.jpg`);
      try { fs.writeFileSync(file, jpeg, { flag: 'wx' }); return { ok: true, file }; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 20) throw e; }
    }
  }

  return { salva, pulisci, cartella };
}
