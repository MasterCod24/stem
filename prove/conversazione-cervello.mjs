// conversazione-cervello.mjs — come parla O.S.C.A.R. col cervello vero (richiesta di Tony del 28/11): va dritto al punto, dice
// cosa controlla prima di cercare e poi tace, risponde a un'interruzione sapendo dove era arrivato, ignora la TV che gli parla
// sopra, risponde alla frase intera quando Tony la completa. Uno O.S.C.A.R. di prova isolato (oscar-di-prova.mjs), 12 domande
// come le manda l'HUD, coi perché e i numeri delle interruzioni. Consuma come 12 domande a O.S.C.A.R. Porte 4452, 8952, 9352.
//   node prove/conversazione-cervello.mjs [cartella-uscita]
// Criteri, scritti il 28/11 prima del primo giro:
//   1. nessuna prima frase comincia con un preambolo («certo», «bella domanda», «volentieri», «allora», «ok», «perfetto»…);
//   2. le domande dirette hanno la risposta nella prima frase (17 per 23, ombrello in inglese);
//   3. prima di una ricerca una frase di al massimo sei parole che nomina la cosa, e nessuna frase fra una ricerca e l'altra;
//      almeno 2 risposte con ricerca su 3;
//   4. all'interruzione non ripete le frasi che Tony ha già sentito, e risponde a quello che ha aggiunto;
//   5. la TV che gli parla sopra: [ignora], nessuna frase;
//   6. la frase completata dopo un'interruzione del cervello: la risposta tiene conto della parte aggiunta.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { avviaOscarDiProva } from './oscar-di-prova.mjs';

const uscita = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'conversazione-')));
fs.mkdirSync(uscita, { recursive: true });
let ok = 0, ko = 0;
const esito = (c, n, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  —  ' + d : ''}`); c ? ok++ : ko++; };
const frasi = (ev) => ev.filter((e) => e.t === 'say').map((e) => e.s);
const PREAMBOLO = /^(certo|certamente|bella domanda|ottima domanda|buona domanda|volentieri|allora|ok|okay|perfetto|eccomi|sì,? certo|vediamo un po')\b/i;
const parole = (s) => s.split(/\s+/).filter(Boolean).length;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const o = await avviaOscarDiProva({ porta: 4452, pw: 8952, cdp: 9352, log: path.join(uscita, 'server.log') });
const giri = [];
async function giro(nome, corpo) {
  const ev = await o.chiedi(corpo);
  giri.push({ nome, corpo, eventi: ev });
  const f = frasi(ev), web = ev.filter((e) => e.t === 'web').length;
  console.log(`\n· ${nome}  (${corpo.why}${Number.isInteger(corpo.interrotto) ? `, interrotto ${corpo.interrotto}` : ''}) «${corpo.text}»`);
  console.log(`  prima frase ${ev.find((e) => e.t === 'say')?.at ?? '-'} s, fine ${ev.at(-1)?.at ?? '-'} s, ${f.length} frasi, ${web} ricerche${ev.some((e) => e.t === 'ignore') ? ', [ignora]' : ''}`);
  for (const e of ev) if (e.t === 'say' || e.t === 'web' || e.t === 'ignore' || e.t === 'error') console.log(`    ${String(e.at).padStart(6)}  ${e.t === 'say' ? e.s : e.t === 'web' ? `[${e.name}${e.detail ? ' ' + e.detail : ''}]` : `[${e.t}]`}`);
  return ev;
}
try {
  const diretta1 = await giro('diretta', { text: 'quanto fa diciassette per ventitré?', why: 'nome' });
  const diretta2 = await giro('diretta', { text: 'come si dice ombrello in inglese?', why: 'conversazione' });
  const diretta3 = await giro('diretta', { text: 'spiegami perché il cielo è blu', why: 'nome' });
  const cerca1 = await giro('ricerca', { text: 'quanto costa oggi un bitcoin in euro?', why: 'nome' });
  const cerca2 = await giro('ricerca', { text: "quando gioca l'Inter la prossima partita?", why: 'nome' });
  const storia = await giro('lunga', { text: 'raccontami la storia del Colosseo', why: 'nome' });
  const interr = await giro('interruzione', { text: 'no aspetta, dimmi solo quanto costa il biglietto', why: 'interruzione', interrotto: 1 });
  const nap = await giro('lunga', { text: 'raccontami di Napoleone in poche frasi', why: 'nome' });
  const tv = await giro('interruzione TV', { text: 'e adesso la pubblicità, restate con noi', why: 'interruzione', interrotto: 1 });
  // Tony si ferma a metà («cercami un ristorante»), l'HUD chiede, poi lui continua: l'HUD ferma il cervello e richiede intera
  const meta = o.chiedi({ text: 'cercami un ristorante', why: 'nome' });
  await new Promise((r) => setTimeout(r, 1200));
  await o.ferma(); await meta;
  const intera = await giro('continuata', { text: 'cercami un ristorante di pesce a Genova', why: 'nome' });

  const tutte = giri.filter((g) => frasi(g.eventi).length);
  const conPreambolo = tutte.filter((g) => PREAMBOLO.test(frasi(g.eventi)[0]));
  esito(!conPreambolo.length, 'nessuna prima frase con un preambolo', conPreambolo.map((g) => `«${frasi(g.eventi)[0]}»`).join(' | ') || `${tutte.length} risposte`);
  const p1 = norm(frasi(diretta1)[0] || ''), p2 = norm(frasi(diretta2)[0] || '');
  esito(/391|trecentonovantuno/.test(p1) && /umbrella/.test(p2), 'le domande dirette hanno la risposta nella prima frase', `«${frasi(diretta1)[0]}» | «${frasi(diretta2)[0]}» | «${frasi(diretta3)[0]}»`);
  const ricerche = [[cerca1, /bitcoin|prezzo|quotazion|cambio/], [cerca2, /inter|partita|calendario/], [interr, /bigliett|prezz|cost/]].filter(([ev]) => ev.some((e) => e.t === 'web'));
  const bene = ricerche.filter(([ev, cosa]) => {
    const i = ev.findIndex((e) => e.t === 'web'), j = ev.findLastIndex((e) => e.t === 'web');
    const prima = ev.slice(0, i).filter((e) => e.t === 'say'), inMezzo = ev.slice(i, j).filter((e) => e.t === 'say');
    return prima.length === 1 && parole(prima[0].s) <= 6 && cosa.test(norm(prima[0].s)) && !inMezzo.length;
  });
  esito(ricerche.length >= 2 && bene.length >= 2, 'prima di cercare dice cosa controlla, in poche parole, e poi tace fino al risultato',
    `${bene.length} su ${ricerche.length} risposte con ricerca: ${ricerche.map(([ev]) => `«${frasi(ev)[0]}»`).join(' | ')}`);
  const giaSentite = frasi(storia).slice(0, 2).map(norm), risposta = frasi(interr).map(norm);
  esito(risposta.length && !risposta.some((s) => giaSentite.includes(s)) && /bigliett|euro|prezz|cost/.test(risposta.join(' ')),
    "all'interruzione risponde a quello che Tony ha aggiunto, senza ripetere quello che aveva sentito", frasi(interr).join(' ').slice(0, 200));
  esito(tv.some((e) => e.t === 'ignore') && !frasi(tv).length, 'la TV che gli parla sopra: [ignora]', frasi(tv).join(' ').slice(0, 160) || '[ignora]');
  esito(/pesce|genova/.test(norm(frasi(intera).join(' '))), 'la frase completata: la risposta tiene conto della parte aggiunta', frasi(intera).join(' ').slice(0, 200));
  void diretta3; void nap;
} finally {
  fs.writeFileSync(path.join(uscita, 'giri.json'), JSON.stringify(giri, null, 1));
  await o.chiudi();
  console.log(`\n${ok} passati, ${ko} falliti; i giri in ${uscita}`);
  process.exitCode = ko ? 1 : 0;
}
