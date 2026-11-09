// lavoratore.mjs — l'ingresso del worker_threads del calcolo degli sforzi: analizza() dura secondi e
// bloccherebbe il server. Il lavoro arriva in workerData, il risultato torna con i due array trasferiti
// (non copiati) e il worker finisce. Un errore torna come testo: basta il messaggio, che è per il cervello.
import { parentPort, workerData } from 'node:worker_threads';
import { analizza } from './struttura.mjs';

if (!parentPort) throw new Error('lavoratore.mjs va lanciato da calcolaInWorker, come worker');
let messaggio, trasferiti = [];
try {
  const r = analizza(workerData);
  messaggio = { ok: true, r };
  trasferiti = [r.voxel_pezzo.buffer, r.vm.buffer];
} catch (e) {
  messaggio = { ok: false, errore: String((e && e.message) || e) };
}
parentPort.postMessage(messaggio, trasferiti);
