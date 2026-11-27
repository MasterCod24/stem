// Scaricare dal web senza aprire porte verso il Mac: solo https verso indirizzi pubblici, controllati dopo il DNS e a ogni
// rimando (niente O.S.C.A.R., altri servizi del Mac o la rete di casa), con un tetto ai byte e al tempo.
// Lo usano guarda_oggetto_vero (mac/mac-mcp.mjs) e le foto delle schede (schede.mjs). Il tipo di un'immagine si legge dai
// primi byte, non da quello che dice il sito, e le misure dall'intestazione, senza decodificarla.
import dns from 'node:dns/promises';

export const UA_WEB = { 'user-agent': 'OSCAR/1.0 (assistente personale)' };

export function indirizzoPrivato(ip) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('::ffff:');
}

// byte: il tetto; troppo: il messaggio quando lo supera; ms: il tempo massimo di ogni richiesta
export async function scaricaSicuro(indirizzo, { byte, ms, troppo = 'troppo grande', headers = UA_WEB } = {}) {
  let u;
  try { u = new URL(String(indirizzo ?? '')); } catch { throw new Error('non è un indirizzo'); }
  for (let rimandi = 0; ; rimandi++) {
    if (u.protocol !== 'https:' || u.port || u.username || u.password) throw new Error('serve https, senza porta né credenziali');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const ind = await dns.lookup(host, { all: true }).catch(() => []);
    if (!ind.length) throw new Error(`${host} non si trova`);
    if (ind.some((x) => indirizzoPrivato(x.address))) throw new Error(`${host} porta a un indirizzo del Mac o della rete di casa`);
    let r;
    try { r = await fetch(u, { headers, redirect: 'manual', signal: AbortSignal.timeout(ms) }); } catch (e) { throw new Error(`il sito non risponde (${e.cause?.code || e.name})`); }
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
        if (n > byte) throw new Error(troppo);
        parti.push(c);
      }
    } catch (e) { throw e.name === 'TimeoutError' ? new Error(`non è arrivata entro ${ms / 1000} s`) : e; }
    return Object.assign(Buffer.concat(parti), { finale: u.href }); // finale: l'indirizzo dopo i rimandi
  }
}

export function tipoFoto(b) { // dai primi byte, non da quello che dice il sito
  if (b.length < 16) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
export const TIPI_FOTO = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// Larghezza e altezza dall'intestazione, senza decodificare l'immagine
export function latiFoto(b, tipo) {
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
