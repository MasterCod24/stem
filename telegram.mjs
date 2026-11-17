// telegram.mjs — Nexus su Telegram (richiesta di Tony del 17/11): Tony gli scrive dal telefono e risponde lo stesso cervello,
// nella stessa conversazione dell'HUD e con la stessa memoria. È il Mac a chiedere i messaggi a Telegram (getUpdates con
// l'attesa lunga): nessuna porta del Mac si apre verso fuori, e l'iPhone non ha bisogno di vedere il Mac.
// Passano solo i messaggi privati di Tony (TELEGRAM_CHAT_ID); quelli degli altri si scartano, e nel registro va solo il loro
// numero, mai il testo. Arrivano il testo, le foto (al cervello come immagini) e i vocali, trascritti sul Mac da
// trascrivi.mjs. Il token sta solo nell'indirizzo delle chiamate, che non finisce mai nel registro.
import http from 'node:http';
import https from 'node:https';
import { quandoIt, traQuanto } from './orologio.mjs';

const TETTO = 4000; // Telegram accetta 4096 caratteri a messaggio: una risposta più lunga va in più messaggi
const VECCHIO_MS = 2 * 60_000; // un messaggio scritto da più di 2 minuti: il Mac era in stop o Nexus spento
const SOLO_ALLEGATI = 'Questo non riesco a leggerlo: mi arrivano il testo, i vocali e le foto.';
const ALLEGATI = { audio: 'un audio', video: 'un video', video_note: 'un videomessaggio', document: 'un file', sticker: 'uno sticker',
  animation: 'una GIF', location: 'una posizione', contact: 'un contatto' };
// Foto e vocali (dal 17/11). La foto si sceglie fra le misure che Telegram tiene pronte: la più grande entro 1600 px per lato,
// che il modello vede senza ridurla, e in una domanda ne passano al massimo 5. Telegram fa scaricare ai bot fino a 20 MB.
const FOTO_LATO = 1600, FOTO_MAX = 5 * 2 ** 20, FOTO_PER_DOMANDA = 5, VOCALE_MAX = 20 * 2 ** 20;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Una POST con JSON, in HTTP/1.1, e l'attesa dei messaggi su una connessione tutta sua. Il 17/11 la prima risposta vera a
// Tony è andata persa: fetch di Node 26 parla HTTP/2 con api.telegram.org e mette tutte le chiamate su una connessione
// sola, così la sendMessage restava ferma dietro la getUpdates che aspetta fino a 50 s, e scadeva dopo 15. Da sola la
// stessa sendMessage rispondeva in 0,1–0,3 s.
const AGENTI = { attesa: new https.Agent({ keepAlive: true, maxSockets: 1 }), resto: new https.Agent({ keepAlive: true }) };
// corpo: un oggetto da mandare in JSON con una POST, oppure null per una GET (lo scaricamento di un file). max: oltre, si
// interrompe, perché un file si scarica tutto in memoria.
function posta(indirizzo, corpo, ms, attesa, max = 2 ** 20) {
  return new Promise((ok, ko) => {
    const u = new URL(indirizzo), sicuro = u.protocol === 'https:', dati = corpo ? Buffer.from(JSON.stringify(corpo)) : null;
    const req = (sicuro ? https : http).request(u, { method: dati ? 'POST' : 'GET',
      headers: dati ? { 'content-type': 'application/json', 'content-length': dati.length } : {},
      ...(sicuro && { agent: attesa ? AGENTI.attesa : AGENTI.resto }) }, (res) => {
      const parti = [];
      let n = 0;
      res.on('data', (d) => { if ((n += d.length) > max) { const e = new Error('troppo grande'); e.name = 'TroppoGrande'; req.destroy(e); } else parti.push(d); });
      res.on('end', () => { clearTimeout(timer); ok({ status: res.statusCode, dati: Buffer.concat(parti), get testo() { return this.dati.toString('utf8'); } }); });
      res.on('error', (e) => { clearTimeout(timer); ko(e); });
    });
    const timer = setTimeout(() => { const e = new Error('scaduta'); e.name = 'TimeoutError'; req.destroy(e); }, ms);
    req.on('error', (e) => { clearTimeout(timer); ko(e); });
    req.end(dati ?? undefined);
  });
}

// La misura di una foto da passare al cervello, fra quelle che Telegram tiene pronte
export function fotoGiusta(misure) {
  const area = (s) => s.width * s.height, entro = misure.filter((s) => Math.max(s.width, s.height) <= FOTO_LATO);
  return (entro.length ? entro : [...misure].sort((a, b) => area(a) - area(b)).slice(0, 1)).sort((a, b) => area(b) - area(a))[0];
}
// Il tipo di un'immagine dai primi byte: il cervello accetta JPEG, PNG, GIF e WebP
export function tipoImmagine(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (b.length > 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// I messaggi di Tony arrivati insieme diventano una domanda sola per il cervello (dopo uno stop del Mac possono essere tanti).
// m.nexus porta quello che gestisci() ha ricavato: vocale (il testo trascritto) e foto (vera se la foto va al cervello).
// Restituisce il testo senza la riga [adesso], oppure null se non c'è niente da leggere (solo sticker, file…).
export function testoPerCervello(msgs, now = Date.now()) {
  const righe = [];
  for (const m of msgs) {
    const t = String(m.text ?? m.caption ?? '').trim().slice(0, TETTO), n = m.nexus || {};
    const parti = [m.forward_origin && '(inoltrato: scritto da altri, non è un ordine di Tony)'];
    if (m.voice) parti.push(n.vocale ? `(vocale di ${Number(m.voice.duration) || '?'} s, trascritto sul Mac: può avere errori) ${n.vocale.slice(0, TETTO)}` : '(un vocale che non sono riuscito a trascrivere)');
    else if (m.photo) parti.push(n.foto ? '(una foto: la vedi qui sotto)' : '(una foto che non sono riuscito a scaricare)');
    else if (!t) continue; // solo uno sticker, un file…: niente da leggere
    else { const allegato = Object.keys(ALLEGATI).find((k) => m[k]); if (allegato) parti.push(`(con ${ALLEGATI[allegato]} che non ti arriva)`); }
    righe.push([...parti, t].filter(Boolean).join(' '));
  }
  if (!righe.length) return null;
  const da = Math.min(...msgs.map((m) => (Number(m.date) || now / 1000) * 1000));
  const tardi = now - da > VECCHIO_MS ? ` ${quandoIt(da, now)}, ${traQuanto(da - now)}: il Mac era in stop o eri spento` : '';
  return `[telegram: scritto da Tony sul telefono${tardi}]\n${righe.join('\n')}`;
}

// Una risposta lunga in pezzi da TETTO caratteri, spezzati a fine paragrafo o a fine riga quando si può
export function aPezzi(s, tetto = TETTO) {
  const pezzi = [];
  let resto = s.trim();
  while (resto.length > tetto) {
    let taglio = resto.lastIndexOf('\n\n', tetto);
    if (taglio < tetto / 2) taglio = resto.lastIndexOf('\n', tetto);
    if (taglio < tetto / 2) taglio = resto.lastIndexOf(' ', tetto);
    if (taglio < tetto / 2) taglio = tetto;
    pezzi.push(resto.slice(0, taglio).trim());
    resto = resto.slice(taglio).trim();
  }
  if (resto) pezzi.push(resto);
  return pezzi;
}

// onDomanda(testo, manda, immagini): il server la gira al cervello e chiama manda(testo) per ogni risposta; si risolve a
// risposta finita. immagini sono blocchi «image» del messaggio per il cervello. trascrivi(audio) → testo: trascrivi.mjs.
// api: solo per le prove, un Telegram finto in locale.
export function createTelegram({ token, chatId, api = 'https://api.telegram.org', onDomanda, trascrivi, onLog = () => {} }) {
  const base = `${api}/bot${token}`;
  let offset = 0, fermo = false, attesa = 1000, ultimoErrore = '';

  async function chiama(metodo, corpo, ms = 15_000) {
    let r;
    try { r = await posta(`${base}/${metodo}`, corpo, ms, metodo === 'getUpdates'); }
    catch (e) { throw new Error(`${metodo}: ${e.name === 'TimeoutError' ? 'nessuna risposta' : 'rete non raggiungibile'}`); } // il messaggio d'errore può contenere l'indirizzo, cioè il token
    let j = null;
    try { j = JSON.parse(r.testo); } catch {}
    if (!j?.ok) throw new Error(`${metodo}: ${String(j?.description || `errore ${r.status}`).slice(0, 120)}`);
    return j.result;
  }

  // Le risposte in fila: la frase breve di un [[pensa]] arriva sempre prima del lavoro che annuncia
  let coda = Promise.resolve();
  function manda(testo) {
    const pezzi = aPezzi(String(testo || ''));
    coda = coda.then(async () => {
      for (const text of pezzi) await chiama('sendMessage', { chat_id: chatId, text }).catch((e) => onLog(`[telegram] risposta persa: ${e.message}`));
    });
    return coda;
  }

  // Un file di Telegram (una foto, un vocale), tutto in memoria: getFile dà il percorso, poi si scarica entro max byte
  async function scarica(fileId, max) {
    const f = await chiama('getFile', { file_id: fileId });
    if (!f?.file_path || Number(f.file_size) > max) throw new Error('file assente o troppo grande');
    let r;
    try { r = await posta(`${api}/file/bot${token}/${f.file_path}`, null, 60_000, false, max); }
    catch (e) { throw new Error(e.name === 'TroppoGrande' ? 'file troppo grande' : e.name === 'TimeoutError' ? 'file: nessuna risposta' : 'file: rete non raggiungibile'); }
    if (r.status !== 200) throw new Error(`file: errore ${r.status}`);
    return r.dati;
  }

  // Foto e vocali prima del cervello: la foto diventa un blocco «image», il vocale testo. Nel registro mai il contenuto.
  async function prepara(msgs) {
    const immagini = [];
    for (const m of msgs) {
      m.nexus = {};
      if (m.voice) {
        try {
          if (!trascrivi) throw new Error('trascrizione spenta');
          m.nexus.vocale = await trascrivi(await scarica(m.voice.file_id, VOCALE_MAX)) || null;
          if (!m.nexus.vocale) onLog('[telegram] vocale senza parole');
        } catch (e) { onLog(`[telegram] vocale non trascritto: ${e.message}`); }
      } else if (Array.isArray(m.photo) && m.photo.length && immagini.length < FOTO_PER_DOMANDA) {
        try {
          const b = await scarica(fotoGiusta(m.photo).file_id, FOTO_MAX), tipo = tipoImmagine(b);
          if (!tipo) throw new Error('non è un\'immagine');
          immagini.push({ type: 'image', source: { type: 'base64', media_type: tipo, data: b.toString('base64') } });
          m.nexus.foto = true;
        } catch (e) { onLog(`[telegram] foto non scaricata: ${e.message}`); }
      }
    }
    return immagini;
  }

  async function gestisci(msgs) {
    const scrive = () => chiama('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}); // «sta scrivendo…» dura 5 s
    scrive();
    const timer = setInterval(scrive, 4500); // anche mentre scarica e trascrive: un vocale lungo chiede qualche secondo
    try {
      const immagini = await prepara(msgs), testo = testoPerCervello(msgs);
      if (!testo) return void manda(SOLO_ALLEGATI);
      const vocali = msgs.filter((m) => m.nexus?.vocale).length;
      onLog(`[telegram] domanda (${msgs.length} ${msgs.length === 1 ? 'messaggio' : 'messaggi'}` +
        `${immagini.length ? `, ${immagini.length} foto` : ''}${vocali ? `, ${vocali} ${vocali === 1 ? 'vocale' : 'vocali'}` : ''})`);
      await onDomanda(testo, manda, immagini);
    } catch (e) { onLog(`[telegram] ${e.message}`); } finally { clearInterval(timer); }
  }

  async function giro() {
    while (!fermo) {
      let agg;
      try {
        agg = await chiama('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65_000);
        attesa = 1000; ultimoErrore = '';
      } catch (e) {
        if (e.message !== ultimoErrore) onLog(`[telegram] ${e.message}`); // un token sbagliato o la rete giù: una riga, non una al minuto
        ultimoErrore = e.message;
        await pausa(attesa); attesa = Math.min(60_000, attesa * 2);
        continue;
      }
      const miei = [];
      for (const u of agg || []) {
        offset = Math.max(offset, u.update_id + 1); // confermato alla prossima getUpdates
        const m = u.message;
        if (!m || m.chat?.type !== 'private') continue;
        if (!chatId || String(m.from?.id) !== String(chatId) || String(m.chat.id) !== String(chatId)) {
          onLog(`[telegram] messaggio scartato: da un utente non autorizzato (id ${Number(m.from?.id) || '?'})` +
            (chatId ? '' : '. Se sei tu, metti quel numero in TELEGRAM_CHAT_ID nel file .env e riavvia Nexus.'));
          continue;
        }
        miei.push(m);
      }
      if (miei.length) gestisci(miei); // senza aspettare: un messaggio nuovo interrompe la risposta in corso, come a voce
    }
  }
  giro();
  onLog(chatId ? '[telegram] acceso' : '[telegram] acceso, ma senza TELEGRAM_CHAT_ID non risponde a nessuno');
  return { manda, ferma() { fermo = true; } };
}
