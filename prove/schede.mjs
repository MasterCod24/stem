// schede.mjs — le schede di quello che O.S.C.A.R. nomina mentre parla: cervello, server e foto, senza HUD.
//   node prove/schede.mjs            in un paio di secondi, senza rete: campi, fonti, foto finte, guardia, ordine nel cervello
//   node prove/schede.mjs --rete     anche il server vero con un claude finto e la rete vera (foto da Wikipedia), circa 30 s
// Il cervello vero si prova con prove/schede-cervello.mjs. L'HUD (corsia, tempi, voce non ritardata) con prove/hud-foto.mjs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { leggiScheda, anteprima, indirizzi, createSchede, vocegiusta, MISURE } from '../schede.mjs';
import { scaricaSicuro } from '../rete.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RETE = process.argv.includes('--rete');
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') { console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`); if (ok) passati++; else falliti++; return ok; }
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); } }
function png(w, h) { // un PNG vero, tutto nero
  const blocco = (tipo, dati) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), t = Buffer.from(tipo); l.writeUInt32BE(dati.length); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, dati])) >>> 0); return Buffer.concat([l, t, dati, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), blocco('IHDR', ihdr), blocco('IDAT', zlib.deflateSync(Buffer.alloc((3 * w + 1) * h))), blocco('IEND', Buffer.alloc(0))]);
}

console.log('== I campi');
const FONTI = ['https://www.tripadvisor.it/Restaurant_Review-g187823-Rossi.html', 'https://it.wikipedia.org/wiki/Colosseo'];
let s = leggiScheda('Trattoria Rossi | trattoria di pesce | voto 4,6/5 (1.230 recensioni) | 25 € a testa | fonte tripadvisor.it', FONTI);
esito(s?.nome === 'Trattoria Rossi' && s.tipo === 'trattoria di pesce' && s.numeri.join(';') === 'voto 4,6/5 (1.230 recensioni);25 € a testa' && s.fonte === 'tripadvisor.it',
  'nome, tipo, numeri e fonte letta', JSON.stringify(s));
s = leggiScheda('Trattoria Rossi | trattoria | fonte gamberorosso.it', FONTI);
esito(s && s.fonte === null, 'una fonte non letta in questa risposta si toglie', JSON.stringify(s?.fonte));
s = leggiScheda('Colosseo | anfiteatro | fonte https://it.wikipedia.org/wiki/Colosseo', FONTI);
esito(s?.fonte === 'it.wikipedia.org', 'una fonte scritta come indirizzo diventa il nome del sito', s?.fonte);
s = leggiScheda(`${'N'.repeat(90)} | ${'t'.repeat(90)} | 1 ${'x'.repeat(90)} | 2 | 3 | 4 | 5`, []);
esito(s.nome.length <= MISURE.nome && s.tipo.length <= MISURE.tipo && s.numeri.length === 3 && s.numeri.every((n) => n.length <= MISURE.numero),
  'campi tagliati a misura, al massimo tre numeri', `${s.nome.length}/${s.tipo.length}/${s.numeri.map((n) => n.length).join(',')}`);
esito(leggiScheda('  | voto 4 ', []) === null && leggiScheda('', []) === null, 'senza nome niente scheda');
s = leggiScheda('Elbrus | vulcano del Caucaso | alto 5.642 m', []);
esito(s.tipo === 'vulcano del Caucaso' && s.numeri[0] === 'alto 5.642 m' && s.fonte === null, 'senza fonte va bene: i numeri che sa con certezza', JSON.stringify(s));
esito(indirizzi('{"x":"vedi https://www.gamberorosso.it/ristoranti/genova/, e https://piatti.menu/beluga."}').join(' ') === 'https://www.gamberorosso.it/ristoranti/genova/ https://piatti.menu/beluga',
  'gli indirizzi dentro un risultato di uno strumento, senza la punteggiatura in coda');

console.log('\n== Le foto (finte)');
esito(anteprima('<meta content="/img/a.jpg" property="og:image"><meta property="twitter:image" content="https://x.it/b.jpg">', 'https://sito.it/pagina') === 'https://sito.it/img/a.jpg',
  "l'anteprima della pagina, anche relativa e con gli attributi al contrario");
esito(anteprima('<meta property="og:image" content="http://sito.it/a.jpg">', 'https://sito.it/') === null, 'una anteprima in http no');
const chiesti = [];
const finto = createSchede({
  fetchPagina: async (u) => { chiesti.push(u); if (u.includes('wikipedia.org/w/api.php')) return Buffer.from(JSON.stringify({ query: { pages: { 1: { title: u.includes('Marin') ? 'Marina di Pisa' : 'Colosseo', description: 'anfiteatro romano di Roma', thumbnail: { source: 'https://upload.wikimedia.org/c.jpg' } } } } }));
    return Object.assign(Buffer.from('<html><meta property="og:image" content="https://img.tripadvisor.it/rossi.jpg"></html>'), { finale: u }); },
  fetchFoto: async (u) => (u.includes('rossi') ? png(800, 450) : u.includes('upload.wikimedia') ? png(640, 427) : png(40, 40)),
});
let r = leggiScheda('Trattoria Rossi | trattoria | fonte tripadvisor.it', FONTI);
let f = await finto.cercaFoto(r, FONTI);
esito(f === `/api/schede/foto/${r.id}` && finto.foto(r.id)?.tipo === 'image/png' && chiesti[0] === FONTI[0], "dalla pagina letta della fonte: la sua anteprima, tenuta dal server", f);
r = leggiScheda('Colosseo | anfiteatro romano', []);
f = await finto.cercaFoto(r, []);
esito(f && finto.foto(r.id), 'senza fonte: Wikipedia, se la voce è proprio quella cosa', f);
r = leggiScheda('Il Marin | ristorante', []);
esito((await finto.cercaFoto(r, [])) === null, 'una voce di Wikipedia con un altro nome («Marina di Pisa» per «Il Marin») non dà la foto');
// le voci vere trovate da Wikipedia il 27/11 (titolo e descrizione), contro il tipo della scheda
for (const [nome, tipo, titolo, descr, deve] of [
  ['Ultima', 'in fondo', 'Ultima', 'serie di videogiochi', false], ['Beluga', 'ristorante di pesce', 'Airbus A300-600ST Beluga', 'aereo cargo', false],
  ['Il Marin', 'ristorante di pesce', 'Marin Sanudo il Giovane', 'storico e politico italiano (1466-1536)', false],
  ['Louvre', "museo d'arte", 'Museo del Louvre', 'museo di arte e archeologia a Parigi', true], ['Monte Bianco', 'vetta delle Alpi', 'Monte Bianco', "vetta montuosa più alta d'Italia, di Francia, della catena alpina", true],
  ['Colosseo', 'anfiteatro romano', 'Colosseo', 'anfiteatro romano di Roma', true], ['Colosseo', '', 'Colosseo', 'anfiteatro romano di Roma', false]]) {
  esito(vocegiusta({ nome, tipo }, titolo, descr) === deve, `«${nome}, ${tipo || 'senza tipo'}» e la voce «${titolo}»: ${deve ? 'foto' : 'niente foto'}`);
}
const piccolo = createSchede({ fetchPagina: async () => Object.assign(Buffer.from('<meta property="og:image" content="https://x.it/logo.png">'), { finale: 'https://x.it/' }), fetchFoto: async () => png(40, 40) });
r = leggiScheda('Logo | cosa | fonte x.it', ['https://x.it/p']);
esito((await piccolo.cercaFoto(r, ['https://x.it/p'])) === null, 'un logo da 40×40 non è una foto');
const rotto = createSchede({ fetchPagina: async () => { throw new Error('il sito ha risposto 403'); }, fetchFoto: async () => png(800, 600), onLog: () => {} });
esito((await rotto.cercaFoto(leggiScheda('X | y | fonte x.it', ['https://x.it/']), ['https://x.it/'])) === null, 'un sito che rifiuta: niente foto, nessun errore che esce');

console.log('\n== La guardia');
for (const u of ['http://example.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg', 'https://192.168.1.1/a.jpg', 'https://example.com:8443/a.jpg']) {
  const e = await scaricaSicuro(u, { byte: 1000, ms: 2000 }).then(() => null, (x) => x.message);
  esito(Boolean(e), `rifiutato: ${u}`, e);
}

console.log('\n== Il cervello: ogni scheda subito dopo la sua frase');
const CASA = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-schede-'));
const BIN = path.join(CASA, 'bin');
fs.mkdirSync(BIN);
// Il claude finto: per ogni domanda un copione. «pezzi» manda il testo a pezzetti di 7 caratteri, «tutto» in un pezzo solo
// (come dopo una ricerca), sempre con un risultato di strumento che contiene due indirizzi.
const TESTO = 'Guardo subito. Il migliore è la Trattoria Rossi, in centro storico vicino al porto. [[vedi: Trattoria Rossi | trattoria | fonte tripadvisor.it]] '
  + 'Costa sui venticinque euro, vino escluso. Poi c\'è il Marin[[vedi: Il Marin | ristorante]], al Porto Antico sopra Eataly. Prenota venerdì. [[vedi: Ultima | in fondo]]';
fs.writeFileSync(path.join(BIN, 'claude'), `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: '00000000-0000-4000-8000-00000000beef' }) + '\\n');
out({ type: 'system', subtype: 'init' });
const TESTO = ${JSON.stringify(TESTO)}, COLOSSEO = ${JSON.stringify('Guardo subito. Il Colosseo è il più grande anfiteatro mai costruito dai Romani. [[vedi: Colosseo | anfiteatro romano | alto 48 m]] Ci stavano cinquantamila persone.')};
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === 'control_request') return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
  if (m.type !== 'user') return;
  const q = JSON.stringify(m.message);
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'Risultati: https://www.tripadvisor.it/Rossi e https://piatti.menu/x' }] }] } });
  const testo = q.includes('Colosseo') ? COLOSSEO : TESTO;
  const pezzi = q.includes('tutto') ? [testo] : testo.match(/[\\s\\S]{1,7}/g);
  for (const p of pezzi) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: p } } });
  out({ type: 'stream_event', event: { type: 'content_block_stop' } });
  out({ type: 'result', subtype: 'success', is_error: false });
});
process.stdin.on('end', () => process.exit(0));
`, { mode: 0o755 });
const PATH0 = process.env.PATH;
process.env.PATH = `${BIN}:${PATH0}`;
const { createBrain } = await import('../brain.mjs');
const brain = createBrain({ cwd: CASA, args: [], sessionFile: path.join(CASA, 'cervello.json') });
for (const modo of ['pezzi', 'tutto']) {
  const ev = [];
  await brain.ask(`domanda ${modo}`, (e) => ev.push(e));
  const seq = ev.filter((e) => e.t === 'say' || e.t === 'vedi').map((e) => (e.t === 'say' ? `S:${e.s}` : `V:${e.arg.split('|')[0].trim()}`));
  const atteso = ['S:Guardo subito.', 'S:Il migliore è la Trattoria Rossi, in centro storico vicino al porto.', 'V:Trattoria Rossi',
    'S:Costa sui venticinque euro, vino escluso.', "S:Poi c'è il Marin, al Porto Antico sopra Eataly.", 'V:Il Marin', 'S:Prenota venerdì.', 'V:Ultima'];
  esito(JSON.stringify(seq) === JSON.stringify(atteso), `testo ${modo === 'pezzi' ? 'a pezzetti' : 'tutto insieme'}: ogni scheda dopo la frase che la contiene o la precede, anche in fondo`, seq.join(' | '));
  esito(ev.filter((e) => e.t === 'say').every((e) => !/[\u0007[\]|]|vedi/.test(e.s)), 'nel parlato niente segnaposto, parentesi o campi');
  const fonti = ev.filter((e) => e.t === 'fonti').flatMap((e) => e.indirizzi);
  esito(fonti.includes('https://www.tripadvisor.it/Rossi') && ev.findIndex((e) => e.t === 'fonti') < ev.findIndex((e) => e.t === 'vedi'), 'gli indirizzi letti arrivano prima delle schede', fonti.join(' '));
}
brain.kill?.();
await pausa(300);

if (RETE) {
  console.log('\n== Il server vero, con un claude finto e la rete');
  const PORTA = 4463, PW = 8963, CDP = 9363;
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(CASA, 'chrome')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: `${BIN}:${PATH0}`, OSCAR_CERVELLO: path.join(CASA, 'oscar'), OSCAR_PORT: String(PORTA), OSCAR_BROWSER_PORT: String(PW), OSCAR_CDP_PORT: String(CDP), OSCAR_NO_OPEN: '1' } });
  let registro = ''; server.stdout.on('data', (d) => { registro += d; }); server.stderr.on('data', (d) => { registro += d; });
  try {
    esito(await attendi(() => registro.includes(`online su http://localhost:${PORTA}`), 30000), 'il server di prova è online');
    // la domanda «tutto»: il finto cita tripadvisor.it, mai scaricabile da qui (403 ai programmi), e il Marin, che su Wikipedia non c'è
    const t0 = performance.now(), ev = [];
    const risposta = await fetch(`http://localhost:${PORTA}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'tutto', why: 'nome' }) });
    for (const riga of (await risposta.text()).split('\n').filter(Boolean)) ev.push(JSON.parse(riga));
    const tipi = ev.map((e) => e.t);
    const v = ev.filter((e) => e.t === 'vedi');
    esito(v.length === 3 && v[0].nome === 'Trattoria Rossi' && v[0].fonte === 'tripadvisor.it' && v[1].fonte === null && tipi.indexOf('vedi') === tipi.lastIndexOf('say', tipi.indexOf('vedi')) + 1,
      'all\'HUD: le schede pulite, la prima dopo la sua frase, la fonte letta tenuta', v.map((x) => `${x.nome}/${x.fonte}`).join(' '));
    esito(!tipi.includes('fonti') && tipi.at(-1) === 'done', "gli indirizzi letti non vanno all'HUD; la risposta si chiude", tipi.join(','));
    // una foto vera da Wikipedia: il Colosseo, chiesto con la sua domanda
    const ev2 = [];
    const r2 = await fetch(`http://localhost:${PORTA}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'tutto Colosseo', why: 'nome' }) });
    for (const riga of (await r2.text()).split('\n').filter(Boolean)) ev2.push(JSON.parse(riga));
    const col = ev2.find((e) => e.t === 'vedi'), ft = ev2.find((e) => e.t === 'vedi-foto');
    const foto = ft && await fetch(`http://localhost:${PORTA}${ft.url}`);
    const byte = foto?.ok ? (await foto.arrayBuffer()).byteLength : 0;
    esito(col?.nome === 'Colosseo' && ft?.id === col.id && /^image\//.test(foto?.headers.get('content-type') || '') && byte > 5000,
      'il Colosseo: la foto da Wikipedia, scaricata dal server e servita all\'HUD da localhost', `${ft?.url} ${foto?.headers.get('content-type')} ${byte} B, ${Math.round(performance.now() - t0)} ms`);
    console.log(`      dal registro: ${registro.split('\n').filter((l) => l.includes('[schede]')).join(' | ').slice(0, 300) || 'niente'}`);
    const sbagliata = await fetch(`http://localhost:${PORTA}/api/schede/foto/nonesiste`);
    esito(sbagliata.status === 404, 'una foto che non c\'è: 404');
    const daFuori = await fetch(`http://localhost:${PORTA}/api/schede/foto/nonesiste`, { headers: { 'sec-fetch-site': 'cross-site' } });
    esito(daFuori.status === 403, 'da un altro sito: 403, come ogni /api/', String(daFuori.status));
  } finally {
    server.kill('SIGTERM'); await attendi(() => server.exitCode !== null || server.signalCode !== null, 8000);
    chrome.kill('SIGTERM'); await pausa(500);
    const porte = (() => { try { return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${PORTA}`, `-iTCP:${PW}`, `-iTCP:${CDP}`, '-sTCP:LISTEN', '-t']).toString().trim(); } catch { return ''; } })();
    esito(!porte, 'porte di prova chiuse', porte);
  }
}
fs.rmSync(CASA, { recursive: true, force: true });
console.log(`\n${passati} su ${passati + falliti}`);
process.exitCode = falliti ? 1 : 0; // non process.exit: con una pipe taglierebbe le ultime righe
