// oggetto-vero.mjs — prova guarda_oggetto_vero e il confronto col vero, senza O.S.C.A.R. né cervello: parla con mac/mac-mcp.mjs
// su stdio come il cervello, con un finto /api/ologramma che risponde con una foto dell'HUD finta.
//   node prove/oggetto-vero.mjs     circa 20 s, vuole la rete (Wikimedia) e Blender in /Applications (o OSCAR_BLENDER)
// Controlla: i rifiuti (http, Mac, rete di casa, pagine, foto oltre 2000 px), le anteprime che passano intatte,
// le foto rimesse accanto a quella dell'HUD (fuori alla prima vista, dentro ai raggi X e in sezione, mai su un ologramma
// nuovo senza foto nuove) e il confronto delle misure in costruisci_in_blender, anche in scala.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERO_LATO_PROVA = 2000; // VERO_LATO di mac-mcp.mjs: le foto più larghe si rifiutano
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}

// Il finto server degli ologrammi: «senza-hud» nel titolo risponde senza foto, come con l'HUD spento
const PNG_HUD = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let versione = 0, senzaHud = false;
const finto = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; }).on('end', () => {
    const c = JSON.parse(b || '{}');
    if (c.azione === 'mostra') senzaHud = /senza-hud/.test(c.modello?.titolo || '');
    versione++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, versione, testo: `fatto: ${c.azione}`, ...(!senzaHud && { foto: PNG_HUD }) }));
  });
});
await new Promise((ok) => finto.listen(0, '127.0.0.1', ok));

const BASE = path.join(ROOT, 'runtime', `prova-vero-${process.pid}`);
const CARTELLA = path.join(BASE, 'Documents', 'OSCAR-Blender');
fs.mkdirSync(CARTELLA, { recursive: true });
const mcp = spawn(process.execPath, [path.join(ROOT, 'mac', 'mac-mcp.mjs'), '--porta', String(finto.address().port), '--blender', CARTELLA], { stdio: ['pipe', 'pipe', 'inherit'] });
const attese = new Map();
let buf = '', id = 0;
mcp.stdout.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    attese.get(m.id)?.(m); attese.delete(m.id);
  }
});
const chiama = (method, params) => new Promise((ok) => { const n = ++id; attese.set(n, ok); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const strumento = async (name, args) => {
  const t0 = performance.now();
  const m = await chiama('tools/call', { name, arguments: args });
  const c = m.result?.content ?? [];
  return { errore: m.result?.isError === true, testo: c.filter((x) => x.type === 'text').map((x) => x.text).join('\n'), immagini: c.filter((x) => x.type === 'image'), ms: performance.now() - t0 };
};
// Larghezza e altezza di un jpg dai suoi byte (marcatore SOF)
function misuraJpg(b64) {
  const b = Buffer.from(b64, 'base64');
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1], n = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + n;
  }
  return null;
}

try {
  const lista = await chiama('tools/list');
  const g = lista.result.tools.find((t) => t.name === 'guarda_oggetto_vero');
  esito(!!g, 'guarda_oggetto_vero è fra gli strumenti', g ? `${Buffer.byteLength(JSON.stringify(g))} B` : '');

  // ------------------------------------------------------------ rifiuti, senza rete
  for (const [url, attesa, nome] of [
    ['http://upload.wikimedia.org/x.jpg', /serve https/, 'http'],
    ['https://localhost/x.png', /indirizzo del Mac o della rete di casa/, 'localhost'],
    ['https://127.0.0.1/x.png', /indirizzo del Mac/, '127.0.0.1'],
    ['https://[::1]/x.png', /indirizzo del Mac/, '[::1]'],
    ['https://192.168.1.1/x.png', /rete di casa/, '192.168.1.1'],
    ['https://upload.wikimedia.org:8443/x.png', /senza porta/, 'porta diversa da 443'],
    ['file:///etc/passwd', /serve https/, 'file://'],
  ]) {
    const r = await strumento('guarda_oggetto_vero', { oggetto: 'prova', foto: [{ url, cosa: 'fuori' }] });
    esito(r.errore && attesa.test(r.testo), `rifiutato: ${nome}`, r.testo.split('\n').at(-1));
  }
  let r = await strumento('guarda_oggetto_vero', { oggetto: 'prova' });
  esito(r.errore && /foto, le misure/.test(r.testo), 'senza foto né misure: errore');
  r = await strumento('guarda_oggetto_vero', { oggetto: 'prova', misure: [10, -1, 3] });
  esito(r.errore && /numeri positivi/.test(r.testo), 'misure sbagliate: errore');

  // ------------------------------------------------------------ foto vere, con la rete (Wikimedia Commons)
  // Previsione: l'originale grande è rifiutato col consiglio dell'anteprima; l'anteprima da 1280 passa intatta in meno di 5 s
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10' +
    '&gsrsearch=' + encodeURIComponent('turbofan engine cutaway filetype:bitmap') + '&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1280';
  const pagine = Object.values((await (await fetch(api, { headers: { 'user-agent': 'OSCAR/1.0 (prova)' } })).json()).query?.pages ?? {});
  const infos = pagine.map((p) => p.imageinfo?.[0]).filter((i) => i?.mime === 'image/jpeg' && i.width > VERO_LATO_PROVA && i.thumburl);
  const [grande, altra] = infos;
  if (!esito(!!grande && !!altra, 'Wikimedia dà due jpg grandi con l\'anteprima', grande ? `${grande.width}×${grande.height}, ${(grande.size / 2 ** 20).toFixed(1)} MB` : 'niente')) throw new Error('senza foto di prova');

  r = await strumento('guarda_oggetto_vero', { oggetto: 'pagina', foto: [{ url: grande.descriptionurl, cosa: 'fuori' }] });
  esito(r.errore && /è una pagina/.test(r.testo), 'una pagina invece della foto: rifiutata', r.testo.split('\n').at(-1));
  r = await strumento('guarda_oggetto_vero', { oggetto: 'originale', foto: [{ url: grande.url, cosa: 'fuori' }] });
  esito(r.errore && (/è di \d+×\d+ pixel/.test(r.testo) || /oltre 3,5 MB/.test(r.testo)) && /\/thumb\//.test(r.testo), 'l\'originale grande: rifiutato col consiglio dell\'anteprima', r.testo.split('\n').at(-1).slice(0, 120));

  // Larga ma leggera: rifiutata dai pixel dell'intestazione, non dal peso. Poi un'anteprima png: intestazione png letta
  const cerca = async (q, w) => Object.values((await (await fetch('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=20' +
    '&gsrsearch=' + encodeURIComponent(q) + `&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=${w}`, { headers: { 'user-agent': 'OSCAR/1.0 (prova)' } })).json()).query?.pages ?? {}).map((p) => p.imageinfo?.[0]);
  const larga = (await cerca('engine diagram filetype:bitmap', 800)).find((i) => i?.mime === 'image/jpeg' && i.width > 2100 && i.size < 3 * 2 ** 20);
  if (esito(!!larga, 'Wikimedia dà un jpg largo ma leggero', larga ? `${larga.width}×${larga.height}, ${(larga.size / 2 ** 20).toFixed(1)} MB` : 'niente')) {
    r = await strumento('guarda_oggetto_vero', { oggetto: 'larga', foto: [{ url: larga.url, cosa: 'fuori' }] });
    esito(r.errore && new RegExp(`è di ${larga.width}×${larga.height} pixel`).test(r.testo), 'rifiutata dai pixel letti nell\'intestazione jpg', r.testo.split('\n').at(-1).slice(0, 90));
  }
  const pngInfo = (await cerca('engine cutaway filemime:png', 600)).find((i) => i?.mime === 'image/png' && i.thumburl);
  if (esito(!!pngInfo, 'Wikimedia dà un\'anteprima png')) {
    r = await strumento('guarda_oggetto_vero', { oggetto: 'png', foto: [{ url: pngInfo.thumburl, cosa: 'fuori' }] });
    esito(!r.errore && r.immagini[0]?.mimeType === 'image/png', 'l\'anteprima png passa come png', `${pngInfo.thumbwidth}×${pngInfo.thumbheight}`);
  }

  r = await strumento('guarda_oggetto_vero', {
    oggetto: 'Turbofan di prova', misure: [2400, 1000, 1000], fonte: 'prova',
    foto: [{ url: grande.thumburl, cosa: 'fuori' }, { url: altra.thumburl, cosa: 'dentro' }, { url: 'https://localhost/x.png', cosa: 'dentro' }],
  });
  const dim = r.immagini.map((x) => misuraJpg(x.data));
  esito(!r.errore && r.immagini.length === 2 && r.immagini.every((x) => x.mimeType === 'image/jpeg'), 'due anteprime prese, la terza no, e l\'errore lo dice',
    `${r.immagini.length} immagini; ${/foto 3 \(dentro\)/.test(r.testo) ? 'errore della terza nel testo' : 'ERRORE MANCANTE'}`);
  esito(dim[0]?.w === grande.thumbwidth && dim[1]?.w === altra.thumbwidth, 'passano intatte, della loro misura', dim.map((d) => d && `${d.w}×${d.h}`).join(', '));
  esito(r.ms < 5000, 'scaricate in meno di 5 s', `${Math.round(r.ms)} ms`);

  // ------------------------------------------------------------ accanto alla foto dell'HUD
  const pezzi = [{ id: 'a', forma: 'file', misure: { file: '/Users/x/a.glb', centra: false } }];
  r = await strumento('mostra_ologramma', { titolo: 'Turbofan', pezzi });
  esito(!r.errore && r.immagini.length === 2 && r.immagini[0].mimeType === 'image/png' && r.immagini[1].mimeType === 'image/jpeg' && /foto vera di «Turbofan di prova», com'è fuori/.test(r.testo),
    'prima vista: foto dell\'HUD, poi la foto vera «fuori»', `${r.immagini.map((x) => x.mimeType).join(', ')}`);
  r = await strumento('modifica_ologramma', { vista: { esploso: 1 } });
  esito(r.immagini.length === 1, 'un esploso non rimette le foto vere');
  r = await strumento('modifica_ologramma', { vista: { modo: 'raggi-x' } });
  esito(r.immagini.length === 2 && /com'è dentro/.test(r.testo), 'ai raggi X: foto dell\'HUD e foto vera «dentro»');
  r = await strumento('modifica_ologramma', { vista: { sezione: { asse: 'x', posizione: 0, verso: 1 } } });
  esito(r.immagini.length === 2, 'in sezione: anche');
  r = await strumento('modifica_ologramma', { vista: { sezione: null } });
  esito(r.immagini.length === 1, 'togliere la sezione non le rimette');
  r = await strumento('mostra_ologramma', { titolo: 'Altro oggetto', pezzi });
  esito(r.immagini.length === 1 && /nessuna per questo ologramma/.test(r.testo), 'un ologramma nuovo senza foto nuove: niente foto vecchie, e il testo lo dice');
  r = await strumento('modifica_ologramma', { vista: { modo: 'raggi-x' } });
  esito(r.immagini.length === 1, '…e nemmeno ai raggi X');
  r = await strumento('guarda_oggetto_vero', { oggetto: 'Con HUD spento', foto: [{ url: altra.thumburl, cosa: 'fuori' }] });
  r = await strumento('mostra_ologramma', { titolo: 'senza-hud', pezzi });
  esito(r.immagini.length === 0 && /senza la foto dell'HUD non c'è confronto/.test(r.testo), 'HUD spento: niente foto vere, e il testo dice perché');
} catch (e) {
  esito(false, 'la parte con la rete', e.message);
}

// ------------------------------------------------------------ misure contro Blender
const BLOCCO = (x, y, z, nome = 'Blocco') => `
bm = bmesh.new()
q = [(${-x / 2}, 0, ${-z / 2}), (${x / 2}, 0, ${-z / 2}), (${x / 2}, 0, ${z / 2}), (${-x / 2}, 0, ${z / 2})]
a0 = anello(bm, q)
a1 = anello(bm, [(u, ${y}, w) for u, y0, w in q])
loft(bm, [a0, a1])
tappo_piano(bm, a0)
tappo_piano(bm, a1)
oggetto('${nome}', bm)
`;
let r = await strumento('guarda_oggetto_vero', { oggetto: 'Mattone', misure: [20, 100, 50], fonte: 'prova' });
esito(!r.errore && r.immagini.length === 0 && /misure vere 100 × 50 × 20 mm/.test(r.testo), 'solo misure: accettate, dal lato più lungo', r.testo.split('\n')[0]);
r = await strumento('costruisci_in_blender', { nome: 'mattone', script: BLOCCO(100, 50, 20) });
esito(!r.errore && /100 × 50 × 20 mm/.test(r.testo) && /Scarti dal lato più lungo: \+0%, \+0%, \+0%\./.test(r.testo) && !/Oltre il 10%/.test(r.testo),
  'stesso ingombro (girato): scarti a zero', r.testo.match(/Scarti[^\n]*/)?.[0] ?? r.testo.slice(0, 300));
r = await strumento('costruisci_in_blender', { nome: 'mattone', script: BLOCCO(130, 50, 20) });
esito(/\+30%, \+0%, \+0%/.test(r.testo) && /Oltre il 10%/.test(r.testo), 'versione nuova più lunga: +30% e la richiesta di correggere', r.testo.match(/Scarti[^\n]*/)?.[0]);
r = await strumento('costruisci_in_blender', { nome: 'sporgenza', script: BLOCCO(10, 10, 10).replace("oggetto('Blocco'", "trasforma(bm, (0, 0, 0), (0, 60, 0))\noggetto('Sporgenza'") });
esito(/\(mattone, sporgenza\)/.test(r.testo) && /130 × 70 × 20 mm/.test(r.testo), 'due modelli: conta l\'unione', r.testo.match(/Quello che[^\n]*/)?.[0]?.slice(0, 200));
r = await strumento('guarda_oggetto_vero', { oggetto: 'Torre', misure: [1000, 500, 200], scala: 10 });
r = await strumento('costruisci_in_blender', { nome: 'torre', script: BLOCCO(100, 50, 20) });
esito(/\+0%, \+0%, \+0%/.test(r.testo) && /in grandezza vera \(×10\)/.test(r.testo), 'in scala 1:10: confronta la grandezza vera', r.testo.match(/Scarti[^\n]*/)?.[0]);
r = await strumento('guarda_oggetto_vero', { oggetto: 'Solo foto', foto: [{ url: 'https://localhost/x.png', cosa: 'fuori' }], misure: [1, 1, 1] });
r = await strumento('costruisci_in_blender', { nome: 'torre', script: BLOCCO(100, 50, 20) });
esito(/Solo foto/.test(r.testo), 'una chiamata nuova sostituisce la precedente');

mcp.kill();
finto.close();
fs.rmSync(BASE, { recursive: true, force: true });
console.log(`\n${passati} passati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
