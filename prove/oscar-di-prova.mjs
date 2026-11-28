// oscar-di-prova.mjs — uno O.S.C.A.R. di prova col cervello vero, isolato, per le prove che parlano col modello: una copia del
// codice (la persona si può cambiare prima di partire), il suo cervello in una cartella temporanea, un Chrome headless suo per
// Google (così non compare nessuna finestra), il server senza HUD. Alla fine cancella copia, cartella e la conversazione che
// Claude Code ha registrato. L'ambiente del server è scritto qui, con USER: senza, la CLI non trova la login (CLAUDE.md, Lezioni).
// Lo stesso avvio sta, scritto a mano, in prove/schede-cervello.mjs.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export async function avviaOscarDiProva({ porta, pw, cdp, log, persona = (p) => p }) {
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-copia-'));
  const prova = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-cervello-'));
  execFileSync('/usr/bin/rsync', ['-a', '--exclude', '.git', '--exclude', 'node_modules', '--exclude', 'runtime', '--exclude', '.claude', '--exclude', '.env', `${REPO}/`, `${copia}/`]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(copia, 'node_modules'));
  const f = path.join(copia, 'oscar-persona.md');
  fs.writeFileSync(f, persona(fs.readFileSync(f, 'utf8')));
  const uscita = fs.openSync(log, 'w');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdp}`, `--user-data-dir=${path.join(prova, 'chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  await pausa(1500);
  const server = spawn(process.execPath, ['server.mjs'], { cwd: copia, stdio: ['ignore', uscita, uscita],
    env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH, OSCAR_CERVELLO: prova, OSCAR_PORT: String(porta),
      OSCAR_BROWSER_PORT: String(pw), OSCAR_CDP_PORT: String(cdp), OSCAR_NO_OPEN: '1' } });
  const base = `http://localhost:${porta}`;
  let su = false;
  for (let i = 0; i < 90 && !su; i++) { await pausa(1000); su = await fetch(`${base}/api/status`).then((r) => r.ok).catch(() => false); }

  // Una domanda come la manda l'HUD: gli eventi del flusso, ognuno col suo tempo in secondi dalla domanda
  async function chiedi(corpo) {
    const t0 = performance.now(), eventi = [], at = () => +((performance.now() - t0) / 1000).toFixed(3);
    try {
      const r = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(420000) });
      const dec = new TextDecoder(), reader = r.body.getReader();
      let resto = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        let k;
        while ((k = resto.indexOf('\n')) >= 0) {
          const riga = resto.slice(0, k); resto = resto.slice(k + 1);
          if (riga.trim()) eventi.push({ ...JSON.parse(riga), at: at() });
        }
      }
    } catch (e) { eventi.push({ t: 'errore', errore: String(e), at: at() }); }
    return eventi;
  }
  const ferma = () => fetch(`${base}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } });
  // La conversazione registrata da Claude Code: i messaggi del cervello col testo grezzo, coi segnali che il server toglie
  function conversazione() {
    const id = JSON.parse(fs.readFileSync(path.join(prova, 'cervello.json'), 'utf8')).id;
    const progetti = path.join(os.homedir(), '.claude', 'projects');
    const dir = fs.readdirSync(progetti).find((d) => fs.existsSync(path.join(progetti, d, `${id}.jsonl`)));
    return dir ? { dir: path.join(progetti, dir), righe: fs.readFileSync(path.join(progetti, dir, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } : null;
  }
  async function chiudi() {
    let conv = null; try { conv = conversazione(); } catch {}
    server.kill('SIGTERM');
    for (let i = 0; i < 20 && server.exitCode === null && server.signalCode === null; i++) await pausa(250);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    chrome.kill('SIGTERM');
    await pausa(800);
    fs.rmSync(copia, { recursive: true, force: true });
    fs.rmSync(prova, { recursive: true, force: true });
    if (conv?.dir) fs.rmSync(conv.dir, { recursive: true, force: true }); // la conversazione di prova
    const porte = (() => { try { return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${porta}`, `-iTCP:${pw}`, `-iTCP:${cdp}`, '-sTCP:LISTEN', '-t']).toString().trim(); } catch { return ''; } })();
    if (porte) console.error(`porte ancora aperte: ${porte}`);
  }
  if (!su) { await chiudi(); throw new Error('il server di prova non parte'); }
  return { chiedi, ferma, conversazione, chiudi };
}
