// ologramma-stato.mjs — prova ologramma.mjs, lo stato dell'ologramma nel server, con un calcolo finto.
// node prove/ologramma-stato.mjs → una riga PASS o FAIL per caso; esce con 0 solo se passa tutto.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as F from '../public/ologramma/forme.js';
import { createOlogramma } from '../ologramma.mjs';

let passati = 0, falliti = 0;
function esito(ok, nome, dettagli = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${dettagli ? '  —  ' + dettagli : ''}`);
  if (ok) passati++; else falliti++;
  return ok;
}
function titolo(t) { console.log(`\n== ${t}`); }

const uguale = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vicino = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
const pausa = () => new Promise((r) => setImmediate(r)); // lascia arrivare i risultati già pronti
const bytes = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);
const CARTELLE = [];
// Anche se la prova cade a metà: le cartelle temporanee non devono restare
process.on('exit', () => { for (const d of CARTELLE) fs.rmSync(d, { recursive: true, force: true }); });
function cartella() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-ologramma-'));
  CARTELLE.push(d);
  return d;
}

function rinvio() {
  let risolvi, rifiuta;
  const promessa = new Promise((a, b) => { risolvi = a; rifiuta = b; });
  return { promessa, risolvi, rifiuta };
}

// Il calcolo finto: voxel veri con forme.dentro; lo sforzo dipende da carichi, posizione e ν ma non da E, come
// nel risolutore vero a ν fisso; lo spostamento va con 1/E. iterazioni porta il numero della chiamata, così si
// vede quale corsa ha vinto.
function risultatoFinto(lavoro, n) {
  const P = lavoro.pezzi, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of P) { const b = F.ingombro(p); for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], b.min[c]); max[c] = Math.max(max[c], b.max[c]); } }
  const lati = [0, 1, 2].map((c) => max[c] - min[c]), h = Math.cbrt((lati[0] * lati[1] * lati[2]) / 3000);
  const [nx, ny, nz] = lati.map((l) => Math.max(1, Math.ceil(l / h)));
  const N = nx * ny * nz, vp = new Uint16Array(N), vm = new Float32Array(N);
  const forza = lavoro.carichi.reduce((s, c) => s + c.forza_N, 0), picco = P.map(() => ({ s: -1, punto: null }));
  let voxel = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = min[0] + (i + 0.5) * h, y = min[1] + (j + 0.5) * h, z = min[2] + (k + 0.5) * h;
    const q = P.findIndex((p) => F.dentro(p, x, y, z));
    if (q < 0) continue;
    const c = i + nx * (j + ny * k);
    vp[c] = q + 1;
    voxel++;
    vm[c] = (forza / 50) * (1 + 0.5 * P[q].mat.nu) * (1 + i / nx) * (1 + (0.3 * j) / ny);
    if (vm[c] > picco[q].s) picco[q] = { s: vm[c], punto: [x, y, z] };
  }
  return {
    h_mm: h, nx, ny, nz, origine: min, voxel_pezzo: vp, vm, voxel, iterazioni: 100 + n, convergito: true, tempo_s: 0.25,
    spostamento_max_mm: ((forza * Math.max(...lati)) / 1e3) * P.reduce((s, p) => s + 1 / p.mat.E, 0),
    pezzi: P.flatMap((p, q) => (picco[q].punto ? [{ id: p.id, sforzo_max_MPa: picco[q].s, punto_mm: picco[q].punto, vicino_incastro: lavoro.vincoli.some((v) => v.pezzo === p.id) }] : [])),
    esclusi: [], avvisi: [],
  };
}

function calcoloFinto({ sospeso = false } = {}) {
  const chiamate = [];
  const calcola = (lavoro) => {
    const c = { lavoro, ...rinvio(), n: chiamate.length + 1 };
    chiamate.push(c);
    if (!sospeso) c.risolvi(risultatoFinto(lavoro, c.n));
    return c.promessa;
  };
  return { calcola, chiamate, risolvi: (i, r = risultatoFinto(chiamate[i].lavoro, i + 1)) => chiamate[i].risolvi(r) };
}

function nuovo(opz = {}) {
  const fc = calcoloFinto(opz), cambi = [], orologio = { t: 1_000_000 };
  const O = createOlogramma({ cartella: opz.cartella || cartella(), calcola: fc.calcola, onCambio: (s) => cambi.push(s), ora: () => orologio.t });
  return { O, fc, cambi, orologio };
}

// Un modello con le misure fatte a mano: scatola d'acciaio, perno d'alluminio girato lungo X, una sfera generica
// (si disegna, niente massa) e un pezzo da file (né massa né ingombro).
const staffa = () => ({
  titolo: 'Staffa di prova',
  pezzi: [
    { id: 'base', forma: 'scatola', misure: { x: 100, y: 20, z: 10 }, materiale: 'acciaio-s235' },
    { id: 'perno', forma: 'cilindro', misure: { r: 5, h: 40 }, posizione: [60, 0, 0], rotazione: [0, 0, 90], materiale: 'alluminio-6061' },
    { id: 'boa', forma: 'sfera', misure: { r: 10 }, posizione: [0, 30, 0] },
    { id: 'disegno', forma: 'file', misure: { file: '/Users/tony/Documents/pezzo.stl' } },
  ],
  carichi: [{ pezzo: 'perno', faccia: '+x', forza_N: 500, direzione: [0, -1, 0] }],
  vincoli: [{ pezzo: 'base', faccia: '-x' }],
});
const mensola = (a = 'pla', b = 'pla') => ({
  titolo: 'Mensola',
  pezzi: [
    { id: 'muro', forma: 'scatola', misure: { x: 10, y: 60, z: 40 }, materiale: a },
    { id: 'braccio', forma: 'scatola', misure: { x: 80, y: 10, z: 30 }, posizione: [45, 0, 0], materiale: b },
  ],
  carichi: [{ pezzo: 'braccio', faccia: '+x', forza_N: 200, direzione: [0, -1, 0] }],
  vincoli: [{ pezzo: 'muro', faccia: '-x' }],
});
const MASSA_STAFFA = 100 * 20 * 10 * 7850e-9 + Math.PI * 25 * 40 * 2700e-9; // 0,157 + 0,00848… kg

// ------------------------------------------------------------------ 1. mostra, massa e ingombro
titolo('1. Mostra, massa e ingombro fatti a mano');
{
  const { O, cambi } = nuovo();
  const s0 = O.stato();
  esito(s0.aperto === false && s0.modello === 0 && s0.versione === 0 && s0.analisi === null && O.campo() === null && /Nessun ologramma/.test(O.testo()), 'prima di mostra: chiuso, modello 0, versione 0');
  const r = O.esegui({ azione: 'mostra', modello: staffa() });
  const s = O.stato();
  esito(r.ok && r.codice === 200 && r.versione === 1 && s.modello === 1 && s.versione === 1 && s.aperto === true, 'mostra: ok, modello 1, versione 1, aperto');
  esito(cambi.length === 1 && cambi[0].versione === 1, 'onCambio chiamato una volta, con lo stato nuovo');
  const boa = s.pezzi.find((p) => p.id === 'boa'), file = s.pezzi.find((p) => p.id === 'disegno');
  esito(boa.materiale === 'generico' && boa.nome === 'boa' && uguale(boa.posizione, [0, 30, 0]) && file.calcolo === false && uguale(s.vista, F.PREDEFINITI.vista) && uguale(s.tolti, []),
    'pezzi normalizzati (materiale generico, nome = id, file senza calcolo) e vista completa');
  esito(vicino(s.massa_kg, MASSA_STAFFA, 1e-12), 'massa = scatola + perno, senza sfera generica e file', `${s.massa_kg} kg contro ${MASSA_STAFFA} a mano`);
  const atteso = { min: [-50, -10, -10], max: [80, 40, 10] }, b = s.ingombro_mm;
  const scarto = Math.max(...[0, 1, 2].flatMap((c) => [Math.abs(b.min[c] - atteso.min[c]), Math.abs(b.max[c] - atteso.max[c])]));
  esito(scarto < 1e-9, 'ingombro: x da −50 a 80, y da −10 a 40, z da −10 a 10, senza il file', `scarto massimo ${scarto.toExponential(1)} mm`);
  O.esegui({ azione: 'modifica', togli: ['perno'] });
  const t = O.stato();
  esito(vicino(t.massa_kg, 0.157, 1e-12) && uguale(t.ingombro_mm, { min: [-50, -10, -10], max: [50, 40, 10] }), 'con il perno tolto: 0,157 kg e x fino a 50', `${t.massa_kg} kg`);
  const r2 = O.esegui({ azione: 'mostra', modello: { titolo: 'Solo generici', pezzi: [{ id: 'a', forma: 'sfera', misure: { r: 1 } }] } });
  esito(r2.ok && O.stato().modello === 2 && O.stato().massa_kg === null && O.stato().tolti.length === 0, 'mostra di nuovo: modello 2, tutto sostituito, massa null senza materiali veri');
}

// ------------------------------------------------------------------ 2. modifica
titolo('2. Modifica: misure fuse campo per campo, aggiungi, togli e rimetti');
{
  const { O, cambi } = nuovo();
  O.esegui({ azione: 'mostra', modello: staffa() });
  let r = O.esegui({ azione: 'modifica', cambia: [{ id: 'base', misure: { y: 30 } }] });
  let s = O.stato(), base = s.pezzi.find((p) => p.id === 'base');
  esito(r.ok && r.versione === 2 && uguale(base.misure, { x: 100, y: 30, z: 10 }) && base.materiale === 'acciaio-s235', 'cambia misure.y: x e z restano, il resto del pezzo pure');
  esito(vicino(s.massa_kg, 100 * 30 * 10 * 7850e-9 + Math.PI * 25 * 40 * 2700e-9, 1e-12), 'la massa segue le misure nuove');
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'base', posizione: [0, 5, 0] }] });
  base = O.stato().pezzi.find((p) => p.id === 'base');
  esito(r.ok && uguale(base.misure, { x: 100, y: 30, z: 10 }) && uguale(base.posizione, [0, 5, 0]), 'cambia solo la posizione: le misure non si toccano');
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'boa', forma: 'cilindro' }] });
  esito(!r.ok && r.codice === 400 && (r.errori || []).some((e) => e.includes('misure') && e.includes('cilindro')), 'cambia forma senza misure: errore che chiede le misure del cilindro', (r.errori || [])[0]);
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'boa', forma: 'cilindro', misure: { r: 4, h: 12 } }] });
  esito(r.ok && uguale(O.stato().pezzi.find((p) => p.id === 'boa').misure, { r: 4, h: 12 }), 'cambia forma con le misure nuove: le vecchie non si mescolano');
  r = O.esegui({ azione: 'modifica', aggiungi: [{ id: 'dado', forma: 'cilindro', misure: { r: 3, h: 2 }, materiale: 'acciaio-s355' }], togli: ['boa'] });
  s = O.stato();
  esito(r.ok && s.pezzi.length === 5 && s.pezzi[4].id === 'dado' && uguale(s.tolti, ['boa']), 'aggiungi un pezzo e togline un altro nella stessa modifica');
  r = O.esegui({ azione: 'modifica', rimetti: ['boa'], togli: ['dado'] });
  esito(r.ok && uguale(O.stato().tolti, ['dado']), 'rimetti e togli: tolti si aggiorna');
  const v = O.stato().versione, n = cambi.length;
  r = O.esegui({ azione: 'modifica', togli: ['dado'] });
  esito(r.ok && r.versione === v && cambi.length === n && /Niente da cambiare/.test(r.testo) && /era già tolto/.test(r.testo), 'togliere un pezzo già tolto: niente versione nuova, e il testo lo dice');
  r = O.esegui({ azione: 'modifica' });
  esito(r.ok && r.versione === v && r.testo === O.testo(), 'modifica senza campi: solo lo stato in testo');
  r = O.esegui({ azione: 'modifica', vista: { modo: 'raggi-x', sezione: { asse: 'x', posizione: 10 } }, carichi: null });
  s = O.stato();
  esito(r.ok && s.vista.modo === 'raggi-x' && uguale(s.vista.sezione, { asse: 'x', posizione: 10, verso: 1 }) && s.carichi.length === 1, 'vista parziale completata; carichi: null vale come assente');
  O.esegui({ azione: 'chiudi' });
  r = O.esegui({ azione: 'modifica', vista: { esploso: 0.5 } });
  esito(r.ok && O.stato().aperto === true && O.stato().vista.esploso === 0.5, 'modificare un ologramma chiuso lo riapre');
  const versioni = cambi.map((c) => c.versione);
  esito(versioni.every((x, i) => x === i + 1), 'versioni: crescono di uno a ogni cambio, e onCambio arriva a ogni versione', versioni.join(' '));
}

// ------------------------------------------------------------------ 3. HUD
titolo("3. Dall'HUD: togli, rimetti, chiudi, 409 e rifiuti");
{
  const { O } = nuovo();
  let r = O.esegui({ azione: 'togli', id: 'base', modello: 0 }, { daHud: true });
  esito(!r.ok && r.codice === 409, 'prima di mostra: 409');
  O.esegui({ azione: 'mostra', modello: staffa() });
  O.esegui({ azione: 'mostra', modello: staffa() }); // modello 2
  const prima = O.stato();
  r = O.esegui({ azione: 'togli', id: 'base', modello: 1 }, { daHud: true });
  esito(!r.ok && r.codice === 409 && uguale(O.stato(), prima), 'togli con un modello vecchio: 409 e niente cambia', (r.errori || [])[0]);
  r = O.esegui({ azione: 'togli', id: 'base', modello: '2' }, { daHud: true });
  esito(!r.ok && r.codice === 409, 'modello come testo invece che numero: 409');
  r = O.esegui({ azione: 'togli', id: 'base', modello: 2 }, { daHud: true });
  esito(r.ok && r.versione === prima.versione + 1 && uguale(O.stato().tolti, ['base']), 'togli dal modello giusto: tolto, versione +1');
  r = O.esegui({ azione: 'togli', id: 'base', modello: 2 }, { daHud: true });
  esito(r.ok && r.versione === prima.versione + 1, 'lo stesso togli due volte: niente versione nuova');
  r = O.esegui({ azione: 'rimetti', id: 'base', modello: 2 }, { daHud: true });
  esito(r.ok && uguale(O.stato().tolti, []), 'rimetti: torna al suo posto');
  r = O.esegui({ azione: 'togli', id: 'nessuno', modello: 2 }, { daHud: true });
  esito(!r.ok && r.codice === 400 && !(r.errori || []).join().includes('nessuno'), 'id sconosciuto: 400, senza ripetere il testo arrivato');
  const rifiutate = ['mostra', 'modifica', 'analizza', 'boh'].map((azione) => O.esegui({ azione, modello: 2, togli: ['perno'], vista: { modo: 'solido' } }, { daHud: true }));
  esito(rifiutate.every((x) => !x.ok && x.codice === 403) && uguale(O.stato().tolti, []) && O.stato().vista.modo === 'ologramma', "mostra, modifica, analizza e altro dall'HUD: 403 e niente cambia");
  r = O.esegui({ azione: 'chiudi', modello: 2 }, { daHud: true });
  esito(r.ok && O.stato().aperto === false && /chiuso da Tony con Esc/.test(O.testo()), "chiudi dall'HUD: chiuso, e il testo per il cervello dice che è stato Tony");
  const v = O.stato().versione;
  r = O.esegui({ azione: 'chiudi', modello: 2 }, { daHud: true });
  esito(r.ok && r.versione === v, 'chiudere un ologramma già chiuso: niente versione nuova');
  r = O.esegui({ azione: 'togli', id: 'perno' });
  esito(!r.ok && r.codice === 400 && /modifica/.test((r.errori || [])[0]), 'togli come azione del cervello: 400 che indica modifica', (r.errori || [])[0]);
}

// ------------------------------------------------------------------ 4. errori di validazione
titolo('4. Errori chiari, e niente cambia');
{
  const { O } = nuovo();
  let r = O.esegui({ azione: 'modifica', vista: { modo: 'solido' } });
  esito(!r.ok && r.codice === 400 && /usa prima mostra/.test((r.errori || [])[0]), 'modifica prima di mostra: 400 che dice di usare mostra');
  r = O.esegui({ azione: 'analizza' });
  esito(!r.ok && /usa prima mostra/.test((r.errori || [])[0]), 'analizza prima di mostra: 400');
  r = O.esegui({ azione: 'mostra', modello: { titolo: 'Rotto', pezzi: [{ id: 'a', forma: 'cilindro', misure: { r: 5 } }] } });
  esito(!r.ok && r.codice === 400 && (r.errori || []).some((e) => e.includes('«a»') && e.includes('misure.h') && e.includes('manca')) && O.stato().modello === 0, 'cilindro senza h: errore che nomina pezzo e campo, e nessun modello nuovo', (r.errori || [])[0]);
  O.esegui({ azione: 'mostra', modello: staffa() });
  const prima = O.stato();
  const casi = [
    [{ azione: 'modifica', cambia: [{ id: 'zz', misure: { x: 1 } }] }, (e) => e.includes('"zz"') && e.includes('«base»'), 'cambia di un pezzo che non c\'è: lo dice ed elenca i pezzi'],
    [{ azione: 'modifica', aggiungi: [{ id: 'base', forma: 'sfera', misure: { r: 1 } }] }, (e) => e.includes("c'è già"), 'aggiungi con un id già usato'],
    [{ azione: 'modifica', togli: ['zz'] }, (e) => e.includes('togli[0]'), 'togli di un pezzo che non c\'è'],
    [{ azione: 'modifica', togli: ['base'], rimetti: ['base'] }, (e) => e.includes('sia in togli sia in rimetti'), 'lo stesso pezzo in togli e rimetti'],
    [{ azione: 'modifica', carichi: [{ pezzo: 'zz', faccia: '+y', forza_N: 10, direzione: [0, 1, 0] }] }, (e) => e.includes('carichi[0]'), 'carico su un pezzo che non c\'è'],
    [{ azione: 'modifica', vista: { modo: 'arcobaleno' } }, (e) => e.includes('modo'), 'modo di vista sconosciuto'],
    [{ azione: 'modifica', cambia: [{ id: 'base', misure: { x: -3 } }], togli: ['perno'] }, (e) => e.includes('misure.x'), 'un errore annulla tutta la modifica, anche la parte buona'],
    [{ azione: 'analizza', vincoli: [] }, (e) => e.startsWith('manca un vincolo'), 'analizza senza vincoli: «manca un vincolo»'],
    [{ azione: 'analizza', carichi: [] }, (e) => e.startsWith('manca un carico'), 'analizza senza carichi: «manca un carico»'],
    [{ azione: 'analizza', carichi: [{ pezzo: 'boa', faccia: '+y', forza_N: 10, direzione: [0, 1, 0] }] }, (e) => e.includes("«boa» ha materiale 'generico'"), 'carico solo su un pezzo generico: dice perché non conta'],
    [{ azione: 'boh' }, (e) => e.includes('"boh"'), 'azione sconosciuta'],
    ['mostra', (e) => e.includes('azione'), 'azione che non è un oggetto'],
  ];
  for (const [azione, va, nome] of casi) {
    r = O.esegui(azione);
    esito(!r.ok && r.codice === 400 && (r.errori || []).some(va) && uguale(O.stato(), prima) && /^Niente è cambiato/.test(r.testo), nome, (r.errori || []).find(va) || (r.errori || [])[0]);
  }
  O.esegui({ azione: 'mostra', modello: { titolo: 'Generici', pezzi: [{ id: 'a', forma: 'scatola', misure: { x: 1, y: 1, z: 1 } }], vincoli: [{ pezzo: 'a', faccia: '-y' }], carichi: [{ pezzo: 'a', faccia: '+y', forza_N: 1, direzione: [0, -1, 0] }] } });
  r = O.esegui({ azione: 'analizza' });
  esito(!r.ok && (r.errori || []).some((e) => e.includes("materiale 'generico'") && e.includes('acciaio-s235')), 'tutto generico: dice che serve un materiale vero e quali ci sono', (r.errori || [])[0]);
}

// ------------------------------------------------------------------ 5. analisi e campo
titolo('5. Analisi: lavoro, numeri, fs per voxel, testo');
{
  const { O, fc, orologio } = nuovo({ sospeso: true });
  // Perno di titanio (snervamento 880): ha lo sforzo più alto ma non è il più a rischio, così l'ordine per fs si distingue da quello per sforzo
  const m = staffa();
  m.pezzi[1].materiale = 'titanio-ti6al4v';
  O.esegui({ azione: 'mostra', modello: m });
  const v0 = O.stato().versione;
  const r = O.esegui({ azione: 'analizza' });
  const L = fc.chiamate[0]?.lavoro;
  esito(r.ok && r.versione === v0 + 1 && O.stato().analisi.stato === 'in-corso' && O.stato().analisi.versione === v0 + 1 && r.attesa instanceof Promise && O.campo() === null,
    'analizza: in corso alla versione nuova, con attesa e senza campo');
  esito(L && uguale(L.pezzi.map((p) => p.id), ['base', 'perno']) && uguale(Object.keys(L.pezzi[0].mat), ['chiave', 'E', 'nu', 'snervamento', 'densita', 'affidabile']) &&
    L.pezzi[1].mat.E === 113800 && uguale(L.opzioni, { voxel_max: 40000, tempo_max_s: 45 }) && L.carichi.length === 1 && L.vincoli.length === 1,
    'il lavoro: solo i pezzi con materiale vero e calcolo, con mat, opzioni del contratto');
  orologio.t += 12000;
  esito(/in corso da 12 s/.test(O.testo()), 'il testo dice da quanto è in corso');
  const ris = risultatoFinto(L, 1);
  fc.risolvi(0, ris);
  const fine = await r.attesa;
  const s = O.stato(), a = s.analisi, c = O.campo();
  esito(a.stato === 'fatta' && s.versione === v0 + 2 && a.versione === v0 + 1 && a.campo.versione === v0 + 2 && c.versione === v0 + 2 && fine.versione === v0 + 2 && /sforzo massimo/.test(fine.testo),
    'fatta: versione +1, analisi.versione = quella calcolata, campo alla versione nuova, attesa con il testo nuovo');
  let sbagliati = 0;
  const sn = [235, 880];
  for (let i = 0; i < ris.vm.length; i++) {
    const q = ris.voxel_pezzo[i], atteso = q === 0 ? -1 : Math.fround(Math.min(sn[q - 1] / ris.vm[i], 1e6));
    if (c.fs[i] !== atteso) sbagliati++;
  }
  esito(c.fs.length === ris.nx * ris.ny * ris.nz && sbagliati === 0, 'fs per voxel = snervamento del suo pezzo / vm, −1 dove è vuoto', `${c.fs.length} celle, ${ris.voxel} piene, ${sbagliati} sbagliate`);
  const atteseP = ris.pezzi.map((p) => ({ id: p.id, fs: sn[p.id === 'base' ? 0 : 1] / p.sforzo_max_MPa })).sort((x, y) => x.fs - y.fs);
  const piuSollecitato = ris.pezzi.reduce((x, y) => (y.sforzo_max_MPa > x.sforzo_max_MPa ? y : x)).id;
  esito(atteseP[0].id !== piuSollecitato && uguale(a.pezzi.map((p) => p.id), atteseP.map((p) => p.id)) && a.pezzi.every((p, i) => p.fs_min === atteseP[i].fs) && a.fs_min === atteseP[0].fs &&
    a.sforzo_max_MPa === Math.max(...ris.pezzi.map((p) => p.sforzo_max_MPa)) && a.pezzi[0].materiale === (atteseP[0].id === 'base' ? 'acciaio-s235' : 'titanio-ti6al4v'),
    'pezzi dal più a rischio per fs, non per sforzo (qui i due ordini sono diversi); fs_min e sforzo massimo coerenti',
    `${a.pezzi.map((p) => `${p.id} fs ${p.fs_min.toFixed(2)}`).join(', ')}; più sollecitato ${piuSollecitato}`);
  esito(a.spostamento_max_mm === ris.spostamento_max_mm && a.h_mm === ris.h_mm && a.voxel === ris.voxel && a.iterazioni === 101 && uguale(a.campo.origine, ris.origine) && a.campo.h === ris.h_mm,
    'spostamento, h, voxel, iterazioni e origine come dal calcolo');
  esito(a.avvisi.some((x) => x.includes('«base»') && x.includes('incastro')) && a.avvisi.some((x) => x.includes("'generico'") && x.includes('«boa»')),
    'avvisi: picco vicino all\'incastro e pezzi generici lasciati fuori', a.avvisi.join(' | '));
  const t = O.testo();
  const righe = ['«Staffa di prova», aperto', '4 pezzi', 'Ingombro 130 × 50 × 20 mm', 'senza 1 pezzo da file', 'Massa 171 g', 'Vista: modo ologramma', 'Carichi: 500 N su «perno», faccia +x, direzione [0; -1; 0]',
    'Incastri: «base» faccia -x', 'sforzo massimo', 'fattore di sicurezza minimo', 'spostamento massimo', 'Voxel da', `${ris.voxel} voxel`,
    'Attenzione: stima statica lineare, pezzi incollati; vicino a spigoli e incastri lo sforzo vero può essere più alto: non è una garanzia per costruire.'];
  const mancano = righe.filter((x) => !t.includes(x));
  esito(mancano.length === 0 && t.length < 1500, 'testo per il cervello: titolo, pezzi, ingombro, massa, vista, carichi, analisi, riga d\'onestà; breve', mancano.length ? 'manca: ' + mancano.join(' / ') : `${t.length} caratteri`);
  console.log(t.split('\n').map((x) => '    | ' + x).join('\n'));
  const r2 = O.esegui({ azione: 'analizza' });
  esito(r2.ok && r2.versione === s.versione && !r2.attesa && fc.chiamate.length === 1 && /c'è già/.test(r2.testo), 'analizza di nuovo senza cambi: niente calcolo nuovo');

  // fs = 1e6 dove lo sforzo è zero; pezzi esclusi: −1 nel campo, fuori dai pezzi, con un avviso
  O.esegui({ azione: 'modifica', aggiungi: [{ id: 'staccato', forma: 'scatola', misure: { x: 5, y: 5, z: 5 }, posizione: [0, -40, 0], materiale: 'pla' }] });
  const k = fc.chiamate.length - 1, r3 = risultatoFinto(fc.chiamate[k].lavoro, k + 1);
  const pieno = r3.voxel_pezzo.findIndex((q) => q === 1), staccati = [...r3.voxel_pezzo.keys()].filter((i) => r3.voxel_pezzo[i] === 3);
  r3.vm[pieno] = 0;
  r3.esclusi = ['staccato'];
  r3.pezzi = r3.pezzi.filter((p) => p.id !== 'staccato');
  fc.risolvi(k, r3);
  await pausa();
  const c3 = O.campo(), a3 = O.stato().analisi;
  esito(c3.fs[pieno] === 1e6 && staccati.length > 0 && staccati.every((i) => c3.fs[i] === -1) && !a3.pezzi.some((p) => p.id === 'staccato') && a3.avvisi.some((x) => x.includes('«staccato»') && x.includes('non toccano vincoli')),
    'vm = 0 → fs 1e6; pezzo escluso → −1 nel campo, fuori dalla lista, con l\'avviso', `${staccati.length} voxel del pezzo escluso`);
}

// ------------------------------------------------------------------ 6. ricalcolo da solo
titolo('6. Ricalcolo da solo: quando parte e quando no');
{
  const { O, fc } = nuovo();
  const n = () => fc.chiamate.length;
  O.esegui({ azione: 'mostra', modello: staffa() });
  O.esegui({ azione: 'modifica', cambia: [{ id: 'base', misure: { x: 120 } }] });
  esito(n() === 0, 'senza un\'analisi, cambiare la geometria non calcola');
  await O.esegui({ azione: 'analizza' }).attesa;
  const passi = [
    ['vista', { vista: { modo: 'sforzi', esploso: 0.5 } }, false],
    ['nome, gruppo ed esplodi', { cambia: [{ id: 'base', nome: 'Base', gruppo: 'telaio', esplodi: [0, -1, 0] }] }, false],
    ['misure di un pezzo generico', { cambia: [{ id: 'boa', misure: { r: 12 } }] }, false],
    ['aggiunta di un pezzo generico', { aggiungi: [{ id: 'etichetta', forma: 'scatola', misure: { x: 1, y: 1, z: 1 } }] }, false],
    ['misure di un pezzo calcolato', { cambia: [{ id: 'base', misure: { y: 25 } }] }, true],
    ['posizione di un pezzo calcolato', { cambia: [{ id: 'perno', posizione: [70, 0, 0] }] }, true],
    ['carichi', { carichi: [{ pezzo: 'perno', faccia: '+x', forza_N: 900, direzione: [0, -1, 0] }] }, true],
    ['vincoli', { vincoli: [{ pezzo: 'base', faccia: '-y' }] }, true],
    ['aggiunta di un pezzo di PLA', { aggiungi: [{ id: 'piede', forma: 'scatola', misure: { x: 10, y: 10, z: 10 }, posizione: [0, -15, 0], materiale: 'pla' }] }, true],
    ['materiale con ν diverso (alluminio → titanio)', { cambia: [{ id: 'perno', materiale: 'titanio-ti6al4v' }] }, true],
  ];
  for (const [nome, campi, parte] of passi) {
    const prima = n(), analisiPrima = O.stato().analisi, r = O.esegui({ azione: 'modifica', ...campi });
    if (r.attesa) await r.attesa;
    // Quando non parte, l'analisi resta proprio quella: nemmeno la scorciatoia deve rifarla
    esito(r.ok && n() === prima + (parte ? 1 : 0) && (parte ? !!r.attesa && /Ricalcolo degli sforzi avviato/.test(r.testo) : !r.attesa && uguale(O.stato().analisi, analisiPrima)) && O.stato().analisi.stato === 'fatta',
      `${parte ? 'parte' : 'non parte'}: ${nome}`);
  }
  let prima = n(), r = O.esegui({ azione: 'togli', id: 'boa', modello: O.stato().modello }, { daHud: true });
  esito(r.ok && n() === prima && !r.attesa, "non parte: l'HUD toglie un pezzo generico");
  r = O.esegui({ azione: 'togli', id: 'perno', modello: O.stato().modello }, { daHud: true });
  const a = O.stato().analisi;
  esito(r.ok && n() === prima && a.stato === 'errore' && a.errore.includes('manca un carico') && a.errore.includes('«perno» è tolto') && O.campo() === null,
    "l'HUD toglie il pezzo col carico: non si può ricalcolare, e l'analisi dice perché", a.errore);
  r = O.esegui({ azione: 'rimetti', id: 'perno', modello: O.stato().modello }, { daHud: true });
  await r.attesa;
  esito(n() === prima + 1 && O.stato().analisi.stato === 'fatta', "l'HUD lo rimette: dopo l'errore si ricalcola da solo");
}

// ------------------------------------------------------------------ 7. scorciatoia della lega
titolo('7. Scorciatoia della lega: numeri uguali al ricalcolo pieno');
// Le cifre da confrontare: tutto tranne gli avvisi, le versioni e scorciatoia_s (null dopo un calcolo pieno), che nella
// scorciatoia sono diversi per costruzione.
const cifre = (a) => ({ ...a, avvisi: null, versione: null, spostamento_max_mm: null, scorciatoia_s: null, campo: { ...a.campo, versione: null } });
async function analizzato(modello) {
  const x = nuovo();
  x.O.esegui({ azione: 'mostra', modello });
  await x.O.esegui({ azione: 'analizza' }).attesa;
  return x;
}
for (const [nome, da, a, cambia] of [
  ['un materiale solo: PLA → ABS (ν 0,35, E da 3600 a 1960)', ['pla', 'pla'], ['abs', 'abs'], [{ id: 'muro', materiale: 'abs' }, { id: 'braccio', materiale: 'abs' }]],
  ['due materiali che scalano insieme: S235 → S355 su un pezzo solo', ['acciaio-s235', 'acciaio-s235'], ['acciaio-s235', 'acciaio-s355'], [{ id: 'braccio', materiale: 'acciaio-s355' }]],
]) {
  const x = await analizzato(mensola(...da));
  const r = x.O.esegui({ azione: 'modifica', cambia });
  const sx = x.O.stato(), y = await analizzato(mensola(...a)), sy = y.O.stato();
  const ax = sx.analisi, ay = sy.analisi, cx = x.O.campo(), cy = y.O.campo();
  esito(r.ok && !r.attesa && x.fc.chiamate.length === 1 && ax.stato === 'fatta' && ax.versione === sx.versione && cx.versione === sx.versione && /solo la lega/.test(r.testo),
    `${nome}: niente calcolo, analisi rifatta subito alla versione nuova`);
  esito(uguale(cifre(ax), cifre(ay)), `${nome}: sforzi, fs per pezzo, materiali e griglia uguali al ricalcolo pieno`, `fs minimo ${ax.fs_min.toFixed(4)} contro ${ay.fs_min.toFixed(4)}`);
  esito(bytes(cx.fs).equals(bytes(cy.fs)), `${nome}: campo fs identico bit per bit`, `${cx.fs.length} celle`);
  esito(vicino(ax.spostamento_max_mm, ay.spostamento_max_mm, 1e-12), `${nome}: spostamento scalato di E come nel ricalcolo pieno`, `${ax.spostamento_max_mm} contro ${ay.spostamento_max_mm} mm`);
}
for (const [nome, da, cambia] of [
  ['E che non scalano insieme (PLA e ABS → tutto PLA)', ['pla', 'abs'], [{ id: 'braccio', materiale: 'pla' }]],
  ['ν diverso (PLA → PETG)', ['pla', 'pla'], [{ id: 'muro', materiale: 'petg' }, { id: 'braccio', materiale: 'petg' }]],
]) {
  const x = await analizzato(mensola(...da));
  const r = x.O.esegui({ azione: 'modifica', cambia });
  await r.attesa;
  esito(x.fc.chiamate.length === 2 && x.O.stato().analisi.stato === 'fatta', `niente scorciatoia con ${nome}: ricalcolo pieno`);
}

// ------------------------------------------------------------------ 8. risultati vecchi
titolo("8. Vince l'ultima: i risultati vecchi si scartano");
{
  const { O, fc } = nuovo({ sospeso: true });
  O.esegui({ azione: 'mostra', modello: mensola() });
  const r1 = O.esegui({ azione: 'analizza' });
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 90 } }] });
  esito(fc.chiamate.length === 2 && O.stato().analisi.stato === 'in-corso', 'cambio durante il calcolo: parte un calcolo nuovo');
  let v = O.stato().versione;
  fc.risolvi(0);
  await pausa();
  esito(O.stato().analisi.stato === 'in-corso' && O.stato().versione === v && O.campo() === null, 'il risultato del calcolo superato arriva e si scarta');
  fc.risolvi(1);
  const fine = await r1.attesa;
  esito(O.stato().analisi.stato === 'fatta' && O.stato().analisi.iterazioni === 102 && fine.versione === O.stato().versione && fine.testo.includes('102 iterazioni'),
    "vale l'ultimo, e chi aspettava il primo riceve i numeri dell'ultimo");
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 70 } }] });
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 60 } }] });
  fc.risolvi(3);
  await pausa();
  v = O.stato().versione;
  fc.risolvi(2);
  await pausa();
  esito(O.stato().analisi.iterazioni === 104 && O.stato().versione === v, "se il vecchio arriva dopo il nuovo, si scarta lo stesso");
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 50 } }] });
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 40 } }] });
  fc.chiamate[4].rifiuta(new Error('worker terminato'));
  await pausa();
  esito(O.stato().analisi.stato === 'in-corso', 'il calcolo superato che fallisce (worker terminato) non diventa un errore');
  fc.risolvi(5);
  await pausa();
  esito(O.stato().analisi.stato === 'fatta' && O.stato().analisi.iterazioni === 106, '…e il nuovo arriva normalmente');
  O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 30 } }] });
  const m = O.esegui({ azione: 'mostra', modello: mensola() });
  v = O.stato().versione;
  fc.risolvi(6);
  await pausa();
  esito(m.ok && O.stato().analisi === null && O.stato().versione === v && O.campo() === null, 'mostra durante un calcolo: il suo risultato non tocca il modello nuovo');
}

// ------------------------------------------------------------------ 9. errori del calcolo
titolo('9. Errori del calcolo');
{
  const { O, fc } = nuovo({ sospeso: true });
  O.esegui({ azione: 'mostra', modello: mensola() });
  let r = O.esegui({ azione: 'analizza' });
  const msg = 'il carico sul pezzo «braccio» non ha nessun vincolo: il pezzo volerebbe via';
  fc.chiamate[0].rifiuta(new Error(msg));
  await r.attesa;
  let a = O.stato().analisi;
  esito(a.stato === 'errore' && a.errore === msg && O.testo().includes(`Analisi degli sforzi non riuscita: ${msg}`) && O.campo() === null, "l'errore del calcolo arriva al cervello com'è", a.errore);
  r = O.esegui({ azione: 'analizza' });
  const rotto = risultatoFinto(fc.chiamate[1].lavoro, 2);
  rotto.vm[rotto.voxel_pezzo.findIndex((q) => q > 0)] = NaN;
  fc.risolvi(1, rotto);
  await r.attesa;
  a = O.stato().analisi;
  esito(a.stato === 'errore' && /risultato non valido/.test(a.errore), 'un vm NaN dal calcolo: errore, niente numeri finti', a.errore);
  r = O.esegui({ azione: 'analizza' });
  fc.risolvi(2, { ...risultatoFinto(fc.chiamate[2].lavoro, 3), pezzi: [{ id: 'fantasma', sforzo_max_MPa: 1, punto_mm: [0, 0, 0] }] });
  await r.attesa;
  esito(/risultato non valido \(pezzi\)/.test(O.stato().analisi.errore), 'un pezzo che non era nel lavoro: errore');
}

// ------------------------------------------------------------------ 10. riavvio
titolo('10. Salvataggio e riavvio');
{
  const dir = cartella();
  const A = nuovo({ cartella: dir });
  A.O.esegui({ azione: 'mostra', modello: mensola('pla', 'pla') });
  A.O.esegui({ azione: 'modifica', aggiungi: [{ id: 'targa', forma: 'piastra', misure: { x: 20, z: 20, spessore: 2 }, posizione: [0, 40, 0] }], togli: ['targa'], vista: { modo: 'sforzi' } });
  await A.O.esegui({ azione: 'analizza' }).attesa;
  const file = fs.readdirSync(dir).sort(), n = A.O.campo().fs.length;
  esito(uguale(file, ['ologramma-campo.bin', 'ologramma.json']) && fs.statSync(path.join(dir, 'ologramma-campo.bin')).size === 16 + 6 * n,
    'su disco: ologramma.json e il .bin (vm e voxel_pezzo), niente .tmp avanzati', `${file.join(', ')}; bin ${fs.statSync(path.join(dir, 'ologramma-campo.bin')).size} B per ${n} celle`);
  const B = nuovo({ cartella: dir });
  esito(B.O.carica() === true && uguale(B.O.stato(), A.O.stato()) && B.O.testo() === A.O.testo(), 'dopo il riavvio: stato e testo identici');
  esito(B.O.campo().versione === A.O.campo().versione && bytes(B.O.campo().fs).equals(bytes(A.O.campo().fs)), 'campo fs identico bit per bit, rifatto da vm');
  const cambia = { azione: 'modifica', cambia: [{ id: 'muro', materiale: 'abs' }, { id: 'braccio', materiale: 'abs' }] };
  const ra = A.O.esegui(cambia), rb = B.O.esegui(cambia);
  esito(rb.ok && !rb.attesa && B.fc.chiamate.length === 0 && uguale(B.O.stato(), A.O.stato()) && bytes(B.O.campo().fs).equals(bytes(A.O.campo().fs)),
    'la scorciatoia della lega funziona anche dopo il riavvio, con gli stessi numeri');
  const C = nuovo({ cartella: dir });
  C.O.carica();
  esito(uguale(C.O.stato(), A.O.stato()) && ra.ok, 'riavvio dopo la scorciatoia: stesso stato');
  C.O.esegui({ azione: 'mostra', modello: mensola() });
  esito(C.O.stato().modello === A.O.stato().modello + 1 && C.O.stato().versione === A.O.stato().versione + 1, 'dopo il riavvio modello e versione continuano a crescere');
  esito(!fs.existsSync(path.join(dir, 'ologramma-campo.bin')), "mostra cancella il campo dell'analisi di prima");

  const dir2 = cartella(), D = nuovo({ cartella: dir2, sospeso: true });
  D.O.esegui({ azione: 'mostra', modello: mensola() });
  D.O.esegui({ azione: 'analizza' });
  const E = nuovo({ cartella: dir2 });
  E.O.carica();
  const a = E.O.stato().analisi;
  esito(a.stato === 'errore' && /riavvio/.test(a.errore) && E.O.stato().versione === D.O.stato().versione + 1, 'un calcolo interrotto dal riavvio diventa un errore che lo dice', a.errore);
  fs.writeFileSync(path.join(dir2, 'ologramma.json'), '{ rotto');
  const G = nuovo({ cartella: dir2 });
  esito(G.O.carica() === false && G.O.stato().modello === 0, 'un file illeggibile: si riparte vuoti senza cadere');
  esito(nuovo().O.carica() === false, 'senza file: carica restituisce false');
}

// ------------------------------------------------------------------ 10b. numeri nel testo
titolo('10b. Lo zero negativo delle rotazioni non arriva al cervello');
{
  const { O } = nuovo(); // la flangia girata di 90° ha l'ingombro a −8,9e-16: il 7/11 il testo diceva «x da -0 a 100»
  const r = O.esegui({ azione: 'mostra', modello: { titolo: 'piastra girata', pezzi: [{ id: 'p', forma: 'scatola', misure: { x: 40, y: 80, z: 8 }, posizione: [4, 40, 0], rotazione: [0, 90, 0] }] } });
  const riga = r.testo.split('\n').find((l) => l.startsWith('Ingombro')) || '';
  esito(r.ok && O.stato().ingombro_mm.min.some((v) => v < 0 && v > -1e-9) && !/-0(?![,\d])/.test(riga), 'ingombro senza «-0»', riga);
}

// ------------------------------------------------------------------ 10c. titolo e testi onesti
titolo('10c. Titolo e descrizione con modifica; testi che dicono com\'è andato il calcolo');
{
  const { O, fc } = nuovo();
  O.esegui({ azione: 'mostra', modello: mensola() });
  await O.esegui({ azione: 'analizza' }).attesa;
  const v0 = O.stato().versione, n0 = fc.chiamate.length;
  let r = O.esegui({ azione: 'modifica', titolo: '  Mensola in ABS ', descrizione: 'Stampata in piedi.' });
  let s = O.stato();
  esito(r.ok && s.titolo === 'Mensola in ABS' && s.descrizione === 'Stampata in piedi.' && s.versione === v0 + 1 && r.testo.startsWith('Fatto: titolo, descrizione.') &&
    r.testo.includes('Ologramma «Mensola in ABS»') && fc.chiamate.length === n0 && s.analisi.stato === 'fatta',
    'modifica cambia titolo e descrizione, senza ricalcolare', r.testo.split('\n')[0]);
  r = O.esegui({ azione: 'modifica', titolo: 'x'.repeat(100), descrizione: '' });
  s = O.stato();
  esito(r.ok && s.titolo === 'x'.repeat(80) && s.descrizione === '' && /titolo era più lungo di 80 caratteri: tagliato/.test(r.testo), 'con i limiti di mostra: titolo tagliato a 80 con un avviso, descrizione vuota tolta');
  const v1 = s.versione;
  for (const [nome, campi, motivo] of [['titolo vuoto', { titolo: '   ' }, /titolo è vuoto/], ['titolo che non è un testo', { titolo: 42 }, /titolo deve essere un testo/],
    ['descrizione troppo lunga va tagliata, ma un titolo sbagliato ferma tutto', { titolo: [], descrizione: 'y'.repeat(400) }, /titolo deve essere un testo/]]) {
    r = O.esegui({ azione: 'modifica', ...campi });
    esito(!r.ok && r.codice === 400 && motivo.test((r.errori || []).join(' ')) && O.stato().versione === v1 && O.stato().titolo === 'x'.repeat(80), `${nome}: 400 e niente cambia`, r.errori?.[0] || r.testo?.split('\n')[0]);
  }

  // «avviata» solo finché il calcolo è in corso: la risposta che aspetta la fine dice com'è andata
  const x = nuovo({ sospeso: true });
  x.O.esegui({ azione: 'mostra', modello: mensola() });
  const ra = x.O.esegui({ azione: 'analizza' }), rb = x.O.esegui({ azione: 'analizza' });
  x.fc.risolvi(0);
  const fa = await ra.attesa, fb = await rb.attesa;
  esito(ra.testo.startsWith('Analisi degli sforzi avviata.') && rb.testo.startsWith("L'analisi di questa versione è già in corso.") &&
    fa.testo.startsWith('Analisi degli sforzi finita.') && fb.testo.startsWith('Analisi degli sforzi finita.') && !/avviata|già in corso/.test(fa.testo + fb.testo) && /sforzo massimo/.test(fa.testo),
    'analizza: «avviata» subito, «finita» nella risposta che porta i numeri', `${ra.testo.split('\n')[0]} → ${fa.testo.split('\n')[0]}`);
  const rc = x.O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 90 } }] });
  x.fc.risolvi(1);
  const fc2 = await rc.attesa;
  esito(rc.testo.includes('Ricalcolo degli sforzi avviato.') && fc2.testo.startsWith('Fatto: cambiati «braccio». Sforzi ricalcolati.') && !/avviato/.test(fc2.testo),
    'ricalcolo da solo: «avviato» subito, «ricalcolati» dopo', fc2.testo.split('\n')[0]);
  const rd = x.O.esegui({ azione: 'modifica', cambia: [{ id: 'braccio', misure: { x: 95 } }] });
  x.fc.chiamate[2].rifiuta(new Error('rotto per prova'));
  const fd = await rd.attesa;
  esito(fd.testo.includes('Il ricalcolo degli sforzi non è riuscito') && /rotto per prova/.test(fd.testo), 'ricalcolo che fallisce: lo dice, col perché', fd.testo.split('\n')[0]);

  // La scorciatoia della lega: la riga dei voxel dice che il campo viene dal calcolo di prima, col tempo della scorciatoia
  const y = await analizzato(mensola());
  const pieno = y.O.testo().split('\n').find((l) => l.startsWith('Voxel da'));
  const re = y.O.esegui({ azione: 'modifica', cambia: [{ id: 'muro', materiale: 'abs' }, { id: 'braccio', materiale: 'abs' }] });
  const riga = re.testo.split('\n').find((l) => l.startsWith('Voxel da')) || '', a = y.O.stato().analisi;
  esito(/, 0,25 s\.$/.test(pieno) && y.fc.chiamate.length === 1 && a.scorciatoia_s === 0 && riga.includes('il campo viene dal calcolo di prima (0,25 s)') &&
    riga.includes('rifatti in meno di un millesimo di secondo, senza risolvere'), 'dopo la scorciatoia la riga dei voxel parla del calcolo di prima e del tempo vero', riga);
  esito(y.O.stato().analisi.scorciatoia_s === 0 && (await analizzato(mensola())).O.stato().analisi.scorciatoia_s === null, 'scorciatoia_s: null dopo un calcolo pieno, i secondi dopo la scorciatoia');

  // La massa: la stessa regola di forme.massaTesto, che usa anche l'HUD
  const m = nuovo();
  m.O.esegui({ azione: 'mostra', modello: { titolo: 'Massa', pezzi: [{ id: 'blocco', forma: 'scatola', misure: { x: 1000, y: 1000, z: 315.2 }, materiale: 'acciaio-s235' }] } });
  esito(m.O.testo().includes(`Massa ${F.massaTesto(m.O.stato().massa_kg)}.`) && F.massaTesto(m.O.stato().massa_kg) === '2470 kg', 'massa nel testo con la regola dell\'HUD: 2474,3 kg → 2470 kg', F.massaTesto(m.O.stato().massa_kg));
}

// ------------------------------------------------------------------ 10d. ricerca sui pezzi
titolo('10d. Ricerca sui pezzi: la riga che dice cosa manca, cambia che toglie, salvataggio e ripresa');
{
  const riga = (t) => t.split('\n').find((l) => l.startsWith('Materiali:')) || '';
  const sc = (id, extra = {}) => ({ id, forma: 'scatola', misure: { x: 10, y: 10, z: 10 }, ...extra });
  const IFIXIT = { materiale_vero: 'alluminio 6063 riciclato, anodizzato', fattura: 'fresato da un blocco estruso' };
  const portatile = () => ({ titolo: 'Portatile', pezzi: [
    sc('base', IFIXIT),                                                        // tutto
    sc('vetro', { materiale_vero: 'vetro alluminosilicato', fattura: 'laminato sul pannello' }), // tutto
    sc('cella', { materiale_vero: 'polimeri di litio' }),                      // senza fattura
    sc('vite', { fattura: 'tornita' }),                                        // fattura senza materiale
    sc('staffa', { materiale: 'pla' }),                                        // solo la chiave del calcolo: ha il materiale
    sc('boh'),                                                                 // niente
  ] });
  const dir = cartella(), { O, fc } = nuovo({ cartella: dir });
  let r = O.esegui({ azione: 'mostra', modello: portatile() });
  esito(riga(r.testo) === 'Materiali: 4 pezzi su 6 hanno il materiale. Senza materiale: «vite», «boh». Senza fattura: «cella».',
    'mostra: quanti hanno il materiale, chi no e chi non ha la fattura', riga(r.testo));
  const base = O.stato().pezzi.find((p) => p.id === 'base');
  esito(F.CAMPI_RICERCA.every((k) => base[k] === IFIXIT[k]) && base.materiale === 'generico' && !('fonte' in base), 'i due campi stanno nello stato del pezzo, che è quello che riceve l\'HUD');

  // cambia: i campi nuovi si fondono nel pezzo, quelli non nominati restano; quando non manca niente la riga sparisce
  const v0 = O.stato().versione;
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'boh', materiale_vero: 'rame', fattura: 'trafilato' }, { id: 'cella', fattura: 'celle a sacchetto incollate' }, { id: 'vite', materiale_vero: 'acciaio inox' }] });
  esito(r.ok && O.stato().versione === v0 + 1 && riga(r.testo) === '' && O.stato().pezzi.find((p) => p.id === 'cella').materiale_vero === 'polimeri di litio',
    'cambia completa i pezzi: non manca più niente, la riga sparisce, e il materiale di prima non si perde', riga(r.testo));
  // una stringa vuota toglie il campo
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'base', fattura: '' }, { id: 'boh', materiale_vero: '', fattura: '' }] });
  const b2 = O.stato().pezzi.find((p) => p.id === 'base'), boh = O.stato().pezzi.find((p) => p.id === 'boh');
  esito(r.ok && b2.fattura === null && b2.materiale_vero === IFIXIT.materiale_vero && F.CAMPI_RICERCA.every((k) => boh[k] === null) &&
    riga(r.testo) === 'Materiali: 5 pezzi su 6 hanno il materiale. Senza materiale: «boh». Senza fattura: «base».',
    'cambia con un testo vuoto toglie il campo: «base» torna senza fattura, «boh» senza materiale', riga(r.testo));
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'boh', materiale_vero: '' }] });
  esito(r.ok && r.testo.startsWith('Niente da cambiare') && O.stato().versione === v0 + 2, 'togliere un campo che non c\'è non fa una versione nuova');
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'boh', fattura: 7 }] });
  esito(!r.ok && r.codice === 400 && /fattura deve essere un testo/.test(r.errori.join(' ')) && O.stato().versione === v0 + 2, 'un campo che non è un testo: 400 e niente cambia', r.errori?.[0]);
  // la fonte per pezzo è stata tolta l'11/11: se una conversazione di prima la manda ancora, si ignora e niente si rompe
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'base', fonte: 'iFixit 2022' }] });
  esito(r.ok && !('fonte' in O.stato().pezzi.find((p) => p.id === 'base')), 'una fonte mandata ancora: ignorata, senza errori', r.testo.split('\n')[0]);
  r = O.esegui({ azione: 'modifica', aggiungi: [sc('cavo', { fattura: 'f'.repeat(200) })] });
  esito(r.ok && O.stato().pezzi.find((p) => p.id === 'cavo').fattura.length === 140 && /fattura era più lungo di 140 caratteri: tagliato/.test(r.testo), 'aggiungi con una fattura di 200 caratteri: tagliata a 140, con l\'avviso nella risposta');

  // salvataggio e ripresa: stesso stato e stesso testo, campi compresi
  const B = nuovo({ cartella: dir });
  esito(B.O.carica() === true && uguale(B.O.stato(), O.stato()) && B.O.testo() === O.testo() && riga(B.O.testo()).startsWith('Materiali: 5 pezzi su 7') &&
    B.O.stato().pezzi.find((p) => p.id === 'cella').fattura === 'celle a sacchetto incollate', 'dopo il riavvio i due campi e la riga sono identici', riga(B.O.testo()));
  // uno stato salvato quando la fonte c'era ancora (11/11, prima di toglierla) si riapre: la fonte si perde, il resto no
  const file = path.join(dir, 'ologramma.json'), salvato = JSON.parse(fs.readFileSync(file, 'utf8'));
  salvato.stato.pezzi[0].fonte = 'iFixit 2022';
  fs.writeFileSync(file, JSON.stringify(salvato));
  const V = nuovo({ cartella: dir });
  esito(V.O.carica() === true && V.O.stato().pezzi.length === salvato.stato.pezzi.length && !('fonte' in V.O.stato().pezzi[0]) &&
    V.O.stato().pezzi[0].materiale_vero === salvato.stato.pezzi[0].materiale_vero, 'uno stato salvato con la fonte si riapre uguale, senza la fonte');

  // i campi di testo non toccano il calcolo: né una corsa nuova né la scorciatoia
  const y = await analizzato(mensola());
  const n0 = y.fc.chiamate.length, a0 = JSON.stringify(y.O.stato().analisi);
  r = y.O.esegui({ azione: 'modifica', cambia: [{ id: 'muro', materiale_vero: 'PLA nero', fattura: 'stampato in piedi a 0,2 mm' }] });
  esito(r.ok && !r.attesa && y.fc.chiamate.length === n0 && JSON.stringify(y.O.stato().analisi) === a0 && !/calcol/i.test(r.testo.split('\n')[0]), 'materiale_vero e fattura non fanno ricalcolare gli sforzi', r.testo.split('\n')[0]);

  // quando non manca niente la riga non c'è: una mensola che Tony progetta in PLA non chiede ricerche
  const m = nuovo();
  r = m.O.esegui({ azione: 'mostra', modello: mensola() });
  esito(riga(r.testo) === '' && !/Senza (materiale|fattura)/.test(r.testo), 'pezzi con una chiave vera e nessun campo di ricerca: la riga non compare');
  r = m.O.esegui({ azione: 'mostra', modello: { titolo: 'Completo', pezzi: [sc('a', IFIXIT), sc('b', { ...IFIXIT, materiale: 'alluminio-6061' })] } });
  esito(riga(r.testo) === '', 'tutti con materiale e fattura: la riga non compare');
  // l'elenco si taglia come gli altri: 12 id e poi il conto
  r = m.O.esegui({ azione: 'mostra', modello: { titolo: 'Tanti', pezzi: Array.from({ length: 30 }, (_, i) => sc(`p${i}`)) } });
  esito(riga(r.testo) === `Materiali: 0 pezzi su 30 hanno il materiale. Senza materiale: ${Array.from({ length: 12 }, (_, i) => `«p${i}»`).join(', ')} e altri 18.`, 'trenta pezzi senza materiale: dodici id e «e altri 18»', riga(r.testo));
  // un pezzo tolto da Tony è ancora del modello: conta
  m.O.esegui({ azione: 'mostra', modello: { titolo: 'Due', pezzi: [sc('a', IFIXIT), sc('b')] } });
  r = m.O.esegui({ azione: 'modifica', togli: ['b'] });
  esito(riga(r.testo) === 'Materiali: 1 pezzo su 2 ha il materiale. Senza materiale: «b».', 'un pezzo tolto resta nella riga', riga(r.testo));
  void fc;
}

// ------------------------------------------------------------------ 10e. colore dei pezzi
titolo('10e. Colore dei pezzi: mostra, cambia, versione, niente ricalcolo, salvataggio e ripresa');
{
  const colori = (O) => Object.fromEntries(O.stato().pezzi.map((p) => [p.id, p.colore]));
  const acqua = () => ({ titolo: "Molecola d'acqua", pezzi: [
    { id: 'ossigeno', forma: 'sfera', misure: { r: 76 }, colore: '#E53935' },
    { id: 'idrogeno-1', forma: 'sfera', misure: { r: 53 }, posizione: [158, -122, 0], colore: '#fff' },
    { id: 'legame-1', forma: 'cilindro', misure: { r: 10, h: 81 }, posizione: [88, -68, 0], rotazione: [0, 0, 52.25] },
  ] });
  const dir = cartella(), { O, cambi } = nuovo({ cartella: dir });
  let r = O.esegui({ azione: 'mostra', modello: acqua() });
  esito(r.ok && uguale(colori(O), { ossigeno: '#e53935', 'idrogeno-1': '#ffffff', 'legame-1': null }) && !/sconosciut/.test(r.testo),
    'mostra: i colori nello stato, normalizzati in #rrggbb minuscolo; senza colore è null, e nessun avviso di campo sconosciuto', JSON.stringify(colori(O)));
  const v0 = O.stato().versione, n0 = cambi.length;
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'ossigeno', colore: '#1E88E5' }, { id: 'legame-1', colore: '#ccc' }] });
  esito(r.ok && O.stato().versione === v0 + 1 && cambi.length === n0 + 1 && uguale(colori(O), { ossigeno: '#1e88e5', 'idrogeno-1': '#ffffff', 'legame-1': '#cccccc' }) && r.testo.startsWith('Fatto: cambiati'),
    'cambia col solo colore: versione nuova e un avviso all\'HUD, gli altri pezzi restano', `versione ${v0} → ${O.stato().versione}`);
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'ossigeno', colore: '' }, { id: 'legame-1', colore: null }] });
  esito(r.ok && O.stato().versione === v0 + 2 && uguale(colori(O), { ossigeno: null, 'idrogeno-1': '#ffffff', 'legame-1': null }), 'cambia con colore vuoto o null lo toglie', JSON.stringify(colori(O)));
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'ossigeno', colore: '' }] });
  esito(r.ok && r.testo.startsWith('Niente da cambiare') && O.stato().versione === v0 + 2, 'togliere un colore che non c\'è non fa una versione nuova');
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'idrogeno-1', colore: '#FFFFFF' }] });
  esito(r.ok && r.testo.startsWith('Niente da cambiare') && O.stato().versione === v0 + 2, 'lo stesso colore scritto in maiuscolo non è un cambio');
  r = O.esegui({ azione: 'modifica', cambia: [{ id: 'idrogeno-1', colore: 'bianco' }] });
  esito(!r.ok && r.codice === 400 && /colore "bianco" non è un colore/.test(r.errori.join(' ')) && O.stato().versione === v0 + 2 && colori(O)['idrogeno-1'] === '#ffffff',
    'un colore a parole: 400, l\'errore lo dice, e niente cambia', r.errori?.[0]);
  r = O.esegui({ azione: 'modifica', aggiungi: [{ id: 'idrogeno-2', forma: 'sfera', misure: { r: 53 }, posizione: [-158, -122, 0], colore: '#f5f5f5' }] });
  esito(r.ok && colori(O)['idrogeno-2'] === '#f5f5f5', 'aggiungi accetta il colore come mostra');

  // salvataggio e ripresa: i colori tornano uguali
  const B = nuovo({ cartella: dir });
  esito(B.O.carica() === true && uguale(B.O.stato(), O.stato()) && B.O.testo() === O.testo(), 'dopo il riavvio lo stato, colori compresi, è identico', JSON.stringify(colori(B.O)));
  // uno stato salvato prima del campo colore (senza la chiave) si riapre uguale, con colore null
  const file = path.join(dir, 'ologramma.json'), salvato = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const p of salvato.stato.pezzi) delete p.colore;
  fs.writeFileSync(file, JSON.stringify(salvato));
  const V = nuovo({ cartella: dir });
  esito(V.O.carica() === true && V.O.stato().pezzi.length === O.stato().pezzi.length && V.O.stato().pezzi.every((p) => p.colore === null) &&
    uguale(V.O.stato().pezzi.map(({ colore, ...resto }) => resto), O.stato().pezzi.map(({ colore, ...resto }) => resto)) && V.O.stato().versione === O.stato().versione,
    'uno stato salvato senza colore si riapre uguale, coi pezzi senza colore');

  // il colore non tocca il calcolo: né una corsa nuova né la scorciatoia, ma la versione sale
  const y = await analizzato(mensola());
  const c0 = y.fc.chiamate.length, a0 = JSON.stringify(y.O.stato().analisi), w0 = y.O.stato().versione;
  r = y.O.esegui({ azione: 'modifica', cambia: [{ id: 'muro', colore: '#e53935' }, { id: 'braccio', colore: '#fff' }] });
  esito(r.ok && !r.attesa && y.fc.chiamate.length === c0 && JSON.stringify(y.O.stato().analisi) === a0 && y.O.stato().versione === w0 + 1 && !/calcol/i.test(r.testo.split('\n')[0]),
    'un cambio di solo colore con un\'analisi fatta: versione nuova, nessun ricalcolo, analisi identica', r.testo.split('\n')[0]);
}

// ------------------------------------------------------------------ 11. sicurezza del codice
titolo('11. Niente API vietate');
{
  const src = fs.readFileSync(new URL('../ologramma.mjs', import.meta.url), 'utf8');
  const vietate = ['eval(', 'new Function', 'innerHTML', 'Function('].filter((x) => src.includes(x));
  esito(vietate.length === 0, 'ologramma.mjs non usa eval, new Function né innerHTML', vietate.join(', ') || 'nessuna');
}

console.log(`\n${passati} PASS, ${falliti} FAIL`);
process.exit(falliti ? 1 : 0);
