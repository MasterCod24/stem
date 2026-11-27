// schede-cervello.mjs — prova col cervello vero delle schede [[vedi: …]] sincronizzate con la voce, prima di scriverne il codice
// (richiesta di Tony del 27/11: «prima la prova»). Uno O.S.C.A.R. di prova isolato, su una copia del codice, riceve 10 domande
// concrete una dopo l'altra. I tempi delle frasi vengono dal flusso di /api/ask, il testo grezzo (coi segnali, che il server
// toglie) dalla conversazione registrata da Claude Code.
//   node prove/schede-cervello.mjs base|regola <cartella-uscita>     un giro: senza o con la regola nella persona
//   node prove/schede-cervello.mjs confronta <base.json> <regola.json>   i criteri
// Criteri, scritti il 27/11 prima del primo giro:
//   1. almeno 8 risposte su 10 con almeno una scheda;
//   2. nessuna scheda prima della fine della prima frase della risposta;
//   3. prima parola: mediana entro 0,1 s da quella del giro senza regola;
//   4. le schede non si nominano mai a voce («schermo», «scheda», «te lo mostro»).
// Consuma come 20 domande a O.S.C.A.R. con ricerche (Opus 5.5, il [pensa] a effort alto). Porte 4451, 8951 e 9351.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [MODO, A, B] = process.argv.slice(2);
const PORTA = 4451, PW = 8951, CDP = 9351;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export const DOMANDE = [
  'trovami un buon ristorante di pesce a Genova',
  'quali sono i tre musei più visitati di Parigi?',
  'qual è il miglior aspirapolvere senza fili sotto i trecento euro?',
  'dimmi qualcosa sul Colosseo',
  "quanto costa un iPhone 17 Pro e com'è nelle recensioni?",
  "consigliami un libro di fantascienza uscito quest'anno",
  'quali sono gli hotel meglio recensiti vicino alla stazione di Bologna?',
  "chi ha vinto l'ultima partita del Milan e con che risultato?",
  "qual è la montagna più alta d'Europa e quanto è alta?",
  'che film danno stasera al cinema a Torino?',
];

// La regola, com'è nella persona dal 27/11 (provata così prima di metterla): un segnale in più e la sua sezione
const SEGNALE = "- `[[vedi: …]]`: una scheda nell'HUD sulla cosa concreta che hai appena nominato. Vedi \"Le schede\".\n";
const SEZIONE = `## Le schede
Quando nomini una cosa concreta che Tony non ha davanti (un posto, un locale, un prodotto, un film, un libro, una persona, un monumento), l'HUD la mostra mentre ne parli: subito DOPO la frase che la nomina scrivi \`[[vedi: …]]\`, coi campi separati da \`|\`:
- il nome, come l'hai detto nella frase;
- che cos'è, in due o tre parole;
- fino a tre numeri brevi, ognuno con la sua etichetta: \`voto 4,6/5 (1.230 recensioni)\`, \`25 € a testa\`, \`alta 4.808 m\`;
- \`fonte\` col sito, solo se l'hai letto in questa risposta: \`fonte tripadvisor.it\`.

Esempio: "Il migliore è la Trattoria Rossi, in centro storico, a due passi dal porto. [[vedi: Trattoria Rossi | trattoria di pesce | voto 4,6/5 (1.230 recensioni) | 25 € a testa | fonte tripadvisor.it]] Costa sui venticinque euro a testa."
- Sempre dopo una frase di almeno otto parole, quindi mai prima o dopo la prima frase della risposta: la voce parte per prima.
- Una scheda per cosa, al massimo quattro per risposta. Dentro niente frasi: nomi e numeri.
- I numeri solo se li hai letti nelle fonti o li sai con certezza; senza una fonte letta, niente campo fonte.
- Le schede non chiudono niente e valgono anche con la meteo o un report aperti; con l'ologramma no, perché Blender copre l'HUD.
- Non nominarle mai a voce: niente "te lo mostro", "a schermo", "nella scheda". Tony le vede da sé.

`;

async function giro(variante, uscita) {
  fs.mkdirSync(uscita, { recursive: true });
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'schede-copia-'));
  const prova = fs.mkdtempSync(path.join(os.tmpdir(), 'schede-cervello-'));
  execFileSync('/usr/bin/rsync', ['-a', '--exclude', '.git', '--exclude', 'node_modules', '--exclude', 'runtime', '--exclude', '.claude', '--exclude', '.env', `${REPO}/`, `${copia}/`]);
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(copia, 'node_modules'));
  // Dal 27/11 la regola sta nella persona: «base» la toglie, «regola» la usa com'è (e la aggiunge solo se mancasse)
  const f = path.join(copia, 'oscar-persona.md');
  let persona = fs.readFileSync(f, 'utf8');
  const ancora = "- `[anim: english keywords]`", sez = '## Ascolto sempre acceso', ha = persona.includes(SEZIONE);
  if (variante === 'base' && ha) persona = persona.replace(SEGNALE, '').replace(SEZIONE, '');
  if (variante === 'regola' && !ha) {
    if (!persona.includes(ancora) || !persona.includes(sez)) throw new Error('la persona è cambiata: aggiorna i punti dove va la regola');
    persona = persona.replace(ancora, SEGNALE + ancora).replace(sez, SEZIONE + sez);
  }
  if (persona.includes(SEZIONE) !== (variante === 'regola')) throw new Error('la persona non è quella della variante');
  fs.writeFileSync(f, persona);
  const log = fs.openSync(path.join(uscita, `server-${variante}.log`), 'w');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${path.join(prova, 'chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  await pausa(1500);
  const server = spawn(process.execPath, ['server.mjs'], { cwd: copia, stdio: ['ignore', log, log],
    env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH, OSCAR_CERVELLO: prova, OSCAR_PORT: String(PORTA),
      OSCAR_BROWSER_PORT: String(PW), OSCAR_CDP_PORT: String(CDP), OSCAR_NO_OPEN: '1' } });
  const risultati = { variante, quando: new Date().toISOString(), domande: [] };
  try {
    let su = false;
    for (let i = 0; i < 90 && !su; i++) { await pausa(1000); su = await fetch(`http://localhost:${PORTA}/api/status`).then((r) => r.ok).catch(() => false); }
    if (!su) throw new Error('il server di prova non parte');
    for (const domanda of DOMANDE.slice(0, Number(process.env.SCHEDE_N) || DOMANDE.length)) { // SCHEDE_N=1: una sola, per provare lo script
      const t0 = performance.now(), eventi = [];
      try {
        const r = await fetch(`http://localhost:${PORTA}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: domanda, why: 'nome' }), signal: AbortSignal.timeout(420000) });
        const dec = new TextDecoder(), reader = r.body.getReader();
        let resto = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          resto += dec.decode(value, { stream: true });
          let k;
          while ((k = resto.indexOf('\n')) >= 0) {
            const riga = resto.slice(0, k); resto = resto.slice(k + 1);
            if (riga.trim()) eventi.push({ ...JSON.parse(riga), at: +((performance.now() - t0) / 1000).toFixed(3) });
          }
        }
      } catch (e) { eventi.push({ t: 'errore', errore: String(e), at: +((performance.now() - t0) / 1000).toFixed(3) }); }
      risultati.domande.push({ domanda, eventi });
      console.log(`${variante}  ${domanda}  — prima frase ${eventi.find((e) => e.t === 'say')?.at ?? '-'} s, fine ${eventi.at(-1)?.at ?? '-'} s, ${eventi.filter((e) => e.t === 'say').length} frasi`);
      await pausa(1500);
    }
    // il testo grezzo, coi segnali, dalla conversazione registrata
    const id = JSON.parse(fs.readFileSync(path.join(prova, 'cervello.json'), 'utf8')).id;
    const progetti = path.join(os.homedir(), '.claude', 'projects');
    const dir = fs.readdirSync(progetti).find((d) => fs.existsSync(path.join(progetti, d, `${id}.jsonl`)));
    const righe = fs.readFileSync(path.join(progetti, dir, `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let cur = null;
    for (const r of righe) {
      const c = r.message?.content;
      if (r.type === 'user') {
        const testo = typeof c === 'string' ? c : (c || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
        const q = risultati.domande.find((d) => testo.includes(d.domanda));
        if (q) { cur = q; cur.grezzo = ''; cur.strumenti = []; cur.risultati = ''; }
        if (cur && Array.isArray(c)) for (const x of c) if (x.type === 'tool_result') cur.risultati += JSON.stringify(x.content).slice(0, 20000);
      } else if (r.type === 'assistant' && cur) {
        for (const x of c || []) {
          if (x.type === 'text') cur.grezzo += x.text;
          if (x.type === 'tool_use') cur.strumenti.push({ nome: x.name, input: JSON.stringify(x.input).slice(0, 300) });
        }
      }
    }
    risultati.conversazione = path.join(progetti, dir);
  } finally {
    fs.writeFileSync(path.join(uscita, `${variante}.json`), JSON.stringify(risultati, null, 2));
    server.kill('SIGTERM');
    for (let i = 0; i < 20 && server.exitCode === null && server.signalCode === null; i++) await pausa(250);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    chrome.kill('SIGTERM');
    await pausa(800);
    fs.rmSync(copia, { recursive: true, force: true });
    fs.rmSync(prova, { recursive: true, force: true });
    if (risultati.conversazione) fs.rmSync(risultati.conversazione, { recursive: true, force: true }); // la conversazione di prova
    const porte = (() => { try { return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${PORTA}`, `-iTCP:${PW}`, `-iTCP:${CDP}`, '-sTCP:LISTEN', '-t']).toString().trim(); } catch { return ''; } })();
    if (porte) console.error(`porte ancora aperte: ${porte}`);
  }
}

// ---------------------------------------------------------------- i criteri
const MARCA = /\[\[vedi:([^\]]*)\]\]/gi;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
function analizza(r) {
  return r.domande.map((d) => {
    const tempi = d.eventi.filter((e) => e.t === 'say').map((e) => ({ at: e.at, s: e.s }));
    const grezzo = d.grezzo || '';
    const marche = [...grezzo.matchAll(MARCA)];
    const fineprima = (() => { const m = grezzo.replace(/\[\[[^\]]*\]\]|\[[^\]]*\]/g, (x) => ' '.repeat(x.length)).match(/[.!?…](\s|$)/); return m ? m.index : Infinity; })();
    const domini = new Set([...(d.risultati || '').matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+)/gi), ...d.strumenti.flatMap((s) => [...s.input.matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+)/gi)])].map((m) => m[1].toLowerCase()));
    const schede = marche.map((m) => {
      const campi = m[1].split('|').map((x) => x.trim()).filter(Boolean);
      const prima = grezzo.slice(0, m.index).replace(/\[\[[^\]]*\]\]/g, ' ').split(/(?<=[.!?…])\s+/).filter((x) => x.trim()).pop() || '';
      const dopo = grezzo.slice(m.index + m[0].length).replace(/\[\[[^\]]*\]\]/g, ' ').trim().split(/(?<=[.!?…])\s+/)[0] || '';
      const fonte = campi.find((c) => /^fonte\b/i.test(c));
      const dominio = fonte?.replace(/^fonte\s*:?\s*/i, '').replace(/^www\./, '').toLowerCase();
      // la frase prima e quella dopo, nel flusso della voce
      const iPrima = prima ? tempi.findIndex((x) => norm(x.s).includes(norm(prima).slice(-40))) : -1;
      const iDopo = dopo ? tempi.findIndex((x, j) => j > iPrima && norm(x.s).startsWith(norm(dopo).slice(0, 30))) : -1;
      return {
        campi, dopoPrima: m.index > fineprima, nomeNellaFrase: norm(prima).includes(norm(campi[0] || '').split(' ')[0] || '§'),
        parolePrima: prima.split(/\s+/).filter(Boolean).length, fonte: dominio || null,
        fonteLetta: dominio ? [...domini].some((x) => x === dominio || x.endsWith('.' + dominio) || dominio.endsWith('.' + x)) : null,
        attesa: iPrima >= 0 && iDopo === iPrima + 1 ? +(tempi[iDopo].at - tempi[iPrima].at).toFixed(2) : null,
        lunga: campi.join(' | ').length,
      };
    });
    // fra due frasi consecutive senza scheda in mezzo, per confronto
    const senza = [];
    for (let j = 1; j < tempi.length; j++) if (!schede.some((s) => s.attesa !== null && Math.abs(s.attesa - (tempi[j].at - tempi[j - 1].at)) < 1e-3)) senza.push(+(tempi[j].at - tempi[j - 1].at).toFixed(2));
    const voce = tempi.map((x) => x.s).join(' ');
    return { domanda: d.domanda, prima: tempi[0]?.at ?? null, fine: d.eventi.at(-1)?.at ?? null, frasi: tempi.length, schede,
      aVoce: (voce.match(/\b(schermo|schede|scheda|te lo mostro|ti mostro|vedi qui)\b/gi) || []), senza, errore: d.eventi.find((e) => e.errore)?.errore };
  });
}
function confronta(fb, fr) {
  const b = analizza(JSON.parse(fs.readFileSync(fb, 'utf8'))), r = analizza(JSON.parse(fs.readFileSync(fr, 'utf8')));
  const out = (x) => console.log(x);
  out('domanda | prima frase base → regola | fine base → regola | schede | dopo la 1ª | nome nella frase prima | fonte letta | attesa fra le frasi attorno');
  r.forEach((x, i) => out(`${x.domanda.slice(0, 44).padEnd(44)} | ${b[i].prima} → ${x.prima} s | ${b[i].fine} → ${x.fine} s | ${x.schede.length} | ${x.schede.map((s) => (s.dopoPrima ? 'sì' : 'NO')).join(',')} | ${x.schede.map((s) => (s.nomeNellaFrase ? 'sì' : 'no')).join(',')} | ${x.schede.map((s) => s.fonteLetta === null ? '-' : s.fonteLetta ? 'sì' : 'NO').join(',')} | ${x.schede.map((s) => s.attesa ?? '?').join(',')}`));
  const con = r.filter((x) => x.schede.length).length, prima = r.flatMap((x) => x.schede).filter((s) => !s.dopoPrima).length;
  const mb = mediana(b.map((x) => x.prima).filter((x) => x !== null)), mr = mediana(r.map((x) => x.prima).filter((x) => x !== null));
  const voce = r.flatMap((x) => x.aVoce), voceB = b.flatMap((x) => x.aVoce);
  out('');
  out(`1. risposte con almeno una scheda: ${con} su 10 → ${con >= 8 ? 'PASS' : 'FAIL'}`);
  out(`2. schede prima della fine della prima frase: ${prima} → ${prima === 0 ? 'PASS' : 'FAIL'}`);
  out(`3. prima parola, mediana: ${mb} s senza regola, ${mr} s con → ${Math.abs(mr - mb) <= 0.1 ? 'PASS' : 'FAIL'} (Δ ${(mr - mb).toFixed(2)} s)`);
  out(`4. schede nominate a voce: ${voce.length} (${voce.join(', ')}); senza regola le stesse parole ${voceB.length} volte → ${voce.length <= voceB.length ? 'PASS' : 'FAIL'}`);
  const att = r.flatMap((x) => x.schede.map((s) => s.attesa)).filter((x) => x !== null), sen = r.flatMap((x) => x.senza);
  out(`attesa fra la frase prima e quella dopo una scheda: mediana ${mediana(att)} s su ${att.length}; fra frasi senza scheda: mediana ${mediana(sen)} s su ${sen.length}`);
  out(`frasi prima di una scheda con meno di 8 parole: ${r.flatMap((x) => x.schede).filter((s) => s.parolePrima < 8).length}; schede più lunghe di 120 caratteri: ${r.flatMap((x) => x.schede).filter((s) => s.lunga > 120).length}`);
  out(`fine della risposta, mediana: ${mediana(b.map((x) => x.fine))} s senza regola, ${mediana(r.map((x) => x.fine))} s con`);
  for (const x of r) for (const s of x.schede) out(`  ${x.domanda.slice(0, 30)}: ${s.campi.join(' | ')}`);
}

if (MODO === 'base' || MODO === 'regola') await giro(MODO, path.resolve(A || fs.mkdtempSync(path.join(os.tmpdir(), 'schede-'))));
else if (MODO === 'confronta') confronta(A, B);
else { console.error('uso: node prove/schede-cervello.mjs base|regola <uscita>  |  confronta <base.json> <regola.json>'); process.exit(2); }
