// meteo.mjs — prova i conti della meteo (public/meteo/dati.js) e il testo per il cervello (meteo.mjs) su dati costruiti qui.
//   node prove/meteo.mjs           solo i conti, senza rete, in un secondo
//   node prove/meteo.mjs --rete    anche Open-Meteo e RainViewer veri, e il server vero (porta 4423) con lo strumento
//                                  mostra_meteo, con un cervello e un Playwright finti: niente modello, niente browser
// Una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../public/meteo/dati.js';
import { createMeteo, testoMeteo } from '../meteo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RETE = process.argv.includes('--rete');
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const titolo = (t) => console.log(`\n== ${t}`);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const { H, Q } = M;

// ---------------------------------------------------------------- una risposta di Open-Meteo costruita a mano
// adesso: 12/11/2026 15:03 UTC, cioè le 16:03 a Roma (offset 3600). Ore da −6 a +12, quarti da −2 h a +12 h.
const ADESSO = Date.UTC(2026, 10, 12, 15, 3);
function finto({ pressioni = (i) => 1010, codici = () => 3, raffiche = () => 15, vis = () => 20000, bagnati = [], mmQuarto = () => 0.4, codiceQuarto = () => 61, prob = () => 20, ora = {} } = {}) {
  const h0 = Math.floor(ADESSO / H) * H - 6 * H, ore = Array.from({ length: 19 }, (_, i) => h0 + i * H);
  const q0 = Math.floor(ADESSO / Q) * Q - 7 * Q, quarti = Array.from({ length: 57 }, (_, i) => q0 + i * Q);
  const s = (ms) => ms / 1000, ho = ore.map((t) => (t - ADESSO) / H); // ore relative ad adesso
  return {
    utc_offset_seconds: 3600, timezone: 'Europe/Rome', elevation: 120,
    current: { time: s(Math.floor(ADESSO / Q) * Q), temperature_2m: 11.3, apparent_temperature: 10.4, relative_humidity_2m: 97, dew_point_2m: 10.9,
      precipitation: 0, weather_code: 3, cloud_cover: 100, pressure_msl: pressioni(0), wind_speed_10m: 8, wind_direction_10m: 325, wind_gusts_10m: raffiche(0),
      visibility: vis(0), is_day: 1, ...ora },
    hourly: { time: ore.map(s), temperature_2m: ore.map(() => 12), apparent_temperature: ore.map(() => 11), relative_humidity_2m: ore.map(() => 90),
      dew_point_2m: ore.map(() => 10), precipitation_probability: ho.map(prob), precipitation: ore.map(() => 0), weather_code: ho.map(codici), cloud_cover: ore.map(() => 80),
      pressure_msl: ho.map(pressioni), wind_speed_10m: ore.map(() => 10), wind_direction_10m: ore.map(() => 300), wind_gusts_10m: ho.map(raffiche), visibility: ho.map(vis) },
    minutely_15: { time: quarti.map(s), precipitation: quarti.map((t) => (bagnati.some(([a, b]) => t >= a && t <= b) ? mmQuarto(t) : 0)), weather_code: quarti.map(codiceQuarto) },
    daily: { time: [s(Date.UTC(2026, 10, 11, 23)), s(Date.UTC(2026, 10, 12, 23))], weather_code: [61, 3], temperature_2m_max: [12, 15], temperature_2m_min: [9, 8],
      precipitation_sum: [3.2, 0], precipitation_probability_max: [90, 10], wind_gusts_10m_max: [30, 25] },
  };
}
const LUOGO = { nome: 'Milano', regione: 'Lombardia', paese: 'Italia', lat: 45.4643, lon: 9.1895 };
const dati = (o) => M.normalizza(finto(o), LUOGO, ADESSO);
const T = (hh, mm) => Date.UTC(2026, 10, 12, hh, mm); // un quarto, in UTC

titolo('Precipitazioni: quando cominciano e quando finiscono');
{ // l'esempio di Tony: quarti bagnati dalle 16:00 alle 17:00 UTC, cioè la pioggia fra le 16:45 e le 18:00 di Roma
  const d = dati({ bagnati: [[T(16, 0), T(17, 0)]] }), a = M.analizza(d, ADESSO), e = a.eventi[0];
  esito(a.frase === 'precipitazioni tra 42 min · durata stimata 1 h 15 min', 'pioggia in arrivo: «tra 42 min · durata stimata 1 h 15 min»', a.frase);
  esito(e && !e.in_corso && M.oraDi(e.inizio, 3600) === '16:45' && M.oraDi(e.fine, 3600) === '18:00', 'inizio 16:45 e fine 18:00, ora di Roma', e && `${M.oraDi(e.inizio, 3600)}–${M.oraDi(e.fine, 3600)}`);
  esito(e?.max_mmh === 1.6 && e?.mm === 2, 'picco 1,6 mm/h e 2 mm in tutto (5 quarti da 0,4 mm)', e && `${e.max_mmh} mm/h, ${e.mm} mm`);
}
{ // un quarto asciutto in mezzo non spezza l'evento, due sì
  const uno = M.eventi(dati({ bagnati: [[T(16, 0), T(16, 15)], [T(16, 45), T(17, 0)]] }), ADESSO);
  const due = M.eventi(dati({ bagnati: [[T(16, 0), T(16, 15)], [T(17, 0), T(17, 15)]] }), ADESSO);
  esito(uno.length === 1 && due.length === 2, 'un quarto asciutto in mezzo non spezza, due sì', `${uno.length} e ${due.length} eventi`);
}
{ // in corso: il quarto che contiene adesso (15:00–15:15 UTC) è bagnato
  const d = dati({ bagnati: [[T(15, 15), T(18, 30)]] }), a = M.analizza(d, ADESSO);
  esito(a.frase === 'precipitazioni in corso · fine tra 3 h 27 min', 'pioggia in corso: «fine tra 3 h 27 min»', a.frase);
  const sempre = M.analizza(dati({ bagnati: [[T(15, 15), T(23, 59) + 6 * H]] }), ADESSO);
  esito(sempre.frase === 'precipitazioni in corso · continua oltre le prossime 12 h', 'fino alla fine dei dati: «continua oltre le prossime 12 h»', sempre.frase);
  const niente = M.analizza(dati(), ADESSO);
  esito(niente.frase === 'nessuna precipitazione nelle prossime 12 h' && !niente.eventi.length, 'niente pioggia: «nessuna precipitazione nelle prossime 12 h»', niente.frase);
  const sotto = M.eventi(dati({ bagnati: [[T(16, 0), T(17, 0)]], mmQuarto: () => 0.05 }), ADESSO);
  esito(sotto.length === 0, 'sotto 0,1 mm a quarto non è pioggia', `${sotto.length} eventi`);
}
{ // il tipo: temporale vince, poi gelata, poi neve se è almeno metà
  const ev = (c) => M.eventi(dati({ bagnati: [[T(16, 0), T(17, 0)]], codiceQuarto: c }), ADESSO)[0]?.tipo;
  const casi = [[() => 95, 'temporale'], [() => 71, 'neve'], [() => 66, 'pioggia gelata'], [(t) => (t === T(16, 0) ? 95 : 61), 'temporale'], [(t) => (t <= T(16, 15) ? 73 : 61), 'pioggia']];
  const sbagli = casi.map(([c, atteso]) => [ev(c), atteso]).filter(([x, y]) => x !== y);
  esito(!sbagli.length, 'tipo: temporale, neve, pioggia gelata e pioggia', sbagli.map(([x, y]) => `${x} invece di ${y}`).join(', '));
}

titolo('Pressione: tendenza del Met Office e avvisi');
{
  const tend = [[-3.6, 'in calo rapido'], [-3.5, 'in calo'], [-1.6, 'in calo'], [-1.5, 'in calo lento'], [0.04, 'stabile'], [0.06, 'in aumento lento'], [6.1, 'in aumento molto rapido'], [6.0, 'in aumento rapido'], [null, null]];
  const sb = tend.filter(([d, t]) => M.tendenza(d) !== t);
  esito(!sb.length, 'parole della tendenza alle soglie (1,5, 3,5, 6,0 hPa)', sb.map(([d, t]) => `${d}: ${M.tendenza(d)} invece di ${t}`).join('; '));
  const conCalo = (x) => dati({ pressioni: (h) => 1000 - (h * x) / 3 }); // x hPa in 3 ore, lineare: −3 h vale 1000 + x
  const a1 = M.analizza(conCalo(3.6), ADESSO), a2 = M.analizza(conCalo(6.2), ADESSO), a0 = M.analizza(conCalo(3.4), ADESSO);
  const p1 = a1.avvisi.find((x) => x.chiave === 'pressione'), p2 = a2.avvisi.find((x) => x.chiave === 'pressione');
  esito(p1?.livello === 1 && /calo barometrico rapido/.test(p1.titolo) && a1.pressione.delta === -3.6, 'calo di 3,6 hPa in 3 h: allerta arancione', p1?.titolo);
  esito(p2?.livello === 2 && /molto rapido/.test(p2.titolo), 'calo di 6,2 hPa: allerta rossa', p2?.titolo);
  esito(!a0.avvisi.some((x) => x.chiave === 'pressione'), 'calo di 3,4 hPa: niente allerta', a0.avvisi.map((x) => x.titolo).join('; '));
  // un calo che arriva: ferma per ora, poi giù di 5 hPa fra +4 e +7 ore (ore intere: adesso è 3 minuti dopo l'ora)
  const futuro = M.analizza(dati({ pressioni: (h) => { const r = Math.round(h); return r <= 4 ? 1012 : r >= 7 ? 1007 : 1012 - (5 * (r - 4)) / 3; } }), ADESSO);
  const pf = futuro.avvisi.find((x) => x.chiave === 'pressione');
  esito(pf && /in arrivo: −5,0 hPa fra le 20:00 e le 23:00/.test(pf.titolo), 'calo futuro: «in arrivo: −5,0 hPa fra le 20:00 e le 23:00»', pf?.titolo);
  const conProb = M.analizza(dati({ pressioni: (h) => 1000 - (h * 4) / 3, prob: (h) => (h > 0 && h <= 6 ? 85 : 10) }), ADESSO);
  esito(conProb.avvisi[0]?.dettaglio === 'probabilità di precipitazioni al 85% nelle prossime 6 ore', 'il dettaglio dà la probabilità vera del modello, non una inventata', conProb.avvisi[0]?.dettaglio);
}

titolo('Altri avvisi: temporale, raffiche, pioggia forte, nebbia, gelo');
{
  const tutti = (o) => M.analizza(dati(o), ADESSO).avvisi;
  const temp = tutti({ codici: (h) => (h > 2 && h < 4 ? 95 : 3), prob: () => 70 }), grand = tutti({ codici: (h) => (h > 2 && h < 4 ? 96 : 3) });
  esito(temp[0]?.chiave === 'temporale' && temp[0].livello === 1 && /fra le 18:00 e le 19:00/.test(temp[0].titolo), 'temporale alle 19 (ora che finisce alle 19): «fra le 18:00 e le 19:00»', temp[0]?.titolo);
  esito(grand[0]?.livello === 2, 'temporale con grandine: rosso', grand[0]?.titolo);
  const r61 = tutti({ raffiche: () => 61.9 }), r62 = tutti({ raffiche: (h) => (h > 3 && h < 5 ? 62 : 20) }), r89 = tutti({ raffiche: () => 89 });
  esito(!r61.length && r62[0]?.livello === 1 && r89[0]?.livello === 2, 'raffiche: niente a 61,9, arancione a 62 (Beaufort 8), rosso a 89 (Beaufort 10)', `${r61.length}, ${r62[0]?.titolo}, ${r89[0]?.titolo}`);
  const p8 = tutti({ bagnati: [[T(17, 0), T(17, 0)]], mmQuarto: () => 2 }), p50 = tutti({ bagnati: [[T(17, 0), T(17, 0)]], mmQuarto: () => 12.5 }), p7 = tutti({ bagnati: [[T(17, 0), T(17, 0)]], mmQuarto: () => 1.9 });
  esito(p8[0]?.livello === 1 && p50[0]?.livello === 2 && !p7.length, 'pioggia: arancione da 8 mm/h, rosso da 50, niente a 7,6', `${p8[0]?.titolo} | ${p50[0]?.titolo}`);
  const neb = tutti({ vis: (h) => (h > 6 && h < 8 ? 580 : 20000) });
  esito(neb[0]?.chiave === 'nebbia' && /alle 23:00: visibilità 580 m/.test(neb[0].titolo), 'nebbia: «alle 23:00: visibilità 580 m»', neb[0]?.titolo);
  const gelo = tutti({ codici: (h) => (h > 1 && h < 3 ? 66 : 3) });
  esito(gelo[0]?.chiave === 'ghiaccio', 'pioggia gelata: avviso', gelo[0]?.titolo);
  const ordine = tutti({ raffiche: () => 95, vis: () => 500 });
  esito(ordine.length === 2 && ordine[0].livello === 2, 'prima i rossi, poi gli arancioni', ordine.map((x) => x.livello).join(','));
}

titolo('Condizioni, visibilità, Beaufort, bussola, formati');
{
  const c = (v) => M.condizioniA({ vis: 20000, raffiche: 10, mmh: 0, codice: 1, ...v });
  const casi = [[{}, 100, null], [{ vis: 5500 }, 55, 'visibilità'], [{ raffiche: 41 }, 50, 'vento'], [{ mmh: 4 }, 50, 'pioggia'], [{ codice: 95 }, 10, 'temporale'],
    [{ codice: 73 }, 40, 'neve'], [{ vis: 900 }, 9, 'visibilità'], [{ raffiche: 70 }, 0, 'vento']];
  esito(c({ vis: 4200 }).pct === M.visibilitaPct({ vis: 4200 }), 'la visibilità ha una scala sola: condizioni e percentuale dicono lo stesso numero');
  const sb = casi.filter(([v, pct, lim]) => { const x = c(v); return x.pct !== pct || x.limite !== lim; });
  esito(!sb.length, 'condizioni: il fattore peggiore comanda, coi suoi estremi', sb.map(([v]) => JSON.stringify(v) + ' → ' + JSON.stringify(c(v))).join('; '));
  esito(M.condizioniA({ vis: null, raffiche: null, mmh: null, codice: null }) === null, 'senza dati, niente condizioni');
  esito(M.visibilitaPct({ vis: 4200 }) === 42 && M.visibilitaPct({ vis: 24000 }) === 100 && M.visibilitaPct({ vis: null }) === null, 'visibilità: 4,2 km = 42%, oltre 10 km = 100%');
  const bf = [[0.5, 0], [1, 1], [61.9, 7], [62, 8], [117.9, 11], [118, 12]].filter(([k, n]) => M.beaufort(k).n !== n);
  esito(!bf.length && M.beaufort(NaN) === null, 'Beaufort alle soglie dell\'OMM', bf.map(([k, n]) => `${k}: ${M.beaufort(k).n} invece di ${n}`).join(', '));
  const bu = [[0, 'N'], [349, 'N'], [348, 'NNO'], [325, 'NO'], [-35, 'NO'], [180, 'S'], [NaN, '—']].filter(([g, s]) => M.bussola(g) !== s);
  esito(!bu.length && M.direzione(325) === 'nord-ovest', 'bussola a 16 settori, anche con gradi negativi', bu.map(([g, s]) => `${g}: ${M.bussola(g)} invece di ${s}`).join(', '));
  esito(M.num(-0.04, 1) === '0,0' && M.num(-3.6, 1) === '−3,6' && M.num(1004.25, 1) === '1004,3' && M.num(null) === '—', 'numeri: virgola, meno vero, niente «−0,0»', [M.num(-0.04, 1), M.num(-3.6, 1)].join(' '));
  esito(M.durata(42 * 60_000) === '42 min' && M.durata(75 * 60_000) === '1 h 15 min' && M.durata(3 * H) === '3 h', 'durate: 42 min, 1 h 15 min, 3 h');
  const ore = [{ t: 0, dir: 350 }, { t: 2, dir: 10 }];
  esito(Math.abs(M.interp(ore, 1, 'dir')) < 1e-9 || Math.abs(M.interp(ore, 1, 'dir') - 360) < 1e-9, 'il vento da 350° a 10° passa da nord, non da sud', String(M.interp(ore, 1, 'dir')));
}

titolo('Dati sporchi e testo per il cervello');
{
  const r = finto();
  r.hourly.temperature_2m[3] = 'x'; r.hourly.visibility = null; r.current.visibility = null; r.current.pressure_msl = NaN; r.minutely_15.precipitation[10] = Infinity;
  const d = M.normalizza(r, LUOGO, ADESSO);
  esito(d.ore[3].temp === null && d.ore.every((o) => o.vis === null) && d.ora.pressione === null && d.quarti[10].mm === null, 'stringhe, NaN, Infinity e serie mancanti diventano null');
  const a = M.analizza(d, ADESSO);
  esito(a.pressione.hpa !== null && a.visibilita === null, 'senza pressione «adesso» si usa quella oraria; senza visibilità, niente percentuale', `${a.pressione.hpa} hPa`);
  const vuoto = M.normalizza({}, LUOGO, ADESSO), av = M.analizza(vuoto, ADESSO);
  esito(Array.isArray(vuoto.ore) && !vuoto.ore.length && av.frase === 'nessuna precipitazione nelle prossime 0 h', 'una risposta vuota non fa cadere niente', av.frase);
  const t = testoMeteo(dati({ bagnati: [[T(16, 0), T(17, 0)]], pressioni: (h) => 1000 - (h * 4) / 3, vis: (h) => (h > 6 && h < 8 ? 580 : 20000) }), ADESSO);
  const deve = ['Meteo di Milano, Lombardia, Italia', 'pressione 1000 hPa, in calo rapido: −4,0 hPa nelle ultime 3 ore', 'pioggia dalle 16:45 (tra 42 min) alle 18:00',
    'calo barometrico rapido', 'nebbia alle 23:00', 'Condizioni per spostarsi', 'alle 19:00', 'oggi da 9 a 12 °C', 'domani'];
  const manca = deve.filter((x) => !t.includes(x));
  esito(!manca.length, 'il testo per il cervello ha i numeri che contano', manca.join(' | '));
  esito(!/undefined|null|NaN|\[object/.test(t), 'nel testo niente undefined, null o NaN');
  esito(!/undefined|null|NaN|\[object/.test(testoMeteo(vuoto, ADESSO)), 'nemmeno con una risposta vuota');
  console.log(t.split('\n').map((x) => `      ${x}`).join('\n'));
}

// ---------------------------------------------------------------- con la rete
if (RETE) {
  titolo('Open-Meteo vero (meteo.mjs)');
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meteo-'));
  const m = createMeteo({ cartella });
  const t0 = performance.now(), r = await m.mostra({ luogo: 'Milano' }), ms = Math.round(performance.now() - t0);
  esito(r.ok && r.dati.ore.length >= 18 && r.dati.quarti.length >= 50 && r.dati.giorni.length === 3, 'Milano: ore, quarti e tre giorni', r.ok ? `${r.dati.ore.length} ore, ${r.dati.quarti.length} quarti, in ${ms} ms` : r.errori.join('; '));
  esito(r.ok && !/undefined|null|NaN/.test(r.testo), 'il testo vero non ha buchi', r.ok ? r.testo.split('\n')[1].slice(0, 120) : '');
  const ultimo = JSON.parse(fs.readFileSync(path.join(cartella, 'meteo.json'), 'utf8'));
  esito(ultimo.nome === 'Milano' && (await m.mostra({})).dati?.luogo.nome === 'Milano', 'senza luogo vale l\'ultimo, salvato in meteo.json');
  const amb = await m.mostra({ luogo: 'Milano', paese: 'US' });
  esito(amb.ok && amb.dati.luogo.codice_paese === 'US', '«paese» sceglie fra i posti con lo stesso nome', amb.ok ? `${amb.dati.luogo.nome}, ${amb.dati.luogo.regione}` : amb.errori.join(''));
  const no = await m.mostra({ luogo: 'Qwzxjkvbnm' });
  esito(!no.ok && no.codice === 404 && /non trovo/.test(no.errori[0]), 'un posto che non esiste: 404 con cosa fare', no.errori?.[0]);
  const vuota = createMeteo({ cartella: fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meteo-')) });
  const senza = await vuota.mostra({});
  esito(!senza.ok && senza.codice === 400 && /chiedi a Tony/.test(senza.errori[0]), 'senza luogo e senza ultimo: chiedere a Tony', senza.errori?.[0]);

  titolo('RainViewer vero');
  const mappe = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
  const past = mappe?.radar?.past || [], ultima = past[past.length - 1];
  esito(past.length >= 10 && /^https:\/\/tilecache\.rainviewer\.com$/.test(mappe.host), 'mappe delle ultime 2 ore', `${past.length} mappe, l'ultima ${ultima ? Math.round((Date.now() / 1000 - ultima.time) / 60) : '?'} min fa`);
  const mattonella = async (z, x, y) => { const r2 = await fetch(`${mappe.host}${ultima.path}/256/${z}/${x}/${y}/2/1_0.png`); return { cors: r2.headers.get('access-control-allow-origin'), byte: (await r2.arrayBuffer()).byteLength }; };
  const z7 = await mattonella(7, 67, 45), z8 = await mattonella(8, 134, 91);
  esito(z7.cors === '*', 'le mattonelle hanno CORS aperto: l\'HUD può leggerne i pixel', `access-control-allow-origin: ${z7.cors}`);
  esito(z8.byte === 1370, 'lo zoom 8 è ancora «Zoom Level Not Supported» (radar.js si ferma a 7)', `${z8.byte} B a zoom 8`);

  titolo('Server vero e strumento mostra_meteo (porta 4423, cervello e Playwright finti)');
  const CASA = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meteo-server-')), BIN = path.join(CASA, 'bin');
  fs.mkdirSync(BIN);
  fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\nexec cat > /dev/null\n', { mode: 0o755 }); // legge e tace: nessun modello
  fs.writeFileSync(path.join(BIN, 'npx'), '#!/bin/sh\necho Listening\nexec sleep 600\n', { mode: 0o755 });
  const PORTA = 4423;
  const s = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, NEXUS_CERVELLO: path.join(CASA, 'cervello'), NEXUS_PORT: String(PORTA), NEXUS_BROWSER_PORT: '8933', NEXUS_CDP_PORT: '9335', NEXUS_NO_OPEN: '1' } });
  let log = ''; s.stdout.on('data', (x) => { log += x; }); s.stderr.on('data', (x) => { log += x; });
  for (let i = 0; i < 50 && !log.includes('Nexus online'); i++) await pausa(200);
  const U = `http://127.0.0.1:${PORTA}/api/meteo`, J = { 'content-type': 'application/json' };
  try {
    esito(log.includes('Nexus online'), 'server di prova acceso');
    const daHud = await fetch(U, { method: 'POST', headers: { ...J, origin: `http://localhost:${PORTA}` }, body: '{"luogo":"Roma"}' });
    esito(daHud.status === 403, 'dall\'HUD (con origin) POST /api/meteo è vietato', `${daHud.status}`);
    const prima = await fetch(U);
    esito(prima.status === 404, 'GET prima di ogni meteo: 404', `${prima.status}`);
    // lo strumento vero, come lo chiama il cervello: JSON-RPC su stdio a mac-mcp.mjs
    const mcp = spawn(process.execPath, [path.join(ROOT, 'mac', 'mac-mcp.mjs'), '--porta', String(PORTA)], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = ''; const risposte = new Map();
    mcp.stdout.on('data', (x) => { buf += x; let i; while ((i = buf.indexOf('\n')) >= 0) { const r2 = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); risposte.set(r2.id, r2); } });
    const chiama = async (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); for (let i = 0; i < 150 && !risposte.has(id); i++) await pausa(100); return risposte.get(id); };
    await chiama(1, 'initialize', {});
    const lista = (await chiama(2, 'tools/list', {}))?.result?.tools || [], def = lista.find((x) => x.name === 'mostra_meteo');
    esito(Boolean(def), 'tools/list ha mostra_meteo', def ? `${Buffer.byteLength(JSON.stringify(def))} B di definizione` : '');
    const t1 = performance.now(), res = await chiama(3, 'tools/call', { name: 'mostra_meteo', arguments: { luogo: 'Torino' } }), ms1 = Math.round(performance.now() - t1);
    const testo = res?.result?.content?.[0]?.text || '';
    esito(!res?.result?.isError && testo.startsWith('Meteo di Torino') && /HUD non è acceso/.test(testo), 'lo strumento risponde coi numeri, e sa che l\'HUD è spento', `${ms1} ms; ${testo.split('\n')[1]?.slice(0, 90)}`);
    const dopo = await (await fetch(U)).json();
    esito(dopo?.luogo?.nome === 'Torino' && dopo.quarti.length > 50, 'GET /api/meteo dà i dati di Torino all\'HUD');
    const err = await chiama(4, 'tools/call', { name: 'mostra_meteo', arguments: { luogo: 'Qwzxjkvbnm' } });
    esito(err?.result?.isError && /non trovo/.test(err.result.content[0].text), 'un posto sbagliato torna al cervello come errore leggibile', err?.result?.content?.[0]?.text);
    const chiudi = await chiama(5, 'tools/call', { name: 'mostra_meteo', arguments: { chiudi: true } });
    esito(chiudi?.result?.content?.[0]?.text === 'Vista meteo chiusa.', 'chiudi true', chiudi?.result?.content?.[0]?.text);
    mcp.stdin.end();
    // la misura delle mani alla chiusura della meteo: nel registro come «[meteo]», e un valore storto di vista è rifiutato
    const misura = (vista) => fetch(`http://127.0.0.1:${PORTA}/api/ologramma`, { method: 'POST', headers: { ...J, origin: `http://localhost:${PORTA}` },
      body: JSON.stringify({ azione: 'misura', secondi: 12, fps: { mediana: 60, p10: 57, minimo: 38 }, detect_ms: 15, vista }) });
    const ok = await misura('meteo'), storta = await misura('altro');
    await pausa(200);
    esito(ok.status === 204 && log.includes('[meteo] mani accese 12 s: fps mediana 60, p10 57, minimo 38, detect 15 ms'), 'misura delle mani con la meteo: riga «[meteo] mani accese» nel registro', `${ok.status}`);
    esito(storta.status === 400, 'una vista che non esiste non scrive niente', `${storta.status}`);
  } finally {
    s.kill('SIGTERM');
    for (let i = 0; i < 50 && s.exitCode === null; i++) await pausa(100);
    esito(s.exitCode !== null, 'il server di prova si spegne');
  }
}

console.log(`\n${passati} passati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
