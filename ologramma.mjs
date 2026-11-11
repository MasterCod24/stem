// ologramma.mjs — lo stato dell'ologramma, tenuto dal server: è l'unico che lo scrive.
// Valida con forme.js quello che arriva dal cervello (mostra, modifica, analizza, chiudi) e dall'HUD
// (togli, rimetti, chiudi), conta modelli e versioni, salva in runtime/ e scrive il riassunto per il cervello.
// Gli sforzi li calcola `calcola`, passato da fuori (nel server fisica/struttura.mjs in un worker, nelle
// prove un finto): qui si decide quando calcolare, si scartano i risultati superati e si fa fs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LIMITI, PREDEFINITI, normalizzaModello, normalizzaPezzo, normalizzaCarichi, normalizzaVincoli, normalizzaVista, normalizzaTesti, volume, ingombro, massaTesto } from './public/ologramma/forme.js';
import { MATERIALI, materiale } from './public/ologramma/materiali.js';

const OPZIONI = Object.freeze({ voxel_max: 40000, tempo_max_s: 45 });
const FS_MAX = 1e6;        // «sicurezza enorme»: anche dove lo sforzo è zero
const CELLE_MAX = 1 << 24; // 16,8 milioni di celle, 64 MB per array: oltre, il risultato è rotto
const AZIONI_HUD = ['togli', 'rimetti', 'chiudi'];
const CAMPI_MODIFICA = ['cambia', 'aggiungi', 'togli', 'rimetti', 'vista', 'carichi', 'vincoli', 'titolo', 'descrizione'];
const VERI = Object.keys(MATERIALI).filter((k) => MATERIALI[k].E > 0).join(', ');
const ONESTA = 'stima statica lineare, pezzi incollati; vicino a spigoli e incastri lo sforzo vero può essere più alto: non è una garanzia per costruire';

const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finito = (v, min = -Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const terna = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => finito(x));
const intero = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const impronta = (x) => createHash('sha256').update(JSON.stringify(x)).digest('base64');
const elenco = (ids) => ids.slice(0, 12).map((id) => `«${id}»`).join(', ') + (ids.length > 12 ? ` e altri ${ids.length - 12}` : '');
// Un valore del cervello, corto e tra virgolette se è un testo: nei messaggi si vede cosa è arrivato
function breve(v) {
  try { const s = JSON.stringify(v) ?? String(v); return s.length > 40 ? s.slice(0, 39) + '…' : s; } catch { return typeof v; }
}
const N3 = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 3, useGrouping: false });
// signDisplay 'negative': uno zero negativo (−8,9e-16 dalle rotazioni di 90°) si scriveva «x da -0 a 100»
const N1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, useGrouping: false, signDisplay: 'negative' });
const num = (v) => N3.format(v); // sforzi, masse, fattori: tre cifre bastano
const mm = (v) => N1.format(v);  // coordinate al decimo di mm
const vettore = (v, f = num) => `[${v.map(f).join('; ')}]`; // il punto e virgola, perché la virgola è già il decimale
const nomeMateriale = (k) => materiale(k)?.nome ?? k;
const fsTesto = (v) => (v >= 1000 ? 'oltre 1000' : num(v) + (v < 1 ? ' (sotto 1: in questa stima snerva)' : ''));

function statoVuoto(modello, versione) {
  return {
    aperto: false, modello, versione, titolo: '', descrizione: '', pezzi: [], tolti: [], carichi: [], vincoli: [],
    vista: { ...PREDEFINITI.vista }, massa_kg: null, ingombro_mm: null, analisi: null,
  };
}

function analisiVuota(stato, versione, altro = {}) {
  return {
    stato, versione, errore: null, h_mm: null, voxel: null, iterazioni: null, convergito: null, tempo_s: null,
    sforzo_max_MPa: null, fs_min: null, spostamento_max_mm: null, scorciatoia_s: null, pezzi: [], avvisi: [], campo: null, ...altro,
  };
}

// Il lavoro per fisica/struttura.mjs: i pezzi con calcolo true, non tolti e con un materiale vero, più carichi
// e vincoli su quei pezzi. errori dice cosa manca per calcolare, avvisi cosa resta fuori e perché.
function preparaLavoro(s) {
  const tolti = new Set(s.tolti), pezzi = [], generici = [], avvisi = [], errori = [];
  for (const p of s.pezzi) {
    if (!p.calcolo || tolti.has(p.id)) continue;
    const m = materiale(p.materiale);
    if (!m || !(m.E > 0)) { generici.push(p.id); continue; }
    pezzi.push({ ...p, mat: { chiave: p.materiale, E: m.E, nu: m.nu, snervamento: m.snervamento, densita: m.densita, affidabile: m.affidabile } });
  }
  if (generici.length && pezzi.length) avvisi.push(`fuori dal calcolo perché hanno materiale 'generico': ${elenco(generici)}`);
  const dentro = new Set(pezzi.map((p) => p.id));
  const perche = (id) => (tolti.has(id) ? 'è tolto' : generici.includes(id) ? "ha materiale 'generico'" : 'ha calcolo false');
  const fuori = (lista) => lista.filter((x) => !dentro.has(x.pezzo)).map((x) => `«${x.pezzo}» ${perche(x.pezzo)}`);
  const carichi = s.carichi.filter((c) => dentro.has(c.pezzo)), vincoli = s.vincoli.filter((v) => dentro.has(v.pezzo));
  const cf = fuori(s.carichi), vf = fuori(s.vincoli);
  if (cf.length) avvisi.push(`carichi che non contano: ${cf.join(', ')}`);
  if (vf.length) avvisi.push(`incastri che non contano: ${vf.join(', ')}`);
  if (!pezzi.length) {
    errori.push(generici.length
      ? `nessun pezzo ha un materiale vero: ${elenco(generici)} ${generici.length === 1 ? 'ha' : 'hanno'} materiale 'generico', senza E né snervamento; scegli fra ${VERI}`
      : 'nessun pezzo entra nel calcolo: sono tutti tolti o con calcolo false');
  }
  if (!vincoli.length) errori.push(`manca un vincolo: serve almeno un incastro { pezzo, faccia, tipo: 'incastro' } su un pezzo che entra nel calcolo, se no il pezzo volerebbe via${vf.length ? ` (${vf.join(', ')})` : ''}`);
  if (!carichi.length) errori.push(`manca un carico: serve almeno un carico { pezzo, faccia, forza_N, direzione } su un pezzo che entra nel calcolo${cf.length ? ` (${cf.join(', ')})` : ''}`);
  return { lavoro: { pezzi, carichi, vincoli, opzioni: { ...OPZIONI } }, errori, avvisi };
}

// Due impronte del lavoro: geo (pezzi, misure, posa, carichi e vincoli) e tutto (geo più i materiali).
// Se cambia solo tutto, è cambiata solo la lega: la scorciatoia può bastare.
function firme(L) {
  const geo = impronta([L.pezzi.map((p) => [p.id, p.forma, p.misure, p.posizione, p.rotazione]), L.carichi, L.vincoli]);
  return { geo, tutto: impronta([geo, L.pezzi.map((p) => p.mat.chiave)]) };
}

// k tale che E di adesso = k · E del calcolo per tutti i pezzi, con ν uguali; null se non c'è. Con E scalato
// dello stesso k ovunque e ν fermo, K·u = f diventa (k·K)·(u/k) = f: sforzi uguali, spostamenti divisi per k.
// Vale anche con più materiali, purché scalino insieme (S235 → S355 su un pezzo solo: k = 1).
function scala(mats, pezzi) {
  if (mats.length !== pezzi.length) return null;
  let k = null;
  for (let i = 0; i < pezzi.length; i++) {
    const a = mats[i], b = pezzi[i];
    if (a.id !== b.id || a.nu !== b.mat.nu) return null;
    const r = b.mat.E / a.E;
    if (k === null) k = r;
    else if (Math.abs(r - k) > 1e-12 * k) return null;
  }
  return k;
}

// fs per voxel: snervamento / von Mises, −1 dove è vuoto o il pezzo è stato escluso, FS_MAX dove lo sforzo è zero.
function campoSicurezza(vm, vp, snervamento, escluso) {
  const s = new Float32Array(vm.length);
  for (let i = 0; i < vm.length; i++) {
    const q = vp[i] - 1;
    s[i] = q < 0 || escluso[q] ? -1 : vm[i] > 0 ? Math.min(snervamento[q] / vm[i], FS_MAX) : FS_MAX;
  }
  return s;
}

// Il risultato arriva da un altro modulo (e da un worker): forme e numeri si controllano tutti prima di usarli.
function controllaRisultato(r, pezzi) {
  const no = (cosa) => { throw new Error(`il calcolo ha dato un risultato non valido (${cosa})`); };
  if (!oggetto(r)) no('non è un oggetto');
  const { nx, ny, nz } = r;
  if (![nx, ny, nz].every((v) => Number.isSafeInteger(v) && v > 0) || nx * ny * nz > CELLE_MAX) no('nx, ny, nz');
  const n = nx * ny * nz;
  if (!finito(r.h_mm) || r.h_mm <= 0 || !terna(r.origine)) no('h_mm o origine');
  if (!(r.voxel_pezzo instanceof Uint16Array) || r.voxel_pezzo.length !== n || !(r.vm instanceof Float32Array) || r.vm.length !== n) no('voxel_pezzo o vm');
  for (let i = 0; i < n; i++) if (r.voxel_pezzo[i] > pezzi.length || !(r.vm[i] >= 0 && r.vm[i] < Infinity)) no(`cella ${i}`);
  if (!['voxel', 'iterazioni', 'tempo_s', 'spostamento_max_mm'].every((k) => finito(r[k], 0)) || typeof r.convergito !== 'boolean') no('numeri del risolutore');
  const ids = new Set(pezzi.map((p) => p.id));
  if (!Array.isArray(r.pezzi) || !r.pezzi.every((p) => oggetto(p) && ids.has(p.id) && finito(p.sforzo_max_MPa, 0) && terna(p.punto_mm))) no('pezzi');
  if (r.esclusi != null && (!Array.isArray(r.esclusi) || !r.esclusi.every((id) => ids.has(id)))) no('esclusi');
  if (r.avvisi != null && (!Array.isArray(r.avvisi) || !r.avvisi.every((a) => typeof a === 'string'))) no('avvisi');
}

// Del risultato si tengono solo i numeri (gli array restano a parte): è anche quello che va nel file.
const numeri = (r) => ({
  h_mm: r.h_mm, nx: r.nx, ny: r.ny, nz: r.nz, origine: [...r.origine], voxel: r.voxel, iterazioni: r.iterazioni,
  convergito: r.convergito, tempo_s: r.tempo_s, spostamento_max_mm: r.spostamento_max_mm,
  pezzi: r.pezzi.map((p) => ({ id: p.id, sforzo_max_MPa: p.sforzo_max_MPa, punto_mm: [...p.punto_mm], vicino_incastro: p.vicino_incastro === true })),
  esclusi: [...(r.esclusi || [])], avvisi: (r.avvisi || []).slice(0, 20).map((a) => a.slice(0, 300)),
});

// Un campo null vale come assente: «carichi: null» non deve cancellare i carichi; per toglierli si manda [].
const senzaNull = (a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null));
const datiDi = (s) => JSON.stringify([s.aperto, s.titolo, s.descrizione, s.pezzi, s.tolti, s.carichi, s.vincoli, s.vista]);
const byte = (t) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);

export function createOlogramma({ cartella, calcola, onCambio = () => {}, ora = Date.now } = {}) {
  const FILE = path.join(cartella, 'ologramma.json'), BIN = path.join(cartella, 'ologramma-campo.bin');
  let S = statoVuoto(0, 0);
  let chiusoDa = null;  // 'tony' (Esc nell'HUD) o 'stem': il cervello deve sapere chi l'ha chiuso
  let base = null;      // l'ultimo calcolo risolto: { versione, geo, tutto, mats, r, vm, vp }
  let sicurezza = null; // fs per voxel, rifatto da base con i materiali di adesso
  let corsa = null;     // il calcolo in volo: { versione, geo, tutto, lavoro, inizio }
  let fine = null, risolviFine = null; // chi aspetta: si risolve quando l'analisi esce da 'in-corso'

  function scrivi(file, dati) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, dati);
    fs.renameSync(tmp, file); // tutto o niente: chi legge non trova mai un file a metà
  }

  // Il .bin cambia solo quando cambia base: [versione di base, n] in Float64, poi vm (Float32) e voxel_pezzo (Uint16).
  // fs non serve salvarlo: si rifà identico da questi due e dai materiali, e un doppione potrebbe contraddirli.
  function salva(bin) {
    try {
      fs.mkdirSync(cartella, { recursive: true });
      if (bin && base) scrivi(BIN, Buffer.concat([byte(new Float64Array([base.versione, base.vm.length])), byte(base.vm), byte(base.vp)]));
      else if (bin) fs.rmSync(BIN, { force: true });
      const b = base && { versione: base.versione, geo: base.geo, tutto: base.tutto, mats: base.mats, r: base.r };
      scrivi(FILE, JSON.stringify({ stato: S, chiusoDa, base: b }));
    } catch (e) {
      console.error(`[ologramma] non riesco a salvare: ${e.message}`); // lo stato in memoria resta buono
    }
  }

  function avvisa() {
    try { onCambio(stato()); } catch (e) { console.error(`[ologramma] onCambio: ${e.message}`); }
  }

  function chiudiFine() {
    if (!risolviFine) return;
    const r = risolviFine;
    fine = risolviFine = null;
    r();
  }

  // Massa e ingombro dei pezzi non tolti. I pezzi 'file' non hanno né volume né ingombro: il server non li apre.
  function derivati() {
    const tolti = new Set(S.tolti), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    let massa = 0, conMassa = 0, conIngombro = 0;
    for (const p of S.pezzi) {
      if (tolti.has(p.id)) continue;
      const v = volume(p), rho = materiale(p.materiale)?.densita;
      if (v !== null && rho > 0) { massa += v * rho * 1e-9; conMassa++; } // mm³ · kg/m³ · 1e-9 = kg
      const b = ingombro(p);
      if (!b) continue;
      conIngombro++;
      for (let c = 0; c < 3; c++) { if (b.min[c] < min[c]) min[c] = b.min[c]; if (b.max[c] > max[c]) max[c] = b.max[c]; }
    }
    S.massa_kg = conMassa ? massa : null;
    S.ingombro_mm = conIngombro ? { min, max } : null;
  }

  // L'analisi dai numeri di base e dai materiali di adesso: dopo un calcolo, dopo la scorciatoia e dopo un riavvio.
  // Se i materiali non sono più quelli del calcolo (la scorciatoia della lega, anche dopo un riavvio) il campo viene
  // dal calcolo di prima: scorciatoia_s dice in quanto sono stati rifatti fs e spostamento, il testo lo racconta così.
  function rifaiAnalisi(versione, versioneCampo = S.versione) {
    const t0 = ora(), L = preparaLavoro(S), P = L.lavoro.pezzi, r = base.r, k = scala(base.mats, P);
    const lega = base.mats.some((m, i) => m.chiave !== P[i].mat.chiave);
    const esclusi = new Set(r.esclusi), mat = new Map(P.map((p) => [p.id, p.mat]));
    sicurezza = campoSicurezza(base.vm, base.vp, P.map((p) => p.mat.snervamento), P.map((p) => esclusi.has(p.id)));
    const pezzi = r.pezzi.filter((p) => !esclusi.has(p.id)).map((p) => {
      const m = mat.get(p.id), fs_min = p.sforzo_max_MPa > 0 ? Math.min(m.snervamento / p.sforzo_max_MPa, FS_MAX) : FS_MAX;
      return { id: p.id, materiale: m.chiave, sforzo_max_MPa: p.sforzo_max_MPa, fs_min, punto_mm: [...p.punto_mm] };
    }).sort((a, b) => a.fs_min - b.fs_min); // dal più a rischio: conta fs, non lo sforzo, perché i materiali sono diversi
    const avvisi = [...L.avvisi, ...r.avvisi];
    if (!r.convergito) avvisi.push('il risolutore non è arrivato a convergenza: i numeri sono meno precisi');
    for (const p of r.pezzi) if (p.vicino_incastro && !esclusi.has(p.id)) avvisi.push(`pezzo «${p.id}»: il picco è vicino a un incastro, dove il valore è una stima`);
    for (const p of P) if (!p.mat.affidabile) avvisi.push(`pezzo «${p.id}»: materiale non isotropo (${nomeMateriale(p.mat.chiave)}), numeri indicativi`);
    if (esclusi.size) avvisi.push(`lasciati fuori perché non toccano vincoli e non hanno carichi: ${elenco([...esclusi])}`);
    if (lega) avvisi.push('materiale cambiato senza risolvere di nuovo: con lo stesso ν gli sforzi non cambiano, fs e spostamento sono rifatti');
    S.analisi = {
      stato: 'fatta', versione, errore: null, h_mm: r.h_mm, voxel: r.voxel, iterazioni: r.iterazioni, convergito: r.convergito, tempo_s: r.tempo_s,
      sforzo_max_MPa: pezzi.length ? Math.max(...pezzi.map((p) => p.sforzo_max_MPa)) : null,
      fs_min: pezzi.length ? pezzi[0].fs_min : null,
      spostamento_max_mm: r.spostamento_max_mm / k, scorciatoia_s: lega ? (ora() - t0) / 1000 : null,
      pezzi, avvisi: [...new Set(avvisi)],
      campo: { versione: versioneCampo, nx: r.nx, ny: r.ny, nz: r.nz, h: r.h_mm, origine: [...r.origine] },
    };
  }

  function avvia(L, f) {
    const c = { versione: S.versione, geo: f.geo, tutto: f.tutto, lavoro: L.lavoro, inizio: ora() };
    corsa = c;
    base = sicurezza = null;
    S.analisi = analisiVuota('in-corso', S.versione);
    if (!fine) fine = new Promise((r) => (risolviFine = r));
    // Il calcolo parte subito (un errore lanciato subito diventa un rifiuto): quando esegui risponde, il worker c'è già
    new Promise((ok) => ok(calcola(L.lavoro))).then((r) => arrivato(c, r, null), (e) => arrivato(c, null, e));
  }

  function arrivato(c, r, e) {
    // Vince l'ultima: ogni cambio che tocca il calcolo ne avvia uno nuovo (o lo annulla), quindi un risultato
    // di una corsa che non è più quella attuale è vecchio e si butta.
    if (corsa !== c) return;
    corsa = null;
    S.versione++;
    if (!e) {
      try {
        controllaRisultato(r, c.lavoro.pezzi);
        const mats = c.lavoro.pezzi.map((p) => ({ id: p.id, chiave: p.mat.chiave, E: p.mat.E, nu: p.mat.nu, snervamento: p.mat.snervamento }));
        base = { versione: S.versione, geo: c.geo, tutto: c.tutto, mats, r: numeri(r), vm: r.vm, vp: r.voxel_pezzo };
        rifaiAnalisi(c.versione);
      } catch (x) { e = x; }
    }
    if (e) {
      base = sicurezza = null;
      S.analisi = analisiVuota('errore', c.versione, { errore: String((e && e.message) || e).slice(0, 500) });
    }
    salva(true);
    avvisa();
    chiudiFine();
  }

  // Applica campi già validati e decide cosa fare del calcolo. Un cambio che non cambia niente non conta come
  // versione nuova: niente salvataggio, niente avviso all'HUD.
  function commit(campi, { analizza = false } = {}) {
    const dopo = { ...S, ...campi }, a = S.analisi;
    const L1 = preparaLavoro(dopo), f0 = firme(preparaLavoro(S).lavoro), f1 = firme(L1.lavoro);
    let calc = null;
    if (analizza) {
      const gia = a && ((a.stato === 'in-corso' && corsa && corsa.tutto === f1.tutto) || (a.stato === 'fatta' && base && base.tutto === f1.tutto));
      if (!gia) calc = 'corsa';
    } else if (a && f1.tutto !== f0.tutto) { // ricalcolo da solo: c'era un'analisi e il cambio la tocca
      if (a.stato === 'fatta' && base && base.geo === f1.geo && scala(base.mats, L1.lavoro.pezzi) !== null) calc = 'scorciatoia';
      else calc = L1.errori.length ? 'errore' : 'corsa';
    }
    const aspetta = calc === 'corsa' || (analizza && !calc && a.stato === 'in-corso');
    if (!calc && datiDi(dopo) === datiDi(S)) return { cambiato: false, calc, aspetta };
    if (campi.aperto) chiusoDa = null;
    Object.assign(S, campi);
    S.versione++;
    derivati();
    if (calc === 'corsa') avvia(L1, f1);
    else if (calc === 'scorciatoia') { base.tutto = f1.tutto; rifaiAnalisi(S.versione); }
    else if (calc === 'errore') {
      corsa = base = sicurezza = null;
      S.analisi = analisiVuota('errore', S.versione, { errore: `il calcolo non si può rifare: ${L1.errori.join('; ')}` });
    }
    salva(calc === 'corsa' || calc === 'errore');
    avvisa();
    if (S.analisi?.stato !== 'in-corso') chiudiFine();
    return { cambiato: true, calc, aspetta };
  }

  const no = (codice, errori) => ({ ok: false, codice, versione: S.versione, errori, testo: `Niente è cambiato:\n- ${errori.join('\n- ')}` });

  // intestazione può essere una funzione: il server risponde dopo l'attesa del calcolo, e allora la frase giusta è un'altra
  function fatto(esito, intestazione, avvisi = []) {
    const testa = typeof intestazione === 'function' ? intestazione : () => intestazione;
    const t = () => [testa(), ...(avvisi.length ? [`Avvisi: ${avvisi.join('; ')}.`] : []), testo()].filter(Boolean).join('\n');
    const out = { ok: true, codice: 200, versione: S.versione, testo: t() };
    if (esito.aspetta && fine) out.attesa = fine.then(() => ({ ok: true, codice: 200, versione: S.versione, testo: t() }));
    return out;
  }

  const DOPO_CALCOLO = {
    scorciatoia: ' È cambiata solo la lega, con lo stesso ν: sforzi uguali, fs e spostamento rifatti senza risolvere.',
    errore: ' Il calcolo degli sforzi non si può rifare: il perché è sotto.',
  };
  // Un ricalcolo partito: «avviato» finché è in corso, poi com'è andato. Prima la risposta che portava già i numeri nuovi
  // diceva ancora «avviato».
  const dopoCorsa = () => ({ 'in-corso': ' Ricalcolo degli sforzi avviato.', fatta: ' Sforzi ricalcolati.', errore: ' Il ricalcolo degli sforzi non è riuscito: il perché è sotto.' })[S.analisi?.stato] || '';
  const intestazione = (esito, t) => () => (!esito.cambiato ? 'Niente da cambiare: era già così.' : t + (esito.calc === 'corsa' ? dopoCorsa() : DOPO_CALCOLO[esito.calc] || ''));
  const estranei = (a, noti) => {
    const x = Object.keys(a).filter((k) => k !== 'azione' && !noti.includes(k));
    return x.length ? [`campi sconosciuti, ignorati: ${x.slice(0, 5).map(breve).join(', ')}`] : [];
  };

  function mostra(a) {
    const avvisi = estranei(a, ['modello']), r = normalizzaModello(a.modello);
    if (!r.modello) return no(400, r.errori);
    const m = r.modello;
    corsa = base = sicurezza = chiusoDa = null;
    S = { ...statoVuoto(S.modello + 1, S.versione + 1), aperto: true, titolo: m.titolo, descrizione: m.descrizione, pezzi: m.pezzi, carichi: m.carichi, vincoli: m.vincoli, vista: m.vista };
    derivati();
    salva(true);
    avvisa();
    chiudiFine(); // chi aspettava l'analisi del modello di prima non aspetta più
    return fatto({}, `Mostrato «${m.titolo}» (modello ${S.modello}).`, [...avvisi, ...r.avvisi]);
  }

  function modifica(a) {
    if (!S.modello) return no(400, ["non c'è nessun ologramma da modificare: usa prima mostra"]);
    a = senzaNull(a);
    if (CAMPI_MODIFICA.every((k) => a[k] === undefined)) return { ok: true, codice: 200, versione: S.versione, testo: testo() };
    const errori = [], avvisi = estranei(a, CAMPI_MODIFICA);
    const pezzi = S.pezzi.slice(), indice = new Map(pezzi.map((p, i) => [p.id, i]));
    const quali = () => elenco([...indice.keys()]);
    const lista = (v, nome) => {
      if (v === undefined) return [];
      if (Array.isArray(v) && v.length <= LIMITI.pezzi) return v;
      errori.push(`${nome}: deve essere una lista di al massimo ${LIMITI.pezzi} elementi, non ${breve(v)}`);
      return [];
    };
    const cambiati = [], aggiunti = [];
    lista(a.cambia, 'cambia').forEach((c, i) => {
      const j = oggetto(c) && typeof c.id === 'string' ? indice.get(c.id) : undefined;
      if (j === undefined) { errori.push(`cambia[${i}]: ${oggetto(c) ? `id ${breve(c.id)} non è un pezzo` : 'deve essere un oggetto { id, …campi da cambiare }'}; i pezzi sono ${quali()}`); return; }
      const vecchio = pezzi[j], unito = { ...vecchio, ...c };
      if (c.forma !== undefined && c.forma !== vecchio.forma) {
        for (const k of ['misure', 'calcolo', 'flusso']) if (c[k] === undefined) delete unito[k]; // valevano per la forma di prima
      } else if (oggetto(c.misure)) unito.misure = { ...vecchio.misure, ...c.misure }; // le misure si fondono campo per campo
      const r = normalizzaPezzo(unito);
      errori.push(...r.errori);
      avvisi.push(...r.avvisi);
      if (r.pezzo) { pezzi[j] = r.pezzo; cambiati.push(c.id); }
    });
    lista(a.aggiungi, 'aggiungi').forEach((p, i) => {
      const r = normalizzaPezzo(p);
      errori.push(...r.errori.map((e) => `aggiungi[${i}]: ${e}`));
      avvisi.push(...r.avvisi);
      if (!r.pezzo) return;
      if (indice.has(r.pezzo.id)) { errori.push(`aggiungi[${i}]: «${r.pezzo.id}» c'è già; per cambiarlo usa cambia`); return; }
      indice.set(r.pezzo.id, pezzi.length);
      pezzi.push(r.pezzo);
      aggiunti.push(r.pezzo.id);
    });
    if (pezzi.length > LIMITI.pezzi) errori.push(`aggiungi: si arriverebbe a ${pezzi.length} pezzi, al massimo ${LIMITI.pezzi}`);
    const ids = (v, nome) => lista(v, nome).filter((id, i) => indice.has(id) || (errori.push(`${nome}[${i}]: ${breve(id)} non è un pezzo; i pezzi sono ${quali()}`), false));
    const via = ids(a.togli, 'togli'), su = ids(a.rimetti, 'rimetti');
    for (const id of via) if (su.includes(id)) errori.push(`«${id}» è sia in togli sia in rimetti`);
    let { carichi, vincoli, vista } = S;
    if (a.carichi !== undefined) { const r = normalizzaCarichi(a.carichi, pezzi); errori.push(...r.errori); avvisi.push(...r.avvisi); carichi = r.carichi; }
    if (a.vincoli !== undefined) { const r = normalizzaVincoli(a.vincoli, pezzi); errori.push(...r.errori); avvisi.push(...r.avvisi); vincoli = r.vincoli; }
    if (a.vista !== undefined) { const r = normalizzaVista(a.vista, pezzi, S.vista); errori.push(...r.errori); avvisi.push(...r.avvisi); vista = r.vista; }
    let { titolo, descrizione } = S; // con le regole di mostra: dopo «falla in titanio» la scheda diceva ancora «in alluminio»
    if (a.titolo !== undefined || a.descrizione !== undefined) {
      const r = normalizzaTesti({ titolo: a.titolo, descrizione: a.descrizione });
      errori.push(...r.errori); avvisi.push(...r.avvisi);
      if (r.testi?.titolo !== undefined) titolo = r.testi.titolo;
      if (r.testi?.descrizione !== undefined) descrizione = r.testi.descrizione;
    }
    if (errori.length) return no(400, errori);
    for (const id of via) if (S.tolti.includes(id)) avvisi.push(`«${id}» era già tolto`);
    for (const id of su) if (!S.tolti.includes(id)) avvisi.push(`«${id}» non era tolto`);
    const tolti = [...new Set([...S.tolti, ...via])].filter((id) => !su.includes(id));
    if (vista.modo === 'sforzi' && !S.analisi) avvisi.push("modo sforzi senza un'analisi: i colori arrivano dopo analizza");
    const esito = commit({ aperto: true, titolo, descrizione, pezzi, tolti, carichi, vincoli, vista }); // modificare un ologramma chiuso lo riapre
    const fatti = [];
    if (cambiati.length) fatti.push(`cambiati ${elenco(cambiati)}`);
    if (aggiunti.length) fatti.push(`aggiunti ${elenco(aggiunti)}`);
    if (via.length) fatti.push(`tolti ${elenco(via)}`);
    if (su.length) fatti.push(`rimessi ${elenco(su)}`);
    if (a.carichi !== undefined) fatti.push(`carichi (${carichi.length})`);
    if (a.vincoli !== undefined) fatti.push(`vincoli (${vincoli.length})`);
    if (a.vista !== undefined) fatti.push('vista');
    if (a.titolo !== undefined) fatti.push('titolo');
    if (a.descrizione !== undefined) fatti.push('descrizione');
    return fatto(esito, intestazione(esito, `Fatto: ${fatti.join(', ') || 'ologramma riaperto'}.`), avvisi);
  }

  function analizza(a) {
    if (!S.modello) return no(400, ["non c'è nessun ologramma da analizzare: usa prima mostra"]);
    a = senzaNull(a);
    const errori = [], avvisi = estranei(a, ['carichi', 'vincoli']);
    let { carichi, vincoli } = S;
    if (a.carichi !== undefined) { const r = normalizzaCarichi(a.carichi, S.pezzi); errori.push(...r.errori); avvisi.push(...r.avvisi); carichi = r.carichi; }
    if (a.vincoli !== undefined) { const r = normalizzaVincoli(a.vincoli, S.pezzi); errori.push(...r.errori); avvisi.push(...r.avvisi); vincoli = r.vincoli; }
    if (errori.length) return no(400, errori);
    const L = preparaLavoro({ ...S, carichi, vincoli });
    if (L.errori.length) return no(400, L.errori); // materiale, vincolo e carico: si dice tutto quello che manca, insieme
    const esito = commit({ aperto: true, carichi, vincoli }, { analizza: true });
    // Scelta quando si scrive: la risposta che aspetta la fine del calcolo non dice più «avviata»
    const t = () => {
      const st = S.analisi?.stato;
      if (st === 'in-corso') return esito.calc === 'corsa' ? 'Analisi degli sforzi avviata.' : "L'analisi di questa versione è già in corso.";
      if (!esito.aspetta) return "L'analisi di questa versione c'è già.";
      return st === 'fatta' ? 'Analisi degli sforzi finita.' : st === 'errore' ? 'Analisi degli sforzi non riuscita: il perché è sotto.' : '';
    };
    return fatto(esito, t, avvisi);
  }

  function chiudi(chi) {
    if (!S.aperto) return fatto({}, "L'ologramma era già chiuso.");
    chiusoDa = chi;
    commit({ aperto: false });
    return fatto({}, chi === 'tony' ? "Tony ha chiuso l'ologramma." : 'Ologramma chiuso.');
  }

  /** Esegue un'azione: { ok, codice, versione, testo, errori?, attesa? }. attesa si risolve a fine analisi. */
  function esegui(a, { daHud = false } = {}) {
    if (!oggetto(a) || typeof a.azione !== 'string') return no(400, [`serve un oggetto { azione, … }, non ${breve(a)}`]);
    if (daHud) {
      // Dall'HUD solo id e numeri: niente testo libero arriva al cervello da qui
      if (!AZIONI_HUD.includes(a.azione)) return no(403, ["dall'HUD arrivano solo togli, rimetti e chiudi"]);
      if (!S.modello || a.modello !== S.modello) return no(409, [`il modello mostrato non è più quello attuale (${S.modello}): rileggi lo stato`]);
      if (a.azione === 'chiudi') return chiudi('tony');
      if (typeof a.id !== 'string' || !S.pezzi.some((p) => p.id === a.id)) return no(400, ['id: non è un pezzo del modello']);
      const togli = a.azione === 'togli';
      const esito = commit({ tolti: togli ? [...new Set([...S.tolti, a.id])] : S.tolti.filter((id) => id !== a.id) });
      return fatto(esito, intestazione(esito, togli ? `Tony ha tolto «${a.id}».` : `Tony ha rimesso «${a.id}».`));
    }
    switch (a.azione) {
      case 'mostra': return mostra(a);
      case 'modifica': return modifica(a);
      case 'analizza': return analizza(a);
      case 'chiudi': return chiudi('stem');
      default: return no(400, [`azione ${breve(a.azione)} sconosciuta: le azioni sono mostra, modifica, analizza e chiudi (togli e rimetti stanno dentro modifica)`]);
    }
  }

  /** Lo stato del contratto, completo: una copia, così chi lo riceve non tocca quello vero. */
  function stato() {
    return structuredClone(S);
  }

  /** { versione, fs } per GET /api/ologramma/campo, o null se non c'è un'analisi fatta. */
  function campo() {
    return sicurezza && S.analisi?.stato === 'fatta' ? { versione: S.analisi.campo.versione, fs: sicurezza } : null;
  }

  function vistaTesto() {
    const v = S.vista, r = [`modo ${v.modo}`];
    if (v.esploso) r.push(`esploso ${num(v.esploso)}`);
    if (v.sezione) r.push(`sezione ${v.sezione.asse} a ${mm(v.sezione.posizione)} mm, verso ${v.sezione.verso > 0 ? '+' : '−'}`);
    if (v.selezionato) r.push(`selezionato «${v.selezionato}»`);
    if (v.isolato) r.push(`isolato «${v.isolato}»`);
    if (v.rotazione_auto) r.push('rotazione automatica');
    return r.join(', ');
  }

  function testoAnalisi() {
    const a = S.analisi;
    if (!a) return [];
    if (a.stato === 'in-corso') return [`Analisi degli sforzi in corso${corsa ? ` da ${Math.round((ora() - corsa.inizio) / 1000)} s` : ''}: i numeri arrivano quando finisce.`];
    if (a.stato === 'errore') return [`Analisi degli sforzi non riuscita: ${a.errore}`];
    const p = a.pezzi[0], r = [];
    if (!p) r.push(`Analisi degli sforzi (versione ${a.versione}): nessun pezzo è stato calcolato.`);
    else {
      r.push(`Analisi degli sforzi (versione ${a.versione}): sforzo massimo ${num(a.sforzo_max_MPa)} MPa; fattore di sicurezza minimo ${fsTesto(a.fs_min)} ` +
        `su «${p.id}» (${nomeMateriale(p.materiale)}), nel punto ${vettore(p.punto_mm, mm)} mm; spostamento massimo ${num(a.spostamento_max_mm)} mm.`);
    }
    const griglia = `Voxel da ${num(a.h_mm)} mm: ${a.voxel} voxel, ${a.iterazioni} iterazioni${a.convergito ? '' : ' senza convergenza'}`;
    if (!finito(a.scorciatoia_s)) r.push(`${griglia}, ${num(a.tempo_s)} s.`);
    else {
      const quanto = a.scorciatoia_s < 1e-3 ? 'in meno di un millesimo di secondo' : `in ${num(a.scorciatoia_s)} s`;
      r.push(`${griglia}: il campo viene dal calcolo di prima (${num(a.tempo_s)} s); per la lega nuova fs e spostamento sono rifatti ${quanto}, senza risolvere.`);
    }
    if (a.avvisi.length) r.push(`Avvisi: ${a.avvisi.join('; ')}.`);
    r.push(`Attenzione: ${ONESTA}.`);
    return r;
  }

  // Cosa manca alla ricerca sui pezzi: è la riga che fa finire il lavoro al cervello, quindi dice cosa manca e non
  // come si trova. Un pezzo «ha il materiale» con materiale_vero o con una chiave vera: una staffa che Tony progetta
  // in PLA non la fa comparire. La fattura si chiede solo ai pezzi con materiale_vero, cioè a quelli di un oggetto cercato.
  // Contano anche i pezzi tolti: sono ancora del modello. Niente da dire, niente riga.
  function testoRicerca() {
    const P = S.pezzi, ids = (f) => P.filter(f).map((p) => p.id);
    const senza = ids((p) => !p.materiale_vero && p.materiale === 'generico');
    const senzaFattura = ids((p) => p.materiale_vero && !p.fattura);
    if (!senza.length && !senzaFattura.length) return [];
    const n = P.length - senza.length, r = [`Materiali: ${n} ${n === 1 ? 'pezzo' : 'pezzi'} su ${P.length} ${n === 1 ? 'ha' : 'hanno'} il materiale.`];
    if (senza.length) r.push(`Senza materiale: ${elenco(senza)}.`);
    if (senzaFattura.length) r.push(`Senza fattura: ${elenco(senzaFattura)}.`);
    return [r.join(' ')];
  }

  /** Il riassunto per il cervello: titolo, pezzi, ingombro, massa, materiali che mancano, vista, carichi, vincoli e analisi. */
  function testo() {
    if (!S.modello) return 'Nessun ologramma: non ne è ancora stato mostrato uno.';
    const P = S.pezzi, tolti = new Set(S.tolti), r = [];
    const come = S.aperto ? 'aperto' : chiusoDa === 'tony' ? 'chiuso da Tony con Esc' : 'chiuso';
    r.push(`Ologramma «${S.titolo}», ${come}: modello ${S.modello}, versione ${S.versione}.`);
    r.push(`${P.length} ${P.length === 1 ? 'pezzo' : 'pezzi'}${S.tolti.length ? `, di cui ${S.tolti.length} ${S.tolti.length === 1 ? 'tolto' : 'tolti'}: ${elenco(S.tolti)}` : ''}.`);
    const presenti = P.filter((p) => !tolti.has(p.id)), daFile = presenti.filter((p) => p.forma === 'file').length;
    const senzaMassa = presenti.filter((p) => volume(p) === null || !(materiale(p.materiale)?.densita > 0)).length;
    if (S.ingombro_mm) {
      const { min: a, max: b } = S.ingombro_mm;
      r.push(`Ingombro ${mm(b[0] - a[0])} × ${mm(b[1] - a[1])} × ${mm(b[2] - a[2])} mm (x da ${mm(a[0])} a ${mm(b[0])}, y da ${mm(a[1])} a ${mm(b[1])}, z da ${mm(a[2])} a ${mm(b[2])})` +
        `${daFile ? `, senza ${daFile} ${daFile === 1 ? 'pezzo' : 'pezzi'} da file` : ''}.`);
    }
    r.push(S.massa_kg === null ? 'Massa: nessun pezzo ha un materiale con densità.'
      : `Massa ${massaTesto(S.massa_kg)}${senzaMassa ? ` (senza ${senzaMassa} ${senzaMassa === 1 ? 'pezzo generico o da file' : 'pezzi generici o da file'})` : ''}.`);
    r.push(...testoRicerca());
    r.push(`Vista: ${vistaTesto()}.`);
    if (S.carichi.length) r.push(`Carichi: ${S.carichi.map((c) => `${num(c.forza_N)} N su «${c.pezzo}», faccia ${c.faccia}, direzione ${vettore(c.direzione)}`).join('; ')}.`);
    if (S.vincoli.length) r.push(`Incastri: ${S.vincoli.map((v) => `«${v.pezzo}» faccia ${v.faccia}`).join(', ')}.`);
    r.push(...testoAnalisi());
    return r.join('\n');
  }

  // Dopo un riavvio: base dal JSON e dal .bin, controllata come un risultato nuovo, e analisi rifatta da lì.
  function riprendi(b, a) {
    try {
      if (!oggetto(b) || !Array.isArray(b.mats) || !oggetto(b.r) || !oggetto(a.campo)) return false;
      const mats = b.mats.map((m) => ({ id: m.id, chiave: m.chiave, E: m.E, nu: m.nu, snervamento: m.snervamento }));
      if (!mats.every((m) => typeof m.id === 'string' && finito(m.E) && m.E > 0 && finito(m.nu) && finito(m.snervamento) && m.snervamento > 0)) return false;
      const buf = fs.readFileSync(BIN), testa = new Float64Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + 16)), n = testa[1];
      if (testa[0] !== b.versione || !Number.isSafeInteger(n) || buf.length !== 16 + 6 * n) return false;
      const vm = new Float32Array(buf.buffer.slice(buf.byteOffset + 16, buf.byteOffset + 16 + 4 * n));
      const vp = new Uint16Array(buf.buffer.slice(buf.byteOffset + 16 + 4 * n, buf.byteOffset + 16 + 6 * n));
      controllaRisultato({ ...b.r, vm, voxel_pezzo: vp }, mats);
      const L = preparaLavoro(S), f = firme(L.lavoro);
      if (f.geo !== b.geo || scala(mats, L.lavoro.pezzi) === null) return false;
      base = { versione: b.versione, geo: b.geo, tutto: f.tutto, mats, r: numeri(b.r), vm, vp };
      rifaiAnalisi(intero(a.versione), intero(a.campo.versione));
      return true;
    } catch {
      base = sicurezza = null;
      return false;
    }
  }

  /** Rilegge lo stato salvato, all'avvio del server. false se non c'era o non si leggeva. */
  function carica() {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[ologramma] stato salvato illeggibile, riparto vuoto: ${e.message}`);
      return false;
    }
    const s = oggetto(d) && oggetto(d.stato) ? d.stato : {};
    S = statoVuoto(intero(s.modello), intero(s.versione)); // i contatori prima di tutto: un modello non si riusa mai
    corsa = base = sicurezza = null;
    chiusoDa = d.chiusoDa === 'tony' || d.chiusoDa === 'stem' ? d.chiusoDa : null;
    if (Array.isArray(s.pezzi) && s.pezzi.length) {
      // Il file è nostro, ma passa dalla stessa validazione del cervello: un file rovinato non entra nello stato
      const r = normalizzaModello({ titolo: s.titolo, descrizione: s.descrizione, pezzi: s.pezzi, carichi: s.carichi, vincoli: s.vincoli, vista: s.vista });
      if (!r.modello) { console.error(`[ologramma] modello salvato non valido, riparto vuoto: ${r.errori[0]}`); return false; }
      const m = r.modello, ids = new Set(m.pezzi.map((p) => p.id));
      const tolti = Array.isArray(s.tolti) ? [...new Set(s.tolti.filter((id) => ids.has(id)))] : [];
      Object.assign(S, { aperto: s.aperto === true, titolo: m.titolo, descrizione: m.descrizione, pezzi: m.pezzi, tolti, carichi: m.carichi, vincoli: m.vincoli, vista: m.vista });
    }
    derivati();
    const a = s.analisi;
    if (S.pezzi.length && oggetto(a) && !(a.stato === 'fatta' && riprendi(d.base, a))) {
      if (a.stato === 'errore' && typeof a.errore === 'string') S.analisi = analisiVuota('errore', intero(a.versione), { errore: a.errore.slice(0, 500) });
      else {
        S.versione++;
        const perche = a.stato === 'in-corso' ? 'interrotta da un riavvio di STEM' : 'i dati del calcolo salvato non si leggono più';
        S.analisi = analisiVuota('errore', S.versione, { errore: `${perche}: chiedi di nuovo l'analisi` });
        salva(true);
      }
    }
    return true;
  }

  return { stato, esegui, campo, testo, carica };
}
