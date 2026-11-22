// voce.mjs — voice.mjs vero, senza server: Kokoro per una risposta, poi Kokoro ucciso a metà (la frase dopo si salta, niente
// voce del Mac in mezzo), la voce del Mac per la risposta dopo, e Kokoro che riparte da solo. Vuole Kokoro installato
// (./installa-kokoro.sh; in una worktree basta un collegamento a ~/STEM/runtime/kokoro). Circa 10 s.
// node prove/voce.mjs → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVoice } from '../voice.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const log = [];
const v = createVoice({ cartella: `${ROOT}/runtime/kokoro`, script: `${ROOT}/voce-kokoro.py`, onLog: (l) => log.push(l) });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const esito = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); c ? ok++ : ko++; };
esito(v.status.provider === 'mac', 'prima che Kokoro sia pronto lo stato dice mac', JSON.stringify(v.status));
for (let i = 0; i < 100 && v.status.provider !== 'kokoro'; i++) await pausa(100);
esito(v.status.provider === 'kokoro' && v.status.voce === 'im_nicola', 'Kokoro pronto', JSON.stringify(v.status));
let t = performance.now(); const a = await v.speak('Guardo subito.', 'r1');
esito(a.provider === 'kokoro' && a.type === 'audio/wav' && a.data.toString('latin1', 0, 4) === 'RIFF', 'prima frase da Kokoro, in WAV', `${((performance.now() - t) / 1000).toFixed(2)} s, ${a.data.length} B`);
const b = await v.speak('Domani piove dalle tre.', 'r1');
esito(b.provider === 'kokoro', 'seconda frase, stessa voce');
const p = v.speak('Questa frase la perdo perché Kokoro muore.', 'r1');
process.kill(v.pid, 'SIGTERM'); // solo il Kokoro di questa prova
const c = await p.then((x) => x.provider, (e) => e.message);
esito(c === 'frase saltata per non cambiare voce', 'Kokoro muore a metà risposta: la frase si salta, niente voce del Mac', c);
const d = await v.speak('Risposta nuova.', 'r2');
esito(d.provider === 'mac', 'risposta dopo, con Kokoro fermo: voce del Mac', d.provider);
for (let i = 0; i < 100 && v.status.provider !== 'kokoro'; i++) await pausa(100);
const e = await v.speak('Sono tornato.', 'r3');
esito(e.provider === 'kokoro' && log.some((l) => l.includes('Kokoro fermo')), 'Kokoro riparte da solo e la risposta dopo torna sua', log.filter((l) => l.includes('fermo')).join(' | ').slice(0, 120));
v.ferma();
console.log(`\n${ok} passati, ${ko} falliti`);
process.exit(ko ? 1 : 0);
