// Meteo: il server scarica le previsioni di Open-Meteo per un luogo, le passa all'HUD e ne scrive il riassunto per il cervello.
// Open-Meteo e non Windy (scelta del 12/11): l'API di Windy costa 990 € l'anno, e la chiave gratuita restituisce dati
// mescolati apposta, buoni solo per programmare. Open-Meteo è gratuito senza chiave per uso personale, ha i quarti d'ora
// (ICON-D2 sull'Europa centrale, interpolati altrove) e risponde in circa 0,2 s. Il radar (RainViewer) lo scarica l'HUD.
// I conti stanno in public/meteo/dati.js, uguali per server e HUD. Qui solo rete, stato e parole.
import fs from 'node:fs';
import path from 'node:path';
import { normalizza, analizza, valoriA, beaufort, direzione, num, oraDi, giornoDi, durata, CODICI, H } from './public/meteo/dati.js';

const PREVISIONI = 'https://api.open-meteo.com/v1/forecast';
const GEOCODIFICA = 'https://geocoding-api.open-meteo.com/v1/search';
const ORA = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,cloud_cover,pressure_msl,' +
  'wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,is_day';
const ORE = 'temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,' +
  'cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility';
const GIORNI = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max';
const VECCHI_MS = 10 * 60_000; // i quarti d'ora del modello cambiano ogni 15 minuti: dopo 10 si riscarica
const ATTESA_MS = 8000;

class ErroreMeteo extends Error { constructor(m, codice = 502) { super(m); this.codice = codice; } }

async function chiedi(url) {
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(ATTESA_MS) }); } catch (e) {
    throw new ErroreMeteo(`Open-Meteo non risponde (${e.name === 'TimeoutError' ? `oltre ${ATTESA_MS / 1000} s` : e.cause?.code || e.message})`);
  }
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new ErroreMeteo(`Open-Meteo ha risposto ${r.status}${d?.reason ? `: ${String(d.reason).slice(0, 200)}` : ''}`);
  return d;
}

// cartella: dove resta l'ultimo luogo (meteo.json), così «che tempo fa?» senza luogo vale per l'ultimo chiesto
export function createMeteo({ cartella, onLog = () => {} }) {
  const file = path.join(cartella, 'meteo.json');
  let luogo = null, ultimo = null, inCorso = null; // ultimo: i dati dell'ultimo scaricamento, per l'HUD
  try { const l = JSON.parse(fs.readFileSync(file, 'utf8')); if (Number.isFinite(l?.lat) && Number.isFinite(l?.lon) && typeof l.nome === 'string') luogo = l; } catch {}
  const posti = new Map(); // nome cercato → luogo: la geocodifica non cambia

  async function trova(nome, paese) {
    const n = nome.split(',')[0].trim().slice(0, 80), p = /^[a-z]{2}$/i.test(paese || '') ? paese.toUpperCase() : '';
    if (!n) throw new ErroreMeteo('«luogo» è vuoto', 400);
    const chiave = `${n.toLowerCase()}|${p}`;
    if (posti.has(chiave)) return posti.get(chiave);
    const d = await chiedi(`${GEOCODIFICA}?name=${encodeURIComponent(n)}&count=5&language=it&format=json${p ? `&countryCode=${p}` : ''}`);
    const r = (Array.isArray(d.results) ? d.results : []).find((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
    if (!r) throw new ErroreMeteo(`non trovo «${n}»${p ? ` in ${p}` : ''}: prova col nome del comune più vicino, o col «paese» se il nome è di più posti`, 404);
    const l = { nome: String(r.name).slice(0, 60), regione: String(r.admin1 || '').slice(0, 60), paese: String(r.country || '').slice(0, 60),
      codice_paese: String(r.country_code || ''), lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4 };
    posti.set(chiave, l);
    return l;
  }

  async function scarica(l) {
    const q = new URLSearchParams({ latitude: l.lat, longitude: l.lon, current: ORA, hourly: ORE, minutely_15: 'precipitation,weather_code',
      daily: GIORNI, past_hours: 6, forecast_hours: 13, past_minutely_15: 8, forecast_minutely_15: 49, forecast_days: 3,
      timezone: 'auto', timeformat: 'unixtime' });
    const t0 = Date.now(), d = normalizza(await chiedi(`${PREVISIONI}?${q}`), l, Date.now());
    if (!d.ore.length || !d.quarti.length) throw new ErroreMeteo('Open-Meteo ha risposto senza previsioni orarie o al quarto d\'ora');
    onLog(`[meteo] ${l.nome}: previsioni in ${Date.now() - t0} ms`);
    return d;
  }

  // Il luogo chiesto (o l'ultimo), i dati e il testo per il cervello. Errori: { ok: false, codice, errori }
  async function mostra({ luogo: nome, paese } = {}) {
    try {
      const l = typeof nome === 'string' && nome.trim() ? await trova(nome, paese) : luogo;
      if (!l) throw new ErroreMeteo('non so ancora dove sei: chiedi a Tony la città e richiama con «luogo»', 400);
      const d = await scarica(l);
      ultimo = d;
      if (!luogo || luogo.lat !== l.lat || luogo.lon !== l.lon) {
        luogo = l;
        try { fs.writeFileSync(file, JSON.stringify(l)); } catch (e) { onLog(`[meteo] non salvo il luogo: ${e.message}`); }
      }
      return { ok: true, dati: d, testo: testoMeteo(d, Date.now()) };
    } catch (e) {
      if (!(e instanceof ErroreMeteo)) throw e;
      return { ok: false, codice: e.codice, errori: [e.message] };
    }
  }

  // Per l'HUD aperto: gli ultimi dati, riscaricati se hanno più di 10 minuti. Un solo scaricamento alla volta.
  async function attuale() {
    if (!ultimo) return null;
    if (Date.now() - ultimo.preso > VECCHI_MS) {
      inCorso ||= scarica(ultimo.luogo).then((d) => { ultimo = d; }, (e) => onLog(`[meteo] aggiornamento fallito: ${e.message}`)).finally(() => { inCorso = null; });
      await inCorso;
    }
    return ultimo;
  }

  return { mostra, attuale, get luogo() { return luogo; } };
}

// ---------------------------------------------------------------- il riassunto per il cervello
// Numeri veri e frasi corte: il cervello sceglie cosa dire a voce. Gli orari sono quelli del posto.
export function testoMeteo(d, adesso) {
  const a = analizza(d, adesso), v = a.valori, l = d.luogo, ora = (t) => oraDi(t, l.offset), righe = [];
  const dove = [l.nome, l.regione, l.paese].filter(Boolean).filter((x, i, xs) => xs.indexOf(x) === i).join(', ');
  righe.push(`Meteo di ${dove}, da Open-Meteo alle ${ora(d.preso)} (orari del posto, fuso ${l.fuso}).`);
  const b = beaufort(v.vento), dir = direzione(v.dir);
  const pezzi = [
    v.codice !== null && CODICI[v.codice],
    v.temp !== null && `${num(v.temp)} °C${v.percepita !== null ? ` (percepiti ${num(v.percepita)})` : ''}`,
    v.umidita !== null && `umidità ${num(v.umidita)}%${v.rugiada !== null ? `, punto di rugiada ${num(v.rugiada)} °C` : ''}`,
    v.vento !== null && `vento ${dir ? `da ${dir} ` : ''}a ${num(v.vento)} km/h${v.raffiche !== null ? `, raffiche ${num(v.raffiche)}` : ''}${b ? ` (Beaufort ${b.n}, ${b.nome})` : ''}`,
    a.pressione.hpa !== null && `pressione ${num(a.pressione.hpa)} hPa${a.pressione.delta !== null ? `, ${a.pressione.tendenza}: ${a.pressione.delta > 0 ? '+' : ''}${num(a.pressione.delta, 1)} hPa nelle ultime 3 ore` : ''}`,
    v.vis !== null && `visibilità ${v.vis >= 1000 ? `${num(v.vis / 1000, 1)} km` : `${num(v.vis)} m`}`,
    v.nuvole !== null && `nuvole ${num(v.nuvole)}%`,
  ].filter(Boolean);
  righe.push(pezzi.length ? `Adesso: ${pezzi.join('; ')}.` : 'Adesso: nessun dato.');
  const ev = a.eventi[0];
  righe.push(`Precipitazioni: ${!ev ? `nessuna nelle prossime ${a.orizzonte} ore`
    : ev.in_corso ? `${ev.tipo} in corso${ev.oltre ? `, continua oltre le prossime ${a.orizzonte} ore` : `, finisce verso le ${ora(ev.fine)} (tra ${durata(ev.fine - adesso)})`}`
      : `${ev.tipo} dalle ${ora(ev.inizio)} (tra ${durata(ev.inizio - adesso)}) alle ${ora(ev.fine)}${ev.oltre ? ' e oltre' : ''}`}` +
    `${ev ? `, al massimo ${num(ev.max_mmh, 1)} mm/h e ${num(ev.mm, 1)} mm in tutto` : ''}` +
    `${a.eventi.length > 1 ? `; poi ${a.eventi.slice(1, 3).map((e) => `${e.tipo} dalle ${ora(e.inizio)} alle ${ora(e.fine)}`).join(', ')}` : ''}. Dati al quarto d'ora del modello, non del radar.`);
  righe.push(a.avvisi.length ? `Avvisi: ${a.avvisi.map((x) => `${x.titolo}${x.dettaglio ? ` (${x.dettaglio})` : ''}`).join('; ')}.` : 'Avvisi: nessuno nelle prossime 12 ore.');
  if (a.condizioni) righe.push(`Condizioni per spostarsi: ${a.condizioni.pct}%, ${a.condizioni.giudizio}${a.condizioni.limite ? `, il limite è ${a.condizioni.limite}` : ''} (mia scala, non uno standard).`);
  const tappe = [3, 6, 9, 12].map((n) => valoriA(d, Math.floor(adesso / H) * H + n * H)).filter((x) => x.temp !== null) // ore intere
    .map((x) => `alle ${ora(x.t)} ${num(x.temp)} °C${x.codice !== null && CODICI[x.codice] ? `, ${CODICI[x.codice]}` : ''}${x.prob !== null ? `, probabilità di pioggia ${num(x.prob)}%` : ''}`);
  if (tappe.length) righe.push(`Prossime ore: ${tappe.join('; ')}.`);
  if (d.giorni.length) righe.push(`Giorni: ${d.giorni.map((g, i) => `${i === 0 ? 'oggi' : i === 1 ? 'domani' : giornoDi(g.t, l.offset)} da ${num(g.min)} a ${num(g.max)} °C` +
    `${g.codice !== null ? `, ${CODICI[g.codice] || ''}` : ''}${g.mm !== null ? `, ${num(g.mm, 1)} mm` : ''}${g.prob !== null ? ` (${num(g.prob)}%)` : ''}`).join('; ')}.`);
  righe.push("Nell'HUD c'è la vista meteo: radar delle piogge vero delle ultime 2 ore, vento e pressione, profilo termico, timeline di 12 ore e avvisi. " +
    'Tony la muove con le mani o col mouse e la chiude con Esc o lanciandola via.');
  return righe.join('\n');
}
