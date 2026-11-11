#!/usr/bin/env node
// STEM — server MCP per il controllo del Mac (stdio, JSON-RPC 2.0, un messaggio JSON per riga). Senza dipendenze.
// Le azioni native le fa runtime/stem-mac, compilato al volo da mac/helper.swift.
import { execFile } from 'node:child_process';
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
const STEM_OWNED = path.join(ROOT, 'runtime') + path.sep; // i Chrome di STEM (HUD e finestra di Google) hanno il profilo qui

// Niente tastiera nei terminali e nei gestori di password: server.mjs esclude già il Terminale («Niente Terminale»),
// e una pagina web non deve poter far scrivere comandi a STEM.
// Anche gli editor di codice (hanno un terminale dentro) e le app che eseguono script: i file STEM li modifica con i suoi strumenti.
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
const LAUNCHER = '«STEM» (STEM.app nella cartella di STEM), oppure «Terminale» se lo avvii da avvia.command';
const who = (p) => (p.app ? `«${p.app}»${p.percorso ? ` (${p.percorso})` : ''}` : LAUNCHER);

function permissionText(kind, p = {}) {
  const k = PANELS[kind];
  const app = who(p);
  return `Non ho il permesso per ${k.serve}. Apri Impostazioni di Sistema → Privacy e sicurezza → ${k.nome} e attiva ${app}. ` +
    `Se è già attiva, spegnila e riaccendila, poi riavvia STEM. Lo strumento «permessi» con apri="${kind}" apre quel pannello.`;
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
  const tmp = path.join(os.tmpdir(), `stem-schermo-${process.pid}-${Date.now()}.png`);
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

async function stemOwned(pids) { // i processi avviati da STEM col profilo in runtime/
  if (!pids.length) return new Set();
  const r = await run('/bin/ps', ['-o', 'pid=,command=', '-p', pids.join(',')]);
  const own = new Set();
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m && m[2].includes(STEM_OWNED)) own.add(Number(m[1]));
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
  // Se gira solo il Chrome di STEM, ne apro uno di Tony a parte invece di riattivare quello dell'HUD
  const inst = (await running()).filter((r) => r.bundle && r.bundle === app.bundle);
  const own = await stemOwned(inst.map((r) => r.pid));
  const onlyStem = inst.length > 0 && inst.every((r) => own.has(r.pid));
  const r = await run('/usr/bin/open', onlyStem ? ['-n', '-a', app.percorso] : ['-a', app.percorso]);
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
  const own = await stemOwned(all.map((x) => x.pid));
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
    description: 'Dice se STEM ha i permessi di Accessibilità (mouse e tastiera) e di Registrazione schermo, e per quale app vanno dati. ' +
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
  description: 'Apre a schermo intero, nell\'HUD di STEM, un report fatto di blocchi che arrivano dal fondo e si incastrano in una griglia. ' +
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
// A batteria il Mac va in stop dopo un po' che nessuno lo tocca (parlare a STEM non conta): lì niente gira, nemmeno l'orologio
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
    'Il momento si dà in uno dei due modi: «tra_minuti» oppure «alle». Funziona solo con STEM acceso e il Mac sveglio: se no, il compito aspetta.',
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
// La porta arriva dagli argomenti (mcp.json: --porta <STEM_PORT>), perché .env non arriva ai processi figli. Una porta
// sbagliata non ripiega sulla 4321: una prova finirebbe sullo STEM vero.
const PORTA = (() => {
  const i = process.argv.indexOf('--porta');
  if (i < 0) return 4321;
  const n = Number(process.argv[i + 1]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
})();
const ATTESA_MS = 95_000; // il server aspetta il calcolo fino a 60 s e poi la foto fino a 8 s
const olo = new Set();    // richieste in volo: «stop» le annulla
async function ologramma(corpo) {
  if (!PORTA) throw new ToolError(`la porta di STEM negli argomenti non è valida (${process.argv.slice(2).join(' ')}): niente è cambiato`);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ATTESA_MS);
  olo.add(ctrl);
  let r, testo;
  try {
    r = await fetch(`http://127.0.0.1:${PORTA}/api/ologramma`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: ctrl.signal });
    testo = await r.text();
  } catch (e) {
    throw new ToolError(ctrl.signal.aborted
      ? `nessuna risposta da STEM entro ${ATTESA_MS / 1000} s, o richiesta annullata: il cambio può essere arrivato lo stesso, guardalo con modifica_ologramma senza campi`
      : `il server di STEM non risponde sulla porta ${PORTA} (${e.cause?.code || e.message}): niente è cambiato`);
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
  return out;
}

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
  rotazione_auto: { type: 'boolean', description: 'gira da solo' },
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
  run: (a) => ologramma({ azione: 'mostra', modello: a }),
});
TOOLS.push({
  name: 'modifica_ologramma',
  description: 'Cambia l\'ologramma: pezzi (cambia, aggiungi, togli, rimetti), vista (esploso, sezione, modo, selezionato, isolato, rotazione_auto), carichi, vincoli, titolo e descrizione. ' +
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
    if (chiudi !== true) return ologramma({ ...resto, azione: 'modifica' });
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
        serverInfo: { name: 'stem-mac', version: '1.0.0' },
        instructions: 'Controllo del Mac di Tony. Prima di cliccare fai «schermo»: le coordinate sono in pixel dell\'ultima schermata. ' +
          'Per aprire o chiudere un\'app usa apri_app e chiudi_app, non il mouse. I compiti per dopo si segnano con «ricorda». ' +
          'Gli oggetti in 3D si mostrano con mostra_ologramma.',
      } });
    case 'ping':
      return reply({ result: {} });
    case 'tools/list':
      return reply({ result: { tools: TOOLS.map(({ run: _, ...t }) => t) } });
    case 'tools/call': {
      const run = async () => reply(await callTool(params));
      if (OLOGRAMMI.has(params?.name)) return (codaOlo = codaOlo.then(run).catch((e) => log(e.message)));
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
