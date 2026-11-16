// ologramma-server.mjs — prova il collegamento fra server, strumenti MCP e cervello per gli ologrammi.
// Avvia un Nexus di prova sulle porte 4422 (HTTP), 8932 (Playwright MCP) e 9334 (CDP), senza finestre e con NEXUS_CERVELLO
// in una cartella sua: il cervello parte ma non riceve domande, quindi non spende niente. Poi lo riavvia con un cervello
// finto (bin/claude nella cartella della prova, nessun modello) e un Chrome headless suo sulla 9334, per le domande che
// aprono un report o il browser. Alla fine spegne tutto con SIGTERM e controlla che sulle porte e fra i processi non resti niente.
// node prove/ologramma-server.mjs [cartella] → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
// La cartella (se manca, una nuova in os.tmpdir()) dev'essere vuota o di una prova di prima.
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { MODELLO_MANI } from '../public/ologramma/mani.js';
import { MATERIALI } from '../public/ologramma/materiali.js';
import { FACCE } from '../public/ologramma/forme.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORTA = 4422, PW = 8932, CDP = 9334, VUOTA = 4498; // VUOTA: nessuno ascolta, per lo strumento senza server
const ORIGINE = `http://localhost:${PORTA}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HUD = { origin: ORIGINE, 'sec-fetch-site': 'same-origin' }; // come le manda Chrome dall'HUD

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
const titolo = (t) => console.log(`\n== ${t}`);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const N3 = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 3, useGrouping: false }); // come ologramma.mjs
const sh = (file, args) => new Promise((ok) => execFile(file, args, { encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out) => ok(e ? '' : out)));
const porteOccupate = async () => (await sh('/usr/sbin/lsof', ['-nP', ...[PORTA, PW, CDP, VUOTA].map((p) => `-iTCP:${p}`), '-sTCP:LISTEN', '-t'])).trim();
async function attendi(fn, ms, passo = 100) { // fino a ms, finché fn dà qualcosa di vero
  const fine = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); }
}

// Gli argomenti esatti di un processo (sysctl KERN_PROCARGS2): ps storpia gli a capo e le lettere accentate della persona
const ARGOMENTI_PY = `import ctypes, json, struct, sys
libc = ctypes.CDLL(None)
mib = (ctypes.c_int * 3)(1, 49, int(sys.argv[1]))
n = ctypes.c_size_t(0)
if libc.sysctl(mib, 3, None, ctypes.byref(n), None, 0) != 0: sys.exit(1)
buf = ctypes.create_string_buffer(n.value)
if libc.sysctl(mib, 3, buf, ctypes.byref(n), None, 0) != 0: sys.exit(1)
raw = buf.raw[:n.value]
argc = struct.unpack('i', raw[:4])[0]
resto = raw[4:]
resto = resto[resto.index(b'\\0'):].lstrip(b'\\0')
print(json.dumps([a.decode('utf-8', 'replace') for a in resto.split(b'\\0')[:argc]]))`;
async function argomenti(pid) { try { return JSON.parse(await sh('/usr/bin/python3', ['-I', '-c', ARGOMENTI_PY, String(pid)])); } catch { return null; } }
const figli = async (pid) => (await sh('/usr/bin/pgrep', ['-P', String(pid)])).split('\n').filter(Boolean).map(Number);

// Una richiesta HTTP con le intestazioni scelte qui (fetch aggiungerebbe le sue). La risposta conta anche se poi il
// server chiude mentre il corpo sta ancora partendo.
function chiedi(metodo, percorso, { corpo, intestazioni = {}, pezzi } = {}) {
  return new Promise((ok, no) => {
    const dati = corpo === undefined ? null : Buffer.isBuffer(corpo) ? corpo : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const h = { ...((dati || pezzi) && { 'content-type': 'application/json' }), ...(dati && { 'content-length': dati.length }), ...intestazioni };
    const t0 = performance.now();
    let fatto = false;
    const req = http.request({ host: '127.0.0.1', port: PORTA, method: metodo, path: percorso, headers: h }, (res) => {
      const parti = [];
      res.on('data', (d) => parti.push(d));
      res.on('end', () => {
        fatto = true;
        const b = Buffer.concat(parti);
        let j = null;
        try { j = JSON.parse(b.toString('utf8')); } catch {}
        ok({ codice: res.statusCode, h: res.headers, b, j, ms: performance.now() - t0 });
      });
    });
    req.on('error', (e) => { if (!fatto) no(e); });
    req.setTimeout(100_000, () => req.destroy(new Error('nessuna risposta in 100 s')));
    if (pezzi) { for (const p of pezzi) req.write(p); req.end(); } // a pezzi, senza content-length
    else req.end(dati ?? undefined);
  });
}
const cervello = (azione) => chiedi('POST', '/api/ologramma', { corpo: azione }); // come il processo MCP: niente origin
const stato = async () => (await chiedi('GET', '/api/ologramma')).j;

// Un client MCP su stdio, come quello di Claude Code
function mcp(porta = String(PORTA)) {
  const p = spawn(process.execPath, [path.join(ROOT, 'mac', 'mac-mcp.mjs'), '--porta', porta], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', id = 0;
  const attese = new Map();
  p.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const riga = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!riga.trim()) continue;
      const m = JSON.parse(riga);
      attese.get(m.id)?.(m);
      attese.delete(m.id);
    }
  });
  p.stderr.on('data', () => {});
  const chiama = (method, params) => new Promise((ok) => {
    const n = ++id;
    attese.set(n, ok);
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });
  const strumento = async (name, args) => {
    const t0 = performance.now(), m = await chiama('tools/call', { name, arguments: args });
    const c = m.result?.content || [];
    return { errore: m.result?.isError === true, testo: c[0]?.text || '', foto: c.find((x) => x.type === 'image'), contenuto: c, ms: performance.now() - t0 };
  };
  return { p, chiama, strumento, chiudi: () => new Promise((ok) => { p.on('exit', ok); p.stdin.end(); }) };
}

// Un PNG vero di w×h pixel neri, con i byte di riempimento dopo la fine se servono (per la foto troppo grande)
function png(w, h, riempi = 0) {
  const blocco = (tipo, dati) => {
    const t = Buffer.from(tipo, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4);
    l.writeUInt32BE(dati.length);
    c.writeUInt32BE(zlib.crc32(Buffer.concat([t, dati])) >>> 0);
    return Buffer.concat([l, t, dati, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), blocco('IHDR', ihdr),
    blocco('IDAT', zlib.deflateSync(Buffer.alloc((3 * w + 1) * h))), blocco('IEND', Buffer.alloc(0)), Buffer.alloc(riempi)]);
}

// ---------------------------------------------------------------- la cartella del Nexus di prova
const CASA = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-prova-'));
const SEGNO = path.join(CASA, '.nexus-prova');
if (fs.existsSync(CASA) && fs.readdirSync(CASA).length && !fs.existsSync(SEGNO)) {
  console.log(`FAIL  ${CASA} non è vuota e non è di una prova di prima: non la tocco`);
  process.exit(1);
}
fs.rmSync(CASA, { recursive: true, force: true });
const DOC = path.join(CASA, 'Documents'), FUORI = path.join(CASA, 'fuori');
for (const d of [path.join(DOC, '.nascosta'), path.join(DOC, 'cartella.stl'), path.join(CASA, 'Desktop'), FUORI]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(SEGNO, 'cartella di prove/ologramma-server.mjs\n');
const STL = 'solid prova\n facet normal 0 0 -1\n  outer loop\n   vertex 0 0 0\n   vertex 10 0 0\n   vertex 0 10 0\n  endloop\n endfacet\nendsolid prova\n';
fs.writeFileSync(path.join(DOC, 'pezzo.stl'), STL);
fs.writeFileSync(path.join(FUORI, 'segreto.stl'), 'fuori dalle cartelle di Tony\n');
fs.writeFileSync(path.join(DOC, 'note.txt'), 'non è un modello\n');
fs.writeFileSync(path.join(DOC, '.nascosta', 'x.stl'), STL);
fs.symlinkSync(path.join(FUORI, 'segreto.stl'), path.join(DOC, 'link-fuori.stl'));
fs.symlinkSync(path.join(DOC, 'note.txt'), path.join(DOC, 'finto.stl'));
fs.symlinkSync(path.join(DOC, '.nascosta', 'x.stl'), path.join(DOC, 'link-nascosto.stl'));
fs.writeFileSync(path.join(DOC, 'enorme.stl'), '');
fs.truncateSync(path.join(DOC, 'enorme.stl'), 200 * 2 ** 20 + 1); // file sparso: 200 MB e un byte, senza occupare il disco

// I file del Nexus del repository che la prova non deve toccare
const VERI = ['ascolto.log', 'mcp.json', 'ologramma.json', 'ologramma-campo.bin', 'cervello.json'].map((f) => path.join(ROOT, 'runtime', f));
const impronta = (f) => { try { const s = fs.statSync(f); return `${s.size}:${s.mtimeMs}`; } catch { return 'assente'; } };
const primaVeri = VERI.map(impronta);

// ---------------------------------------------------------------- avvio
titolo('Avvio');
if (!esito(!(await porteOccupate()), `porte ${PORTA}, ${PW}, ${CDP} e ${VUOTA} libere prima di partire`)) process.exit(1);
const env = {
  ...process.env, NEXUS_PORT: String(PORTA), NEXUS_BROWSER_PORT: String(PW), NEXUS_CDP_PORT: String(CDP), NEXUS_NO_OPEN: '1',
  NEXUS_CERVELLO: CASA, NEXUS_APP: '', ELEVENLABS_API_KEY: '', GIPHY_API_KEY: '', // niente voce, niente GIF: niente rete né crediti
};
function avvia(altre = {}) { // il server di prova, con il suo registro
  const p = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...env, ...altre }, stdio: ['ignore', 'pipe', 'pipe'] });
  const srv = { p, registro: '', uscito: false };
  p.stdout.on('data', (d) => { srv.registro += d; });
  p.stderr.on('data', (d) => { srv.registro += d; });
  p.on('exit', () => { srv.uscito = true; });
  return srv;
}
const spegni = (srv) => { srv.p.kill('SIGTERM'); return attendi(() => srv.uscito, 10_000); };
let S1 = avvia();
const server = S1.p;
process.on('exit', () => { if (!S1.uscito) S1.p.kill('SIGTERM'); }); // anche se la prova cade a metà
const t0 = performance.now();
const online = await attendi(() => S1.registro.includes(`Nexus online su http://localhost:${PORTA}`), 20_000);
if (!esito(online, 'il server di prova è online', `${Math.round(performance.now() - t0)} ms`)) { console.log(S1.registro); process.exit(1); }

// ---------------------------------------------------------------- cervello: argomenti, persona, cartelle
titolo('Cervello');
const PERSONA = fs.readFileSync(path.join(ROOT, 'nexus-persona.md'), 'utf8');
const trovaClaude = async () => { for (const f of await figli(server.pid)) { const a = await argomenti(f); if (a?.includes('--input-format')) return { pid: f, a }; } return null; };
const claude = await attendi(trovaClaude, 10_000, 200);
if (esito(Boolean(claude), 'il processo claude del cervello è partito')) {
  const a = claude.a, dopo = (k) => a[a.indexOf(k) + 1];
  esito(dopo('--append-system-prompt') === PERSONA, 'la persona arriva intera, byte per byte', `${Buffer.byteLength(PERSONA)} B`);
  esito(/## Ologrammi/.test(dopo('--append-system-prompt')) && ['mostra_ologramma', 'modifica_ologramma', 'analizza_struttura'].every((n) => dopo('--append-system-prompt').includes(n)),
    'la persona ha la sezione Ologrammi con i tre strumenti');
  // Le ricerche sui pezzi passano da WebSearch e WebFetch: devono esserci e devono essere approvati, se no con
  // --permission-prompts none verrebbero negati in silenzio. Bash resta fuori.
  const strumenti = dopo('--tools').split(','), approvati = a.slice(a.indexOf('--allowedTools') + 1, a.indexOf('--disallowedTools'));
  esito(['WebSearch', 'WebFetch'].every((n) => strumenti.includes(n) && approvati.includes(n)) && !strumenti.includes('Bash') && approvati.includes('mcp__mac') && approvati.includes('mcp__playwright'),
    'il cervello ha WebSearch e WebFetch, approvati senza domande, e non ha Bash', `--tools ${dopo('--tools')}; --allowedTools ${approvati.join(' ')}`);
  esito(['WebSearch', 'materiale_vero', 'fattura'].every((n) => dopo('--append-system-prompt').includes(n)) && !dopo('--append-system-prompt').includes('`fonte`'),
    'la persona dice di cercare con WebSearch e nomina i due campi del pezzo, non più la fonte (tolta l\'11/11)');
  const dirs = a.slice(a.indexOf('--add-dir') + 1, a.indexOf('--mcp-config'));
  esito(dirs.length === 2 && dirs.includes(path.join(CASA, 'Desktop')) && dirs.includes(DOC) && a.indexOf('--add-dir') > 0,
    'le cartelle dei documenti sono quelle della prova', dirs.join(', '));
  esito(dopo('--mcp-config') === path.join(CASA, 'mcp.json'), 'mcp.json sta nella cartella della prova');
  const cfg = JSON.parse(fs.readFileSync(path.join(CASA, 'mcp.json'), 'utf8'));
  // --blender: i GLB di costruisci_in_blender vanno sotto i Documenti della prova, non in quelli di Tony
  esito(JSON.stringify(cfg.mcpServers.mac.args) === JSON.stringify([path.join(ROOT, 'mac', 'mac-mcp.mjs'), '--porta', String(PORTA), '--blender', path.join(CASA, 'Documents', 'Nexus-Blender')]) && cfg.mcpServers.playwright.url.includes(`:${PW}/`),
    'mcp.json lancia mac-mcp con --porta 4422 e i file di Blender nei Documenti della prova', cfg.mcpServers.mac.args.slice(1).join(' '));
  const cwd = (await sh('/usr/sbin/lsof', ['-a', '-p', String(claude.pid), '-d', 'cwd', '-Fn'])).split('\n').find((l) => l.startsWith('n'))?.slice(1);
  esito(cwd === fs.realpathSync(CASA), 'il cervello lavora nella cartella della prova', cwd);
  const mac = await attendi(async () => { for (const f of await figli(claude.pid)) { const x = await argomenti(f); if (x?.some((s) => s.endsWith('mac-mcp.mjs'))) return x; } return null; }, 20_000, 300);
  const iP = mac ? mac.indexOf('--porta') : -1;
  esito(iP >= 0 && mac[iP + 1] === String(PORTA), 'claude ha avviato mac-mcp con la porta di prova', mac ? mac.slice(iP).join(' ') : 'non trovato in 20 s');
}

// ---------------------------------------------------------------- richieste da fuori, limiti dei corpi
titolo('Sicurezza delle richieste');
let r = await chiedi('GET', '/api/status');
esito(r.codice === 200 && Number.isInteger(r.j?.ologramma), '/api/status da curl risponde e riporta ologramma', `ologramma: ${r.j?.ologramma}`);
const LOG = path.join(CASA, 'ascolto.log');
r = await chiedi('GET', '/api/status?hud=1&ear=on&lock=0&rec=ear&mic=0.100&mode=idle', { intestazioni: { 'sec-fetch-site': 'cross-site' } });
const r2 = await chiedi('HEAD', '/api/status?hud=1&ear=on', { intestazioni: { 'sec-fetch-site': 'cross-site' } });
esito(r.codice === 403 && r2.codice === 403 && !fs.existsSync(LOG), '/api/status da un altro sito: 403, anche con HEAD, e niente nel registro');
r = await chiedi('GET', '/api/ologramma', { intestazioni: { 'sec-fetch-site': 'same-site' } });
const r3 = await chiedi('GET', '/api/ologramma', { intestazioni: { 'sec-fetch-site': 'cross-site' } });
esito(r.codice === 403 && r3.codice === 403, 'GET /api/ologramma da un\'altra porta o da un altro sito: 403');
r = await chiedi('GET', '/api/ologramma', { intestazioni: { 'sec-fetch-site': 'same-origin' } });
esito(r.codice === 200 && r.h['cache-control'] === 'no-store' && r.j?.aperto === false, 'GET /api/ologramma dall\'HUD: 200, no-store');
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'chiudi' }, intestazioni: { origin: 'http://evil.example' } });
esito(r.codice === 403, 'POST da un\'origine estranea: 403');
// Previsione: la pagina dell'HUD dice al browser di non aprirsi dentro un'altra origine (prima partiva in un iframe di un sito qualsiasi)
r = await chiedi('GET', '/');
const r1b = await chiedi('GET', '/lab-ologramma.html');
esito(r.codice === 200 && r.h['x-frame-options'] === 'SAMEORIGIN' && r.h['content-security-policy'] === "frame-ancestors 'self'" && r1b.h['x-frame-options'] === 'SAMEORIGIN',
  "l'HUD non si apre in un iframe di un'altra origine: x-frame-options SAMEORIGIN e frame-ancestors 'self'", `${r.h['x-frame-options']} | ${r.h['content-security-policy']}`);
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'mostra', modello: { titolo: 'x', pezzi: [{ id: 'a', forma: 'sfera', misure: { r: 1 } }] } }, intestazioni: HUD });
esito(r.codice === 403 && /solo togli, rimetti e chiudi/.test(r.j?.errori?.[0]), 'dall\'HUD un «mostra» è rifiutato: 403', r.j?.errori?.[0]);

const riempi = (n) => Buffer.from(JSON.stringify({ line: 'x'.repeat(n) }));
const limiti = [
  ['/api/log', riempi(2e5), 'base 1e5, con content-length'],
  ['/api/ologramma', Buffer.from(JSON.stringify({ azione: 'modifica', x: 'y'.repeat(1.2e6) })), '1 MB'],
  ['/api/ologramma/foto', Buffer.from(JSON.stringify({ modello: 1, versione: 1, png: 'A'.repeat(2.3e6) })), '2 MB'],
];
for (const [rotta, corpo, nome] of limiti) {
  r = await chiedi('POST', rotta, { corpo }).catch((e) => ({ codice: e.code || e.message, ms: 0 })); // un reset invece della risposta è un FAIL
  esito(r.codice === 413 && r.ms < 1000, `${rotta} oltre il limite (${nome}): 413`, `${(corpo.length / 1e6).toFixed(2)} MB in ${Math.round(r.ms)} ms`);
}
const blocco = Buffer.from('x'.repeat(5e4));
r = await chiedi('POST', '/api/log', { pezzi: [Buffer.from('{"line":"'), blocco, blocco, blocco, Buffer.from('"}')] }).catch((e) => ({ codice: e.code || e.message, ms: 0 }));
esito(r.codice === 413, '/api/log a pezzi, senza content-length, oltre 1e5: 413', `${Math.round(r.ms)} ms`);
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'modifica', x: 'y'.repeat(9e5) } });
esito(r.codice === 400 || r.codice === 200, 'sotto il limite (0,9 MB su /api/ologramma) il corpo passa', `codice ${r.codice}`);
r = await chiedi('GET', '/api/status');
esito(r.codice === 200, 'dopo i 413 il server risponde ancora');

// ---------------------------------------------------------------- mostra, modifica, analizza via HTTP
titolo('Mostra, modifica e analizza via HTTP (come il processo MCP)');
const TRAVE = {
  titolo: 'Trave di prova', pezzi: [{ id: 'trave', forma: 'scatola', misure: { x: 100, y: 10, z: 10 }, materiale: 'alluminio-6061' }],
  carichi: [{ pezzo: 'trave', faccia: '+x', forza_N: 100, direzione: [0, -1, 0] }], vincoli: [{ pezzo: 'trave', faccia: '-x', tipo: 'incastro' }],
};
r = await cervello({ azione: 'mostra', modello: TRAVE });
let s = await stato();
esito(r.codice === 200 && r.j.ok === true && r.j.versione === s.versione && r.j.testo.startsWith(`Mostrato «Trave di prova» (modello ${s.modello}).`),
  'mostra: 200 { ok, versione, testo }', r.j?.testo?.split('\n')[0]);
esito(r.j.testo.includes('Ingombro 100 × 10 × 10 mm') && r.j.testo.includes('Massa 27 g') && r.j.testo.includes("Senza foto: l'HUD non è acceso") && !('foto' in r.j),
  'il testo dice ingombro, massa (10.000 mm³ × 2700 kg/m³ = 27 g) e che la foto non c\'è');
esito(s.aperto === true && s.pezzi.length === 1 && Math.abs(s.massa_kg - 0.027) < 1e-12, 'lo stato è aperto, con un pezzo e 0,027 kg');
r = await cervello({ azione: 'modifica', vista: { esploso: 0.5 } });
esito(r.codice === 200 && r.j.testo.startsWith('Fatto: vista.') && r.j.testo.includes('esploso 0,5'), 'modifica della vista', r.j?.testo?.split('\n')[0]);
r = await cervello({ azione: 'modifica', vista: { modo: 'arcobaleno' } });
esito(r.codice === 400 && r.j.ok === false && Array.isArray(r.j.errori) && /modo/.test(r.j.errori.join(' ')) && !('testo' in r.j), 'modifica sbagliata: 400 { ok: false, errori }', r.j?.errori?.[0]);

// Previsione scritta prima: trave a sbalzo 100 × 10 × 10 mm in 6061 (E 68900), 100 N in punta. Freccia di Eulero-Bernoulli
// F·L³/(3·E·I) = 0,5806 mm, attesa fra −1% e +3,5% (taglio e voxel); sforzo all'incastro 60 MPa, atteso fra 50 e 100 MPa
// (centri dei voxel sotto, spigolo dell'incastro sopra); tempo sotto 10 s.
r = await cervello({ azione: 'analizza' });
s = await stato();
const A = s.analisi;
esito(r.codice === 200 && A?.stato === 'fatta' && r.j.versione === s.versione, 'analizza aspetta la fine del calcolo', `${Math.round(r.ms)} ms, calcolo ${A?.tempo_s?.toFixed(2)} s, ${A?.voxel} voxel`);
if (A?.stato === 'fatta') {
  const freccia = A.spostamento_max_mm, teoria = (100 * 100 ** 3) / (3 * 68900 * ((10 * 10 ** 3) / 12));
  esito(freccia > teoria * 0.99 && freccia < teoria * 1.035, 'freccia della trave come la teoria', `${freccia.toFixed(4)} mm contro ${teoria.toFixed(4)} (${(((freccia / teoria) - 1) * 100).toFixed(2)}%)`);
  esito(A.sforzo_max_MPa > 50 && A.sforzo_max_MPa < 100 && Math.abs(A.fs_min - 240 / A.sforzo_max_MPa) < 1e-9, 'sforzo massimo e fattore di sicurezza plausibili', `${A.sforzo_max_MPa.toFixed(1)} MPa, fs ${A.fs_min.toFixed(2)}`);
  esito(r.j.testo.includes(`sforzo massimo ${N3.format(A.sforzo_max_MPa)} MPa`) && r.j.testo.includes(`spostamento massimo ${N3.format(freccia)} mm`) &&
    r.j.testo.includes('Attenzione: stima statica lineare'), 'il testo porta gli stessi numeri dello stato e la riga d\'onestà');
  esito(r.j.testo.startsWith('Analisi degli sforzi finita.') && !/avviata/.test(r.j.testo), 'la risposta che porta i numeri non dice «avviata»', r.j.testo.split('\n')[0]);
  // il campo: fs per voxel, nx·ny·nz Float32
  const c = A.campo, n = c.nx * c.ny * c.nz;
  r = await chiedi('GET', `/api/ologramma/campo?v=${c.versione}`);
  const f = r.codice === 200 ? new Float32Array(r.b.buffer.slice(r.b.byteOffset, r.b.byteOffset + r.b.length)) : new Float32Array(0);
  const pieni = f.filter((v) => v > 0), minimo = pieni.reduce((m, v) => Math.min(m, v), Infinity);
  esito(r.codice === 200 && r.b.length === 4 * n && r.h['content-type'] === 'application/octet-stream', 'il campo ha la dimensione giusta', `${c.nx}×${c.ny}×${c.nz} = ${n} valori, ${r.b.length} B`);
  esito(pieni.length === A.voxel && f.every((v) => v === -1 || v > 0) && Math.abs(minimo - A.fs_min) <= 1e-6 * A.fs_min, 'nel campo: un valore per voxel pieno, −1 nel vuoto, il minimo è fs_min', `${pieni.length} pieni, minimo ${minimo.toFixed(4)}`);
  r = await chiedi('GET', `/api/ologramma/campo?v=${c.versione + 1}`);
  esito(r.codice === 409, 'il campo di un\'altra versione no: 409');
}

// ---------------------------------------------------------------- gli strumenti su stdio
titolo('Strumenti MCP su stdio (node mac/mac-mcp.mjs --porta 4422)');
const M = mcp();
const init = await M.chiama('initialize', { protocolVersion: '2025-06-18' });
const lista = (await M.chiama('tools/list', {})).result?.tools || [];
const per = Object.fromEntries(lista.map((t) => [t.name, t]));
esito(init.result?.serverInfo?.name === 'nexus-mac' && ['mostra_ologramma', 'modifica_ologramma', 'analizza_struttura'].every((n) => per[n]?.inputSchema?.type === 'object'),
  'tools/list ha i tre strumenti degli ologrammi');
const P = per.mostra_ologramma?.inputSchema?.properties?.pezzi?.items?.properties;
esito(JSON.stringify(P?.materiale?.enum) === JSON.stringify(Object.keys(MATERIALI)) && JSON.stringify(per.analizza_struttura?.inputSchema?.properties?.carichi?.items?.properties?.faccia?.enum) === JSON.stringify([...FACCE]) &&
  /mm/.test(P?.misure?.description) && per.modifica_ologramma?.inputSchema?.properties?.vista?.properties?.modo?.enum?.includes('raggi-x'),
  'gli schemi hanno le chiavi dei materiali, le facce, le misure in mm e i modi');
esito(['materiale_vero', 'fattura'].every((k) => P?.[k]?.type === 'string' && /al massimo (60|140)/.test(P[k].description)) && /chiave del calcolo/.test(P?.materiale?.description) && P && !('fonte' in P),
  'lo schema del pezzo ha materiale_vero e fattura, non la fonte, e distingue la chiave del calcolo dal materiale vero');
{ // il campo colore (11/11): lo schema accetta quello che accetta forme.js, e la descrizione dice quando usarlo
  const re = P?.colore?.pattern ? new RegExp(P.colore.pattern) : null;
  esito(P?.colore?.type === 'string' && re && ['#e53935', '#E53935', '#fff'].every((c) => re.test(c)) && !['rosso', 'e53935', '#12345', '#e539351'].some((c) => re.test(c)) &&
    /Tony lo chiede/.test(P.colore.description) && /ciano/.test(P.colore.description),
    'lo schema del pezzo ha colore: esadecimale #rgb o #rrggbb, e la descrizione dice quando usarlo e cosa c\'è senza', P?.colore ? `${P.colore.pattern} — ${P.colore.description}` : 'manca');
}
// Le definizioni stanno nel contesto del cervello a ogni domanda. Prima dei campi di ricerca i tre strumenti pesavano 8.441 B
// (misurati sul tools/list del 10/11): il tetto lascia 700 B ai campi nuovi, e chi li gonfia lo vede qui. Il colore dei pezzi
// (11/11) ne ha presi 204, da 8.872 a 9.076 B: ne restano 65.
const pesoOlo = Buffer.byteLength(JSON.stringify(lista.filter((x) => ['mostra_ologramma', 'modifica_ologramma', 'analizza_struttura'].includes(x.name))));
esito(pesoOlo <= 8441 + 700, 'i tre strumenti degli ologrammi restano entro 9.141 B', `${pesoOlo} B; tools/list intero ${Buffer.byteLength(JSON.stringify(lista))} B`);
const MO = per.modifica_ologramma?.inputSchema?.properties;
esito(MO?.titolo?.type === 'string' && MO?.descrizione?.type === 'string' && /titolo/.test(per.modifica_ologramma?.description) && !/\bsicur[oa]\b/i.test(JSON.stringify(lista)),
  'modifica_ologramma cambia anche titolo e descrizione; nessuno strumento chiama «sicuro» un colore');
const STAFFA = {
  titolo: 'Staffa', pezzi: [
    { id: 'base', nome: 'Base', forma: 'scatola', misure: { x: 60, y: 6, z: 40 }, materiale: 'acciaio-s235' },
    { id: 'braccio', nome: 'Braccio', forma: 'scatola', misure: { x: 6, y: 50, z: 40 }, posizione: [-27, 28, 0], materiale: 'acciaio-s235' },
  ],
};
let t = await M.strumento('mostra_ologramma', STAFFA);
s = await stato();
esito(!t.errore && t.testo.startsWith(`Mostrato «Staffa» (modello ${s.modello}).`) && t.contenuto.length === 1, 'mostra_ologramma', t.testo.split('\n')[0]);
esito(t.testo.includes('2 pezzi.') && t.testo.includes('Ingombro 60 × 56 × 40 mm') && t.testo.includes('Massa 207 g'),
  'il testo dello strumento: 2 pezzi, 60 × 56 × 40 mm, 207 g (26.400 mm³ di S235)');
t = await M.strumento('modifica_ologramma', { titolo: 'Staffa in S235', descrizione: 'Base e braccio.' });
s = await stato();
esito(!t.errore && t.testo.startsWith('Fatto: titolo, descrizione.') && s.titolo === 'Staffa in S235' && s.descrizione === 'Base e braccio.', 'modifica_ologramma cambia titolo e descrizione', t.testo.split('\n')[0]);
// La ricerca sui pezzi: i due campi arrivano allo stato, la riga dice cosa manca, un testo vuoto li toglie
const rigaMateriali = (x) => x.split('\n').find((l) => l.startsWith('Materiali:')) || '';
t = await M.strumento('modifica_ologramma', { cambia: [{ id: 'base', materiale_vero: 'acciaio S235JR zincato', fattura: 'tagliata al laser e piegata' }, { id: 'braccio', materiale_vero: 'acciaio S235JR' }] });
s = await stato();
esito(!t.errore && s.pezzi[0].materiale_vero === 'acciaio S235JR zincato' && s.pezzi[0].fattura === 'tagliata al laser e piegata' && !('fonte' in s.pezzi[0]) && s.pezzi[0].materiale === 'acciaio-s235' &&
  rigaMateriali(t.testo) === 'Materiali: 2 pezzi su 2 hanno il materiale. Senza fattura: «braccio».',
  'cambia con materiale_vero e fattura: stanno nello stato, e il testo dice cosa manca', rigaMateriali(t.testo));
t = await M.strumento('modifica_ologramma', { cambia: [{ id: 'base', materiale_vero: '', fattura: '' }, { id: 'braccio', materiale_vero: '' }] });
s = await stato();
esito(!t.errore && s.pezzi.every((p) => p.materiale_vero === null && p.fattura === null) && rigaMateriali(t.testo) === '', 'un testo vuoto toglie i campi, e senza niente da dire la riga sparisce');
await M.strumento('modifica_ologramma', { titolo: 'Staffa', descrizione: '' });
t = await M.strumento('modifica_ologramma', { togli: ['braccio'] });
esito(!t.errore && t.testo.startsWith('Fatto: tolti «braccio».') && t.testo.includes('di cui 1 tolto'), 'modifica_ologramma togli', t.testo.split('\n')[0]);
t = await M.strumento('modifica_ologramma', { rimetti: ['braccio'], vista: { esploso: 1, sezione: { asse: 'z', posizione: 0 }, modo: 'raggi-x' } });
s = await stato();
esito(!t.errore && s.tolti.length === 0 && s.vista.esploso === 1 && s.vista.sezione?.verso === 1 && s.vista.modo === 'raggi-x', 'modifica_ologramma: rimetti, esploso, sezione e raggi X', t.testo.split('\n')[0]);
t = await M.strumento('modifica_ologramma', {});
esito(!t.errore && t.testo.startsWith('Ologramma «Staffa», aperto') && t.testo.includes('Foto: nessuna nuova'), 'modifica_ologramma senza campi: lo stato in testo', t.testo.split('\n')[0]);
t = await M.strumento('modifica_ologramma', { chiudi: true, vista: { esploso: 0 } });
esito(t.errore && /chiudi va mandato da solo/.test(t.testo) && (await stato()).vista.esploso === 1, 'chiudi insieme ad altro: errore, niente cambiato');
t = await M.strumento('modifica_ologramma', { chiudi: true });
esito(!t.errore && t.testo.startsWith('Ologramma chiuso.') && (await stato()).aperto === false && t.contenuto.length === 1, 'modifica_ologramma chiudi', t.testo.split('\n')[0]);
t = await M.strumento('modifica_ologramma', { vista: {} });
esito(!t.errore && (await stato()).aperto === true, 'una modifica con vista {} lo riapre');
t = await M.strumento('mostra_ologramma', { titolo: 'Rotto', pezzi: [{ id: 'x', forma: 'cubo', misure: { r: -1 } }] });
esito(t.errore && t.testo.startsWith('Niente è cambiato (il server ha risposto 400):\n- ') && (await stato()).titolo === 'Staffa', 'errori del server riportati così come sono', t.testo.split('\n')[1]);
t = await M.strumento('analizza_struttura', {});
esito(t.errore && /manca un vincolo/.test(t.testo) && /manca un carico/.test(t.testo), 'analizza senza vincoli né carichi: dice cosa manca', t.testo.split('\n').slice(1, 3).join(' | '));
t = await M.strumento('analizza_struttura', {
  vincoli: [{ pezzo: 'base', faccia: '-y', tipo: 'incastro' }], carichi: [{ pezzo: 'braccio', faccia: '+y', forza_N: 500, direzione: [1, 0, 0] }],
});
s = await stato();
esito(!t.errore && s.analisi?.stato === 'fatta' && t.testo.includes(`Analisi degli sforzi (versione ${s.analisi.versione})`) &&
  t.testo.includes(`sforzo massimo ${N3.format(s.analisi.sforzo_max_MPa)} MPa`) && t.testo.includes('Attenzione: stima statica lineare'),
  'analizza_struttura aspetta il risultato e lo racconta', `${Math.round(t.ms)} ms, ${N3.format(s.analisi.sforzo_max_MPa)} MPa, fs ${N3.format(s.analisi.fs_min)}`);
const V = mcp(String(VUOTA)), X = mcp('abc');
t = await V.strumento('modifica_ologramma', {});
const t2 = await X.strumento('modifica_ologramma', {});
esito(t.errore && t.testo.includes(`non risponde sulla porta ${VUOTA}`) && t2.errore && /porta di Nexus negli argomenti non è valida/.test(t2.testo),
  'server spento o porta sbagliata: lo strumento lo dice', `${t.testo.slice(0, 70)}… | ${t2.testo.slice(0, 60)}…`);
await Promise.all([V.chiudi(), X.chiudi()]);

// ---------------------------------------------------------------- file 3D
titolo('File 3D (GET /api/ologramma/file/<modello>/<id>)');
const file = (id, f) => ({ id, forma: 'file', misure: { file: f } });
const FILE = {
  titolo: 'File', pezzi: [
    { id: 'box', forma: 'scatola', misure: { x: 1, y: 1, z: 1 } },
    file('ok', path.join(DOC, 'pezzo.stl')), file('fuori', path.join(FUORI, 'segreto.stl')), file('link-fuori', path.join(DOC, 'link-fuori.stl')),
    file('finto', path.join(DOC, 'finto.stl')), file('nascosto', path.join(DOC, 'link-nascosto.stl')), file('cartella', path.join(DOC, 'cartella.stl')),
    file('enorme', path.join(DOC, 'enorme.stl')), file('manca', path.join(DOC, 'manca.stl')),
  ],
};
r = await cervello({ azione: 'mostra', modello: { titolo: 'Txt', pezzi: [file('t', path.join(DOC, 'note.txt'))] } });
esito(r.codice === 400 && /estensione|glb/.test(r.j.errori.join(' ')), 'un file .txt non entra nemmeno nel modello: 400', r.j?.errori?.[0]);
r = await cervello({ azione: 'mostra', modello: FILE });
const MF = (await stato()).modello;
esito(r.codice === 200 && r.j.testo.includes(`(modello ${MF})`), 'modello con nove pezzi, otto da file', `modello ${MF}`);
const casi = [
  ['ok', 200, 'dentro Documents'], ['fuori', 403, 'fuori dalle cartelle'], ['link-fuori', 403, 'link simbolico verso fuori'],
  ['finto', 403, 'link verso un .txt (estensione vera vietata)'], ['nascosto', 403, 'link verso una cartella nascosta'],
  ['cartella', 403, 'una cartella che si chiama .stl'], ['enorme', 413, 'oltre 200 MB'], ['manca', 404, 'che non c\'è'], ['box', 404, 'pezzo che non è un file'],
];
for (const [id, atteso, nome] of casi) {
  r = await chiedi('GET', `/api/ologramma/file/${MF}/${id}`, { intestazioni: { 'sec-fetch-site': 'same-origin' } });
  esito(r.codice === atteso, `file ${nome}: ${atteso}`, `codice ${r.codice}${r.codice === 200 ? `, ${r.b.length} B` : ''}`);
  if (id === 'ok' && r.codice === 200) {
    esito(r.b.toString('utf8') === STL && r.h['x-content-type-options'] === 'nosniff' && r.h['cross-origin-resource-policy'] === 'same-origin' &&
      r.h['content-type'] === 'model/stl', 'il file arriva intero, con nosniff, same-origin e model/stl');
  }
}
r = await chiedi('GET', `/api/ologramma/file/${MF - 1}/ok`);
const r4 = await chiedi('GET', `/api/ologramma/file/${MF}/ok`, { intestazioni: { 'sec-fetch-site': 'cross-site' } });
const r5 = await chiedi('GET', `/api/ologramma/file/${MF}/..%2F..%2Fetc`);
esito(r.codice === 404 && r4.codice === 403 && r5.codice === 404, 'modello vecchio 404, altro sito 403, id strano 404');

// ---------------------------------------------------------------- azioni dell'HUD
titolo('Azioni dell\'HUD (togli, rimetti, chiudi)');
s = await stato();
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'togli', id: 'box', modello: s.modello }, intestazioni: HUD });
esito(r.codice === 200 && r.j.ok && r.j.versione === s.versione + 1 && !('testo' in r.j) && (await stato()).tolti.includes('box'), 'togli dall\'HUD: 200 { ok, versione }');
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'rimetti', id: 'box', modello: s.modello }, intestazioni: HUD });
esito(r.codice === 200 && (await stato()).tolti.length === 0, 'rimetti dall\'HUD');
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'togli', id: 'box', modello: s.modello - 1 }, intestazioni: HUD });
esito(r.codice === 409 && r.j.ok === false && r.j.stato?.modello === s.modello && Array.isArray(r.j.stato?.pezzi), 'modello vecchio: 409 con lo stato', r.j?.errori?.[0]);
r = await chiedi('POST', '/api/ologramma', { corpo: { azione: 'chiudi', modello: s.modello }, intestazioni: HUD });
t = await M.strumento('modifica_ologramma', {});
esito(r.codice === 200 && (await stato()).aperto === false && t.testo.startsWith('Ologramma «File», chiuso da Tony con Esc'), 'Esc nell\'HUD: il cervello sa che l\'ha chiuso Tony', t.testo.split('\n')[0]);

// ---------------------------------------------------------------- foto
titolo('Foto (l\'HUD finto: /api/status?hud=1, poi POST /api/ologramma/foto)');
const vedoHud = () => chiedi('GET', '/api/status?hud=1&ear=on&lock=0&rec=ear&mic=0.000&mode=idle', { intestazioni: { 'sec-fetch-site': 'same-origin' } });
r = await vedoHud();
esito(r.codice === 200 && fs.existsSync(LOG) && fs.readFileSync(LOG, 'utf8').includes('HUD: ascolto=on'), 'l\'HUD è visto, e il registro va nella cartella della prova');
// Previsione: con l'HUD acceso e nessuna foto il server aspetta 8 s dopo mostra (l'entrata di un modello nuovo dura 3 s)
// e 4 s dopo una modifica, poi lo dice
t = await M.strumento('mostra_ologramma', STAFFA);
esito(!t.errore && !t.foto && t.testo.endsWith("Senza foto: l'HUD non l'ha mandata entro 8 s.") && t.ms > 7900 && t.ms < 8800, 'HUD acceso ma foto che non arriva: dopo mostra aspetta 8 s e lo dice', `${Math.round(t.ms)} ms`);
await vedoHud();
t = await M.strumento('modifica_ologramma', { vista: { esploso: 0.2 } });
esito(!t.errore && !t.foto && t.testo.endsWith("Senza foto: l'HUD non l'ha mandata entro 4 s.") && t.ms > 3900 && t.ms < 4800, 'dopo una modifica aspetta 4 s', `${Math.round(t.ms)} ms`);
const v0 = (await stato()).versione;
const FOTO = png(8, 5);
const scatto = async () => { // come l'HUD: aspetta la versione nuova, poi manda la foto
  const st = await attendi(async () => { const x = await stato(); return x.versione > v0 && x; }, 5000, 30);
  const t1 = performance.now(), rr = await chiedi('POST', '/api/ologramma/foto', { corpo: { modello: st.modello, versione: st.versione, png: FOTO.toString('base64') }, intestazioni: HUD });
  return { ...rr, t1 };
};
// Previsione: la risposta dello strumento arriva entro 300 ms dalla foto
const [tf, rf] = await Promise.all([M.strumento('modifica_ologramma', { vista: { modo: 'solido' } }).then((x) => ({ ...x, t2: performance.now() })), scatto()]);
esito(rf.codice === 204 && !tf.errore && tf.foto?.mimeType === 'image/png' && tf.foto.data === FOTO.toString('base64') && tf.contenuto[0].type === 'text' && tf.t2 - rf.t1 < 300,
  'lo strumento restituisce [testo, foto PNG] appena la foto arriva', `strumento ${Math.round(tf.ms)} ms, ${Math.round(tf.t2 - rf.t1)} ms dopo la foto`);
s = await stato();
t = await M.strumento('modifica_ologramma', {});
esito(t.foto?.data === FOTO.toString('base64'), 'senza cambi torna l\'ultima foto della stessa versione');
r = await chiedi('POST', '/api/ologramma/foto', { corpo: { modello: s.modello, versione: s.versione - 1, png: FOTO.toString('base64') }, intestazioni: HUD });
esito(r.codice === 409, 'foto di una versione vecchia: 409');
const sbagliate = [['non è base64', 'non base64!'], ['non è un PNG', Buffer.from('GIF89a, non un png, ma abbastanza lungo').toString('base64')],
  ['larga 961 px', png(961, 2).toString('base64')], ['oltre 1,5 MB', png(4, 3, 1.5e6).toString('base64')]];
for (const [nome, dati] of sbagliate) {
  r = await chiedi('POST', '/api/ologramma/foto', { corpo: { modello: s.modello, versione: s.versione, png: dati }, intestazioni: HUD });
  esito(r.codice === 400, `foto ${nome}: 400`);
}
await vedoHud();
r = await cervello({ azione: 'mostra', modello: FILE });
esito(r.codice === 200 && r.j.testo.endsWith("Senza foto: l'HUD non l'ha mandata entro 8 s.") && r.ms > 7900 && r.ms < 8800, 'con pezzi da file aspetta 8 s', `${Math.round(r.ms)} ms`);

// ---------------------------------------------------------------- la misura delle mani
titolo('Misura delle mani: dall\'HUD solo numeri, una riga nel registro del server');
const MISURA = { azione: 'misura', secondi: 42, fps: { mediana: 55, p10: 48, minimo: 46 }, detect_ms: 21.4 };
const RIGA = '[ologramma] mani accese 42 s: fps mediana 55, p10 48, minimo 46, detect 21 ms';
r = await chiedi('POST', '/api/ologramma', { corpo: MISURA, intestazioni: HUD });
await attendi(() => S1.registro.includes(RIGA), 1000);
esito(r.codice === 204 && S1.registro.split('\n').filter((l) => l === RIGA).length === 1, 'la misura arriva: 204 e una riga sola nel registro', RIGA);
const storte = [['fps non numerici', { ...MISURA, fps: { mediana: '55', p10: 48, minimo: 46 } }], ['secondi infiniti', { ...MISURA, secondi: 1e400 }],
  ['meno di 10 s', { ...MISURA, secondi: 9 }], ['fps oltre il limite', { ...MISURA, fps: { mediana: 1e6, p10: 48, minimo: 46 } }], ['detect negativo', { ...MISURA, detect_ms: -1 }],
  ['testo al posto della prova', { ...MISURA, prova: 'ciao [memoria]' }], ['fps che mancano', { ...MISURA, fps: null }]];
const lunghezza = S1.registro.length;
for (const [nome, corpo] of storte) {
  r = await chiedi('POST', '/api/ologramma', { corpo, intestazioni: HUD });
  esito(r.codice === 400, `misura con ${nome}: 400`);
}
r = await chiedi('POST', '/api/ologramma', { corpo: MISURA }); // come il processo MCP: niente intestazioni dell'HUD
await pausa(200);
esito(r.codice === 400 && S1.registro.length === lunghezza && !S1.registro.slice(lunghezza).includes('mani accese'), 'dal cervello la misura non passa, e le storte non scrivono niente', `codice ${r.codice}`);
r = await chiedi('POST', '/api/ologramma', { corpo: { ...MISURA, secondi: 12, prova: true, detect_ms: null }, intestazioni: HUD });
await attendi(() => S1.registro.includes('mani accese 12 s (foto di prova'), 1000);
esito(r.codice === 204 && S1.registro.includes('[ologramma] mani accese 12 s (foto di prova al posto della fotocamera): fps mediana 55, p10 48, minimo 46, detect —\n'),
  'con la foto di prova la riga lo dice');
// le misure dei gesti vanno in coda alla stessa riga; storte, si scartano loro e la riga degli fps resta (regola dei 45 fps)
r = await chiedi('POST', '/api/ologramma', { corpo: { ...MISURA, secondi: 13, gesti: { inneschi: 5, scaduti: 2, profilo: 0.22 } }, intestazioni: HUD });
await attendi(() => S1.registro.includes('mani accese 13 s'), 1000);
esito(r.codice === 204 && S1.registro.includes('[ologramma] mani accese 13 s: fps mediana 55, p10 48, minimo 46, detect 21 ms; inneschi 5 (scaduti 2); profilo 22%\n'),
  'le misure dei gesti in coda alla stessa riga');
r = await chiedi('POST', '/api/ologramma', { corpo: { ...MISURA, secondi: 14, gesti: { profilo: 1.5, ignota: 1 } }, intestazioni: HUD });
await attendi(() => S1.registro.includes('mani accese 14 s'), 1000);
esito(r.codice === 204 && S1.registro.includes('[ologramma] mani accese 14 s: fps mediana 55, p10 48, minimo 46, detect 21 ms; misure dei gesti scartate (storte)\n'),
  'gesti storti: si scartano loro, la riga degli fps resta');

// ---------------------------------------------------------------- MediaPipe e modello delle mani
titolo('MediaPipe e modello delle mani');
const WASM = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm', 'vision_wasm_internal.wasm');
r = await chiedi('GET', '/mediapipe/wasm/vision_wasm_internal.wasm', { intestazioni: { 'sec-fetch-site': 'same-origin' } });
esito(r.codice === 200 && r.h['content-type'] === 'application/wasm' && r.b.length === fs.statSync(WASM).size, '/mediapipe/ serve il wasm come application/wasm', `${r.b.length} B`);
r = await chiedi('GET', '/mediapipe/vision_bundle.mjs');
const r6 = await chiedi('GET', '/mediapipe/vision_bundle.mjs', { intestazioni: { 'sec-fetch-site': 'cross-site' } });
esito(r.codice === 200 && r.h['content-type'] === 'text/javascript' && r6.codice === 403, 'il bundle .mjs come JavaScript; da un altro sito 403');
r = await chiedi('GET', '/modelli/hand_landmarker.task');
const sha = createHash('sha256').update(r.b).digest('hex');
esito(r.codice === 200 && r.b.length === MODELLO_MANI.byte && sha === MODELLO_MANI.sha256 && r.h['content-type'] === 'application/octet-stream', 'il modello delle mani, con byte e SHA-256 giusti', `${r.b.length} B`);
r = await chiedi('GET', '/modelli/prova-mani.jpg');
const r7 = await chiedi('GET', '/modelli/stem-mac');
esito(r.codice === 200 && r.h['content-type'] === 'image/jpeg' && r7.codice === 404, 'la foto di prova come image/jpeg; il resto di runtime/ no');
esito(!/\[mani\]/.test(S1.registro), 'con il modello già lì il server non scarica niente');

// ---------------------------------------------------------------- spegnimento
titolo('Spegnimento e riavvio');
await M.chiudi();
const prima = await stato();
const fermo = await spegni(S1);
esito(fermo && prima.aperto === true, 'SIGTERM con l\'ologramma aperto: il server si ferma');
// Previsione: al riavvio lo stesso modello c'è ancora, chiuso, con una versione in più; nessuna conversazione da riprendere
S1 = avvia();
const ancora = await attendi(() => S1.registro.includes(`Nexus online su http://localhost:${PORTA}`), 20_000);
const dopo = ancora ? await stato() : null;
esito(dopo && dopo.modello === prima.modello && dopo.aperto === false && dopo.versione === prima.versione + 1 && dopo.pezzi.length === prima.pezzi.length,
  'al riavvio l\'ologramma rimasto aperto torna chiuso, con lo stesso modello', dopo ? `modello ${dopo.modello}, versione ${prima.versione} → ${dopo.versione}` : 'non riparte');
esito(!/riprendo la conversazione/.test(S1.registro) && !fs.existsSync(path.join(CASA, 'cervello.json')), 'senza domande non c\'è una conversazione da riprendere');
await spegni(S1);

// ---------------------------------------------------------------- cervello finto: report e browser coprono l'ologramma
titolo("Report e browser chiudono l'ologramma anche nel server (cervello finto, Chrome headless sulla 9334)");
// Il cervello finto parla stream-json come claude -p, senza modello né rete: «report» chiama mostra_report con un blocco,
// «vuoto» senza blocchi, «browser» scrive [[mostra]]. Il Chrome headless sulla 9334 c'è perché /api/ask apre la finestra
// di Google se non la trova: senza, partirebbe un Chrome vero sullo schermo.
const FINTO = `#!/usr/bin/env node
const readline = require('readline');
const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: '00000000-0000-4000-8000-000000004422' }) + '\\n');
const testo = (s) => { out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: s } } }); out({ type: 'stream_event', event: { type: 'content_block_stop' } }); };
const report = (blocchi) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_prova', name: 'mcp__mac__mostra_report', input: { titolo: 'Prova', blocchi } }] } });
const ricerca = () => out({ type: 'assistant', message: { content: [
  { type: 'tool_use', id: 'toolu_w0', name: 'WebSearch', input: { query: 'parolasegreta teardown' } },
  ...['https://www.ifixit.com/Teardown/parolasegreta/1?q=parolasegreta', 'https://support.apple.com/it-it/parolasegreta', 'https://www.apple.com/environment/pdf/parolasegreta.pdf', 'https://en.wikipedia.org/wiki/parolasegreta', 'non un indirizzo']
    .map((url, i) => ({ type: 'tool_use', id: 'toolu_w' + (i + 1), name: 'WebFetch', input: { url, prompt: 'parolasegreta: di che materiale è?' } })),
] } });
out({ type: 'system', subtype: 'init' });
let effort = 'quello di --effort';
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === 'control_request' && m.request && m.request.subtype === 'apply_flag_settings') {
    effort = m.request.settings.effortLevel;
    return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
  }
  if (m.type !== 'user') return;
  const t = String(m.message && m.message.content || '');
  if (t.includes('[memoria]')) testo('fatto.');
  else if (/\\bvuoto\\b/.test(t)) report([]);
  else if (/\\breport\\b/.test(t)) report([{ tipo: 'testo', titolo: 'Uno', testo: 'Prova.' }]);
  else if (/\\bricerca\\b/.test(t)) { ricerca(); testo('Trovato.'); }
  else if (/\\bbrowser\\b/.test(t)) testo('Cerco. [[mostra]] Un attimo.');
  else if (t.includes('[pensa]')) testo('Fatto a fondo, effort ' + effort + '.');
  else if (/\\bpensaci\\b/.test(t)) testo('Te lo costruisco. [[pensa]]');
  else if (/\\bquale effort\\b/.test(t)) testo('Effort ' + effort + '.');
  else if (/\\bperche\\b/.test(t)) testo(t.includes('\\n[sentito: col nome]\\n') ? 'Riga col nome.' : 'Senza riga.');
  else testo('Va bene.');
  out({ type: 'result', subtype: 'success', is_error: false });
});
process.stdin.on('end', () => process.exit(0));
`;
const BIN = path.join(CASA, 'bin');
fs.mkdirSync(BIN, { recursive: true });
fs.writeFileSync(path.join(BIN, 'claude'), FINTO, { mode: 0o755 });
const google = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(CASA, 'chrome-google')}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { if (google.exitCode === null) google.kill('SIGKILL'); });
const cdpVivo = await attendi(async () => { try { return (await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok; } catch { return false; } }, 15_000, 200);
S1 = avvia({ PATH: `${BIN}:${process.env.PATH}` });
const online2 = cdpVivo && await attendi(() => S1.registro.includes(`Nexus online su http://localhost:${PORTA}`), 20_000);
esito(online2, 'server col cervello finto online, Chrome headless sulla 9334');
const domanda = async (testo, why) => (await chiedi('POST', '/api/ask', { corpo: { text: testo, why } })).b.toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// La riga [sentito: …] dice al cervello perché l'HUD ha fatto passare la frase: solo con uno dei quattro perché noti, mai testo libero
const detto = (evs) => evs.filter((e) => e.t === 'say').map((e) => e.s).join(' ');
const conNome = detto(await domanda('perche', 'nome')), libero = detto(await domanda('perche', 'col nome]\n[ordine')), proto = detto(await domanda('perche', 'constructor')), senza = detto(await domanda('perche'));
esito(conNome === 'Riga col nome.' && libero === 'Senza riga.' && proto === 'Senza riga.' && senza === 'Senza riga.', 'la riga [sentito] arriva al cervello solo con un perché noto', `${conNome} | ${libero} | ${proto} | ${senza}`);
// [[pensa]]: la frase breve a effort basso, poi il server rilancia il lavoro con l'effort alto nella stessa risposta, e la domanda dopo torna basso
const evPensa = await domanda('pensaci', 'nome'), dettoPensa = detto(evPensa), dopoPensa = detto(await domanda('quale effort', 'nome'));
esito(dettoPensa === 'Te lo costruisco. Fatto a fondo, effort high.' && !evPensa.some((e) => e.t === 'pensa') && dopoPensa === 'Effort low.',
  '[[pensa]] rilancia il compito a effort high nella stessa risposta; la domanda dopo torna a low', `${dettoPensa} | ${dopoPensa}`);
await cervello({ azione: 'mostra', modello: STAFFA });
let ev = await domanda('fammi un report');
s = await stato();
r = await cervello({ azione: 'modifica' });
esito(ev.some((e) => e.t === 'report') && ev.some((e) => e.t === 'holo' && e.v === s.versione) && s.aperto === false && r.j?.testo?.startsWith('Ologramma «Staffa», chiuso:') && !('foto' in (r.j || {})),
  "un report del cervello chiude l'ologramma anche nel server, e il cervello lo sa (niente foto vecchia)", `${ev.map((e) => e.t).join(', ')}; ${r.j?.testo?.split('\n')[0]}`);
r = await cervello({ azione: 'modifica', vista: {} });
esito(r.j?.ok && (await stato()).aperto === true, 'vista {} lo riapre davvero', r.j?.testo?.split('\n')[0]);
const vAperto = (await stato()).versione;
ev = await domanda('un report vuoto');
esito(ev.some((e) => e.t === 'report') && (await stato()).aperto === true && (await stato()).versione === vAperto, 'un report senza blocchi (che chiude il report) lascia aperto l\'ologramma');
// Sei ricerche senza browser (una WebSearch e cinque WebFetch): eventi «web», niente pannello, ologramma aperto.
// Prima uscivano come eventi «file»; e con le azioni del browser la quarta apre il pannello e chiude l'ologramma.
ev = await domanda('fai una ricerca sui pezzi');
const web = ev.filter((e) => e.t === 'web');
esito(web.map((e) => e.name).join() === 'ricerca,pagina,pagina,pagina,pagina,pagina' && web.map((e) => e.detail).join() === ',ifixit.com,support.apple.com,apple.com,en.wikipedia.org,' && !ev.some((e) => e.t === 'file' || e.t === 'tool'),
  'WebSearch e WebFetch escono come eventi «web»: ricerca senza dettaglio, pagina col solo nome del sito', web.map((e) => `${e.name}:${e.detail}`).join(' '));
esito(!JSON.stringify(ev).includes('parolasegreta') && !S1.registro.includes('parolasegreta'), "le parole cercate e gli indirizzi interi non arrivano né all'HUD né al registro");
esito(!ev.some((e) => e.t === 'show' || e.t === 'holo') && (await stato()).aperto === true && (await stato()).versione === vAperto, "sei ricerche non aprono il pannello del browser e l'ologramma resta aperto", ev.map((e) => e.t).join(', '));
ev = await domanda('apri il browser');
const vChiuso = (await stato()).versione;
esito(ev.some((e) => e.t === 'show') && (await stato()).aperto === false, "[[mostra]] apre il browser e chiude l'ologramma anche nel server", ev.map((e) => e.t).join(', '));
ev = await domanda('ancora il browser');
esito((await stato()).versione === vChiuso && !ev.some((e) => e.t === 'holo'), 'già chiuso: nessuna versione nuova');
// Un corpo JSON che non è un oggetto vale {}: prima «null» faceva cadere il server, che lo destrutturava
const nulli = [];
for (const rotta of ['/api/ologramma/foto', '/api/log', '/api/ask', '/api/ologramma']) nulli.push(`${rotta} ${(await chiedi('POST', rotta, { corpo: 'null' }).catch((e) => ({ codice: e.code })) ).codice}`);
r = await chiedi('GET', '/api/status').catch((e) => ({ codice: e.code }));
esito(r.codice === 200 && !S1.uscito && !/TypeError/.test(S1.registro), 'un corpo «null» non fa cadere il server', nulli.join(', '));
await spegni(S1);
google.kill('SIGTERM');
await attendi(() => google.exitCode !== null || google.signalCode !== null, 5000);
const libere = await attendi(async () => !(await porteOccupate()), 10_000, 250);
esito(S1.uscito && libere, `SIGTERM: server fermo e porte ${PORTA}, ${PW}, ${CDP} libere`);
const ANTENATI = new Set([process.pid]);
for (let p = process.ppid; p > 1 && !ANTENATI.has(p);) { ANTENATI.add(p); p = Number((await sh('/bin/ps', ['-o', 'ppid=', '-p', String(p)])).trim()) || 0; }
const processiProva = async () => (await sh('/bin/ps', ['-A', '-ww', '-o', 'pid=,args='])).split('\n')
  .filter((l) => !ANTENATI.has(Number(l.trim().split(' ')[0])) // la prova e chi l'ha lanciata, che può avere la cartella negli argomenti
    && (l.includes(CASA) || l.includes(`--porta ${PORTA}`) || l.includes(`--port ${PW}`)));
const tFine = performance.now();
const vivi = await attendi(async () => !(await processiProva()).length, 15_000, 250);
const resti = (await processiProva()).map((l) => l.trim().slice(0, 140));
esito(vivi, 'nessun processo della prova resta acceso (claude, mac-mcp, Playwright)', vivi ? `spenti in ${Math.round(performance.now() - tFine)} ms` : resti.join(' | '));
esito(VERI.every((f, i) => impronta(f) === primaVeri[i]), 'runtime/ del repository non è stato toccato (registro, mcp.json, ologramma, conversazione)');

console.log(`\n${passati} PASS, ${falliti} FAIL  (cartella della prova: ${CASA})`);
process.exit(falliti ? 1 : 0);
