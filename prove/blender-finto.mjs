#!/usr/bin/env node
// blender-finto.mjs — un Blender finto per le prove del server (OSCAR_BLENDER=prove/blender-finto.mjs): parla come
// mac/blender/vivo.py, senza finestre. Prende gli argomenti di Blender e usa solo quelli dopo «--»: --porta e --gettone.
// OSCAR_BLENDER_FINTO=<file>: una riga JSON per ogni messaggio ricevuto, più {fine: segnale} all'uscita.
// <file>.comandi: le righe che ci scrive la prova diventano eventi verso il server ({evento: …}), oppure cambiano il
// comportamento: {foto: 'mai'} o {foto: 0} (risponde o no alla foto), {esci: 0} (Blender chiuso da Tony).
import fs from 'node:fs';
import net from 'node:net';
import zlib from 'node:zlib';

const a = process.argv.slice(process.argv.indexOf('--') + 1);
const arg = (k) => a[a.indexOf(k) + 1];
const PORTA = Number(arg('--porta')), GETTONE = arg('--gettone');
const REG = process.env.OSCAR_BLENDER_FINTO || null, CMD = REG && `${REG}.comandi`;
const scrivi = (o) => { if (REG) fs.appendFileSync(REG, JSON.stringify(o) + '\n'); };
let fotoMai = false, conn = null;
const inAttesa = [];
const scatta = (m) => { fs.writeFileSync(m.file, FOTO_FINTA); manda({ rid: m.rid, file: m.file }); };
// i comandi scritti prima che questo Blender partisse erano per un altro: si parte dalla fine del file
let letti = CMD && fs.existsSync(CMD) ? fs.readFileSync(CMD, 'utf8').split('\n').filter(Boolean).length : 0;

// Un PNG vero di 8×5 pixel ciano: quello che la prova si aspetta di ritrovare nella risposta dello strumento
function png() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const pezzo = (tipo, dati) => { const t = Buffer.concat([Buffer.from(tipo), dati]), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(dati.length); c.writeUInt32BE(crc(t)); return Buffer.concat([l, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(5, 4); ihdr[8] = 8; ihdr[9] = 2;
  const righe = Buffer.concat(Array.from({ length: 5 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [0, 240, 255]).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(righe)), pezzo('IEND', Buffer.alloc(0))]);
}
export const FOTO_FINTA = png();

const manda = (o) => conn?.write(JSON.stringify(o) + '\n');
const srv = net.createServer((c) => {
  conn = c;
  let buf = '';
  c.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let m; try { m = JSON.parse(buf.slice(0, i)); } catch { m = null; }
      buf = buf.slice(i + 1);
      if (!m || m.gettone !== GETTONE) { scrivi({ rifiutato: true }); continue; }
      delete m.gettone;
      scrivi(m.tipo === 'ologramma' ? { tipo: 'ologramma', versione: m.stato.versione, modello: m.stato.modello, pezzi: m.stato.pezzi.map((p) => p.id),
        mesh: Object.keys(m.mesh), percorsi: Object.keys(m.percorsi), campo: Boolean(m.campo), info: m.info.length, materiali: m.materiali.length,
        file: Object.fromEntries(m.stato.pezzi.filter((p) => p.forma === 'file').map((p) => [p.id, { file: p.misure.file, errore: p.errore }])) } : m);
      if (m.tipo === 'ologramma') manda({ rid: m.rid, versione: m.stato.versione });
      else if (m.tipo === 'foto') { if (fotoMai) inAttesa.push(m); else scatta(m); }
    }
  });
});
srv.listen(PORTA, '127.0.0.1');
setInterval(() => { // i comandi della prova
  if (!CMD || !fs.existsSync(CMD)) return;
  const righe = fs.readFileSync(CMD, 'utf8').split('\n').filter(Boolean);
  for (const r of righe.slice(letti)) {
    const o = JSON.parse(r);
    if ('foto' in o) { fotoMai = o.foto === 'mai'; if (!fotoMai) inAttesa.splice(0).forEach(scatta); }
    if ('esci' in o) { scrivi({ fine: 'esci' }); process.exit(0); }
    if (o.evento) manda(o);
  }
  letti = righe.length;
}, 30);
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { scrivi({ fine: s }); process.exit(0); });
