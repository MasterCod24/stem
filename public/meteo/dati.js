// Meteo: i conti sui dati di Open-Meteo, senza DOM. Gira nel server (meteo.mjs, che ne fa il testo per il cervello),
// nell'HUD (vista.js, che li rifà all'ora scelta sulla timeline) e in Node (prove/meteo.mjs).
// Tempi in millisecondi UTC; l'ora del posto si fa con offset, i secondi di scarto dall'UTC che dà Open-Meteo.
// Pioggia e codice di un quarto d'ora o di un'ora valgono per il periodo PRIMA del loro orario (documentazione di
// Open-Meteo: «sum of the preceding 15 minutes / hour»): il quarto delle 17:00 è la pioggia fra le 16:45 e le 17:00.
// Pressione, temperatura, vento e visibilità invece sono il valore a quell'ora.

export const Q = 15 * 60_000, H = 3_600_000;

// Le soglie, ognuna con la sua fonte. Le percentuali delle condizioni (condizioniA) sono una scelta mia sopra queste
// soglie, non uno standard: la vista dice quale fattore limita, così il numero si controlla.
export const SOGLIE = Object.freeze({
  bagnato_mm: 0.1,        // mm in un quarto d'ora: la risoluzione di Open-Meteo, cioè 0,4 mm/h
  buco_quarti: 1,         // un quarto asciutto in mezzo non spezza un evento: il modello alterna 0,1 e 0,0
  pressione_rapida: 3.6,  // hPa in 3 h: «falling quickly» del Met Office, da 3,6 a 6,0
  pressione_molto: 6.1,   // oltre 6,0 hPa in 3 h: «falling very rapidly»
  raffica_ideale: 20,     // km/h: dove comincia Beaufort 4. Sotto, il vento non conta per spostarsi (scelta mia)
  raffica_burrasca: 62,   // km/h: Beaufort 8, burrasca
  raffica_tempesta: 89,   // km/h: Beaufort 10, tempesta
  pioggia_forte: 8,       // mm/h: «very heavy rain» del Met Office, oltre 8
  pioggia_violenta: 50,   // mm/h: «violent shower» del Met Office, oltre 50
  nebbia_m: 1000,         // visibilità sotto 1 km: nebbia, per l'OMM
  vis_piena_m: 10000,     // 10 km: il massimo che riporta un METAR (9999), cioè visibilità piena
});

// I codici del tempo dell'OMM (WMO 4677 ridotto), come li usa Open-Meteo
export const CODICI = Object.freeze({
  0: 'sereno', 1: 'quasi sereno', 2: 'poco nuvoloso', 3: 'coperto', 45: 'nebbia', 48: 'nebbia con brina',
  51: 'pioggerella debole', 53: 'pioggerella', 55: 'pioggerella fitta', 56: 'pioggerella gelata', 57: 'pioggerella gelata fitta',
  61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte', 66: 'pioggia gelata', 67: 'pioggia gelata forte',
  71: 'neve debole', 73: 'neve', 75: 'neve forte', 77: 'neve granulosa', 80: 'rovesci deboli', 81: 'rovesci', 82: 'rovesci violenti',
  85: 'rovesci di neve', 86: 'rovesci di neve forti', 95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine forte',
});
export const temporale = (c) => c >= 95 && c <= 99;
export const neve = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
export const gelata = (c) => c === 56 || c === 57 || c === 66 || c === 67;
export const grandine = (c) => c === 96 || c === 99;

// Beaufort dell'OMM: la forza è quante soglie (km/h) il vento supera
const BEAUFORT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const NOMI_BEAUFORT = ['calma', 'bava di vento', 'brezza leggera', 'brezza tesa', 'vento moderato', 'vento teso', 'vento fresco',
  'vento forte', 'burrasca', 'burrasca forte', 'tempesta', 'fortunale', 'uragano'];
export function beaufort(kmh) {
  if (!Number.isFinite(kmh)) return null;
  const n = BEAUFORT.filter((s) => kmh >= s).length;
  return { n, nome: NOMI_BEAUFORT[n] };
}

// Da dove viene il vento: 16 settori per l'HUD, 8 nomi interi per la voce
const SETTORI = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const NOMI_DIR = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];
const giro = (g) => ((g % 360) + 360) % 360;
export const bussola = (g) => (Number.isFinite(g) ? SETTORI[Math.round(giro(g) / 22.5) % 16] : '—');
export const direzione = (g) => (Number.isFinite(g) ? NOMI_DIR[Math.round(giro(g) / 45) % 8] : null);

// ---------------------------------------------------------------- formati (virgola italiana, meno tipografico)
export function num(v, d = 0) {
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v).toFixed(d).replace('.', ',');
  return (v < 0 && Number(s.replace(',', '.')) !== 0 ? '−' : '') + s;
}
const due = (n) => String(n).padStart(2, '0');
export function oraDi(t, offset = 0) {
  const d = new Date(t + offset * 1000);
  return `${due(d.getUTCHours())}:${due(d.getUTCMinutes())}`;
}
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export function giornoDi(t, offset = 0) {
  const d = new Date(t + offset * 1000);
  return `${GIORNI[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
// «42 min», «1 h 15 min», «3 h»
export function durata(ms) {
  const m = Math.max(0, Math.round(ms / 60_000)), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${m} min`;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const r1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- dalla risposta di Open-Meteo ai dati di O.S.C.A.R.
// Solo numeri finiti (il resto diventa null) e tempi in ms. raw è la risposta con timeformat=unixtime.
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export function normalizza(raw, luogo, preso) {
  const offset = fin(raw?.utc_offset_seconds) ?? 0;
  const serie = (o, campi) => {
    const tempi = Array.isArray(o?.time) ? o.time : [];
    return tempi.map((t, i) => {
      const x = { t: fin(t) === null ? null : t * 1000 };
      for (const [k, nome] of Object.entries(campi)) x[k] = fin(o[nome]?.[i]);
      return x;
    }).filter((x) => x.t !== null);
  };
  const ORA = { temp: 'temperature_2m', percepita: 'apparent_temperature', umidita: 'relative_humidity_2m', rugiada: 'dew_point_2m',
    mm: 'precipitation', codice: 'weather_code', nuvole: 'cloud_cover', pressione: 'pressure_msl', vento: 'wind_speed_10m',
    dir: 'wind_direction_10m', raffiche: 'wind_gusts_10m', vis: 'visibility' };
  const c = raw?.current || {};
  const ora = { t: fin(c.time) === null ? preso : c.time * 1000, giorno: c.is_day === 1 };
  for (const [k, nome] of Object.entries(ORA)) ora[k] = fin(c[nome]);
  return {
    luogo: { ...luogo, quota: fin(raw?.elevation), fuso: typeof raw?.timezone === 'string' ? raw.timezone : 'UTC', offset },
    preso,
    ora,
    ore: serie(raw?.hourly, { ...ORA, prob: 'precipitation_probability' }),
    quarti: serie(raw?.minutely_15, { mm: 'precipitation', codice: 'weather_code' }),
    giorni: serie(raw?.daily, { codice: 'weather_code', max: 'temperature_2m_max', min: 'temperature_2m_min', mm: 'precipitation_sum',
      prob: 'precipitation_probability_max', raffiche: 'wind_gusts_10m_max' }),
  };
}

// ---------------------------------------------------------------- i valori a un'ora qualsiasi
// Un campo di una serie oraria all'istante t, lineare fra due ore; la direzione del vento gira per la via più corta.
export function interp(ore, t, k) {
  if (!ore?.length) return null;
  let i = ore.findIndex((o) => o.t > t);
  if (i === 0) return ore[0].t === t ? ore[0][k] : null;
  if (i < 0) return ore[ore.length - 1].t === t ? ore[ore.length - 1][k] : null;
  const a = ore[i - 1], b = ore[i];
  if (a[k] === null || b[k] === null) return t - a.t < b.t - t ? a[k] : b[k];
  const f = (t - a.t) / (b.t - a.t);
  if (k === 'dir') { const d = ((b.dir - a.dir + 540) % 360) - 180; return giro(a.dir + d * f); }
  return a[k] + (b[k] - a[k]) * f;
}
// La pioggia in mm/h nel quarto che contiene t; senza quarti, quella dell'ora che lo contiene
export function mmhA(d, t) {
  const s = d.quarti.find((x) => x.t - Q <= t && t < x.t);
  if (s) return s.mm === null ? null : s.mm * 4;
  const o = d.ore.find((x) => x.t - H <= t && t < x.t);
  return o ? o.mm : null;
}
// Tutti i valori a t: vicino all'ultimo dato «adesso» si usa quello (ogni 15 minuti), altrove le ore del modello.
// Mezz'ora dopo vale ancora: l'HUD riprende i dati ogni 5 minuti, il server li riscarica dopo 10.
export function valoriA(d, t) {
  const o = d.ora;
  if (o && t >= o.t - 2 * Q && t <= o.t + 2 * Q) return { ...o, mmh: mmhA(d, t) ?? (o.mm === null ? null : o.mm * 4), adesso: true };
  const v = { t, adesso: false };
  for (const k of ['temp', 'percepita', 'umidita', 'rugiada', 'nuvole', 'pressione', 'vento', 'dir', 'raffiche', 'vis', 'prob']) v[k] = interp(d.ore, t, k);
  const h = d.ore.find((x) => x.t - H <= t && t < x.t); // il codice dell'ora che contiene t
  v.codice = h ? h.codice : null;
  v.mmh = mmhA(d, t);
  return v;
}

// ---------------------------------------------------------------- indici
export const visibilitaPct = (v) => (v?.vis === null || v?.vis === undefined ? null : Math.round(clamp01(v.vis / SOGLIE.vis_piena_m) * 100));
// Le condizioni per spostarsi: il fattore peggiore comanda. Visibilità come visibilitaPct (la parte dei 10 km, una scala sola
// in tutta la vista), raffiche da 20 (100%) a 62 km/h (0%), pioggia da 0 a 8 mm/h; un temporale vale 10%, neve o ghiaccio 40%.
export function condizioniA(v) {
  const S = SOGLIE, f = [];
  if (v.vis !== null && v.vis !== undefined) f.push(['visibilità', clamp01(v.vis / S.vis_piena_m)]);
  if (v.raffiche !== null && v.raffiche !== undefined) f.push(['vento', clamp01((S.raffica_burrasca - v.raffiche) / (S.raffica_burrasca - S.raffica_ideale))]);
  if (v.mmh !== null && v.mmh !== undefined) f.push(['pioggia', clamp01(1 - v.mmh / S.pioggia_forte)]);
  if (temporale(v.codice)) f.push(['temporale', 0.1]);
  else if (neve(v.codice)) f.push(['neve', 0.4]);
  else if (gelata(v.codice)) f.push(['ghiaccio', 0.4]);
  if (!f.length) return null;
  const peggiore = f.reduce((a, b) => (b[1] < a[1] ? b : a)), pct = Math.round(peggiore[1] * 100);
  return {
    pct, giudizio: pct >= 85 ? 'ideali' : pct >= 60 ? 'buone' : pct >= 35 ? 'limitate' : 'sconsigliate',
    limite: pct < 100 ? peggiore[0] : null, fattori: f.map(([k, x]) => [k, Math.round(x * 100)]),
  };
}

// ---------------------------------------------------------------- pressione
// Le parole del Met Office per la tendenza in 3 ore: stabile sotto 0,1 hPa, lenta fino a 1,5, normale fino a 3,5,
// rapida fino a 6,0, molto rapida oltre.
export function tendenza(delta) {
  if (delta === null || !Number.isFinite(delta)) return null;
  const a = Math.abs(r1(delta));
  if (a < 0.1) return 'stabile';
  return `${delta < 0 ? 'in calo' : 'in aumento'}${a < 1.6 ? ' lento' : a < SOGLIE.pressione_rapida ? '' : a < SOGLIE.pressione_molto ? ' rapido' : ' molto rapido'}`;
}
export function pressione(d, adesso) {
  const ora = d.ora?.pressione ?? interp(d.ore, adesso, 'pressione'), prima = interp(d.ore, adesso - 3 * H, 'pressione');
  const delta = ora !== null && prima !== null ? r1(ora - prima) : null;
  // il calo più forte in 3 ore da qui a 12 ore, sulle ore del modello
  let futuro = null;
  for (const a of d.ore) {
    if (a.t < adesso - H / 2 || a.t + 3 * H > adesso + 12 * H || a.pressione === null) continue;
    const b = d.ore.find((x) => x.t === a.t + 3 * H);
    if (!b || b.pressione === null) continue;
    const dd = r1(b.pressione - a.pressione);
    if (!futuro || dd < futuro.delta) futuro = { delta: dd, da: a.t, a: b.t };
  }
  return { hpa: ora, delta, tendenza: tendenza(delta), futuro };
}

// ---------------------------------------------------------------- precipitazioni: quando cominciano e quando finiscono
// Sui quarti d'ora da adesso in avanti: un evento è una fila di quarti bagnati, con al massimo un quarto asciutto in mezzo.
export function tipoDi(codici) {
  if (codici.some(temporale)) return 'temporale';
  if (codici.some(gelata)) return 'pioggia gelata';
  const n = codici.filter(neve).length;
  return n && n >= codici.length / 2 ? 'neve' : 'pioggia';
}
export function eventi(d, adesso) {
  const S = SOGLIE, q = d.quarti.filter((s) => s.t > adesso), out = [];
  const bagnato = (s) => s.mm !== null && s.mm >= S.bagnato_mm;
  for (let i = 0; i < q.length;) {
    if (!bagnato(q[i])) { i++; continue; }
    let ultimo = i;
    for (let k = i + 1; k < q.length && k - ultimo <= S.buco_quarti + 1; k++) if (bagnato(q[k])) ultimo = k;
    const tratto = q.slice(i, ultimo + 1).filter(bagnato);
    out.push({
      inizio: q[i].t - Q, fine: q[ultimo].t, in_corso: q[i].t - Q <= adesso, oltre: ultimo === q.length - 1,
      tipo: tipoDi(tratto.map((s) => s.codice).filter((c) => c !== null)),
      max_mmh: r1(Math.max(...tratto.map((s) => s.mm * 4))), mm: r1(tratto.reduce((a, s) => a + s.mm, 0)),
    });
    i = ultimo + 1;
  }
  return out;
}
// Fin dove arrivano i quarti, in ore da adesso
export const orizzonte = (d, adesso) => (d.quarti.length ? Math.max(0, Math.round((d.quarti[d.quarti.length - 1].t - adesso) / H)) : 0);
// La frase della timeline, come nell'esempio di Tony: «precipitazioni tra 42 min · durata stimata 1 h 15 min»
export function fraseEvento(ev, adesso, ore) {
  if (!ev) return `nessuna precipitazione nelle prossime ${ore} h`;
  const nome = ev.tipo === 'pioggia' ? 'precipitazioni' : ev.tipo;
  if (ev.in_corso) return ev.oltre ? `${nome} in corso · continua oltre le prossime ${ore} h` : `${nome} in corso · fine tra ${durata(ev.fine - adesso)}`;
  return `${nome} tra ${durata(ev.inizio - adesso)} · durata stimata ${ev.oltre ? `oltre ${durata(ev.fine - ev.inizio)}` : durata(ev.fine - ev.inizio)}`;
}

// ---------------------------------------------------------------- avvisi
// livello 1 arancione, 2 rosso: come le anomalie dell'HUD. titolo e dettaglio sono frasi in minuscolo, l'HUD le fa maiuscole.
export function avvisi(d, adesso, p = pressione(d, adesso)) {
  const S = SOGLIE, off = d.luogo?.offset ?? 0, ora = (t) => oraDi(t, off), out = [];
  const avanti = d.ore.filter((o) => o.t > adesso && o.t <= adesso + 12 * H);
  const probMax = (ms) => Math.max(-1, ...d.ore.filter((o) => o.t > adesso && o.t <= adesso + ms && o.prob !== null).map((o) => o.prob));
  const temp = avanti.find((o) => temporale(o.codice));
  const fraOra = (t, passo) => `fra le ${ora(t - passo)} e le ${ora(t)}`;

  // pressione: il calo più forte fra le ultime 3 ore e le prossime 12
  const passato = p.delta !== null && p.delta <= -S.pressione_rapida ? p.delta : null;
  const futuro = p.futuro && p.futuro.delta <= -S.pressione_rapida ? p.futuro : null;
  if (passato !== null || futuro) {
    const usaFuturo = futuro && (passato === null || futuro.delta < passato - 0.5);
    const delta = usaFuturo ? futuro.delta : passato, rapido = delta <= -S.pressione_molto ? 'molto rapido' : 'rapido';
    const pr6 = probMax(6 * H);
    out.push({ livello: delta <= -S.pressione_molto ? 2 : 1, chiave: 'pressione', t: usaFuturo ? futuro.da : adesso,
      titolo: usaFuturo ? `calo barometrico ${rapido} in arrivo: ${num(delta, 1)} hPa ${fraOra(futuro.a, 3 * H)}` : `calo barometrico ${rapido}: ${num(delta, 1)} hPa nelle ultime 3 ore`,
      dettaglio: temp ? `temporale previsto ${fraOra(temp.t, H)}${temp.prob !== null ? `, precipitazioni al ${temp.prob}%` : ''}`
        : pr6 >= 0 ? `probabilità di precipitazioni al ${pr6}% nelle prossime 6 ore` : '' });
  }
  if (temp) out.push({ livello: avanti.some((o) => grandine(o.codice)) ? 2 : 1, chiave: 'temporale', t: temp.t - H,
    titolo: `${CODICI[temp.codice] || 'temporale'} previsto ${fraOra(temp.t, H)}`, dettaglio: temp.prob !== null ? `probabilità di precipitazioni ${temp.prob}%` : '' });

  const conOra = [{ ...d.ora, adesso: true }, ...avanti];
  const raffica = conOra.filter((o) => o.raffiche !== null).reduce((a, o) => (!a || o.raffiche > a.raffiche ? o : a), null);
  if (raffica && raffica.raffiche >= S.raffica_burrasca) {
    const b = beaufort(raffica.raffiche);
    out.push({ livello: raffica.raffiche >= S.raffica_tempesta ? 2 : 1, chiave: 'vento', t: raffica.adesso ? adesso : raffica.t,
      titolo: `raffiche fino a ${num(raffica.raffiche)} km/h ${raffica.adesso ? 'adesso' : `alle ${ora(raffica.t)}`}`, dettaglio: `forza ${b.n} Beaufort, ${b.nome}` });
  }
  const forte = d.quarti.filter((s) => s.t > adesso && s.t <= adesso + 12 * H && s.mm !== null).reduce((a, s) => (!a || s.mm > a.mm ? s : a), null);
  if (forte && forte.mm * 4 >= S.pioggia_forte) {
    const v = forte.mm * 4;
    out.push({ livello: v >= S.pioggia_violenta ? 2 : 1, chiave: 'pioggia', t: forte.t - Q,
      titolo: `pioggia ${v >= S.pioggia_violenta ? 'violenta' : 'molto forte'}: ${num(v, 1)} mm/h ${fraOra(forte.t, Q)}`, dettaglio: 'picco del modello su un quarto d\'ora' });
  }
  const nebbia = conOra.filter((o) => o.vis !== null && o.vis < S.nebbia_m).reduce((a, o) => (!a || o.vis < a.vis ? o : a), null);
  if (nebbia) out.push({ livello: 1, chiave: 'nebbia', t: nebbia.adesso ? adesso : nebbia.t,
    titolo: `nebbia ${nebbia.adesso ? 'adesso' : `alle ${ora(nebbia.t)}`}: visibilità ${num(nebbia.vis)} m`, dettaglio: 'sotto 1 km di visibilità' });
  const gelo = avanti.find((o) => gelata(o.codice));
  if (gelo) out.push({ livello: 1, chiave: 'ghiaccio', t: gelo.t - H, titolo: `${CODICI[gelo.codice]} ${fraOra(gelo.t, H)}`, dettaglio: 'strade ghiacciate possibili' });
  return out.sort((a, b) => b.livello - a.livello || a.t - b.t);
}

// Tutto quello che serve a voce e alla vista, all'istante adesso
export function analizza(d, adesso = d.preso) {
  const p = pressione(d, adesso), ev = eventi(d, adesso), v = valoriA(d, adesso), ore = orizzonte(d, adesso);
  return { pressione: p, eventi: ev, frase: fraseEvento(ev[0], adesso, ore), orizzonte: ore, avvisi: avvisi(d, adesso, p),
    valori: v, condizioni: condizioniA(v), visibilita: visibilitaPct(v) };
}
