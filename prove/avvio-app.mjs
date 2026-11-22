// Prova l'eseguibile dichiarato dal bundle, il vero avvia-app.sh e il passaggio a Node.
// Solo il server è sostituito: scrive una ricevuta nella cartella temporanea.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pausa } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const sorgente = process.argv[2] || path.join(root, 'O.S.C.A.R.app');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-avvio-'));
try {
  const progetto = path.join(tmp, "L'assistente di prova");
  fs.mkdirSync(progetto);
  const app = path.join(progetto, 'O.S.C.A.R.app');
  execFileSync('/usr/bin/ditto', [sorgente, app]);
  for (const f of ['avvia-app.sh', 'config.mjs']) fs.copyFileSync(path.join(root, f), path.join(progetto, f));
  fs.mkdirSync(path.join(progetto, 'node_modules/@mediapipe/tasks-vision'), { recursive: true });
  fs.writeFileSync(path.join(progetto, 'server.mjs'), `import fs from 'node:fs';
    setTimeout(() => fs.writeFileSync('ricevuta.json', JSON.stringify([process.cwd(), process.env.OSCAR_APP])), 100);`);
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', app]);
  const nome = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  execFileSync(path.join(app, 'Contents/MacOS', nome), [], {
    cwd: '/', env: { ...process.env, OSCAR_PORT: '0', NO_PROXY: 'localhost,127.0.0.1' }, timeout: 5000, killSignal: 'SIGKILL',
  });
  const ricevuta = path.join(progetto, 'ricevuta.json');
  for (let i = 0; i < 100 && !fs.existsSync(ricevuta); i++) await pausa(50);
  assert.deepEqual(JSON.parse(fs.readFileSync(ricevuta, 'utf8')), [fs.realpathSync(progetto), '1']);
  console.log('PASS: il launcher firmato avvia lo script e il processo Node nella cartella corretta.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
