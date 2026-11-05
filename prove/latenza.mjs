// Quanto ci mette il cervello a dire la prima parola, con un modello e un effort: serve a scegliere STEM_MODEL misurando.
// Come in brain.mjs, un solo claude -p sempre acceso con la persona di STEM; le domande arrivano una dopo l'altra.
// Il primo turno paga l'avvio del processo e la cache fredda, quindi mediana e massimo contano solo gli altri.
// uso: node prove/latenza.mjs <modello> [effort]      es. node prove/latenza.mjs claude-opus-5-5
// Ogni domanda è un turno vero del modello: consuma come una domanda a STEM.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [model, effort] = process.argv.slice(2);
if (!model) { console.error('uso: node prove/latenza.mjs <modello> [effort]'); process.exit(1); }
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const persona = fs.readFileSync(path.join(ROOT, 'stem-persona.md'), 'utf8');
const QS = ['Ciao, ci sei?', 'Spiegami in due frasi perché il cielo è blu.', 'Quanto fa 17 per 23?',
  'Che differenza c\'è tra un virus e un batterio?', 'Dammi un consiglio per dormire meglio.', 'Che cos\'è un buco nero, in breve?',
  'Come si dice in inglese «domani piove»?', 'Raccontami una battuta.'];
// Cartella vuota come quella del cervello: dalla radice della repository caricherebbe il CLAUDE.md di sviluppo
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-latenza-'));
const c = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  '--append-system-prompt', persona, '--tools', 'Read', '--model', model, ...(effort ? ['--effort', effort] : [])],
{ cwd, stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '', i = -1, t0 = 0, first = 0, usedModel = '';
const rows = [];
function next() {
  if (++i >= QS.length) return c.stdin.end();
  t0 = performance.now(); first = 0;
  c.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: QS[i] } }) + '\n');
}
c.stdout.on('data', (d) => {
  buf += d;
  let k;
  while ((k = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, k); buf = buf.slice(k + 1);
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'system' && o.subtype === 'init') usedModel = o.model;
    if (o.type === 'stream_event' && o.event.type === 'content_block_delta' && o.event.delta?.type === 'text_delta' && !first) first = performance.now();
    if (o.type === 'result') {
      rows.push({ q: QS[i], prima: (first || performance.now()) - t0, fine: performance.now() - t0, out: o.usage?.output_tokens });
      next();
    }
  }
});
c.on('close', () => {
  const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
  console.log(`${model}${effort ? ` (effort ${effort})` : ''} → ${usedModel}`);
  for (const r of rows) console.log(`  prima parola ${s(r.prima)}, fine ${s(r.fine)}, ${r.out ?? '?'} token in uscita | ${r.q}`);
  const warm = rows.slice(1).map((r) => r.prima).sort((a, b) => a - b);
  if (warm.length) console.log(`  dal secondo turno: mediana ${s(warm[Math.floor(warm.length / 2)])}, massimo ${s(warm.at(-1))}`);
  fs.rmSync(cwd, { recursive: true, force: true });
});
next();
