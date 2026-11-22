// blender.mjs — prova costruisci_in_blender senza O.S.C.A.R. né cervello: parla con mac/mac-mcp.mjs su stdio come il cervello.
//   node prove/blender.mjs     circa 20 s, vuole Blender in /Applications (o OSCAR_BLENDER)
// Controlla gli attrezzi (loft, tappi, rivoluzioni con le punte, raccordi), le coordinate dell'HUD nei file, il rifiuto
// delle primitive, gli errori dello script, le versioni tenute e la gabbia: rete, localhost, file di Tony, cartelle
// temporanee, scritture fuori e altri programmi devono essere tutti bloccati. Una riga PASS o FAIL per caso.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
// Sotto /Users come la cartella vera (Documenti), così la prova passa dalla stessa regola della gabbia
const BASE = path.join(ROOT, 'runtime', `prova-blender-${process.pid}`);
const CARTELLA = path.join(BASE, 'Documents', 'OSCAR-Blender');
fs.mkdirSync(CARTELLA, { recursive: true });
const SEGRETO = path.join(BASE, 'segreto.txt');
fs.writeFileSync(SEGRETO, 'non deve uscire');
const TEMP = fs.mkdtempSync('/private/tmp/prova-blender-');
fs.writeFileSync(path.join(TEMP, 'segreto.txt'), 'non deve uscire');

const mcp = spawn(process.execPath, [path.join(ROOT, 'mac', 'mac-mcp.mjs'), '--porta', '4999', '--blender', CARTELLA], { stdio: ['pipe', 'pipe', 'inherit'] });
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
const costruisci = async (nome, script) => {
  const m = await chiama('tools/call', { name: 'costruisci_in_blender', arguments: { nome, script } });
  return { errore: !!m.result?.isError, testo: m.result?.content?.map((c) => c.text).join('\n') ?? JSON.stringify(m) };
};

const BUONO = `
# pala: base, raccordo e profilo NACA svergolato
bm = bmesh.new()
base = profilo_tondo(120, 60, 8, 32)
anelli = [anello(bm, [(u, 0, v) for u, v in base]), anello(bm, [(u, 10, v) for u, v in base])]
for h, e in raccordo_circolare(6, 6):
    p = offset2d(ruota2d(profilo_naca(100, 0.04, 0.4, 0.12, 32), 10), e)
    anelli.append(anello(bm, [(u, 10 + h, v) for u, v in p]))
for i in range(1, 11):
    s = i / 10
    p = ruota2d(profilo_naca(100 - 40 * s, 0.04, 0.4, 0.12 - 0.06 * s, 32), 10 + 30 * s)
    anelli.append(anello(bm, [(u, 16 + 200 * s, v) for u, v in p]))
loft(bm, anelli)
tappo(bm, anelli[0]); tappo(bm, anelli[-1])
oggetto('Pala', bm, 0.5)
# capsula: rivoluzione con le due punte sull'asse
bm = bmesh.new()
rivoluzione(bm, [(0, 0), (40, 2), (50, 10), (50, 90), (40, 98), (0, 100)], 64)
oggetto('capsula', bm, 0)
# la stessa capsula girata come in mostra_ologramma: (90, 0, 0) porta l'asse Y lungo +Z, poi spostata in x
bm = bmesh.new()
rivoluzione(bm, [(0, 0), (40, 2), (50, 10), (50, 90), (40, 98), (0, 100)], 64)
trasforma(bm, (90, 0, 0), (200, 0, 0))
oggetto('capsula-z', bm, 0)
# flangia: rivoluzione chiusa, spostata con la posizione dell'oggetto a z = 300
bm = bmesh.new()
rivoluzione(bm, [(30, 0), (60, 0), (60, 8), (30, 8)], 64, chiuso=True)
ob = oggetto('flangia', bm, 0.6)
ob.location = V(0, 0, 300)
`;

try {
  await chiama('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prova', version: '1' } });
  const lista = (await chiama('tools/list', {})).result.tools;
  const t = lista.find((x) => x.name === 'costruisci_in_blender');
  esito(!!t, 'lo strumento è nella lista', t ? `${Buffer.byteLength(JSON.stringify(t))} B di definizione` : '');

  let t0 = Date.now(), r = await costruisci('prova', BUONO);
  const ms = Date.now() - t0;
  esito(!r.errore && /4 file/.test(r.testo), 'quattro oggetti, quattro file', `${ms} ms`);
  const riga = (n) => r.testo.split('\n').find((l) => l.startsWith(`- ${n}:`)) ?? '';
  esito(/100% quadrilateri, chiuso/.test(riga('pala')), 'la pala è tutta a quadrilateri e chiusa', riga('pala').slice(2, 80));
  esito(/100% quadrilateri, chiuso; x da -50 a 50, y da 0 a 100, z da -50 a 50/.test(riga('capsula')), 'capsula: punte chiuse a quadrilateri, ingombro giusto in Y in alto', riga('capsula').slice(2));
  esito(/chiuso; x da 150 a 250, y da -50 a 50, z da 0 a 100 mm/.test(riga('capsula-z')), 'trasforma gira come «rotazione» di mostra_ologramma e poi sposta', riga('capsula-z').slice(2));
  esito(/chiuso; x da -60 a 60, y da 0 a 8, z da 240 a 360/.test(riga('flangia')), 'flangia: la posizione dell\'oggetto arriva come z dell\'HUD', riga('flangia').slice(2));
  const v1 = path.join(CARTELLA, 'prova', 'v1');
  esito(['pala.glb', 'capsula.glb', 'capsula-z.glb', 'flangia.glb', 'modello.blend', 'script.py', 'rapporto.json'].every((f) => fs.existsSync(path.join(v1, f))) && !fs.existsSync(path.join(v1, '.tmp')),
    'nella versione: i GLB, il .blend, lo script e il rapporto, senza la cartella temporanea');

  r = await costruisci('prova', 'bpy.ops.mesh.primitive_cube_add(size=10)');
  esito(r.errore && /niente primitive/.test(r.testo), 'una primitiva di Blender è rifiutata', r.testo.slice(0, 60));
  r = await costruisci('prova', 'bm = bmesh.new()\nbmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=8, radius=5)');
  esito(r.errore && /bmesh\.ops\.create_/.test(r.testo), 'anche una primitiva di bmesh');
  // 17/11: un profilo chiuso con un tratto sull'asse faceva fallire l'export GLB con «NaN to integer» (4 volte su 7).
  // Il NaN nasce dal raccordo (Bevel) sulle facce di area zero lungo l'asse: oggetto() col raccordo di serie, come O.S.C.A.R.
  r = await costruisci('asse', `
bm = bmesh.new()
rivoluzione(bm, [(0, 0), (27, 0), (28, 4), (26, 12), (20, 24), (10, 33), (0, 37)], 40, True)
oggetto('punta', bm)
bm = bmesh.new()
pr = [(60 + 3 * math.cos(math.pi * k / 4), 20 + 3 * math.sin(math.pi * k / 4)) for k in range(8)]
rivoluzione(bm, pr + [pr[0]], 48, True)
oggetto('filo', bm)`);
  const rapAsse = r.errore ? {} : JSON.parse(fs.readFileSync(path.join(CARTELLA, 'asse', 'v1', 'rapporto.json'), 'utf8'));
  const pezzoAsse = (n) => rapAsse.pezzi?.find((p) => p.nome === n) ?? {};
  esito(!r.errore && /- punta: .*chiuso; x da -28 a 28, y da 0 a 37, z da -28 a 28/.test(r.testo),
    'rivoluzione chiusa con un tratto sull\'asse: diventa una punta chiusa, niente NaN', r.errore ? r.testo.split('\n').slice(-1)[0] : '');
  esito(pezzoAsse('filo').facce === 8 * 48, 'il primo punto ripetuto in fondo non lascia facce di area zero', `${pezzoAsse('filo').facce} facce`);

  r = await costruisci('prova', 'x = 1 +');
  esito(r.errore && /SyntaxError/.test(r.testo) && /si è fermato/.test(r.testo), 'un errore di sintassi torna al cervello', r.testo.split('\n')[0]);
  r = await costruisci('prova', 'loft(bmesh.new(), [[1, 2], [1]])');
  esito(r.errore && /devono essere uguali/.test(r.testo), 'un errore degli attrezzi dice cosa correggere');
  r = await costruisci('prova', 'a = 1');
  esito(r.errore && /non ha creato oggetti/.test(r.testo), 'uno script senza oggetti lo dice');
  r = await costruisci('Prova!', 'a = 1');
  esito(r.errore && /minuscole/.test(r.testo), 'un nome sbagliato è rifiutato prima di partire');

  const FUGA = `
import os, socket, subprocess, urllib.request, json
r = {}
def prova(n, f):
    try:
        f(); r[n] = 'aperto'
    except Exception as e:
        r[n] = 'bloccato'
prova('rete', lambda: urllib.request.urlopen('https://example.com', timeout=3))
prova('localhost', lambda: socket.create_connection(('127.0.0.1', 4321), timeout=2))
prova('file sotto /Users', lambda: open(${JSON.stringify(SEGRETO)}).read())
prova('la repository', lambda: open(${JSON.stringify(path.join(ROOT, 'package.json'))}).read())
prova('cartella temporanea', lambda: open(${JSON.stringify(path.join(TEMP, 'segreto.txt'))}).read())
prova('scrivere fuori', lambda: open(${JSON.stringify(path.join(BASE, 'fuori.txt'))}, 'w').write('x'))
prova('altri programmi', lambda: subprocess.run(['/bin/echo', 'x'], check=True, capture_output=True))
prova('osascript', lambda: subprocess.run(['/usr/bin/osascript', '-e', 'return 1'], check=True, capture_output=True))
prova('la sua cartella', lambda: open(os.path.join(os.getcwd(), 'script.py')).read())
raise RuntimeError('ESITI ' + json.dumps(r))
`;
  r = await costruisci('fuga', FUGA);
  const esiti = JSON.parse(/ESITI (\{.*\})/.exec(r.testo)?.[1] ?? '{}');
  for (const [k, v] of Object.entries(esiti)) esito(k === 'la sua cartella' ? v === 'aperto' : v === 'bloccato', `gabbia: ${k} ${k === 'la sua cartella' ? 'si legge' : 'è bloccato'}`, v);
  esito(Object.keys(esiti).length === 9, 'tutte e nove le prove della gabbia hanno risposto', Object.keys(esiti).length + '');
  esito(!fs.existsSync(path.join(BASE, 'fuori.txt')), 'niente è stato scritto fuori');

  // la regola di Tony anche negli ologrammi: forme native solo per i cavi e per gli sforzi («calcolo» true).
  // Il server di prova non c'è (porta 4999): chi passa la guardia si ferma su «non risponde», chi no sul rifiuto.
  const olo = async (name, args) => { const m = await chiama('tools/call', { name, arguments: args }); return m.result?.content?.map((c) => c.text).join('\n') ?? ''; };
  const scatola = { id: 'scatola', forma: 'scatola', misure: { x: 1, y: 1, z: 1 } };
  let o = await olo('mostra_ologramma', { titolo: 'x', pezzi: [scatola] });
  esito(/Regola di Tony/.test(o) && /«scatola» \(scatola\)/.test(o), 'mostra_ologramma rifiuta una forma nativa senza «calcolo» true', o.slice(0, 70));
  o = await olo('mostra_ologramma', { titolo: 'x', pezzi: [{ ...scatola, calcolo: true }, { id: 'f', forma: 'file', misure: { file: '/x.glb' } }, { id: 'c', forma: 'cavo', misure: { r: 1, punti: [[0, 0, 0], [1, 1, 1]] } }] });
  esito(!/Regola di Tony/.test(o) && /non risponde/.test(o), 'passano i pezzi per gli sforzi, i file e i cavi', o.slice(0, 50));
  o = await olo('modifica_ologramma', { aggiungi: [scatola] });
  esito(/Regola di Tony/.test(o) && /«aggiungi»/.test(o), 'modifica_ologramma rifiuta una forma nativa in «aggiungi»');
  o = await olo('modifica_ologramma', { cambia: [{ id: 'scatola', forma: 'cilindro', misure: { r: 1, h: 1 } }] });
  esito(/Regola di Tony/.test(o) && /«cambia»/.test(o), 'e in «cambia», quando cambia la forma');
  o = await olo('modifica_ologramma', { cambia: [{ id: 'scatola', colore: '#fff' }], vista: { esploso: 1 } });
  esito(!/Regola di Tony/.test(o), 'un «cambia» senza forma e la vista passano');

  for (let i = 0; i < 5; i++) await costruisci('prova', BUONO);
  const versioni = fs.readdirSync(path.join(CARTELLA, 'prova')).sort();
  esito(versioni.length === 5 && !versioni.includes('v1'), 'restano le ultime cinque versioni', versioni.join(' '));
} finally {
  mcp.stdin.end();
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.rmSync(TEMP, { recursive: true, force: true });
}
console.log(`\n${passati} passati, ${falliti} falliti`);
process.exit(falliti ? 1 : 0);
