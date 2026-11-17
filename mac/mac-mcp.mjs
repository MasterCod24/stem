#!/usr/bin/env node
// Nexus — server MCP per il controllo del Mac (stdio, JSON-RPC 2.0, un messaggio JSON per riga). Senza dipendenze.
// Le azioni native le fa runtime/stem-mac, compilato al volo da mac/helper.swift.
import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { agenda, adesso, quandoIt, traQuanto } from '../orologio.mjs';
import { FORME, FACCE, MODI, FLUSSI, LIMITI } from '../public/ologramma/forme.js';
import { MATERIALI } from '../public/ologramma/materiali.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(DIR);
const RUNTIME = path.join(ROOT, 'runtime');
const SRC = path.join(DIR, 'helper.swift');
const BIN = path.join(RUNTIME, 'stem-mac');
const LAST = path.join(RUNTIME, 'schermo-ultimo.json'); // come convertire i pixel dell'ultima schermata in punti
const NEXUS_OWNED = path.join(ROOT, 'runtime') + path.sep; // i Chrome di Nexus (HUD e finestra di Google) hanno il profilo qui

// Niente tastiera nei terminali e nei gestori di password: server.mjs esclude già il Terminale («Niente Terminale»),
// e una pagina web non deve poter far scrivere comandi a Nexus.
// Anche gli editor di codice (hanno un terminale dentro) e le app che eseguono script: i file Nexus li modifica con i suoi strumenti.
const NO_TYPING = [
  'com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'com.mitchellh.ghostty', 'net.kovidgoyal.kitty',
  'org.alacritty', 'com.github.wez.wezterm', 'co.zeit.hyper', 'org.tabby', 'com.raphaelamorim.rio',
  'com.apple.ScriptEditor2', 'com.apple.Automator', 'com.apple.shortcuts', 'com.apple.dt.Xcode',
  'com.microsoft.VSCode', 'com.microsoft.VSCodeInsiders', 'com.todesktop.230313mzl4w4u92', 'dev.zed.Zed', 'com.sublimetext.4',
  'com.jetbrains.intellij', 'com.jetbrains.pycharm', 'com.jetbrains.WebStorm', 'com.jetbrains.goland', 'com.google.android.studio',
  'com.apple.Passwords', 'com.apple.keychainaccess', 'com.1password.1password', 'com.bitwarden.desktop',
];

// Le schermate restano entro 1440 px e circa 1,15 megapixel: così il modello le vede senza ulteriori riduzioni
// e le coordinate che legge sono quelle vere.
const MAX_SIDE = 1440;
const MAX_PIXELS = 1_150_000;

// --- Processi ---

function run(file, args, { input, timeout = 20_000, track } = {}) {
  return new Promise((resolve) => {
    const child = execFile(file, args, { timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      track?.delete(child);
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr, error });
    });
    track?.add(child);
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

let building = null;
function ensureHelper() {
  return (building ??= (async () => {
    const src = fs.statSync(SRC).mtimeMs;
    let bin = 0;
    try { bin = fs.statSync(BIN).mtimeMs; } catch {}
    if (bin >= src) return;
    fs.mkdirSync(RUNTIME, { recursive: true });
    const tmp = `${BIN}.${process.pid}.tmp`; // due server insieme non si pestano i piedi
    const r = await run('/usr/bin/swiftc', ['-O', '-swift-version', '5', '-o', tmp, SRC], { timeout: 240_000 });
    if (r.code !== 0) {
      try { fs.unlinkSync(tmp); } catch {}
      throw new Error(`non riesco a compilare l'aiutante: ${(r.stderr || r.error?.message || '').slice(-600)}`);
    }
    fs.renameSync(tmp, BIN);
  })().catch((e) => { building = null; throw e; }));
}

const inFlight = new Set(); // aiutanti in corso: si fermano se il cervello annulla (Tony dice "stop")
async function helper(args, input) {
  await ensureHelper();
  const r = await run(BIN, args, { input, timeout: 120_000, track: inFlight });
  const line = r.stdout.trim().split('\n').pop() || '';
  try { return JSON.parse(line); } catch {
    throw new Error(`l'aiutante non ha risposto (${r.code}): ${(r.stderr || r.error?.message || '').slice(-300)}`);
  }
}

// --- Permessi ---

const PANELS = {
  accessibilita: { nome: 'Accessibilità', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', serve: 'usare mouse e tastiera' },
  schermo: { nome: 'Registrazione schermo e audio di sistema', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture', serve: 'vedere lo schermo' },
};

class ToolError extends Error {}

// STEM.app avvia il server e poi esce: allora l'app responsabile non si trova più, ma è lei
const LAUNCHER = '«STEM» (STEM.app nella cartella del progetto), oppure «Terminale» se lo avvii da avvia.command';
const who = (p) => (p.app ? `«${p.app}»${p.percorso ? ` (${p.percorso})` : ''}` : LAUNCHER);

function permissionText(kind, p = {}) {
  const k = PANELS[kind];
  const app = who(p);
  return `Non ho il permesso per ${k.serve}. Apri Impostazioni di Sistema → Privacy e sicurezza → ${k.nome} e attiva ${app}. ` +
    `Se è già attiva, spegnila e riaccendila, poi riavvia Nexus. Lo strumento «permessi» con apri="${kind}" apre quel pannello.`;
}

// Errori dell'aiutante → frase italiana chiara
function check(r, expected) {
  if (r.ok) return r;
  if (r.permesso) throw new ToolError(permissionText(r.permesso, r));
  if (r.rifiuto === 'password') throw new ToolError(`Non scrivo: ${r.errore}. Le password le scrive solo Tony.`);
  if (r.rifiuto === 'app_vietata') throw new ToolError(`Non scrivo in ${clean(r.primo_piano || "quest'app")}: nei terminali e nei gestori di password la tastiera la usa solo Tony.`);
  if (r.rifiuto === 'primo_piano') {
    throw new ToolError(`Non ho premuto niente: in primo piano c'è ${clean(r.primo_piano || "un'altra app")}, non ${expected || "l'app chiesta"}. Portala davanti (apri_app) e riprova.`);
  }
  throw new ToolError(r.errore || 'errore sconosciuto');
}

// --- Schermo e coordinate ---

function pngSize(file) {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, b, 0, 24, 0); } finally { fs.closeSync(fd); }
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function fit(w, h) { // fattore di riduzione per stare nei limiti, mai ingrandire
  return Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
}

// Mappa di uno schermo intero, anche senza schermata: stessa formula di «schermo»
async function fullMapping() {
  const d = check(await helper(['display']));
  const pw = Math.round(d.larghezza * d.scala), ph = Math.round(d.altezza * d.scala);
  const s = fit(pw, ph);
  const w = Math.round(pw * s), h = Math.round(ph * s);
  return { ox: d.x, oy: d.y, k: d.larghezza / w, w, h };
}

async function mapping() {
  try {
    const m = JSON.parse(fs.readFileSync(LAST, 'utf8'));
    if ([m.ox, m.oy, m.k, m.w, m.h].every(Number.isFinite)) return m;
  } catch {}
  return fullMapping();
}

function num(v, name) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ToolError(`«${name}» deve essere un numero`);
  return n;
}

async function toPoints(x, y, nx = 'x', ny = 'y') {
  const m = await mapping();
  x = num(x, nx); y = num(y, ny);
  if (x < 0 || y < 0 || x > m.w || y > m.h) {
    throw new ToolError(`(${x}, ${y}) è fuori dall'ultima schermata, che è ${m.w}×${m.h} px. Rifai «schermo» se serve.`);
  }
  const r = (v) => Math.round(v * 10) / 10;
  return [r(m.ox + x * m.k), r(m.oy + y * m.k)];
}

async function schermo(a) {
  const perm = await helper(['permessi']);
  if (!perm.schermo) throw new ToolError(permissionText('schermo', perm));
  let rect, which = ''; // rect in punti
  const region = ['x', 'y', 'larghezza', 'altezza'].some((k) => a[k] != null);
  if (region) {
    const m = await mapping();
    const x = num(a.x ?? 0, 'x'), y = num(a.y ?? 0, 'y');
    const w = num(a.larghezza ?? m.w - x, 'larghezza'), h = num(a.altezza ?? m.h - y, 'altezza');
    if (w < 4 || h < 4 || x < 0 || y < 0 || x + w > m.w + 1 || y + h > m.h + 1) {
      throw new ToolError(`regione fuori dall'ultima schermata (${m.w}×${m.h} px)`);
    }
    rect = [m.ox + x * m.k, m.oy + y * m.k, w * m.k, h * m.k].map((v) => Math.round(v));
  } else {
    // Più schermi: fotografo quello dove sta la finestra in primo piano (o quello chiesto), non sempre il principale
    const { schermi = [] } = await helper(['schermi']).catch(() => ({}));
    let d = schermi.find((s) => s.principale) || schermi[0] || check(await helper(['display']));
    if (a.schermo != null && schermi[num(a.schermo, 'schermo') - 1]) d = schermi[num(a.schermo, 'schermo') - 1];
    else {
      const f = await helper(['finestra']).catch(() => ({}));
      if (Number.isFinite(f.x)) {
        const cx = f.x + f.larghezza / 2, cy = f.y + f.altezza / 2;
        d = schermi.find((s) => cx >= s.x && cx < s.x + s.larghezza && cy >= s.y && cy < s.y + s.altezza) || d;
      }
    }
    rect = [d.x, d.y, d.larghezza, d.altezza].map((v) => Math.round(v));
    which = schermi.length > 1 ? ` (schermo ${schermi.indexOf(d) + 1} di ${schermi.length}${d.principale ? ', il principale' : ''}; ` +
      `per un altro usa il parametro «schermo»)` : '';
  }
  const tmp = path.join(os.tmpdir(), `nexus-schermo-${process.pid}-${Date.now()}.png`);
  try {
    const cap = ['-x', '-t', 'png', `-R${rect.join(',')}`, tmp];
    const r = await run('/usr/sbin/screencapture', cap);
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new ToolError(`screencapture non ha funzionato: ${(r.stderr || '').trim() || r.code}`);
    let { w, h } = pngSize(tmp);
    const s = fit(w, h);
    if (s < 1) {
      const side = Math.floor(Math.max(w, h) * s);
      const z = await run('/usr/bin/sips', ['--resampleHeightWidthMax', String(side), tmp]);
      if (z.code !== 0) throw new ToolError(`sips non ha ridimensionato la schermata: ${(z.stderr || '').trim()}`);
      ({ w, h } = pngSize(tmp));
    }
    const m = { ox: rect[0], oy: rect[1], k: rect[2] / w, w, h, quando: new Date().toISOString() };
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(LAST, JSON.stringify(m));
    const front = (await helper(['app-aperte'])).app?.find((x) => x.primo_piano)?.nome;
    const k = m.k.toFixed(4).replace('.', ',');
    const text = `Schermata ${region ? `della regione (${a.x ?? 0}, ${a.y ?? 0}) ` : 'dello schermo'}${which} ${w}×${h} px. ` +
      `1 px della schermata = ${k} punti dello schermo; origine in punti (${rect[0]}, ${rect[1]}). ` +
      `Da ora clic, muovi, trascina e scorri usano i pixel di QUESTA immagine.` +
      (front ? ` In primo piano: ${clean(front)}.` : '');
    return [{ type: 'image', data: fs.readFileSync(tmp).toString('base64'), mimeType: 'image/png' }, { type: 'text', text }];
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

// --- App ---

const STOP = new Set(['app', 'applicazione', 'programma', 'il', 'lo', 'la', 'l', 'i', 'gli', 'le', 'di', 'del', 'della', 'apri', 'chiudi', 'the']);
function norm(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\.app$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function query(s) { return norm(s).split(' ').filter((w) => w && !STOP.has(w)).join(' '); }

function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

function score(q, name) {
  const n = query(name) || norm(name); // stesse parole vuote tolte da domanda e nome
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.replace(/ /g, '') === q.replace(/ /g, '')) return 0.97; // «chat gpt», «whats app»: la voce spezza le parole
  if (n.startsWith(q)) return 0.92 - Math.min(0.1, (n.length - q.length) / 200);
  if (` ${n}`.includes(` ${q}`)) return 0.88 - Math.min(0.1, (n.length - q.length) / 200);
  if (q.length >= 3 && n.includes(q)) return 0.8;
  if (n.length >= 3 && ` ${q} `.includes(` ${n} `)) return 0.75;
  // errori di battitura o di riconoscimento vocale, sul nome intero o su una sua parola
  let best = 0;
  for (const cand of [n, ...n.split(' ')]) {
    if (cand.length < 3) continue;
    const sim = 1 - lev(q, cand) / Math.max(q.length, cand.length);
    best = Math.max(best, sim * (cand === n ? 0.72 : 0.65));
  }
  return best;
}

function rank(q, apps, names = (a) => a.nomi ?? [a.nome]) {
  const qq = query(q) || norm(q);
  return apps.map((app) => ({ app, s: Math.max(...names(app).map((n) => score(qq, n))) }))
    .filter((r) => r.s >= 0.5)
    .sort((a, b) => b.s - a.s || a.app.nome.length - b.app.nome.length);
}

let installedCache = null;
async function installed() {
  if (!installedCache) installedCache = check(await helper(['app-installate'])).app.map((a) => ({ ...a, nome: clean(a.nome), nomi: a.nomi.map(clean) }));
  return installedCache;
}
const clean = (s) => String(s).replace(/[\u200e\u200f]/g, ''); // segni di direzione (es. «\u200eWhatsApp»)

async function running() {
  const list = check(await helper(['app-aperte'])).app.map((a) => ({ ...a, nome: clean(a.nome) }));
  const byBundle = new Map((await installed()).map((a) => [a.bundle, a]));
  for (const a of list) a.nomi = [...new Set([a.nome, ...(byBundle.get(a.bundle)?.nomi ?? [])])];
  return list;
}

async function nexusOwned(pids) { // i processi avviati da Nexus col profilo in runtime/
  if (!pids.length) return new Set();
  const r = await run('/bin/ps', ['-o', 'pid=,command=', '-p', pids.join(',')]);
  const own = new Set();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m && m[2].includes(NEXUS_OWNED)) own.add(Number(m[1]));
  }
  return own;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apriApp(a) {
  const nome = String(a.nome ?? '').trim();
  if (!nome) throw new ToolError('dimmi il nome dell\'app');
  const found = rank(nome, await installed());
  if (!found.length) {
    const near = (await installed()).map((app) => ({ app, s: Math.max(...app.nomi.map((n) => score(query(nome), n))) }))
      .sort((x, y) => y.s - x.s).slice(0, 5).map((r) => r.app.nome);
    throw new ToolError(`Non trovo un'app che somigli a «${nome}». Le più vicine: ${near.join(', ')}.`);
  }
  const app = found[0].app;
  const others = found.slice(1).filter((r) => r.s >= found[0].s - 0.02).map((r) => r.app.nome);
  // Se gira solo il Chrome di Nexus, ne apro uno di Tony a parte invece di riattivare quello dell'HUD
  const inst = (await running()).filter((r) => r.bundle && r.bundle === app.bundle);
  const own = await nexusOwned(inst.map((r) => r.pid));
  const onlyNexus = inst.length > 0 && inst.every((r) => own.has(r.pid));
  const r = await run('/usr/bin/open', onlyNexus ? ['-n', '-a', app.percorso] : ['-a', app.percorso]);
  if (r.code !== 0) throw new ToolError(`open non è riuscito ad aprire ${app.nome}: ${(r.stderr || '').trim()}`);
  let front = false;
  for (let i = 0; i < 24 && !front; i++) { // aspetto fino a 6 s che sia davanti
    await sleep(250);
    front = (await helper(['app-aperte'])).app?.some((x) => x.primo_piano && x.bundle === app.bundle) ?? false;
  }
  return `Ho aperto ${app.nome} (${app.percorso}). ` + (front ? 'Ora è in primo piano.' : 'Si sta ancora avviando o è rimasta dietro.') +
    (others.length ? ` Somigliavano anche: ${others.join(', ')}.` : '');
}

async function resolveRunning(nome) {
  const list = await running();
  const found = rank(nome, list);
  if (!found.length) throw new ToolError(`«${nome}» non risulta aperta. Aperte ora: ${list.map((x) => x.nome).join(', ')}.`);
  return { app: found[0].app, all: list.filter((x) => x.bundle === found[0].app.bundle) };
}

async function chiudiApp(a) {
  const nome = String(a.nome ?? '').trim();
  if (!nome) throw new ToolError('dimmi il nome dell\'app');
  const { app, all } = await resolveRunning(nome);
  const own = await nexusOwned(all.map((x) => x.pid));
  const pids = all.filter((x) => !own.has(x.pid)).map((x) => x.pid);
  if (!pids.length) throw new ToolError(`L'unico ${app.nome} aperto è il tuo (HUD e finestra di Google): non lo chiudo.`); // il cervello lo ripete a voce: niente nome
  const r = check(await helper(['chiudi', ...pids.map(String)]));
  if (r.ancora_aperte.length) {
    return `Ho chiesto a ${app.nome} di chiudersi, ma è ancora aperta: forse chiede di salvare qualcosa. Guarda lo schermo.`;
  }
  return `Ho chiuso ${app.nome}.` + (own.size ? ' Il tuo Chrome resta aperto.' : '');
}

async function frontGuard(a) { // facoltativo: «app» = scrivi solo se davanti c'è lei
  const args = ['--vieta', NO_TYPING.join(',')];
  if (!a.app) return { args };
  const { app } = await resolveRunning(String(a.app));
  if (!app.bundle) throw new ToolError(`non riesco a riconoscere ${app.nome} con certezza: riprova senza «app»`);
  args.push('--solo-se', app.bundle);
  return { args, expected: app.nome };
}

const said = (r) => (r.primo_piano ? ` In primo piano: ${clean(r.primo_piano)}.` : '');

// --- Strumenti ---

const XY = {
  x: { type: 'number', description: 'pixel orizzontale nell\'ultima schermata' },
  y: { type: 'number', description: 'pixel verticale nell\'ultima schermata' },
};

const TOOLS = [
  {
    name: 'schermo',
    description: 'Fotografa lo schermo del Mac dove sta la finestra in primo piano (con più schermi; «schermo»: 1, 2… per sceglierne uno) e restituisce l\'immagine. Le coordinate di clic, muovi, trascina e scorri ' +
      'sono sempre in pixel dell\'ULTIMA immagine restituita. Facoltativo: una regione (x, y, larghezza, altezza in pixel dell\'ultima ' +
      'immagine) per ingrandire un dettaglio; dopo, le coordinate valgono per la regione.',
    inputSchema: { type: 'object', properties: {
      x: { type: 'number' }, y: { type: 'number' }, larghezza: { type: 'number' }, altezza: { type: 'number' },
      schermo: { type: 'number', description: 'numero dello schermo (1, 2…) se ce n\'è più di uno' },
    } },
    annotations: { title: 'Guarda lo schermo', readOnlyHint: true },
    run: schermo,
  },
  {
    name: 'clic',
    description: 'Clic del mouse in un punto (pixel dell\'ultima schermata). Fai prima «schermo» per sapere dove cliccare.',
    inputSchema: { type: 'object', properties: {
      ...XY,
      pulsante: { type: 'string', enum: ['sinistro', 'destro'], default: 'sinistro' },
      doppio: { type: 'boolean', default: false, description: 'doppio clic' },
    }, required: ['x', 'y'] },
    annotations: { title: 'Clic' },
    run: async (a) => {
      const [X, Y] = await toPoints(a.x, a.y);
      const btn = a.pulsante === 'destro' ? 'destro' : 'sinistro';
      const r = check(await helper(['clic', String(X), String(Y), btn, a.doppio ? '2' : '1']));
      return `${a.doppio ? 'Doppio clic' : 'Clic'} ${btn} in (${a.x}, ${a.y}) px = (${X}, ${Y}) punti.${said(r)}`;
    },
  },
  {
    name: 'muovi',
    description: 'Sposta il puntatore del mouse (pixel dell\'ultima schermata), per esempio per far comparire un menu al passaggio.',
    inputSchema: { type: 'object', properties: XY, required: ['x', 'y'] },
    annotations: { title: 'Muovi il mouse' },
    run: async (a) => {
      const [X, Y] = await toPoints(a.x, a.y);
      check(await helper(['muovi', String(X), String(Y)]));
      return `Puntatore in (${a.x}, ${a.y}) px = (${X}, ${Y}) punti.`;
    },
  },
  {
    name: 'trascina',
    description: 'Tiene premuto il tasto sinistro e trascina da un punto a un altro (pixel dell\'ultima schermata): finestre, file, cursori.',
    inputSchema: { type: 'object', properties: {
      da_x: { type: 'number' }, da_y: { type: 'number' }, a_x: { type: 'number' }, a_y: { type: 'number' },
    }, required: ['da_x', 'da_y', 'a_x', 'a_y'] },
    annotations: { title: 'Trascina' },
    run: async (a) => {
      const [X1, Y1] = await toPoints(a.da_x, a.da_y, 'da_x', 'da_y');
      const [X2, Y2] = await toPoints(a.a_x, a.a_y, 'a_x', 'a_y');
      const r = check(await helper(['trascina', String(X1), String(Y1), String(X2), String(Y2)]));
      return `Trascinato da (${a.da_x}, ${a.da_y}) a (${a.a_x}, ${a.a_y}) px.${said(r)}`;
    },
  },
  {
    name: 'scorri',
    description: 'Scorre con la rotella sopra un punto (pixel dell\'ultima schermata). dy positivo = in giù, negativo = in su; ' +
      'dx positivo = a destra. Unità: righe (5–15 per mezza pagina).',
    inputSchema: { type: 'object', properties: {
      ...XY, dx: { type: 'integer', default: 0 }, dy: { type: 'integer', default: 0 },
    }, required: ['x', 'y'] },
    annotations: { title: 'Scorri' },
    run: async (a) => {
      const [X, Y] = await toPoints(a.x, a.y);
      const dx = Math.round(num(a.dx ?? 0, 'dx')), dy = Math.round(num(a.dy ?? 0, 'dy'));
      check(await helper(['scorri', String(X), String(Y), String(dx), String(dy)]));
      return `Scorso di ${dy} righe in verticale e ${dx} in orizzontale sopra (${a.x}, ${a.y}) px.`;
    },
  },
  {
    name: 'scrivi',
    description: 'Scrive del testo (anche accenti ed emoji) nell\'app in primo piano, dove c\'è il cursore; "\\n" = Invio. ' +
      'Rifiuta i campi password, i terminali e i gestori di password. Facoltativo «app»: scrive solo se davanti c\'è quell\'app.',
    inputSchema: { type: 'object', properties: {
      testo: { type: 'string' }, app: { type: 'string', description: 'nome dell\'app che deve essere in primo piano' },
    }, required: ['testo'] },
    annotations: { title: 'Scrivi' },
    run: async (a) => {
      const testo = String(a.testo ?? '');
      if (!testo) throw new ToolError('testo vuoto');
      if (testo.length > 5000) throw new ToolError('testo troppo lungo (massimo 5000 caratteri): per testi lunghi crea un file');
      const g = await frontGuard(a);
      const r = check(await helper(['scrivi', ...g.args], testo), g.expected);
      return `Scritti ${[...testo].length} caratteri.${said(r)}`;
    },
  },
  {
    name: 'tasti',
    description: 'Preme una combinazione di tasti: "cmd+s", "cmd+shift+4", "cmd+tab", "return", "esc", "tab", "space", "delete", ' +
      '"up"/"down"/"left"/"right", "home", "end", "pageup", "pagedown", "f1"…"f12", oppure un carattere ("cmd+c"). ' +
      'Modificatori: cmd, shift, alt, ctrl, fn. Facoltativi: «volte» (ripetizioni) e «app» (solo se davanti c\'è quell\'app).',
    inputSchema: { type: 'object', properties: {
      combinazione: { type: 'string' },
      volte: { type: 'integer', minimum: 1, maximum: 50, default: 1 },
      app: { type: 'string', description: 'nome dell\'app che deve essere in primo piano' },
    }, required: ['combinazione'] },
    annotations: { title: 'Tasti' },
    run: async (a) => {
      const combo = String(a.combinazione ?? '').trim();
      if (!combo) throw new ToolError('combinazione vuota');
      const volte = Math.max(1, Math.min(50, Math.round(Number(a.volte) || 1)));
      const g = await frontGuard(a);
      const r = check(await helper(['tasti', ...g.args, combo, String(volte)]), g.expected);
      return `Premuto ${combo}${volte > 1 ? ` ${volte} volte` : ''}.${said(r)}`;
    },
  },
  {
    name: 'apri_app',
    description: 'Apre un\'app del Mac (o la porta in primo piano se è già aperta). Il nome può essere approssimato, ' +
      'in italiano o in inglese: "calcolatrice", "chrome", "impostazioni", "word". Restituisce l\'app esatta aperta.',
    inputSchema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
    annotations: { title: 'Apri app', openWorldHint: false },
    run: apriApp,
  },
  {
    name: 'chiudi_app',
    description: 'Chiude un\'app aperta in modo normale, come cmd+Q (mai forzato: se chiede di salvare, la domanda resta sullo schermo).',
    inputSchema: { type: 'object', properties: { nome: { type: 'string' } }, required: ['nome'] },
    annotations: { title: 'Chiudi app', destructiveHint: true },
    run: chiudiApp,
  },
  {
    name: 'app_aperte',
    description: 'Elenca le app aperte, con quella in primo piano segnata.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'App aperte', readOnlyHint: true },
    run: async () => (await running()).map((x) => `${x.primo_piano ? '▶ ' : '  '}${x.nome}${x.primo_piano ? ' (in primo piano)' : ''}`).join('\n'),
  },
  {
    name: 'app_installate',
    description: 'Elenca le app installate che si possono aprire con apri_app.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'App installate', readOnlyHint: true },
    run: async () => {
      const list = (await installed()).map((x) => (x.nomi.length > 1 ? `${x.nome} (${x.nomi.slice(1).join(', ')})` : x.nome));
      return [...new Set(list)].sort((p, q) => p.localeCompare(q, 'it')).join('\n');
    },
  },
  {
    name: 'permessi',
    description: 'Dice se Nexus ha i permessi di Accessibilità (mouse e tastiera) e di Registrazione schermo, e per quale app vanno dati. ' +
      'Con apri="accessibilita" o "schermo" apre il pannello giusto delle Impostazioni.',
    inputSchema: { type: 'object', properties: { apri: { type: 'string', enum: ['accessibilita', 'schermo'] } } },
    annotations: { title: 'Permessi', readOnlyHint: false },
    run: async (a) => {
      const p = await helper(['permessi']);
      const lines = [
        `Accessibilità (mouse e tastiera): ${p.accessibilita ? 'sì' : 'NO'}`,
        `Registrazione schermo: ${p.schermo ? 'sì' : 'NO'}`,
        `App che riceve i permessi: ${who(p)}`,
      ];
      if (a.apri && PANELS[a.apri]) {
        await helper(['chiedi', a.apri]); // la mette nell'elenco, poi va attivata a mano
        await run('/usr/bin/open', [PANELS[a.apri].url]);
        lines.push(`Ho aperto Impostazioni di Sistema → Privacy e sicurezza → ${PANELS[a.apri].nome}: attiva ${who(p)}.`);
      }
      return lines.join('\n');
    },
  },
];
// Il report non passa da qui: brain.mjs legge i blocchi dalla chiamata nel flusso del cervello e li manda all'HUD.
// Lo strumento esiste per dare al cervello la forma dei dati e una risposta.
TOOLS.push({
  name: 'mostra_report',
  description: 'Apre a schermo intero, nell\'HUD di Nexus, un report fatto di blocchi che arrivano dal fondo e si incastrano in una griglia. ' +
    'Usalo alla fine di una ricerca che Tony vuole vedere. Da 6 a 14 blocchi, misti: il primo video è il protagonista. ' +
    'Ci stanno circa 2 video, 4 testi, 3 grafici, 1 immagine e 1 dato; i blocchi in più dello stesso tipo si impilano e si alternano. ' +
    'Solo cose trovate nelle fonti. Con zero blocchi il report si chiude.',
  inputSchema: { type: 'object', properties: {
    titolo: { type: 'string', description: 'titolo corto del report (es. «Lo stato della VR»)' },
    blocchi: { type: 'array', items: { type: 'object', properties: {
      tipo: { type: 'string', enum: ['testo', 'grafico', 'dato', 'immagine', 'video'] },
      titolo: { type: 'string', description: 'corto, compare in maiuscolo' },
      testo: { type: 'string', description: 'testo: 2–4 frasi; grafico e dato: cosa dice il numero e i suoi limiti; immagine: didascalia' },
      fonte: { type: 'string', description: 'da dove viene: sito e anno' },
      valori: { type: 'array', description: 'solo grafico: da 2 a 8 barre', items: { type: 'object', properties: {
        etichetta: { type: 'string' }, valore: { type: 'number' } }, required: ['etichetta', 'valore'] } },
      unita: { type: 'string', description: 'solo grafico: unità dei valori (es. «milioni di pezzi»)' },
      valore: { type: 'string', description: 'solo dato: il numero da mostrare grande, al massimo 8 caratteri (es. «≈20 mln»)' },
      url: { type: 'string', description: 'solo immagine: indirizzo https diretto dell\'immagine, preso dalla pagina' },
      youtube: { type: 'string', description: 'solo video: link di YouTube (anche Shorts) trovato cercando' },
    }, required: ['tipo'] } },
  }, required: ['blocchi'] },
  annotations: { title: 'Report sullo schermo', readOnlyHint: true },
  run: async (a) => {
    const n = Array.isArray(a.blocchi) ? a.blocchi.length : 0;
    return n ? `Report sullo schermo: ${n} blocchi. Immagini e video che non si caricano restano vuoti.` : 'Report chiuso.';
  },
});

// --- Agenda: qui il cervello si segna i compiti; server.mjs guarda l'ora e, quando arriva, glieli ripassa (orologio.mjs) ---
function elenco() {
  const list = agenda.list();
  if (!list.length) return 'Agenda vuota.';
  return 'In agenda:\n' + list.map((x) => `- n. ${x.id}, ${quandoIt(x.quando)} (${traQuanto(x.quando - Date.now())}): ${x.cosa}`).join('\n');
}
function parseAlle(v) {
  const s = String(v).trim();
  const hm = s.match(/^(\d{1,2})[:.](\d{2})$/); // solo l'ora: la prossima volta che arriva, oggi o domani
  if (hm) {
    const h = Number(hm[1]), m = Number(hm[2]);
    if (h > 23 || m > 59) return NaN;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now() - 60_000) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return new Date(s).getTime(); // «2026-11-07T08:30» senza fuso è ora locale
}
// A batteria il Mac va in stop dopo un po' che nessuno lo tocca (parlare a Nexus non conta): lì niente gira, nemmeno l'orologio
async function aBatteria() {
  const r = await run('/usr/bin/pmset', ['-g', 'batt'], { timeout: 3000 });
  return r.stdout.includes("'Battery Power'");
}
TOOLS.push({
  name: 'ricorda',
  description: 'Segna nell\'agenda un compito da fare più tardi: un promemoria, una sveglia, un controllo da fare a un\'ora precisa. ' +
    'All\'ora giusta ricevi un messaggio che comincia con [agenda] e fai il compito, parlando tu per primo. ' +
    '«cosa» è un\'istruzione completa per te stesso, chiara anche senza questa conversazione ' +
    '(es. «Ricorda a Tony di chiamare la mamma», «Cerca se è uscito il trailer di GTA 6 e di\' a Tony cosa hai trovato»). ' +
    'Il momento si dà in uno dei due modi: «tra_minuti» oppure «alle». Funziona solo con Nexus acceso e il Mac sveglio: se no, il compito aspetta.',
  inputSchema: { type: 'object', properties: {
    cosa: { type: 'string', description: 'che cosa dovrai fare, scritto come istruzione per te stesso' },
    tra_minuti: { type: 'number', description: 'fra quanti minuti da adesso, es. 90' },
    alle: { type: 'string', description: 'ora locale: «18:00» (la prossima volta che arriva) oppure data e ora, «2026-11-07T08:30»' },
  }, required: ['cosa'] },
  annotations: { title: 'Segna in agenda' },
  run: async (a) => {
    const cosa = String(a.cosa ?? '').trim();
    if (!cosa) throw new ToolError('«cosa» è vuoto: scrivi che cosa dovrai fare');
    if (cosa.length > 600) throw new ToolError('«cosa» è troppo lungo (al massimo 600 caratteri)');
    const hasMin = a.tra_minuti != null && a.tra_minuti !== '', hasAlle = String(a.alle ?? '').trim() !== '';
    if (hasMin === hasAlle) throw new ToolError('dai il momento in uno dei due modi: «tra_minuti» oppure «alle»');
    if (hasMin && num(a.tra_minuti, 'tra_minuti') <= 0) throw new ToolError('«tra_minuti» deve essere più di zero');
    const quando = hasMin ? Date.now() + num(a.tra_minuti, 'tra_minuti') * 60_000 : parseAlle(a.alle);
    if (!Number.isFinite(quando)) throw new ToolError(`«alle» non è un'ora che capisco: usa «18:00» oppure «2026-11-07T08:30». Adesso è ${adesso()}.`);
    if (quando < Date.now() - 60_000) throw new ToolError(`${quandoIt(quando)} è già passato. Adesso è ${adesso()}.`);
    if (quando > Date.now() + 366 * 864e5) throw new ToolError('è più in là di un anno: troppo lontano per l\'agenda');
    const id = agenda.add(cosa, quando);
    const nota = (await aBatteria())
      ? '\nIl Mac va a batteria: se resta fermo va in stop, e il compito aspetta finché non si risveglia. Se l\'attesa è lunga (una sveglia, più di qualche minuto), dillo a Tony in mezza frase.'
      : '';
    return `Segnato, n. ${id}: ${quandoIt(quando)}, ${traQuanto(quando - Date.now())}.${nota}\n${elenco()}`;
  },
});
TOOLS.push({
  name: 'agenda',
  description: 'Elenca i compiti segnati con «ricorda», con numero e ora. Con «togli» (i loro numeri) li cancella, per esempio se Tony cambia idea.',
  inputSchema: { type: 'object', properties: {
    togli: { type: 'array', items: { type: 'integer' }, description: 'numeri dei compiti da cancellare' },
  } },
  annotations: { title: 'Agenda' },
  run: async (a) => {
    const ids = Array.isArray(a.togli) ? a.togli.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) return elenco();
    const n = agenda.remove(ids);
    const fatto = n === 1 ? 'Tolto 1 compito' : `Tolti ${n} compiti`;
    return `${fatto}${n < ids.length ? ' (gli altri numeri non c\'erano)' : ''}.\n${elenco()}`;
  },
});

// --- Ologrammi: client sottili di POST /api/ologramma. Stato, validazione e testi stanno nel server (ologramma.mjs) ---
// La porta arriva dagli argomenti (mcp.json: --porta <NEXUS_PORT>), perché .env non arriva ai processi figli. Una porta
// sbagliata non ripiega sulla 4321: una prova finirebbe sul Nexus vero.
const PORTA = (() => {
  const i = process.argv.indexOf('--porta');
  if (i < 0) return 4321;
  const n = Number(process.argv[i + 1]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
})();
const ATTESA_MS = 95_000; // il server aspetta il calcolo fino a 60 s e poi la foto fino a 8 s
const olo = new Set();    // richieste in volo: «stop» le annulla
async function ologramma(corpo) {
  if (!PORTA) throw new ToolError(`la porta di Nexus negli argomenti non è valida (${process.argv.slice(2).join(' ')}): niente è cambiato`);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ATTESA_MS);
  olo.add(ctrl);
  let r, testo;
  try {
    r = await fetch(`http://127.0.0.1:${PORTA}/api/ologramma`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: ctrl.signal });
    testo = await r.text();
  } catch (e) {
    throw new ToolError(ctrl.signal.aborted
      ? `nessuna risposta da Nexus entro ${ATTESA_MS / 1000} s, o richiesta annullata: il cambio può essere arrivato lo stesso, guardalo con modifica_ologramma senza campi`
      : `il server di Nexus non risponde sulla porta ${PORTA} (${e.cause?.code || e.message}): niente è cambiato`);
  } finally {
    clearTimeout(timer);
    olo.delete(ctrl);
  }
  let d = null;
  try { d = JSON.parse(testo); } catch {}
  if (!r.ok || d?.ok !== true) { // gli errori del server arrivano al cervello così come sono: dicono già cosa correggere
    const errori = Array.isArray(d?.errori) ? d.errori.map(String) : [];
    throw new ToolError(`Niente è cambiato (il server ha risposto ${r.status})${errori.length ? `:\n- ${errori.join('\n- ')}` : testo ? `: ${testo.slice(0, 500)}` : '.'}`);
  }
  // Testo e foto, senza structuredContent: secondo la misura dello studio, con quello il testo non arriverebbe al cervello
  const out = [{ type: 'text', text: String(d.testo ?? '') }];
  if (typeof d.foto === 'string' && d.foto) out.push({ type: 'image', data: d.foto, mimeType: 'image/png' });
  return accantoAlVero(corpo, out);
}

// --- L'oggetto vero: foto e misure, per confrontare l'ologramma con la realtà (17/11, richiesta di Tony) ---
// Tony ha bocciato gli oggetti fatti «a occhio»: il cervello costruiva da quello che ricordava e controllava la foto
// dell'HUD solo contro sé stesso. Con guarda_oggetto_vero guarda le foto vere, e gli strumenti gliele rimettono accanto
// alla foto dell'HUD: «fuori» alla prima vista (mostra), «dentro» quando guarda ai raggi X o in sezione. Le misure
// ufficiali le confronta costruisci_in_blender con l'ingombro di quello che esce da Blender.
// Le foto vengono dal web: solo https verso indirizzi pubblici (niente Nexus né altri servizi del Mac o di casa).
// Nessuno le apre sul Mac: tipo e misure si leggono dai primi byte, e passano così come sono solo se stanno entro
// 2000 pixel per lato (il limite delle immagini quando una conversazione ne ha più di 20) e 3,5 MB (5 MB in base64).
// Una più grande si rifiuta dicendo dove trovarne una più piccola. Ridurle con sips voleva una gabbia con tre eccezioni
// (17/11): tolto.
const VERO_FOTO = 3, VERO_BYTE = 3.5 * 2 ** 20, VERO_LATO = 2000, VERO_MS = 15_000;
const TIPI_FOTO = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const VERO_VALE_MS = 30 * 60_000; // una foto guardata vale per il prossimo ologramma, se arriva entro mezz'ora
const VERO_SCARTO = 0.1;          // oltre il 10% su un lato, il testo chiede di correggere o di dirlo a Tony
const UA_WEB = { 'user-agent': 'Nexus/1.0 (assistente personale)' };
const mm = (n) => (Math.round(n * 10) / 10 || 0).toLocaleString('it-IT');
let vero = null; // { oggetto, foto: [{ cosa, data }], misure (dal lato più lungo), fonte, scala, quando, mostrato, costruito }

function indirizzoPrivato(ip) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('::ffff:');
}

async function scaricaFoto(indirizzo) {
  let u;
  try { u = new URL(String(indirizzo ?? '')); } catch { throw new Error('non è un indirizzo'); }
  for (let rimandi = 0; ; rimandi++) {
    if (u.protocol !== 'https:' || u.port || u.username || u.password) throw new Error('serve https, senza porta né credenziali');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const ind = await dns.lookup(host, { all: true }).catch(() => []);
    if (!ind.length) throw new Error(`${host} non si trova`);
    if (ind.some((x) => indirizzoPrivato(x.address))) throw new Error(`${host} porta a un indirizzo del Mac o della rete di casa`);
    let r;
    try { r = await fetch(u, { headers: UA_WEB, redirect: 'manual', signal: AbortSignal.timeout(VERO_MS) }); } catch (e) { throw new Error(`il sito non risponde (${e.cause?.code || e.name})`); }
    const dove = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && dove) {
      r.body?.cancel().catch(() => {});
      if (rimandi >= 3) throw new Error('troppi rimandi');
      u = new URL(dove, u);
      continue;
    }
    if (!r.ok) { r.body?.cancel().catch(() => {}); throw new Error(`il sito ha risposto ${r.status}`); }
    const parti = [];
    let n = 0;
    try {
      for await (const c of r.body) {
        n += c.length;
        if (n > VERO_BYTE) throw new Error(`oltre ${mm(VERO_BYTE / 2 ** 20)} MB: ${PIU_PICCOLA}`);
        parti.push(c);
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error(`non è arrivata entro ${VERO_MS / 1000} s`) : e; }
    return Buffer.concat(parti);
  }
}

function tipoFoto(b) { // dai primi byte, non da quello che dice il sito
  if (b.length < 16) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const PIU_PICCOLA = `serve una versione entro ${VERO_LATO} pixel per lato e ${mm(VERO_BYTE / 2 ** 20)} MB, per esempio l'anteprima di Wikimedia (/thumb/…/1280px-…) o la .medium di iFixit`;

// Larghezza e altezza dall'intestazione, senza decodificare l'immagine
function latiFoto(b, tipo) {
  if (tipo === 'png') return b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
  if (tipo === 'gif') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (tipo === 'webp') {
    const f = b.toString('latin1', 12, 16);
    if (f === 'VP8 ' && b.length >= 30) return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L' && b.length >= 25) { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >>> 14) & 0x3fff) + 1 }; }
    if (f === 'VP8X' && b.length >= 30) return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  for (let i = 2; i + 9 < b.length;) { // jpg: il primo marcatore SOF
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

async function guardaOggettoVero(a) {
  const oggetto = String(a.oggetto ?? '').trim().slice(0, 80);
  if (!oggetto) throw new ToolError('«oggetto» dice cosa guardi: «AirPods Pro 2 con custodia». Niente è cambiato.');
  let misure = null;
  if (a.misure != null) {
    if (!Array.isArray(a.misure) || a.misure.length !== 3 || !a.misure.every((x) => typeof x === 'number' && x > 0 && x <= 1e9)) {
      throw new ToolError('«misure» sono i tre lati dell\'oggetto vero in mm, numeri positivi. Niente è cambiato.');
    }
    misure = [...a.misure].sort((x, y) => y - x);
  }
  const scala = a.scala == null ? 1 : a.scala;
  if (!(typeof scala === 'number' && scala > 0 && scala <= 1e6)) throw new ToolError('«scala» è un numero positivo: 1000 per un ologramma 1:1000. Niente è cambiato.');
  const foto = Array.isArray(a.foto) ? a.foto : [];
  if (foto.length > VERO_FOTO) throw new ToolError(`Al massimo ${VERO_FOTO} foto. Niente è cambiato.`);
  if (!foto.length && !misure) throw new ToolError('Servono le foto, le misure o tutte e due. Niente è cambiato.');
  const prese = [], errori = [];
  await Promise.all(foto.map(async (f, i) => {
    const cosa = f?.cosa === 'dentro' ? 'dentro' : 'fuori';
    try {
      const b = await scaricaFoto(f?.url);
      const t = tipoFoto(b);
      if (!t) {
        throw new Error(b.toString('latin1', 0, 256).trimStart().startsWith('<')
          ? 'è una pagina o un SVG, non una foto: serve l\'indirizzo del jpg o del png (per Wikimedia l\'anteprima /thumb/…/1280px-…)'
          : 'non è un jpg, png, webp o gif');
      }
      const l = latiFoto(b, t);
      if (!l || !(l.w > 0 && l.h > 0)) throw new Error(`l'intestazione del ${t} non si legge`);
      if (Math.max(l.w, l.h) > VERO_LATO) throw new Error(`è di ${l.w}×${l.h} pixel: ${PIU_PICCOLA}`);
      prese[i] = { cosa, data: b.toString('base64'), mimeType: TIPI_FOTO[t] };
    } catch (e) {
      errori[i] = `foto ${i + 1} (${cosa}): ${e.message}`;
    }
  }));
  const buone = prese.filter(Boolean);
  if (!buone.length && !misure) throw new ToolError(`Nessuna foto presa, niente è cambiato:\n- ${errori.filter(Boolean).join('\n- ')}`);
  const fonte = String(a.fonte ?? '').trim().slice(0, 200);
  vero = { oggetto, foto: buone, misure, fonte, scala, quando: Date.now(), mostrato: false, costruito: new Map() };
  const quante = (cosa) => buone.filter((f) => f.cosa === cosa).length;
  const righe = [`Guardato «${oggetto}»: ${buone.length ? `${buone.length} foto (fuori ${quante('fuori')}, dentro ${quante('dentro')}), qui sotto` : 'nessuna foto'}` +
    (misure ? `; misure vere ${misure.map(mm).join(' × ')} mm${fonte ? ` (${fonte})` : ''}${scala !== 1 ? `, ologramma in scala 1:${mm(scala)}` : ''}` : '') + '.'];
  if (errori.some(Boolean)) righe.push(`Non prese:\n- ${errori.filter(Boolean).join('\n- ')}`);
  righe.push('Costruisci su queste. Alla prima vista mcp__mac__mostra_ologramma ti rimette accanto alla foto dell\'HUD quelle «fuori», e quelle «dentro» quando guardi in raggi-x o in sezione' +
    (misure ? '; mcp__mac__costruisci_in_blender confronta le misure con quello che costruisci.' : '.'));
  return [{ type: 'text', text: righe.join('\n') }, ...buone.map((f) => ({ type: 'image', data: f.data, mimeType: f.mimeType }))];
}

// Dopo la foto dell'HUD, quelle vere: «fuori» alla prima vista, «dentro» ai raggi X o in sezione
function accantoAlVero(corpo, out) {
  if (corpo.azione === 'mostra') {
    if (!vero || vero.mostrato || Date.now() - vero.quando > VERO_VALE_MS) {
      vero = null; // un ologramma nuovo senza foto nuove: quelle di prima erano di un altro oggetto
      out[0].text += '\nFoto vere: nessuna per questo ologramma. Se l\'oggetto esiste, guardalo con mcp__mac__guarda_oggetto_vero e confronta prima di dire che è fatto.';
      return out;
    }
    vero.mostrato = true;
    return conFotoVere(out, 'fuori', 'com\'è fuori: confronta forma, proporzioni e pezzi, e correggi prima di dire che è fatto');
  }
  const v = corpo.vista;
  if (corpo.azione === 'modifica' && vero?.mostrato && v && (v.modo === 'raggi-x' || (v.sezione && typeof v.sezione === 'object'))) {
    return conFotoVere(out, 'dentro', 'com\'è dentro: confronta i pezzi interni, dove stanno e quanto sono grandi');
  }
  return out;
}
function conFotoVere(out, cosa, perche) {
  const f = vero.foto.filter((x) => x.cosa === cosa);
  if (!f.length) return out;
  if (out.length < 2) {
    out[0].text += `\nLe foto vere di «${vero.oggetto}» (${cosa}) non te le rimetto: senza la foto dell'HUD non c'è confronto.`;
    return out;
  }
  out[0].text += `\nDopo la foto dell'HUD, ${f.length === 1 ? 'la foto vera' : `le ${f.length} foto vere`} di «${vero.oggetto}», ${perche}.`;
  for (const x of f) out.push({ type: 'image', data: x.data, mimeType: x.mimeType });
  return out;
}

// L'ingombro di quello che esce da Blender (unione dei modelli costruiti dopo guarda_oggetto_vero, ultima versione di
// ciascuno) contro le misure vere, lato per lato dal più lungo: l'orientamento non conta, le proporzioni sì.
function confrontaMisure(nome, pezzi) {
  if (!vero?.misure || Date.now() - vero.quando > 2 * VERO_VALE_MS) return null;
  const box = (lista) => [[0, 1, 2].map((i) => Math.min(...lista.map((b) => b[0][i]))), [0, 1, 2].map((i) => Math.max(...lista.map((b) => b[1][i])))];
  vero.costruito.set(nome, box(pezzi.map((p) => [p.min, p.max])));
  const [lo, hi] = box([...vero.costruito.values()]);
  const lati = [0, 1, 2].map((i) => (hi[i] - lo[i]) * vero.scala).sort((x, y) => y - x);
  const scarti = lati.map((l, i) => (l - vero.misure[i]) / vero.misure[i]);
  const pc = (s) => `${s < -0.005 ? '−' : '+'}${Math.round(Math.abs(s) * 100)}%`;
  let t = `Misure vere di «${vero.oggetto}»: ${vero.misure.map(mm).join(' × ')} mm. ` +
    `Quello che hai costruito dopo averlo guardato (${[...vero.costruito.keys()].join(', ')}), come esce da Blender e senza le copie di mcp__mac__mostra_ologramma: ` +
    `${lati.map(mm).join(' × ')} mm${vero.scala !== 1 ? ` in grandezza vera (×${mm(vero.scala)})` : ''}. Scarti dal lato più lungo: ${scarti.map(pc).join(', ')}.`;
  if (scarti.some((s) => Math.abs(s) > VERO_SCARTO)) t += ` Oltre il ${VERO_SCARTO * 100}%: correggi le misure, o di' a Tony quale lato è diverso e perché.`;
  return t;
}

TOOLS.push({
  name: 'guarda_oggetto_vero',
  description: 'Per un oggetto che esiste, dopo le ricerche e prima di costruirlo: guardi 1–3 sue foto vere e fissi le misure ufficiali. ' +
    'Le foto sono indirizzi https di immagini jpg, png, webp o gif (non la pagina) entro 2000 pixel per lato e 3,5 MB, trovati con WebSearch e WebFetch: ' +
    'Wikimedia (l\'anteprima /thumb/…/1280px-…), iFixit (.medium), il sito del produttore. «fuori» è com\'è fuori, «dentro» uno spaccato o uno smontaggio. Tornano a te; poi mcp__mac__mostra_ologramma te le rimette accanto alla foto dell\'HUD: ' +
    '«fuori» alla prima vista, «dentro» quando guardi in raggi-x o in sezione. Con «misure», mcp__mac__costruisci_in_blender confronta l\'ingombro di quello che costruisci con quello vero. ' +
    'Vale per il prossimo ologramma; una chiamata nuova sostituisce la precedente.',
  inputSchema: { type: 'object', properties: {
    oggetto: { type: 'string', description: 'cosa è, al massimo 80 caratteri: «AirPods Pro 2 con custodia»' },
    foto: { type: 'array', maxItems: VERO_FOTO, items: { type: 'object', properties: {
      url: { type: 'string', description: 'https, l\'immagine e non la pagina' },
      cosa: { type: 'string', enum: ['fuori', 'dentro'] },
    }, required: ['url', 'cosa'] } },
    misure: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'ingombro dell\'oggetto vero in mm, i tre lati in qualunque ordine' },
    fonte: { type: 'string', description: 'la pagina che dà le misure' },
    scala: { type: 'number', description: 'solo per un ologramma in scala: 1000 se è 1:1000' },
  }, required: ['oggetto'] },
  annotations: { title: 'Guarda l\'oggetto vero', readOnlyHint: true },
  run: guardaOggettoVero,
});

// Ogni forma di dati è descritta per intero in uno strumento solo, e gli altri lo citano: le definizioni degli strumenti
// stanno nel contesto del cervello a ogni domanda, e con le copie i tre strumenti pesavano 13,2 KB invece di 7,9.
const TERNA = (description) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description });
const COME = (description) => ({ type: 'array', items: { type: 'object' }, description });
const FACCIA = { type: 'string', enum: FACCE, description: 'lato del pezzo negli assi del MONDO, non del pezzo: +y è il lato più in alto' };
const CARICHI = { type: 'array', maxItems: LIMITI.carichi, description: 'forze statiche: sostituiscono quelle di prima ([] le toglie)', items: { type: 'object', properties: {
  pezzo: { type: 'string', description: 'id del pezzo' },
  faccia: FACCIA,
  forza_N: { type: 'number', description: 'newton, da 0 a 10 milioni (1 kg di peso vale 9,81 N); un urto si dà come forza statica equivalente' },
  direzione: TERNA('verso della forza, per esempio [0, -1, 0] in giù'),
}, required: ['pezzo', 'faccia', 'forza_N', 'direzione'] } };
const VINCOLI = { type: 'array', maxItems: LIMITI.vincoli, description: 'dove il pezzo è fissato: sostituiscono quelli di prima', items: { type: 'object', properties: {
  pezzo: { type: 'string', description: 'id del pezzo' },
  faccia: FACCIA,
  tipo: { type: 'string', enum: ['incastro'], description: 'incastro: quella faccia non si muove' },
}, required: ['pezzo', 'faccia'] } };
const VISTA = { type: 'object', description: 'parziale: solo i campi da cambiare', properties: {
  esploso: { type: 'number', description: 'da 0 (montato) a 1 (vista esplosa)' },
  sezione: { type: ['object', 'null'], description: 'taglio pieno, null lo toglie: resta la parte con coordinata ≤ posizione (verso 1) o ≥ (verso -1)', properties: {
    asse: { type: 'string', enum: ['x', 'y', 'z'] },
    posizione: { type: 'number', description: 'mm nel mondo' },
    verso: { type: 'number', enum: [1, -1] },
  } },
  modo: { type: 'string', enum: MODI, description: 'raggi-x mostra i pezzi interni; densita colora per materiale; sforzi colora in proporzione allo sforzo diviso lo snervamento, dal blu (lontano) al rosso (snerva), dopo analizza_struttura' },
  selezionato: { type: ['string', 'null'], description: 'id del pezzo evidenziato' },
  isolato: { type: ['string', 'null'], description: 'id del pezzo mostrato da solo' },
} };
const MISURE = 'In mm, secondo la forma. scatola {x, y, z}: i lati. cilindro {r, h}: asse Y. tubo {r, r_interno, h}. sfera {r}. ' +
  'cono {r, r_cima, h}: r in basso, r_cima in alto (0 è una punta). toro {R, r}: anello nel piano XZ, R dell\'anello e r della sezione. ' +
  'piastra {x, z, spessore, raggio}: lastra x × spessore × z, il raggio la curva (positivo verso +Y). ' +
  'estrusione {profilo, profondita, fori, fori_tondi}: profilo [[x, y], …] di 3–200 punti nel piano XY, estruso lungo Z; fori sono poligoni, fori_tondi [{x, y, r}]. ' +
  'rivoluzione {profilo}: [[r, y], …] con r ≥ 0, gira attorno a Y (alberi a gradini, vasi, ogive); si chiude dall\'asse, ma un profilo tutto fuori dall\'asse che gira su sé stesso (ripetendo il primo punto in fondo) è un anello: la parete di un ugello, una campana cava. ' +
  'ingranaggio {denti, modulo, spessore, foro}: denti dritti, da 6 a 200, raggio primitivo modulo·denti/2, spessore lungo Y. ' +
  'cavo {punti, r}: tubo curvo per 2–100 punti [[x, y, z], …]. ' +
  'file {file, scala, centra}: un modello 3D di Tony, percorso assoluto in Scrivania, Documenti, Download…, estensioni glb, stl, obj, 3mf, ply; scala sono i mm per unità del file (1000 per un GLB in metri)';
const PEZZO = { type: 'object', properties: {
  id: { type: 'string', description: 'minuscole, cifre, - e _, unico: «albero», «pala-3»' },
  nome: { type: 'string', description: 'etichetta leggibile, al massimo 60 caratteri' },
  forma: { type: 'string', enum: FORME },
  misure: { type: 'object', description: MISURE },
  posizione: TERNA('centro del pezzo in mm [x, y, z], Y in alto'),
  rotazione: TERNA('gradi [rx, ry, rz], applicati X poi Y poi Z; le forme con un asse lo hanno lungo Y'),
  materiale: { type: 'string', enum: Object.keys(MATERIALI), description: 'chiave del calcolo: solo se il materiale vero è questo o molto vicino, se no generico (si disegna, non si calcola)' },
  materiale_vero: { type: 'string', description: 'di cosa è fatto davvero, al massimo 60 caratteri: «alluminio 6063 anodizzato», «vetro»' },
  fattura: { type: 'string', description: 'come è fabbricato e montato, al massimo 140: «fresato da un estruso», «stampato a iniezione», «incollato»' },
  gruppo: { type: 'string', description: 'i pezzi dello stesso gruppo esplodono insieme' },
  esplodi: TERNA('direzione nella vista esplosa; la lunghezza, fino a 5, moltiplica la distanza'),
  interno: { type: 'boolean', description: 'pezzo interno: tenue di solito, evidente ai raggi X e in sezione' },
  colore: { type: 'string', pattern: '^#([0-9a-fA-F]{3}){1,2}$', description: 'esadecimale, «#e53935»: se Tony lo chiede o se il colore è un dato (atomi, fili); senza, il ciano. In ologramma e solido' },
  flusso: { type: 'string', enum: FLUSSI, description: 'solo cavo: impulsi disegnati che scorrono, dati dichiarati e non simulati' },
  calcolo: { type: 'boolean', description: 'entra nel calcolo degli sforzi: sì di base, no per cavo e file' },
}, required: ['id', 'forma', 'misure'] };

const OLOGRAMMI = new Set(['mostra_ologramma', 'modifica_ologramma', 'analizza_struttura']);
// Regola di Tony del 16/11: gli ologrammi si fanno in Blender, da soli, senza che lui lo chieda. Un pezzo con una forma
// nativa passa solo se è un cavo (i flussi) o se dichiara «calcolo» true (gli sforzi si calcolano solo sulle forme native).
// Prima era una riga della persona, e il cervello l'ha saltata alla prima domanda: un turbofan di 61 forme native.
const SENZA_BLENDER = new Set(['file', 'cavo']);
function soloBlender(pezzi, campo) {
  const no = (Array.isArray(pezzi) ? pezzi : []).filter((p) => p && typeof p === 'object' && FORME.includes(p.forma) && !SENZA_BLENDER.has(p.forma) && p.calcolo !== true);
  if (!no.length) return;
  throw new ToolError(`Niente è cambiato: ${no.length === 1 ? 'il pezzo' : 'i pezzi'} ${no.slice(0, 6).map((p) => `«${p.id}» (${p.forma})`).join(', ')}${no.length > 6 ? '…' : ''} in ${campo} ${no.length === 1 ? 'ha' : 'hanno'} una forma nativa. ` +
    'Regola di Tony: gli ologrammi si costruiscono in Blender. Fai i pezzi con mcp__mac__costruisci_in_blender e aprili qui come forma «file»; ' +
    'le forme native restano per i cavi e per i pezzi da calcolare con gli sforzi, che portano «calcolo» true.');
}
TOOLS.push({
  name: 'mostra_ologramma',
  description: 'Mostra nell\'HUD, a schermo intero, un ologramma 3D fatto di pezzi con misure vere in mm, al posto di quello di prima. ' +
    'Risponde con il riassunto (pezzi, ingombro, massa, pezzi senza materiale o senza fattura) e, con l\'HUD acceso, con la foto di quello che si vede: guardala e correggi prima di dire che è fatto. ' +
    'Un oggetto vero costruito così è stilizzato; per quello vero serve un file 3D di Tony (forma file).',
  inputSchema: { type: 'object', properties: {
    titolo: { type: 'string', description: 'al massimo 80 caratteri' },
    descrizione: { type: 'string', description: 'al massimo 300 caratteri' },
    pezzi: { type: 'array', minItems: 1, maxItems: LIMITI.pezzi, items: PEZZO },
    carichi: COME('carichi, come in analizza_struttura: servono solo per gli sforzi'),
    vincoli: COME('vincoli, come in analizza_struttura'),
    vista: { type: 'object', description: 'vista iniziale, come in modifica_ologramma' },
  }, required: ['titolo', 'pezzi'] },
  annotations: { title: 'Mostra un ologramma' },
  run: (a) => { soloBlender(a.pezzi, '«pezzi»'); return ologramma({ azione: 'mostra', modello: a }); },
});
TOOLS.push({
  name: 'modifica_ologramma',
  description: 'Cambia l\'ologramma: pezzi (cambia, aggiungi, togli, rimetti), vista (esploso, sezione, modo, selezionato, isolato), carichi, vincoli, titolo e descrizione. ' +
    'Ogni modifica riapre un ologramma chiuso (per riaprirlo e basta: vista {}); chiudi true lo chiude. Senza campi dice com\'è adesso, anche quello che Tony ha tolto o chiuso. ' +
    'Se c\'era un\'analisi e cambiano pezzi, materiali, carichi o vincoli, gli sforzi si ricalcolano da soli. Risponde con il riassunto e la foto.',
  inputSchema: { type: 'object', properties: {
    cambia: { type: 'array', description: 'pezzi da cambiare: l\'id più i soli campi nuovi, con gli stessi nomi dei pezzi; misure si fonde campo per campo, un testo vuoto toglie il campo', items: {
      type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    aggiungi: COME('pezzi nuovi, fatti come in mostra_ologramma'),
    togli: { type: 'array', items: { type: 'string' }, description: 'id dei pezzi da togliere: si possono rimettere' },
    rimetti: { type: 'array', items: { type: 'string' }, description: 'id dei pezzi tolti da rimettere' },
    vista: VISTA,
    carichi: COME('carichi, come in analizza_struttura: sostituiscono quelli di prima'),
    vincoli: COME('vincoli, come in analizza_struttura: sostituiscono quelli di prima'),
    titolo: { type: 'string', description: 'titolo nuovo, al massimo 80 caratteri: se cambi materiale o cosa rappresenta il modello' },
    descrizione: { type: 'string', description: 'descrizione nuova, al massimo 300 caratteri; vuota la toglie' },
    chiudi: { type: 'boolean', description: 'true chiude l\'ologramma; va mandato da solo' },
  } },
  annotations: { title: 'Modifica l\'ologramma' },
  run: (a) => {
    const { chiudi, ...resto } = a;
    if (chiudi !== true) {
      soloBlender(resto.aggiungi, '«aggiungi»');
      soloBlender((Array.isArray(resto.cambia) ? resto.cambia : []).filter((p) => p && 'forma' in p), '«cambia»');
      return ologramma({ ...resto, azione: 'modifica' });
    }
    if (Object.keys(resto).length) throw new ToolError('chiudi va mandato da solo: le modifiche in una chiamata, chiudi in un\'altra. Niente è cambiato.');
    return ologramma({ azione: 'chiudi' });
  },
});
TOOLS.push({
  name: 'analizza_struttura',
  description: 'Calcola gli sforzi dei pezzi con un materiale vero (elasticità lineare statica, a voxel): servono almeno un incastro e un carico, ' +
    'dati qui o già nell\'ologramma. Aspetta il risultato fino a un minuto: sforzo massimo, fattore di sicurezza per pezzo, spostamento e avvisi. ' +
    'È una stima: i pezzi che si toccano sono incollati, niente bulloni, fatica, urti veri o plasticità. Per i colori, vista in modo sforzi.',
  inputSchema: { type: 'object', properties: { carichi: CARICHI, vincoli: VINCOLI } },
  annotations: { title: 'Analizza gli sforzi' },
  run: (a) => ologramma({ ...a, azione: 'analizza' }),
});

// --- Meteo: client sottile di POST /api/meteo. Previsioni, conti e testo stanno nel server (meteo.mjs), il radar nell'HUD ---
TOOLS.push({
  name: 'mostra_meteo',
  description: 'Apre nell\'HUD la vista meteo di un luogo: un globo che scende sul luogo col radar delle piogge vero (ultime 2 ore), vento e pressione, profilo termico, ' +
    'timeline di 12 ore con inizio e fine delle precipitazioni, avvisi e condizioni per spostarsi; chiude le altre viste grandi. ' +
    'Risponde con i numeri da dire: adesso, precipitazioni, avvisi, prossime ore e tre giorni (Open-Meteo, orari del posto). ' +
    'Senza «luogo» usa l\'ultimo chiesto. chiudi true la chiude.',
  inputSchema: { type: 'object', properties: {
    luogo: { type: 'string', description: 'nome della città o del comune, solo il nome: «Milano»' },
    paese: { type: 'string', description: 'codice ISO di due lettere, se il nome è di più posti: «IT»' },
    chiudi: { type: 'boolean', description: 'true chiude la vista; va mandato da solo' },
  } },
  annotations: { title: 'Meteo', readOnlyHint: true },
  run: async (a) => {
    if (!PORTA) throw new ToolError(`la porta di Nexus negli argomenti non è valida (${process.argv.slice(2).join(' ')})`);
    let r, d = null;
    try {
      r = await fetch(`http://127.0.0.1:${PORTA}/api/meteo`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(a.chiudi === true ? { chiudi: true } : { luogo: a.luogo, paese: a.paese }), signal: AbortSignal.timeout(30_000) });
      d = await r.json().catch(() => null);
    } catch (e) {
      throw new ToolError(`il server di Nexus non risponde sulla porta ${PORTA} (${e.cause?.code || e.message})`);
    }
    if (!r.ok || d?.ok !== true) throw new ToolError(`Niente meteo (il server ha risposto ${r.status})${Array.isArray(d?.errori) ? `: ${d.errori.join('; ')}` : '.'}`);
    return String(d.testo ?? '');
  },
});
// --- Blender: pezzi procedurali per gli ologrammi (16/11, richiesta di Tony) ---
// Lo script del cervello è Python libero, quindi gira in una gabbia di sandbox-exec: niente rete (anche localhost), niente
// Apple Events, niente altri programmi, niente letture in /Users, /Volumes e nelle cartelle temporanee (dove le app
// lasciano file loro) fuori dalla sua cartella e dagli attrezzi,
// scritture solo nella cartella della versione. Provato il 16/11 dentro Blender: tutte le vie bloccate, avvio in 1,8 s.
const BLENDER = process.env.NEXUS_BLENDER || '/Applications/Blender.app/Contents/MacOS/Blender';
const CARTELLA_BLENDER = (() => { const i = process.argv.indexOf('--blender'); return i < 0 ? null : process.argv[i + 1] || null; })();
const ATTREZZI = path.join(DIR, 'blender');
const BLENDER_MS = 90_000;
const VERSIONI_TENUTE = 5;      // quelle prima si cancellano: un ologramma aperto usa quasi sempre l'ultima
const SCRIPT_MAX = 100_000;
const TRIANGOLI_FILE = 1e6;     // TRIANGOLI_MAX di geometrie.js: oltre, l'HUD non apre il file
const NOME_BLENDER = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Regola di Tony del 16/11: niente primitive standard, le forme nascono da vertici e facce
const VIETATE = [[/\bprimitive_\w+_add\b/, 'bpy.ops.mesh.primitive_*'], [/\bbmesh\.ops\.create_\w+/, 'bmesh.ops.create_*']];
const sb = (s) => `"${s.replace(/["\\]/g, '\\$&')}"`;
const gabbia = (blender, dir) => [
  '(version 1)', '(allow default)', '(deny network*)', '(deny appleevent-send)',
  '(deny process-exec*)', `(allow process-exec* (literal ${sb(blender)}))`,
  '(deny file-write*)', `(allow file-write* (subpath ${sb(dir)}) (literal "/dev/null"))`,
  '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp"))', `(allow file-read* (subpath ${sb(dir)}) (subpath ${sb(ATTREZZI)}))`,
].join('\n');
const it = (n) => (Math.round(n) || 0).toLocaleString('it-IT'); // || 0: niente «-0»

async function costruisciInBlender(a) {
  const nome = String(a.nome ?? ''), script = String(a.script ?? '');
  if (!NOME_BLENDER.test(nome)) throw new ToolError('«nome» vuole minuscole, cifre e trattini, fino a 40 caratteri: «ventola», «staffa-motore»');
  if (!script.trim() || script.length > SCRIPT_MAX) throw new ToolError(`«script» vuoto o oltre ${it(SCRIPT_MAX)} caratteri`);
  for (const [re, cosa] of VIETATE) {
    if (re.test(script)) throw new ToolError(`Rifiutato: lo script usa ${cosa}. Regola di Tony: niente primitive standard, ogni forma nasce da vertici e facce (anello, loft, rivoluzione, tappo).`);
  }
  if (!CARTELLA_BLENDER) throw new ToolError('manca la cartella di lavoro negli argomenti (mcp.json, --blender): riavvia Nexus');
  let blender;
  try { blender = fs.realpathSync(BLENDER); } catch { throw new ToolError(`Blender non c'è (${BLENDER}): finché Tony non lo installa, i pezzi si fanno con mcp__mac__mostra_ologramma`); }
  const base = path.join(CARTELLA_BLENDER, nome);
  fs.mkdirSync(base, { recursive: true });
  const versioni = () => fs.readdirSync(base).map((d) => Number(/^v(\d+)$/.exec(d)?.[1])).filter(Number.isInteger).sort((x, y) => x - y);
  const v = (versioni().at(-1) ?? 0) + 1;
  fs.mkdirSync(path.join(base, `v${v}`));
  const dir = fs.realpathSync(path.join(base, `v${v}`)); // la gabbia confronta percorsi veri
  const tmp = path.join(dir, '.tmp');
  fs.mkdirSync(tmp);
  const file = path.join(dir, 'script.py');
  fs.writeFileSync(file, script);
  const t0 = Date.now();
  const r = await new Promise((resolve) => {
    const child = execFile('/usr/bin/sandbox-exec', ['-p', gabbia(blender, dir), blender, '-b', '--factory-startup', '--python', path.join(ATTREZZI, 'gabbia.py'), '--', dir, file],
      { timeout: BLENDER_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', cwd: dir, env: { ...process.env, TMPDIR: tmp, PYTHONNOUSERSITE: '1' } },
      (error, stdout, stderr) => { inFlight.delete(child); resolve({ error, out: `${stdout}\n${stderr}` }); });
    inFlight.add(child);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  const secondi = ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',');
  let rap = null;
  try { rap = JSON.parse(fs.readFileSync(path.join(dir, 'rapporto.json'), 'utf8')); } catch {}
  if (!rap?.pezzi?.length || rap.errore) {
    const pezzi = rap?.pezzi?.length ? rap.pezzi : null;
    if (!pezzi) fs.rmSync(dir, { recursive: true, force: true });
    if (r.error?.killed) throw new ToolError(`Blender non ha finito entro ${BLENDER_MS / 1000} s: lo script è troppo pesante (meno anelli, meno sezioni o meno pezzi). Niente esportato.`);
    if (rap?.errore) throw new ToolError(`Lo script si è fermato:\n${rap.errore}\nCorreggi e richiama con lo stesso nome.`);
    if (rap) throw new ToolError('Lo script non ha creato oggetti mesh: chiudi ogni pezzo con oggetto(nome, bm).');
    throw new ToolError(`Blender è uscito senza rapporto (codice ${r.error?.code ?? 0}): ${r.out.trim().split('\n').slice(-6).join(' | ').slice(0, 600)}`);
  }
  // le versioni vecchie si cancellano: sono file di Nexus nella sua cartella, rifatti in un paio di secondi
  for (const vecchia of versioni().slice(0, -VERSIONI_TENUTE)) fs.rmSync(path.join(base, `v${vecchia}`), { recursive: true, force: true });
  const tot = rap.pezzi.reduce((s, p) => s + p.triangoli, 0);
  const righe = [`Costruito «${nome}», versione ${v}, in ${secondi} s: ${rap.pezzi.length} file, ${it(tot)} triangoli in tutto.`];
  const avvisi = [];
  for (const p of rap.pezzi) {
    const q = p.facce ? Math.round((100 * p.quadrilateri) / p.facce) : 0;
    const box = [0, 1, 2].map((i) => `${'xyz'[i]} da ${it(p.min[i])} a ${it(p.max[i])}`).join(', ');
    righe.push(`- ${p.nome}: ${it(p.triangoli)} triangoli, ${q}% quadrilateri, ${p.chiuso ? 'chiuso' : 'APERTO'}; ${box} mm\n  ${p.file}`);
    if (p.triangoli > TRIANGOLI_FILE) avvisi.push(`${p.nome} supera ${it(TRIANGOLI_FILE)} triangoli: l'HUD non lo apre`);
    if (!p.chiuso) avvisi.push(`${p.nome} è aperto: sezione e raggi X lo disegnano male; chiudilo con tappo, tappo_piano o una rivoluzione`);
  }
  if (tot > TRIANGOLI_FILE) avvisi.push(`oltre ${it(TRIANGOLI_FILE)} triangoli in tutto: con le mani l'HUD scende sotto 45 fps (2 milioni fanno 33 fps)`);
  if (avvisi.length) righe.push(`Avvisi: ${avvisi.join('; ')}.`);
  const confronto = confrontaMisure(nome, rap.pezzi);
  if (confronto) righe.push(confronto);
  righe.push('Per vederli: mcp__mac__mostra_ologramma, un pezzo per file, forma «file», misure { file: percorso, centra: false }: posizione [0, 0, 0] lo lascia dove lo script l\'ha messo. ' +
    'Un file può fare più pezzi, con rotazione e posizione diverse; i triangoli contano a ogni copia. Questi pezzi non entrano nel calcolo degli sforzi.');
  return righe.join('\n');
}
TOOLS.push({
  name: 'costruisci_in_blender',
  description: 'Costruisce in Blender i pezzi di ogni ologramma: pale ed eliche svergolate, gusci, raccordi, superfici organiche, e anche quelli semplici. ' +
    'Lo script è Python di Blender (bpy, bmesh) e gira in una gabbia senza rete né file di Tony. Regole di Tony: niente primitive (bpy.ops.mesh.primitive_* e bmesh.ops.create_* sono rifiutati); ' +
    'ogni forma nasce da vertici e facce, a quadrilateri, con dettagli veri: raccordi, nervature, giochi. ' +
    'Misure in mm e coordinate dell\'HUD (Y in alto): il punto (x, y, z) che dai agli attrezzi è il punto (x, y, z) del file e di mcp__mac__mostra_ologramma. ' +
    'Già pronti, senza import: anello(bm, punti); trasforma(bm, rotazione, posizione), coi gradi di mcp__mac__mostra_ologramma; loft(bm, anelli, chiuso); tappo(bm, anello), che unisce il punto k al 2n−1−k; tappo_piano(bm, anello); ' +
    'rivoluzione(bm, [(r, y), …], n, chiuso) attorno a Y, con le punte sull\'asse chiuse a quadrilateri; profilo_naca(corda, curvatura, pos_curvatura, spessore, n); profilo_tondo(lungo, largo, esponente, n); ' +
    'ruota2d(pts, gradi, du, dv); offset2d(pts, e); raccordo_circolare(r, n); bezier, bezier_punti, bezier_tangente; noise (Perlin di mathutils), math, Vector; V(x, y, z) solo per bm.verts.new, mai dentro gli attrezzi. ' +
    'Ogni pezzo si chiude con oggetto(nome, bm, raccordo_mm) e diventa un file GLB. Risponde con percorsi, triangoli e ingombri; poi mcp__mac__mostra_ologramma con forma file e centra false.',
  inputSchema: { type: 'object', properties: {
    nome: { type: 'string', pattern: NOME_BLENDER.source, description: 'il modello: «ventola», «staffa-motore»; lo stesso nome fa una versione nuova' },
    script: { type: 'string', description: 'Python per Blender, al massimo 100.000 caratteri' },
  }, required: ['nome', 'script'] },
  annotations: { title: 'Costruisci in Blender' },
  run: costruisciInBlender,
});
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --- JSON-RPC su stdio ---

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const log = (...a) => process.stderr.write(`[mac] ${a.join(' ')}\n`);

let queue = Promise.resolve(); // un'azione alla volta: mouse e tastiera non si accavallano
let codaOlo = Promise.resolve(); // gli ologrammi in fila fra loro, ma a parte: un calcolo di un minuto non ferma mouse e tastiera

async function callTool(params) {
  const tool = BY_NAME.get(params?.name);
  if (!tool) return { error: { code: -32602, message: `strumento sconosciuto: ${params?.name}` } };
  const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  try {
    const r = await tool.run(args);
    return { result: { content: typeof r === 'string' ? [{ type: 'text', text: r }] : r } };
  } catch (e) {
    if (!(e instanceof ToolError)) log(params.name, e.stack || e.message);
    return { result: { content: [{ type: 'text', text: e.message }], isError: true } };
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (r) => { if (id !== undefined && id !== null) send({ id, ...r }); };
  switch (method) {
    case 'initialize':
      return reply({ result: {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'nexus-mac', version: '1.0.0' },
        instructions: 'Controllo del Mac di Tony. Prima di cliccare fai «schermo»: le coordinate sono in pixel dell\'ultima schermata. ' +
          'Per aprire o chiudere un\'app usa apri_app e chiudi_app, non il mouse. I compiti per dopo si segnano con «ricorda». ' +
          'Un oggetto che esiste si guarda prima con mcp__mac__guarda_oggetto_vero (foto vere e misure). ' +
          'Gli oggetti in 3D si costruiscono con mcp__mac__costruisci_in_blender e si mostrano con mcp__mac__mostra_ologramma, il meteo con mcp__mac__mostra_meteo. Ogni strumento si chiama col nome intero.',
      } });
    case 'ping':
      return reply({ result: {} });
    case 'tools/list':
      return reply({ result: { tools: TOOLS.map(({ run: _, ...t }) => t) } });
    case 'tools/call': {
      const run = async () => reply(await callTool(params));
      if (params?.name === 'mostra_meteo') return run(); // solo rete: non aspetta mouse e tastiera, e non li ferma
      // guarda_oggetto_vero sta nella stessa fila: le foto vere devono esserci prima del mostra che le rimette accanto
      if (OLOGRAMMI.has(params?.name) || params?.name === 'costruisci_in_blender' || params?.name === 'guarda_oggetto_vero') return (codaOlo = codaOlo.then(run).catch((e) => log(e.message)));
      queue = queue.then(run).catch((e) => log(e.message));
      return queue;
    }
    default:
      if (method === 'notifications/cancelled') { // "stop": mouse e tastiera si fermano, le attese degli ologrammi pure
        for (const c of inFlight) c.kill('SIGTERM');
        for (const c of olo) c.abort();
        return;
      }
      if (method?.startsWith('notifications/')) return; // initialized…: nessuna risposta
      return reply({ error: { code: -32601, message: `metodo sconosciuto: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'JSON non valido' } }); }
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    Promise.resolve(handle(m)).catch((e) => {
      log(e.stack || e.message);
      if (m.id != null) send({ id: m.id, error: { code: -32603, message: e.message } });
    });
  }
});
rl.on('close', () => {
  for (const c of olo) c.abort(); // il cervello se n'è andato: nessuno aspetta più le foto
  Promise.allSettled([queue, codaOlo]).finally(() => process.exit(0));
});
ensureHelper().catch((e) => log(e.message)); // compila subito, se serve, mentre il client si presenta
