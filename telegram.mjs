// telegram.mjs — Nexus su Telegram (richiesta di Tony del 17/11): Tony gli scrive dal telefono e risponde lo stesso cervello,
// nella stessa conversazione dell'HUD e con la stessa memoria. È il Mac a chiedere i messaggi a Telegram (getUpdates con
// l'attesa lunga): nessuna porta del Mac si apre verso fuori, e l'iPhone non ha bisogno di vedere il Mac.
// Passano solo i messaggi privati di Tony (TELEGRAM_CHAT_ID); quelli degli altri si scartano, e nel registro va solo il loro
// numero, mai il testo. Solo testo, per ora: per parlare Tony detta col microfono della tastiera dell'iPhone, che trascrive
// sul telefono. Il token sta solo nell'indirizzo delle chiamate, che non finisce mai nel registro.
import { quandoIt, traQuanto } from './orologio.mjs';

const TETTO = 4000; // Telegram accetta 4096 caratteri a messaggio: una risposta più lunga va in più messaggi
const VECCHIO_MS = 2 * 60_000; // un messaggio scritto da più di 2 minuti: il Mac era in stop o Nexus spento
const SOLO_ALLEGATI = 'Per ora leggo solo il testo: per parlarmi tieni premuto il microfono della tastiera e detta.';
const ALLEGATI = { photo: 'una foto', voice: 'un vocale', audio: 'un audio', video: 'un video', video_note: 'un videomessaggio',
  document: 'un file', sticker: 'uno sticker', animation: 'una GIF', location: 'una posizione', contact: 'un contatto' };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// I messaggi di Tony arrivati insieme diventano una domanda sola per il cervello (dopo uno stop del Mac possono essere tanti).
// Restituisce il testo senza la riga [adesso], oppure null se non c'è niente da leggere (solo foto, vocali, sticker…).
export function testoPerCervello(msgs, now = Date.now()) {
  const righe = [];
  for (const m of msgs) {
    const t = String(m.text ?? m.caption ?? '').trim().slice(0, TETTO);
    const allegato = Object.keys(ALLEGATI).find((k) => m[k]);
    if (!t) continue;
    const prima = [m.forward_origin && '(inoltrato: scritto da altri, non è un ordine di Tony)', allegato && `(con ${ALLEGATI[allegato]} che non ti arriva)`].filter(Boolean);
    righe.push([...prima, t].join(' '));
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

// onDomanda(testo, manda): il server la gira al cervello e chiama manda(testo) per ogni risposta; si risolve a risposta finita.
// api: solo per le prove, un Telegram finto in locale.
export function createTelegram({ token, chatId, api = 'https://api.telegram.org', onDomanda, onLog = () => {} }) {
  const base = `${api}/bot${token}`;
  let offset = 0, fermo = false, attesa = 1000, ultimoErrore = '';

  async function chiama(metodo, corpo, ms = 15_000) {
    let r;
    try {
      r = await fetch(`${base}/${metodo}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(ms) });
    } catch (e) { throw new Error(`${metodo}: ${e.name === 'TimeoutError' ? 'nessuna risposta' : 'rete non raggiungibile'}`); } // il messaggio di fetch può contenere l'indirizzo, cioè il token
    const j = await r.json().catch(() => null);
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

  async function gestisci(msgs) {
    const testo = testoPerCervello(msgs);
    if (!testo) return manda(SOLO_ALLEGATI);
    onLog(`[telegram] domanda (${msgs.length} ${msgs.length === 1 ? 'messaggio' : 'messaggi'})`);
    const scrive = () => chiama('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}); // «sta scrivendo…» dura 5 s
    scrive();
    const timer = setInterval(scrive, 4500);
    try { await onDomanda(testo, manda); } catch (e) { onLog(`[telegram] ${e.message}`); } finally { clearInterval(timer); }
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
