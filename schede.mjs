// Le schede che O.S.C.A.R. mostra mentre parla (richiesta di Tony del 27/11). Il cervello scrive [[vedi: nome | cos'è |
// fino a tre numeri | fonte sito]] dopo la frase che nomina la cosa; brain.mjs la lega a quella frase; qui il server:
//   - taglia i campi a misura fissa (a schermo niente frasi: la voce resta il canale principale);
//   - tiene la fonte solo se è un sito letto in questa risposta (gli indirizzi dei risultati di WebSearch e WebFetch);
//   - cerca la foto in parallelo, senza fermare la voce: prima l'immagine di anteprima (og:image) della pagina letta di
//     quella fonte, poi la foto di Wikipedia se il titolo della voce è proprio quel nome. La scarica con la guardia di
//     rete.mjs e la tiene in memoria: l'HUD la prende da /api/schede/foto/<id>, senza chiedere niente ad altri siti.
// Provato col cervello vero prima di scriverlo: prove/schede-cervello.mjs.
import crypto from 'node:crypto';
import { scaricaSicuro, tipoFoto, latiFoto, TIPI_FOTO } from './rete.mjs';

export const MISURE = { nome: 40, tipo: 32, numero: 34, numeri: 3, fonte: 40 }; // numero: «voto 4,6/5 (1.230 recensioni)» ci sta
const FOTO_BYTE = 3.5 * 2 ** 20, PAGINA_BYTE = 1.5 * 2 ** 20, FOTO_LATO = 4000, FOTO_MS = 3500, FOTO_TENUTE = 40;
const taglia = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const stessoSito = (a, b) => Boolean(a && b) && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));

// Gli indirizzi https dentro i risultati di uno strumento (testo o JSON): le fonti lette in questa risposta
export function indirizzi(testo, max = 200) {
  const visti = new Set();
  for (const m of String(testo).matchAll(/https:\/\/[^\s"'<>)\]\\]+/g)) { visti.add(m[0].replace(/[.,;:]+$/, '')); if (visti.size >= max) break; }
  return [...visti];
}

// Dal testo del segnale ai campi; null se non c'è un nome. fonti: gli indirizzi letti in questa risposta.
export function leggiScheda(arg, fonti = []) {
  const campi = String(arg ?? '').split('|').map((x) => x.trim()); // i vuoti restano al loro posto: il nome è sempre il primo
  const nome = taglia(campi.shift(), MISURE.nome);
  if (!nome) return null;
  let fonte = null, tipo = '';
  const numeri = [];
  for (const c of campi) {
    if (!c) continue;
    const f = c.match(/^fonte\b\s*:?\s*(.+)$/i);
    if (f) {
      const sito = host(/^https?:\/\//i.test(f[1]) ? f[1] : `https://${f[1].trim().split(/[\s/]/)[0]}`);
      const letto = fonti.map(host).find((h) => stessoSito(h, sito));
      if (letto && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(sito)) fonte = taglia(sito, MISURE.fonte); // una fonte non letta si toglie
    } else if (!tipo && !/\d/.test(c) && numeri.length === 0) tipo = taglia(c, MISURE.tipo);
    else if (numeri.length < MISURE.numeri) numeri.push(taglia(c, MISURE.numero));
  }
  return { id: crypto.randomBytes(6).toString('hex'), nome, tipo, numeri, fonte };
}

// L'immagine di anteprima che la pagina dichiara per sé (og:image, o twitter:image)
export function anteprima(html, base) {
  const meta = [...String(html).matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  for (const chiave of ['og:image:secure_url', 'og:image', 'twitter:image']) {
    for (const t of meta) {
      if (!new RegExp(`(?:property|name)\\s*=\\s*["']${chiave.replace(/[.:]/g, '\\$&')}["']`, 'i').test(t)) continue;
      const c = t.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!c) continue;
      try { const u = new URL(c.replace(/&amp;/g, '&'), base); if (u.protocol === 'https:') return u.href; } catch {}
    }
  }
  return null;
}

// La voce di Wikipedia è proprio quella cosa? Una foto sbagliata è peggio di nessuna: il 27/11 «Beluga» (un ristorante)
// trovava un aereo cargo, «Il Marin» uno storico del Cinquecento, «Ultima» una serie di videogiochi. Tutte le parole del
// nome stanno nel titolo, e il tipo della scheda ha una parola in comune con titolo o descrizione (stessa radice di 5
// lettere: «alpi» e «alpina», «museo» e «musei»). Il prezzo: qualche voce giusta persa («Elbrus, vulcano del Caucaso»
// contro «Monte Elbrus, monte più alto di Russia»).
const parole = (s) => norm(s).split(' ').filter((w) => w.length >= 4);
const radice = (a, b) => a.slice(0, 5) === b.slice(0, 5) || (Math.min(a.length, b.length) === 4 && a.slice(0, 4) === b.slice(0, 4));
export function vocegiusta(scheda, titolo, descrizione = '') {
  const t = parole(titolo), nome = norm(scheda.nome).split(' ').filter((w) => w.length >= 3), td = parole(`${titolo} ${descrizione}`);
  return nome.length > 0 && nome.every((w) => norm(titolo).split(' ').includes(w)) && t.length > 0
    && parole(scheda.tipo).some((w) => td.some((x) => radice(w, x)));
}

// fetchPagina e fetchFoto si possono sostituire nelle prove; di base passano dalla guardia di rete.mjs
export function createSchede({ onLog = () => {}, fetchPagina, fetchFoto, wikipedia = 'https://it.wikipedia.org' } = {}) {
  const tenute = new Map(); // id → { tipo, dati }: le ultime FOTO_TENUTE, le più vecchie escono
  fetchPagina ||= (u) => scaricaSicuro(u, { byte: PAGINA_BYTE, ms: FOTO_MS, troppo: 'pagina troppo grande', headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) OSCAR/1.0', accept: 'text/html' } });
  fetchFoto ||= (u) => scaricaSicuro(u, { byte: FOTO_BYTE, ms: FOTO_MS, troppo: 'foto troppo grande' });

  async function tieni(id, url) {
    const b = await fetchFoto(url);
    const t = tipoFoto(b), l = t && latiFoto(b, t);
    if (!t || !l || l.w < 120 || l.h < 80 || Math.max(l.w, l.h) > FOTO_LATO) return null; // icone, loghi minuscoli, mostri
    tenute.set(id, { tipo: TIPI_FOTO[t], dati: b });
    while (tenute.size > FOTO_TENUTE) tenute.delete(tenute.keys().next().value);
    return `/api/schede/foto/${id}`;
  }
  async function daFonte(scheda, fonti) {
    if (!scheda.fonte) return null;
    const pagina = fonti.find((u) => stessoSito(host(u), scheda.fonte));
    if (!pagina) return null;
    const html = await fetchPagina(pagina);
    const img = anteprima(html.toString('utf8'), html.finale || pagina);
    return img ? tieni(scheda.id, img) : null;
  }
  async function daWikipedia(scheda) {
    if (!scheda.tipo) return null; // senza «cos'è» non si può controllare che la voce sia quella cosa
    const u = `${wikipedia}/w/api.php?action=query&format=json&generator=search&gsrlimit=1&prop=pageimages|description&piprop=thumbnail&pithumbsize=640`
      + `&gsrsearch=${encodeURIComponent(scheda.nome)}`;
    const d = JSON.parse((await fetchPagina(u)).toString('utf8'));
    const p = Object.values(d.query?.pages || {})[0];
    return p?.thumbnail?.source && vocegiusta(scheda, p.title, p.description) ? tieni(scheda.id, p.thumbnail.source) : null;
  }
  return {
    // L'indirizzo locale della foto, o null. Non lancia mai: una foto che non arriva lascia la scheda senza.
    async cercaFoto(scheda, fonti = []) {
      for (const via of [daFonte, daWikipedia]) {
        try { const f = await via(scheda, fonti); if (f) return f; } catch (e) { onLog(`[schede] foto di «${scheda.nome}» (${via.name}): ${e.message}`); }
      }
      return null;
    },
    // Un'animazione di Wikimedia ([anim:]) diventa una scheda come le altre
    async daAnimazione(m) {
      const scheda = { id: crypto.randomBytes(6).toString('hex'), nome: taglia(m.title, MISURE.nome), tipo: 'animazione', numeri: [], fonte: 'commons.wikimedia.org' };
      try { const f = await tieni(scheda.id, m.url); return f ? { scheda, foto: f } : null; } catch (e) { onLog(`[schede] animazione: ${e.message}`); return null; }
    },
    foto: (id) => tenute.get(id) || null,
  };
}
