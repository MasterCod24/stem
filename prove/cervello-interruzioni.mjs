// cervello-interruzioni.mjs — un cervello ucciso da Nexus per un'interruzione lenta riprende sempre la stessa conversazione,
// anche se lo si uccide mentre sta ancora ripartendo. Il 17/11 sera una domanda di Telegram e due dell'HUD in 11 s l'hanno
// fatto uccidere due volte; la seconda contava come «morto appena nato», e brain.mjs ha aperto una conversazione nuova.
// Un claude finto (bin/claude nella cartella della prova) non chiude mai il turno e ignora le interruzioni, e scrive i
// suoi argomenti a ogni avvio. Niente server né modello, circa 15 s.
// node prove/cervello-interruzioni.mjs → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CASA = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-interruzioni-'));
const AVVII = path.join(CASA, 'avvii.jsonl'), SESSIONE = '00000000-0000-4000-8000-00000000c0de';
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function attendi(fn, ms, passo = 100) { const fine = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > fine) return v; await pausa(passo); } }

const BIN = path.join(CASA, 'bin');
fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(AVVII)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: '${SESSIONE}' }) + '\\n');
out({ type: 'system', subtype: 'init' });
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.type === 'control_request') return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } }); // ma il turno non si chiude
  if (m.type === 'user') out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ci penso' } } });
});
process.stdin.on('end', () => process.exit(0));
`, { mode: 0o755 });
process.env.PATH = `${BIN}:${process.env.PATH}`;

const { createBrain } = await import('../brain.mjs');
const registro = [];
const brain = createBrain({ cwd: CASA, args: [], sessionFile: path.join(CASA, 'cervello.json'), onLog: (l) => registro.push(l) });
const avvii = () => { try { return fs.readFileSync(AVVII, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)); } catch { return []; } };
const riprende = (a) => a && a[a.indexOf('--resume') + 1] === SESSIONE && a.includes('--resume');

await attendi(() => avvii().length >= 1, 5000);
brain.ask('la domanda di Telegram', () => {});
await pausa(300);
brain.ask("la prima dell'HUD", () => {}); // interrompe: il finto non chiude, dopo 4 s lo uccido e riparte
const secondo = await attendi(() => avvii()[1], 12_000);
esito(riprende(secondo), 'ucciso per l\'interruzione lenta, riparte riprendendo la conversazione', JSON.stringify(secondo?.slice(0, 2)));
brain.ask("la seconda dell'HUD", () => {}); // subito, mentre il secondo sta ripartendo: lo uccido di nuovo prima di 20 s
const terzo = await attendi(() => avvii()[2], 15_000);
esito(riprende(terzo), 'ucciso di nuovo mentre ripartiva: riprende ancora la stessa conversazione', JSON.stringify(terzo?.slice(0, 2)));
esito(!registro.some((l) => l.includes('ne apro una nuova')), 'nessuna conversazione nuova nel registro', registro.filter((l) => !l.includes('fermo')).join(' | '));

brain.kill(); // il finto esce quando si chiude il suo ingresso
await pausa(300);
console.log(`\n${passati} passati, ${falliti} falliti`);
if (!falliti) fs.rmSync(CASA, { recursive: true, force: true });
process.exit(falliti ? 1 : 0);
