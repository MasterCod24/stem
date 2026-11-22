// blender.mjs — l'ologramma si vede in Blender, non più nell'HUD (richiesta di Tony del 22/11).
// Il server resta l'unico padrone dello stato (ologramma.mjs): qui lo si traduce per mac/blender/vivo.py, che gira in una
// finestra vera di Blender, gli si passano i gesti delle mani dell'HUD e si ricevono le modifiche che Tony fa nella scheda.
// Blender parte quando un ologramma si apre e si chiude quando l'ologramma si chiude; se Tony chiude Blender, l'ologramma
// risulta chiuso da lui. Il canale è TCP su 127.0.0.1 con un gettone a caso: senza, vivo.py ignora le righe.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geometria } from './public/ologramma/geometrie.js';
import { volume, massaTesto } from './public/ologramma/forme.js';
import { MATERIALI } from './public/ologramma/materiali.js';

const GESTI = new Set(['stato', 'cursore', 'ruota', 'zoom', 'esplodi', 'afferra', 'sposta', 'lascia', 'lancia', 'ricomponi']);

const portaLibera = () => new Promise((ok, ko) => { const s = net.createServer(); s.on('error', ko); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const numIt = (x, c) => x.toLocaleString('it-IT', { maximumFractionDigits: c, minimumFractionDigits: 0 });

/** Un gesto di gesti.js con soli campi noti e numeri finiti, o null. */
export function gestoValido(g) {
  if (!g || typeof g !== 'object' || !GESTI.has(g.tipo)) return null;
  const out = { tipo: g.tipo };
  for (const k of ['x', 'y', 'dx', 'dy', 'vx', 'vy', 'fattore', 'delta']) {
    if (k in g) { const v = Number(g[k]); if (!Number.isFinite(v) || Math.abs(v) > 1e3) return null; out[k] = v; }
  }
  if (g.tipo === 'stato') { if (!['riposo', 'pronto', 'azione', 'spente'].includes(g.fase)) return null; out.fase = g.fase; }
  return out;
}

// ---------------------------------------------------------------- dallo stato al messaggio per vivo.py
function meshDi(p, cacheMesh) {
  const firma = JSON.stringify([p.forma, p.misure]);
  if (cacheMesh.has(firma)) return cacheMesh.get(firma);
  let g = geometria(p);
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-4); // senza le cuciture delle normali: in Blender lo smussato si decide con l'angolo
  const pos = g.attributes.position.array, idx = g.index ? g.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const out = { v: Array.from(pos, (x) => Math.round(x * 1e4) / 1e4), f: Array.from(idx) };
  if (cacheMesh.size > 400) cacheMesh.clear();
  cacheMesh.set(firma, out);
  return out;
}
function percorsoDi(p) {
  const punti = p.misure.punti.map((q) => new THREE.Vector3(...q));
  return new THREE.CatmullRomCurve3(punti, false, 'centripetal').getPoints(Math.min(400, 24 * punti.length)).map((v) => [v.x, v.y, v.z]);
}
function infoDi(p, s) {
  const m = MATERIALI[p.materiale] || MATERIALI.generico;
  const righe = [];
  if (p.materiale && p.materiale !== 'generico') righe.push(`Calcolato come ${m.nome}`, m.densita ? `Densità: ${numIt(m.densita, 0)} kg/m³` : '');
  const vol = p.forma === 'file' ? null : volume(p);
  if (vol && m.densita) righe.push(`Massa: ${massaTesto((vol * 1e-9) * m.densita)}`);
  const a = s.analisi?.stato === 'fatta' ? s.analisi.pezzi?.find((x) => x.id === p.id) : null;
  if (a) righe.push(`Sforzo massimo: ${numIt(a.sforzo_max_MPa, 1)} MPa`, `Sicurezza: ${numIt(a.fs_min, 2)}${a.fs_min < 1 ? ' (cede)' : ''}`);
  else if (p.forma === 'file' && s.analisi) righe.push('Fuori dal calcolo degli sforzi (pezzo da file)');
  return { id: p.id, testo: righe.filter(Boolean).join('\n'), densita: m.densita ?? null };
}
/** Il messaggio {tipo:'ologramma'} per vivo.py: lo stato, le mesh delle forme native, i percorsi dei cavi, la scheda, il campo. */
export function messaggioOlogramma(s, { campo = () => null, controllaFile = () => ({ errore: 'nessun controllo' }), cartella, cacheMesh = new Map() } = {}) {
  const mesh = {}, percorsi = {};
  for (const p of s.pezzi) {
    if (p.forma !== 'file') mesh[p.id] = meshDi(p, cacheMesh);
    if (p.forma === 'cavo' && p.flusso) percorsi[p.id] = percorsoDi(p);
  }
  let c = null;
  const k = campo(), a = s.analisi?.campo;
  if (k && a && s.analisi.stato === 'fatta') {
    const file = path.join(cartella, 'campo.bin');
    fs.writeFileSync(file, Buffer.from(k.fs.buffer, k.fs.byteOffset, k.fs.byteLength));
    c = { file, nx: a.nx, ny: a.ny, nz: a.nz, h: a.h, origine: a.origine };
  }
  // I pezzi da file passano solo col percorso vero che il server ha controllato; gli altri arrivano col motivo
  const pezzi = s.pezzi.map((p) => {
    if (p.forma !== 'file') return p;
    const k = controllaFile(p.misure.file);
    return k.vero ? { ...p, misure: { ...p.misure, file: k.vero } } : { ...p, misure: { ...p.misure, file: null }, errore: k.errore };
  });
  return { tipo: 'ologramma', stato: { ...s, pezzi }, mesh, percorsi, campo: c, info: s.pezzi.map((p) => infoDi(p, s)),
    materiali: Object.entries(MATERIALI).map(([k2, m]) => [k2, m.nome]) };
}

export function createBlender({ bin, vivo, cartella, campo = () => null, controllaFile = () => ({ errore: 'nessun controllo' }), onEvento = () => {}, onFoto = () => {}, onLog = () => {} }) {
  let proc = null, conn = null, gettone = null, avvio = null, chiudendo = false, buf = '', rid = 0;
  let ultimo = null, inviata = null, inVolo = false; // l'ultimo stato chiesto, l'ultima versione mandata
  const attese = new Map();
  const cacheMesh = new Map(); // firma della forma → { v, f }: le forme che non cambiano non si rifanno
  fs.mkdirSync(cartella, { recursive: true });

  function manda(m) { if (conn) conn.write(JSON.stringify({ gettone, ...m }) + '\n'); }
  function chiedi(m, ms = 30_000) {
    return new Promise((ok, ko) => {
      const id = ++rid;
      const t = setTimeout(() => { attese.delete(id); ko(new Error(`Blender non ha risposto a ${m.tipo} in ${ms / 1000} s`)); }, ms);
      attese.set(id, (r) => { clearTimeout(t); attese.delete(id); r.errore ? ko(new Error(r.errore)) : ok(r); });
      manda({ ...m, rid: id });
    });
  }

  async function apri() {
    if (avvio) return avvio;
    chiudendo = false;
    avvio = (async () => {
      const porta = await portaLibera();
      gettone = crypto.randomBytes(24).toString('hex');
      // --factory-startup: niente componenti aggiuntivi né preferenze di Tony (il server MCP di Blender vorrebbe la sua
      // porta), e niente preferenze salvate da questa istanza. -Y: niente script dei .blend.
      const p = spawn(bin, ['--factory-startup', '--disable-autoexec', '--window-maximized', '--python', vivo, '--', '--porta', String(porta), '--gettone', gettone],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      proc = p;
      const righe = (d) => { for (const l of String(d).split('\n')) if (/\[vivo\]|Traceback|Error/.test(l)) onLog(`[blender] ${l.trim().slice(0, 300)}`); };
      p.stdout.on('data', righe); p.stderr.on('data', righe);
      p.on('error', (e) => onLog(`[blender] non parte: ${e.message}`));
      p.on('exit', (codice, segnale) => {
        if (proc !== p) return;
        proc = null; conn?.destroy(); conn = null; avvio = null; inviata = null;
        for (const r of attese.values()) r({ errore: 'Blender si è chiuso' });
        if (!chiudendo) { onLog(`[blender] chiuso (${codice ?? segnale})`); onEvento({ evento: 'chiuso' }); }
      });
      const fine = Date.now() + 40_000;
      while (!conn && Date.now() < fine && proc === p) {
        conn = await new Promise((ok) => { const c = net.connect(porta, '127.0.0.1', () => ok(c)); c.on('error', () => ok(null)); });
        if (!conn) await new Promise((r) => setTimeout(r, 250));
      }
      if (!conn) { chiudi(); throw new Error('Blender non risponde'); }
      conn.setNoDelay(true);
      conn.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          let m; try { m = JSON.parse(buf.slice(0, i)); } catch { m = null; }
          buf = buf.slice(i + 1);
          if (!m) continue;
          if (m.rid != null) attese.get(m.rid)?.(m);
          else if (m.evento) onEvento(m);
        }
      });
      conn.on('close', () => { conn = null; });
      // davanti a tutto: Blender lanciato da un processo in background può aprirsi dietro l'HUD
      const app = path.resolve(bin, '../../..');
      if (app.endsWith('.app')) execFile('/usr/bin/open', ['-a', app], () => {});
      onLog('[blender] aperto');
    })();
    try { await avvio; } catch (e) { avvio = null; throw e; }
    return avvio;
  }

  function chiudi() {
    chiudendo = true;
    const p = proc;
    proc = null; conn?.destroy(); conn = null; avvio = null; inviata = null;
    if (p) { try { p.kill('SIGTERM'); } catch {} setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 3000).unref(); }
  }

  // L'ultimo stato vince: se ne arrivano tre mentre Blender carica il primo, si manda solo il terzo
  async function scorri() {
    if (inVolo) return;
    inVolo = true;
    try {
      while (ultimo && ultimo.aperto && (!inviata || inviata.versione !== ultimo.versione || inviata.modello !== ultimo.modello || inviata.forza)) {
        const s = ultimo;
        if (!conn) await apri();
        await chiedi(messaggioOlogramma(s, { campo, controllaFile, cartella, cacheMesh }), 60_000);
        inviata = { modello: s.modello, versione: s.versione };
        const file = path.join(cartella, `foto-${s.modello}-${s.versione}.png`);
        try {
          await chiedi({ tipo: 'foto', file }, 15_000);
          const png = fs.readFileSync(file).toString('base64');
          fs.rmSync(file, { force: true });
          onFoto(s.modello, s.versione, png);
        } catch (e) { onLog(`[blender] foto: ${e.message}`); }
      }
    } catch (e) {
      onLog(`[blender] ${e.message}`);
      onEvento({ evento: 'errore', testo: e.message });
    } finally { inVolo = false; }
  }

  return {
    /** Lo stato nuovo dell'ologramma: lo apre in Blender, lo aggiorna, o chiude Blender. forza: rimanda anche la stessa versione. */
    stato(s, forza = false) {
      ultimo = s;
      if (!s.aperto) { ultimo = null; if (proc) chiudi(); return; }
      if (forza && inviata) inviata.forza = true;
      scorri();
    },
    gesto(g) { if (conn) manda(g); },
    messaggio(testo) { manda({ tipo: 'messaggio', testo }); },
    chiedi,
    chiudi,
    get attivo() { return Boolean(conn); },
    get avvio() { return Boolean(proc && !conn); },
  };
}
