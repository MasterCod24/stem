// O.S.C.A.R. — l'HUD: ascolto sempre acceso, voce, pannello del browser, GIF, suoni, ologramma, la scheda dell'ascolto,
// i dati a raggiera e i micro-dati ai bordi. La grafica (sfera e anelli) sta in nucleo.js.
import { NOME, norm, isName, unisciSigla } from './nome.js';
import { mostraPromemoria } from './promemoria.js';
import { showReport, hideReport, reportDock } from './report.js';
import { avvia as avviaMoto, molla } from './fisica.js';
import { createSchede } from './schede.js';
avviaMoto(); // --molla, --t-molla, --lieve, --t-lieve: le transizioni CSS con la stessa fisica
// allarme: 0 normale, 1 attenzione (arancione), 2 critico (rosso). Lo calcola aggiornaAllarme() dalle cause attive.
const S = { mode: 'idle', audio: 0, mic: 0, split: 0, splitTarget: 0, dock: 0, dockTarget: 0, hearing: false, allarme: 0 };
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const dbg = (...a) => { if (DEBUG) (window.__earLog ||= []).push(`${(performance.now() / 1000).toFixed(1)}s ${a.join(' ')}`); };

// ---------- Stato: la scritta "STATUS" sugli anelli ----------
const LABELS = { idle: 'STATUS: LISTENING', listening: 'STATUS: LISTENING', thinking: 'STATUS: PROCESSING', speaking: 'STATUS: SPEAKING' };
let booting = true;
function setMode(m) {
  if (S.mode !== m && sfx) { if (m === 'thinking') sfx.think?.(true); else if (S.mode === 'thinking') sfx.think?.(false); }
  if (S.mode === 'speaking' && m !== 'speaking') spokeUntil = performance.now();
  S.mode = m; document.body.dataset.mode = m;
  if (m === 'idle') corsia.scadi(12000); // finita la risposta, le schede restano 12 s
  if (m === 'idle') { if (document.body.classList.contains('browsing')) showScreen(false); }
  else clearTimeout(screenTimer);
}
const scrivi = (el, testo) => { if (el.textContent !== testo) el.textContent = testo; }; // riscrivere lo stesso testo rifà il layout

// ---------- Attorno al nucleo: scritta di stato e dati a raggiera, con i fili che partono dall'anello più esterno ----------
// anchor() di nucleo.js: centro (x, y), raggio della goccia r e dell'anello più esterno R, in pixel CSS.
// I dati stanno su raggi fissi: angolo in gradi (0 a destra, in senso antiorario); lato 1 scritta a destra, -1 a sinistra.
// Ogni scritta è una massa su una molla (fisica.js) agganciata al suo punto: quando il nucleo si sposta lo segue con un filo
// di ritardo e il filo si tende; quando è ferma non costa niente.
const RAGGI = [
  { el: $('status'), ang: 38, lato: 1, stato: true },
  { el: $('d-voce'), ang: 6, lato: 1 },
  { el: $('d-latenza'), ang: -30, lato: 1 },
  { el: $('d-ascolto'), ang: 150, lato: -1 },
  { el: $('d-sistemi'), ang: 186, lato: -1 },
  { el: $('d-grafica'), ang: 220, lato: -1 },
];
const SVG = 'http://www.w3.org/2000/svg';
for (const r of RAGGI) { // un filo e un punto per dato, e la molla della scritta
  r.filo = document.createElementNS(SVG, 'polyline'); r.punto = document.createElementNS(SVG, 'circle');
  r.punto.setAttribute('r', '2'); $('fili').append(r.filo, r.punto);
  r.mx = molla(0); r.my = molla(0); r.via = ''; r.ancora = null;
}
const corsia = createSchede(); // le schede di quello che O.S.C.A.R. nomina mentre parla (schede.js)
const corsiaX = molla(0), corsiaY = molla(0), ascoltoX = molla(0);
let corsiaVia = '';
let chiaveAttorno = '', largAscolto = 0, ultimaLarg = '', primaVolta = true, colonneDaRifare = false;
function disegnaAttorno(t, at, dt) {
  const docked = S.dock > 0.5, split = S.split > 0.5, R = at.R ?? at.r * 1.5, st = $('status');
  if (booting) scrivi(st, `ASSEMBLING... ${Math.min(99, Math.round(scene.assembling(t) * 100))}%`);
  else scrivi(st, ear !== 'on' && S.mode === 'idle' ? (docked ? 'STATUS: MIC OFF' : `STATUS: MIC OFF  (${EAR_TEXT[ear]})`.toUpperCase()) // nell'angolo il perché uscirebbe dallo schermo
    : S.mode === 'speaking' && S.audio > 0.35 && !docked ? 'STATUS: SPEAKING  INTENSITY: HIGH' : LABELS[S.mode]);
  const media = corsia.attiva, sm = $('small'), an = $('anomalia'); // la corsia delle schede prende il posto dei dati di destra
  // anche la lunghezza dei testi: una scritta che si allunga può arrivare sopra la colonna degli eventi
  const lunghi = `${RAGGI.map((r) => r.el.textContent.length)} ${sm.classList.contains('on') && sm.textContent.length} ${an.classList.contains('on') && an.textContent.length}`;
  const chiave = `${at.x.toFixed(1)} ${at.y.toFixed(1)} ${R.toFixed(1)} ${docked} ${split} ${media} ${innerWidth} ${innerHeight} ${lunghi}`;
  if (chiave !== chiaveAttorno) { chiaveAttorno = chiave; mete(at, R, docked, split, media); }
  muovi(dt);
}
// Dove devono andare scritte, GIF e scheda dell'ascolto: gira solo quando cambia qualcosa
function mete(at, R, docked, split, media) {
  document.body.classList.toggle('media', media);
  for (const r of RAGGI) {
    if (docked) { // nell'angolo del report e della meteo: la scritta sopra gli anelli, centrata e corta, per non finire sulle schede
      r.ancora = null;
      if (r.stato) { r.mx.verso(at.x); r.my.verso(at.y - R - 24); r.via = ' translateX(-50%)'; }
      continue;
    }
    // col browser il nucleo sta a sinistra: i dati uscirebbero dallo schermo o finirebbero sulla pagina, resta solo lo stato, in alto
    const lato = r.lato, ang = (r.stato && split ? 72 : r.ang) * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang);
    const x0 = at.x + R * c, y0 = at.y - R * s, x1 = at.x + (R + 22) * c, y1 = at.y - (R + 22) * s;
    r.ancora = { x0, y0, x1, y1, lato, nascosto: !r.stato && (split || (lato === 1 && media)) }; // a destra le schede
    r.mx.verso(x1 + lato * 52); r.my.verso(y1 - 7); r.via = lato === -1 ? ' translateX(-100%)' : '';
  }
  // La corsia delle schede: a destra degli anelli (i dati di destra si spengono); col browser sotto il nucleo, compatta; col
  // report o la meteo sopra il nucleo nell'angolo, compatta e appoggiata dal basso. Non chiude niente.
  corsia.modo(docked || split ? 'compatto' : 'pieno');
  if (docked) { corsiaX.verso(Math.max(16, Math.min(innerWidth - 316, at.x - 150))); corsiaY.verso(at.y - R - 66); corsiaVia = ' translateY(-100%)'; }
  else if (split) { corsiaX.verso(Math.max(16, at.x - 150)); corsiaY.verso(at.y + R + 14); corsiaVia = ''; }
  else { corsiaX.verso(Math.max(16, Math.min(innerWidth - 316, at.x + R + 28))); corsiaY.verso(at.y - 150); corsiaVia = ''; }
  corsiaX.scritta = null;
  // La scheda dell'ascolto sotto il nucleo, centrata su di lui (col report e la meteo è una riga in basso, centrata sullo schermo)
  // la larghezza della scheda cambia solo con le classi del corpo e con la finestra: rileggerla a ogni passo del nucleo
  // forzava un layout per fotogramma
  const chiaveLarg = `${document.body.className} ${innerWidth}`;
  if (chiaveLarg !== ultimaLarg) { ultimaLarg = chiaveLarg; largAscolto = $('ascolto').offsetWidth; }
  ascoltoX.verso(Math.max(12, (docked ? innerWidth * 0.44 : at.x) - largAscolto / 2));
  if (primaVolta) { primaVolta = false; for (const m of [...RAGGI.flatMap((r) => [r.mx, r.my]), corsiaX, corsiaY, ascoltoX]) m.salta(m.meta); }
  colonneDaRifare = true;
}
// Un passo delle molle; il DOM si tocca solo per quello che si muove
function muovi(dt) {
  let fermi = true;
  for (const r of RAGGI) {
    const fermo = r.mx.ferma() && r.my.ferma() && r.disegnata === chiaveAttorno;
    if (fermo) continue;
    fermi = false;
    const x = r.mx.passo(dt), y = r.my.passo(dt);
    r.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${r.via}`;
    if (r.stato) {
      $('small').style.transform = `translate(${x.toFixed(1)}px, ${(y - (r.ancora ? -20 : 18)).toFixed(1)}px)${r.via}`;
      $('anomalia').style.transform = `translate(${x.toFixed(1)}px, ${(y - (r.ancora ? -38 : 36)).toFixed(1)}px)${r.via}`;
    }
    const a = r.ancora;
    r.filo.classList.toggle('spento', !a || a.nascosto); r.punto.classList.toggle('spento', !a || a.nascosto);
    r.el.classList.toggle('spento', !r.stato && (!a || a.nascosto));
    if (a) { // il filo: dal punto sull'anello, in fuori lungo il raggio, poi fino alla scritta dove sta adesso
      r.filo.setAttribute('points', `${a.x0.toFixed(1)},${a.y0.toFixed(1)} ${a.x1.toFixed(1)},${a.y1.toFixed(1)} ${(x - a.lato * 8).toFixed(1)},${(y + 7).toFixed(1)}`);
      r.punto.setAttribute('cx', a.x0.toFixed(1)); r.punto.setAttribute('cy', a.y0.toFixed(1));
    }
    if (r.mx.ferma() && r.my.ferma()) r.disegnata = chiaveAttorno;
  }
  if (!corsiaX.ferma() || !corsiaY.ferma() || corsiaX.scritta === null) { fermi = false; corsiaX.scritta = 1; corsia.el.style.transform = `translate(${corsiaX.passo(dt).toFixed(1)}px, ${corsiaY.passo(dt).toFixed(1)}px)${corsiaVia}`; }
  if (!ascoltoX.ferma() || ascoltoX.scritta !== ascoltoX.meta) { fermi = false; ascoltoX.scritta = ascoltoX.ferma() ? ascoltoX.meta : null; $('ascolto').style.transform = `translateX(${ascoltoX.passo(dt).toFixed(1)}px)`; }
  if (fermi && colonneDaRifare) { colonneDaRifare = false; liberaColonna(); }
}
// La colonna degli eventi non passa sotto le scritte: comincia sotto stato, dati, anomalia e GIF che le stanno sopra
// (riempita di eventi arrivava fino a «MAC · SIRI PAOLO»), e con finestre strette si stringe invece di finire sulla scheda
// dell'ascolto. Gira quando le molle si sono fermate, non a ogni fotogramma.
function liberaColonna() {
  const dx = $('colonna-dx');
  dx.style.top = ''; dx.style.width = '';
  if (S.dock > 0.5 || S.split > 0.5) return; // col browser, il report o la meteo la colonna è spenta
  const scritte = [...RAGGI.map((r) => r.el), ...[$('small'), $('anomalia')].filter((e) => e.classList.contains('on')), ...(corsia.attiva ? [corsia.el] : [])];
  const cd = dx.getBoundingClientRect(), asc = $('ascolto').getBoundingClientRect();
  let sotto = cd.top;
  for (const e of scritte) {
    if (e.classList.contains('spento')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || r.bottom < cd.top || r.top > cd.bottom) continue;
    if (r.right > cd.left - 12) sotto = Math.max(sotto, r.bottom + 12);
  }
  if (sotto > cd.top) dx.style.top = `${Math.ceil(sotto)}px`;
  if (asc.right > cd.left - 12) dx.style.width = `${Math.max(0, Math.floor(cd.right - asc.right - 12))}px`;
}

// ---------- Stato dei sistemi (al server, per il registro: solo stati, niente audio né testo) ----------
// La risposta dice anche quanti compiti dell'agenda sono arrivati all'ora: se O.S.C.A.R. è fermo e nessuno sta parlando, parla per primo
let micPeak = 0, ultimoStato = null, statoFalliti = 0;
async function pollStatus() {
  try {
    const q = new URLSearchParams({ hud: 1, ricevute: 1, ear: ear, lock: earLock ? 1 : 0, mic: micPeak.toFixed(3), mode: S.mode,
      schermo: `${screenX},${screenY}` }); // il server ci apre la finestra di Google, dietro l'HUD
    micPeak = 0;
    const st = await (await fetch('/api/status?' + q)).json();
    ultimoStato = st; statoFalliti = 0; allarme('server', 0);
    allarme('agenda', st.erroreAgenda ? 2 : 0, 'AGENDA NON DISPONIBILE');
    if (st.ricevuteAgenda === true && st.agenda > 0 && S.mode === 'idle' && !S.hearing && !pending) { report('agenda: O.S.C.A.R. parla per primo'); evento('AGENDA · PARLO PER PRIMO'); ask('', { agenda: true }); }
    rileggiOlogramma(Number(st.ologramma)); // senza un turno del cervello l'evento 'holo' non arriva: lo dice questo giro
  } catch { // due giri persi di fila (10 s): il server non c'è più
    if (++statoFalliti === 2) { allarme('server', 2, 'SERVER NON RAGGIUNGIBILE'); evento('NET · SERVER PERSO'); }
  }
}
setTimeout(pollStatus, 0); setInterval(pollStatus, 5000);

// ---------- Anomalie: arancione (1) e rosso (2) solo qui. Ogni causa ha il suo livello; vince la più grave ----------
const ALLARMI = new Map(); // causa → { livello, testo, fino }
function allarme(causa, livello, testo = '', ms = 0) {
  if (livello > 0) ALLARMI.set(causa, { livello, testo, fino: ms ? performance.now() + ms : Infinity });
  else ALLARMI.delete(causa);
  aggiornaAllarme();
}
function aggiornaAllarme() {
  const ora = performance.now();
  let peggiore = null;
  for (const [causa, a] of ALLARMI) { if (a.fino < ora) { ALLARMI.delete(causa); continue; } if (!peggiore || a.livello > peggiore.livello) peggiore = a; }
  S.allarme = peggiore?.livello || 0;
  const el = $('anomalia');
  scrivi(el, peggiore?.testo || '');
  el.classList.toggle('on', !!peggiore); el.classList.toggle('critico', S.allarme === 2);
}
// L'ologramma: un calcolo fallito è attenzione, un pezzo che cede (fs sotto 1) è critico
function allarmeOlogramma(st) {
  const a = st?.aperto ? st.analisi : null, fs = Number(a?.fs_min);
  if (a?.stato === 'errore') allarme('calcolo', 1, 'CALCOLO DEGLI SFORZI FALLITO');
  else if (a?.stato === 'fatta' && Number.isFinite(fs) && fs < 1) allarme('calcolo', 2, `IL PEZZO CEDE · FS ${fs.toFixed(2).replace('.', ',')}`);
  else allarme('calcolo', 0);
}

// ---------- Pannello del browser: solo per i compiti complessi (O.S.C.A.R. lo chiede con [[mostra]]) ----------
let screenTimer = 0;
function showScreen(on) { // si chiude 15 s dopo che O.S.C.A.R. ha finito
  clearTimeout(screenTimer);
  if (on) { document.body.classList.add('browsing'); S.splitTarget = 1; }
  else screenTimer = setTimeout(() => { document.body.classList.remove('browsing'); S.splitTarget = 0; }, 15000);
}
const VERBS = {
  navigate: 'Apro', navigate_back: 'Torno indietro', click: 'Clicco', type: 'Scrivo', fill_form: 'Compilo',
  snapshot: 'Leggo la pagina', take_screenshot: 'Guardo', press_key: 'Premo un tasto', hover: 'Indico',
  select_option: 'Scelgo', wait_for: 'Attendo', evaluate: 'Analizzo', drag: 'Trascino', find: 'Cerco nella pagina',
};
function showAction(name, detail) {
  $('p-what').textContent = (VERBS[name] || name.replace(/_/g, ' ')).toUpperCase();
  if (detail) $('p-host').textContent = '· ' + detail;
}

// File e Mac: un'etichetta discreta sotto la scritta di stato, niente pannello
const SMALL_VERBS = { Read: 'Leggo', Write: 'Creo', Edit: 'Modifico', Glob: 'Cerco file', Grep: 'Cerco nei file',
  schermo: 'Guardo lo schermo', clic: 'Clicco', scrivi: 'Scrivo', tasti: 'Tasti', apri_app: 'Apro', chiudi_app: 'Chiudo', scorri: 'Scorro', trascina: 'Trascino',
  ricorda: 'Segno in agenda', agenda: 'Guardo l\'agenda',
  mostra_ologramma: 'Costruisco l\'ologramma', modifica_ologramma: 'Modifico l\'ologramma', analizza_struttura: 'Calcolo gli sforzi',
  mostra_meteo: 'Guardo il cielo' };
let smallTimer = 0;
function showSmall(name, detail) {
  $('small').textContent = `${SMALL_VERBS[name] || name.replace(/_/g, ' ')}${detail ? ' · ' + detail : ''}`.toUpperCase();
  $('small').classList.add('on');
  clearTimeout(smallTimer);
  smallTimer = setTimeout(() => $('small').classList.remove('on'), 6000);
}

// ---------- Report a schermo intero (O.S.C.A.R. lo manda con lo strumento mostra_report) ----------
function openReport(r) {
  const plan = showReport(r);
  if (!plan) return closeReport(); // zero blocchi: O.S.C.A.R. lo sta chiudendo
  chiudiOlo(); // anche l'ologramma: un report del cervello lo chiude anche nel server (server.mjs), così il cervello lo sa
  chiudiMeteo();
  sfx?.report(plan);
  clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0; // il report prende il posto del browser
  document.body.classList.add('report'); // micro-dati e raggiera si spengono, l'ascolto diventa una riga in basso
  evento(`REPORT · ${Array.isArray(r?.blocchi) ? r.blocchi.length : 0} BLOCCHI`);
  Object.assign(S, reportDock()); S.dockTarget = 1;
}
function closeReport() { hideReport(); document.body.classList.remove('report'); if (!meteo?.aperto) S.dockTarget = 0; } // con la meteo il nucleo resta nell'angolo
addEventListener('resize', () => { if (S.dockTarget) Object.assign(S, meteo?.aperto ? meteo.dock() : reportDock()); });

// ---------- Meteo a schermo intero (meteo/vista.js): i dati dal server con l'evento 'meteo', il radar da RainViewer ----------
// Come il report e l'ologramma: una vista grande alla volta, il nucleo nell'angolo, e le mani accese come con l'ologramma.
// Il globo disegna nel renderer del nucleo (strato, come l'ologramma): la vista aspetta che la scena esista.
let meteo = null, meteoPronto = null, scenaPronta = null;
const scenaAttesa = new Promise((ok) => { scenaPronta = ok; });
function creaMeteo() { // il modulo si carica alla prima apertura: l'avvio dell'HUD non lo paga
  meteoPronto ||= Promise.all([import('./meteo/vista.js'), scenaAttesa])
    .then(([{ createVistaMeteo }, sc]) => (meteo = createVistaMeteo({ contenitore: $('holo'), prima: $('dita'), renderer: sc.renderer, strato: sc.strato,
      sfx: sfxOlo, onChiudi: () => chiudiMeteo() })))
    .catch((e) => { meteoPronto = null; throw e; });
  return meteoPronto;
}
async function apriMeteo(dati) {
  let m;
  try { m = await creaMeteo(); } catch (e) { warn('Meteo non disponibile', 'attenzione'); console.warn(e); return; }
  chiudiOlo(); hideReport(); document.body.classList.remove('report'); clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0;
  const plan = m.apri(dati);
  if (!m.aperto) return;
  if (!document.body.classList.contains('meteo')) { maniDa = Math.floor(performance.now() / 1000); mani?.azzeraMisure(); }
  document.body.classList.add('meteo'); // micro-dati e raggiera si spengono, l'ascolto diventa una riga in basso
  Object.assign(S, m.dock()); S.dockTarget = 1;
  if (plan) sfx?.report(plan);
  evento(`METEO · ${String(dati?.luogo?.nome || '').toUpperCase().slice(0, 24)}`);
  avviaMani();
}
function chiudiMeteo() {
  if (!meteo?.aperto) return;
  misuraMani('meteo'); meteo.chiudi(); document.body.classList.remove('meteo');
  if (!document.body.classList.contains('report')) S.dockTarget = 0;
  if (!holoAperto) fermaMani();
}

// ---------- Ologramma: dal 22/11 lo disegna Blender (blender.mjs e mac/blender/vivo.py), non l'HUD: richiesta di Tony ----------
// Qui restano le mani. Con un ologramma aperto si accendono e i loro gesti vanno al server, che li passa a Blender; l'HUD,
// coperto da Blender, smette di disegnare il nucleo, perché due programmi che disegnano insieme si dividono la grafica.
let holoAperto = false, holoStato = null;
let holoV = 0, holoAncora = 0, holoLeggo = false;  // l'ultima versione del server letta, e una da leggere appena si può
const post = (url, dati) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) });
const sfxOlo = new Proxy({}, { get: (_, k) => (...a) => sfx?.[k]?.(...a) }); // sfx nasce più tardi, con l'audio

// Una versione più alta arriva dall'evento 'holo' del cervello o da /api/status: si rilegge lo stato, una lettura alla volta.
async function rileggiOlogramma(v) {
  if (!(v > holoV)) return;
  if (holoLeggo) { holoAncora = Math.max(holoAncora, v); return; }
  holoLeggo = true;
  try {
    const st = await (await fetch('/api/ologramma', { cache: 'no-store' })).json();
    if (Number.isFinite(st?.versione) && st.versione > holoV) { holoV = st.versione; applicaOlogramma(st); }
  } catch {}
  holoLeggo = false;
  const dopo = holoAncora; holoAncora = 0;
  rileggiOlogramma(dopo);
}
function applicaOlogramma(st) {
  const prima = holoAperto;
  holoAperto = st?.aperto === true;
  holoStato = holoAperto ? st : null;
  if (holoAperto && !prima) apriOlo(); else if (!holoAperto && prima) chiusoOlo();
  allarmeOlogramma(holoStato);
}
// Aperto: report, browser e meteo lasciano il posto, le mani si accendono
let maniDa = 0; // il secondo in cui si è aperto l'ologramma o la meteo: la misura delle mani conta da lì
function apriOlo() {
  chiudiMeteo();
  hideReport(); document.body.classList.remove('report'); clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0;
  document.body.classList.add('olo');
  evento('HOLO · BLENDER');
  maniDa = Math.floor(performance.now() / 1000); mani?.azzeraMisure();
  avviaMani();
}
function chiusoOlo() { misuraMani('ologramma'); holoStato = null; document.body.classList.remove('olo'); fermaMani(); allarme('calcolo', 0); }
// La regola di Tony: mani solo sopra 45 fps sul suo M2. Alla chiusura, se le mani sono state accese almeno 10 secondi interi,
// i fotogrammi di quei secondi e il tempo di MediaPipe vanno al registro del server: solo numeri, la riga la scrive lui.
// Con loro vanno le misure d'uso vero dei gesti (gesti.js, misure()): solo i numeri finiti, quelli senza campioni restano fuori.
function misuraMani(vista) {
  const s = SECONDI.filter((x) => x.s >= maniDa && x.mani);
  if (s.length < 10 || !mani) return;
  const m = mani.misure, f = statFps(s), d = m.detect_ms.mediana;
  const gesti = Object.fromEntries(Object.entries(m.gesti || {}).filter(([k, v]) => k !== 'tremolio' && Number.isFinite(v)));
  post('/api/ologramma', { azione: 'misura', secondi: s.length, fps: { mediana: f.mediana, p10: f.p10, minimo: f.minimo }, detect_ms: d, prova: maniProva, gesti, ...(vista === 'meteo' && { vista }) }).catch(() => {});
}
// Chiuso dall'HUD. Solo Esc lo dice al server, che al cervello scrive «Tony ha chiuso l'ologramma» e chiude Blender: report e
// browser lo chiudono già nel server. Un 409 (il cervello ha già fatto un modello nuovo) porta lo stato: si rilegge quello.
const versioneDi = (d) => Number(d?.versione ?? d?.stato?.versione);
function chiudiOlo(esc = false) {
  if (!holoAperto) return;
  const corpo = { azione: 'chiudi', modello: holoStato?.modello };
  holoAperto = false; chiusoOlo();
  if (esc) post('/api/ologramma', corpo).then((r) => r.json()).then((d) => rileggiOlogramma(versioneDi(d))).catch(() => {});
}
// I gesti verso Blender: una richiesta alla volta. Quelli arrivati nel frattempo partono insieme, riassunti: il cursore conta
// solo l'ultimo, giri, spostamenti ed esploso si sommano, lo zoom si moltiplica.
let gestiCoda = [], gestiInVolo = false;
function gestoOlo(g) {
  const u = gestiCoda[gestiCoda.length - 1];
  if (u && u.tipo === g.tipo && g.tipo === 'cursore') gestiCoda[gestiCoda.length - 1] = g;
  else if (u && u.tipo === g.tipo && (g.tipo === 'ruota' || g.tipo === 'sposta')) { u.dx += g.dx; u.dy += g.dy; }
  else if (u && u.tipo === g.tipo && g.tipo === 'zoom') u.fattore *= g.fattore;
  else if (u && u.tipo === g.tipo && g.tipo === 'esplodi') u.delta += g.delta;
  else gestiCoda.push({ ...g });
  if (!gestiInVolo) queueMicrotask(inviaGesti);
}
async function inviaGesti() {
  if (gestiInVolo || !gestiCoda.length) return;
  const gesti = gestiCoda.slice(0, 60); gestiCoda = gestiCoda.slice(60);
  gestiInVolo = true;
  try { await post('/api/blender/gesti', { gesti }); } catch {}
  gestiInVolo = false;
  if (gestiCoda.length) inviaGesti();
}
function cambiaMani() { const on = !maniVolute(); vogliMani(on); warn(on ? 'Mani accese' : 'Mani spente'); evento(on ? 'HANDS · ON' : 'HANDS · OFF'); if (on) avviaMani(); else fermaMani(); }
// Con la meteo aperta: M per le mani, il resto lo decide la vista (frecce, + e −, R, 0)
function tastoMeteo(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key.toLowerCase() === 'm') { if (!e.repeat) cambiaMani(); return true; }
  return meteo.tasto(e);
}

// ---------- Mani: MediaPipe in locale, accese solo con l'ologramma o la meteo aperti. La scelta del tasto M resta fra un avvio e l'altro ----------
const vistaMani = () => Boolean(holoAperto || meteo?.aperto);
let mani = null, maniPronte = null, mappaMani = null; // mappaMani: la mappa a S di gesti.js, la stessa del cursore
const maniProva = DEBUG && params.get('mani') === 'immagine'; // la foto di prova al posto della fotocamera
const maniVolute = () => { try { return (localStorage.getItem('oscar-mani') ?? localStorage.getItem('nexus-mani')) !== '0'; } catch { return true; } };
const vogliMani = (on) => { try { localStorage.setItem('oscar-mani', on ? '1' : '0'); } catch {} };
function creaMani() { // una volta sola, anche con due aperture di fila
  maniPronte ||= (async () => {
    const [{ createMani, inviaSalto }, { mappa }] = await Promise.all([import('./ologramma/mani.js'), import('./ologramma/gesti.js')]);
    mappaMani = mappa;
    // ?debug&mani=immagine: la foto di prova al posto della fotocamera, a 30 Hz come lei, per misurare
    const prova = maniProva ? { sorgente: 'immagine', immagine: await telaProva(), hz: 30 } : {};
    // ?debug&delegato=CPU: MediaPipe sulla CPU invece che sulla GPU, per confrontarli (prove/mani-delegato.mjs)
    const delegato = DEBUG && params.get('delegato') === 'CPU' ? 'CPU' : 'GPU';
    // onSalto: il fotogramma di ogni salto delle mani va al server, che lo tiene sul Mac per 7 giorni (richiesta di Tony del 23/11)
    const onSalto = (b) => inviaSalto(b, meteo?.aperto ? 'meteo' : 'ologramma').catch(() => {});
    return (mani = createMani({ ...prova, delegato, onSalto, onGesto: gestoMani, onMani: disegnaDita, onErrore: (e) => { warn(e.message, 'attenzione'); disegnaDita([]); faseMani('spente'); } }));
  })().catch((e) => { maniPronte = null; throw e; });
  return maniPronte;
}
async function avviaMani() {
  if (!maniVolute() || !vistaMani()) return;
  try {
    const m = await creaMani();
    if (!vistaMani() || !maniVolute()) return;
    await m.avvia(); // se MediaPipe o la fotocamera non partono: un avviso, e Blender e la meteo restano col mouse
    if (!vistaMani() || !maniVolute()) fermaMani(); // chiusi, o spente col tasto M, mentre partivano
  } catch (e) { warn(String(e?.message || e), 'attenzione'); console.warn(e); }
}
function fermaMani() { mani?.ferma(); disegnaDita([]); faseMani('spente'); }
// La fase delle mani (gesti.js: 'riposo', 'pronto', 'azione'; 'spente' quando si fermano): Blender spegne il cursore a riposo,
// qui i pallini delle dita si fanno più tenui. Cambia di rado: nessun costo a fotogramma.
function faseMani(fase) {
  $('dita').classList.toggle('riposo', fase === 'riposo');
  if (holoAperto) gestoOlo({ tipo: 'stato', fase });
  meteo?.gesto({ tipo: 'stato', fase });
}
function gestoMani(g) { if (g.tipo === 'stato') faseMani(g.fase); else if (meteo?.aperto) meteo.gesto(g); else if (holoAperto) gestoOlo(g); }
async function telaProva() { // come la fotocamera: 640×480, la foto di prova intera su fondo bianco (come lab-mani.html)
  const img = new Image();
  img.src = '/modelli/prova-mani.jpg';
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: 640, height: 480 }), g = c.getContext('2d'), h = (img.naturalHeight * 640) / img.naturalWidth;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 0, (480 - h) / 2, 640, h);
  return c;
}
// Pollice e indice di ogni mano, grezzi, con la stessa mappa a S del cursore di gesti.js: il cursore sta dove sta il
// pallino dell'indice, a meno del filtro e della zona morta (pochi pixel)
const DITA = [...document.querySelectorAll('#dita i')];
function disegnaDita(lista) {
  const su = (v, L) => (Math.min(1, Math.max(0, mappaMani(v))) * L).toFixed(1);
  DITA.forEach((d, i) => {
    const p = lista[i >> 1]?.punti?.[i & 1 ? 8 : 4], ok = Number.isFinite(p?.x) && Number.isFinite(p?.y);
    d.classList.toggle('on', ok);
    if (ok) d.style.transform = `translate(${su(p.x, innerWidth)}px, ${su(p.y, innerHeight)}px)`;
  });
}

// ---------- Le schede: compaiono quando la loro frase comincia a suonare ----------
// Il server manda ogni scheda subito dopo la frase che la nomina: qui si lega a quella frase (l'ultima arrivata). Compare
// quando la frase parte, più la posizione del nome nella frase per la sua durata: «say» non dice quando pronuncia ogni
// parola, quindi è una stima. La voce non aspetta mai una scheda: le schede non entrano nella coda dell'audio.
const normT = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function posizioneNome(testo, nome) {
  const t = normT(testo);
  for (const w of normT(nome).split(/[^a-z0-9]+/).filter((x) => x.length >= 3)) { const i = t.indexOf(w); if (i >= 0) return Math.min(0.85, i / Math.max(1, t.length)); }
  return 0;
}
const TEMPI = DEBUG ? (window.__tempi = { frasi: [], schede: [] }) : null; // per prove/hud-foto.mjs
function mostraScheda(id) { corsia.mostra(id); TEMPI?.schede.push({ id, mostrata: performance.now() }); }
function programma(item, d) {
  const ms = item.partita + posizioneNome(item.job.text || '', d.nome) * item.durata * 1000 - performance.now();
  setTimeout(() => { if (item.gen === generation) mostraScheda(d.id); }, Math.max(0, ms));
}
function legaScheda(item, d) {
  corsia.aggiungi(d);
  if (d.subito || !item || item.finita) mostraScheda(d.id); // un'animazione, o la frase già finita: subito
  else if (item.partita) programma(item, d);
  else item.schede.push(d);
}

// ---------- Audio: una coda, la voce del Mac dal server ----------
let ctx = null, outAnalyser = null, micAnalyser = null, sfx = null, micLivello = 0; // micLivello: rms del microfono, per i dB a raggiera
const buf = new Uint8Array(1024);
async function ensureAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    outAnalyser = ctx.createAnalyser(); outAnalyser.fftSize = 1024;
    outAnalyser.connect(ctx.destination);
    try { const { createSfx } = await import('./sfx.js'); sfx = createSfx(ctx); sfx.out.connect(ctx.destination); } catch (e) { console.warn('suoni non disponibili', e); }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
async function ensureMic() {
  if (micAnalyser || !ctx) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    micAnalyser = ctx.createAnalyser(); micAnalyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(micAnalyser);
  } catch {}
}
function rms(an) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}

let generation = 0, queue = [], playing = false, streamDone = true, currentSource = null, ttsAbort = new AbortController();
let spokeThisAnswer = false;
// Al massimo 2 sintesi insieme: la seconda frase si prepara mentre suona la prima
let ttsActive = 0;
const ttsWaiting = [];
const ttsSlot = () => new Promise((go) => { if (ttsActive < 2) { ttsActive++; go(); } else ttsWaiting.push(go); });
const ttsFree = () => { const next = ttsWaiting.shift(); if (next) next(); else ttsActive--; };

const recentSpoken = []; // frasi davvero riprodotte di recente, con l'ora: servono a riconoscere l'eco della sua voce
function speak(text, riprodotta) {
  const gen = generation, signal = AbortSignal.any([ttsAbort.signal, AbortSignal.timeout(15000)]); // annullabile, e mai bloccata per sempre
  const job = ttsSlot().then(() => (gen !== generation ? null // risposta annullata: non spendo caratteri
    : fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))).finally(ttsFree);
  job.text = text;
  const item = { gen, job, riprodotta, schede: [], ricevuta: performance.now() };
  queue.push(item);
  if (!playing) playNext();
  return item;
}
async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    if (streamDone && (S.mode === 'speaking' || S.mode === 'thinking')) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); }
    else if (!streamDone && S.mode === 'speaking') setMode('thinking'); // la frase è finita ma O.S.C.A.R. sta ancora lavorando
    return;
  }
  playing = true;
  const data = await item.job;
  if (item.gen !== generation) return; // risposta annullata: silence() ha già azzerato tutto
  if (!data) { item.finita = true; item.schede.forEach((d) => mostraScheda(d.id)); return playNext(); } // frase persa: meglio un salto che un'altra voce
  try {
    await ensureAudio();
    const audio = await ctx.decodeAudioData(data);
    if (item.gen !== generation) return;
    const src = ctx.createBufferSource();
    src.buffer = audio; src.connect(outAnalyser);
    currentSource = src;
    spokeThisAnswer = true;
    recentSpoken.push({ text: item.job.text || '', at: performance.now() + audio.duration * 1000, gen: item.gen }); if (recentSpoken.length > 60) recentSpoken.shift();
    if (S.mode !== 'speaking') setMode('speaking');
    src.onended = () => { item.finita = true; if (currentSource === src) currentSource = null; if (item.gen === generation) { item.riprodotta?.(); playNext(); } };
    src.start();
    item.partita = performance.now(); item.durata = audio.duration;
    TEMPI?.frasi.push({ s: item.job.text, ricevuta: item.ricevuta, partita: item.partita, durata: audio.duration });
    for (const d of item.schede) programma(item, d);
  } catch { if (item.gen === generation) { item.finita = true; item.schede.forEach((d) => mostraScheda(d.id)); playNext(); } }
}
function silence() {
  generation++;
  ttsAbort.abort(); ttsAbort = new AbortController(); // le sintesi della risposta vecchia liberano subito i posti
  queue = []; playing = false;
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
}

// ---------- Cervello ----------
let controller = null, lastReplyAt = -1e9, latenza = null; // latenza: secondi dalla domanda alla prima frase dell'ultima risposta
async function ask(text, { agenda = false, why = '' } = {}) { // agenda: niente testo, il server prende i compiti arrivati all'ora
  // why: perché la frase è passata (nome, conversazione, comando, saluto). Il cervello lo legge per decidere se rispondere
  silence();
  spokeThisAnswer = false; earlySent = '';
  allarme('attesa', 0);
  const gen = generation, chiesto = performance.now();
  let primaFrase = true, ultima = null; // ultima: la frase a cui si lega la prossima scheda
  corsia.pulisci(); // una risposta nuova: via le schede di quella prima
  controller?.abort();
  controller = new AbortController();
  setMode('thinking');
  sfx?.ack();
  streamDone = false;
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(agenda ? { agenda } : { text, why }), signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += dec.decode(value, { stream: true });
      let i;
      while ((i = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, i); rest = rest.slice(i + 1);
        if (!line.trim() || gen !== generation) continue;
        const ev = JSON.parse(line);
        if (ev.t === 'say') {
          if (primaFrase) { primaFrase = false; latenza = (performance.now() - chiesto) / 1000; evento(`VOICE OUT · ${latenza.toFixed(1)} S`); allarme('cervello', 0); }
          ultima = speak(ev.s);
        }
        else if (ev.t === 'vedi') { evento(`VEDI · ${String(ev.nome || '').slice(0, 24)}`); legaScheda(ultima, ev); } // non chiude né ologramma né meteo
        else if (ev.t === 'vedi-foto') corsia.foto(ev.id, ev.url)
        else if (ev.t === 'show') { evento('BROWSER · SHOW'); chiudiOlo(); chiudiMeteo(); closeReport(); showScreen(true); } // ricerca nuova: report, ologramma e meteo lasciano il posto al browser
        else if (ev.t === 'report') openReport(ev);
        else if (ev.t === 'meteo') { if (ev.chiudi) chiudiMeteo(); else apriMeteo(ev.dati); }
        else if (ev.t === 'holo') { evento(`HOLO · V${Number(ev.v) || 0}`); rileggiOlogramma(Number(ev.v)); }
        else if (ev.t === 'tool') { evento(`TOOL · ${String(ev.name).slice(0, 24)}`); showAction(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        else if (ev.t === 'page') $('p-host').textContent = '· ' + ev.detail;
        else if (ev.t === 'file' || ev.t === 'mac') { evento(`${ev.t === 'mac' ? 'MAC' : 'FILE'} · ${String(ev.name).slice(0, 24)}`); showSmall(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        // Ricerca senza browser (WebSearch, WebFetch): un'etichetta piccola, e l'ologramma resta aperto. Dal server arriva
        // solo il tipo e, per una pagina, il nome del sito: mai le parole cercate.
        else if (ev.t === 'web') { const pagina = ev.name === 'pagina'; evento(`WEB · ${pagina ? 'PAGINA' : 'RICERCA'}`); showSmall(pagina ? 'Leggo' : 'Cerco in rete', pagina ? String(ev.detail || '').slice(0, 60) : ''); if (!playing) setMode('thinking'); }
        else if (ev.t === 'ignore') { evento('IGNORE'); report('frase non per O.S.C.A.R. (ignorata dal cervello)'); lastReplyAt = -1e9; } // niente finestra di conversazione
        else if (ev.t === 'promemoria') mostraPromemoria(ev, () => gen === generation, speak);
        else if (ev.t === 'attesa') allarme('attesa', ev.attiva ? 1 : 0, 'IN ATTESA · ESC O «STOP» PER INTERROMPERE');
        else if (ev.t === 'error') {
          evento('ERROR · CERVELLO'); allarme('attesa', 0);
          allarme('cervello', 2, ev.causa === 'inattivo' ? 'RICHIESTA INTERROTTA PER INATTIVITÀ' : 'IL CERVELLO HA PERSO IL FILO', 12000);
          speak(ev.s || 'Ho perso il filo. Riprova tra un attimo.');
        }
      }
    }
  } catch (e) {
    if (gen === generation && e.name !== 'AbortError') { evento('ERROR · CERVELLO IRRAGGIUNGIBILE'); allarme('cervello', 2, 'CERVELLO NON RAGGIUNGIBILE', 15000); speak('Non riesco a raggiungere il mio cervello. Il server è acceso?'); }
  } finally {
    if (gen === generation) { allarme('attesa', 0); streamDone = true; if (!playing && queue.length === 0) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); } }
  }
}
function interrupt() { allarme('attesa', 0); evento('STOP'); silence(); controller?.abort(); fetch('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' } }); setMode('idle'); }

// ---------- Ascolto sempre acceso (riconoscimento locale: l'audio della stanza non esce dal Mac) ----------
// Chrome tiene un solo riconoscimento per processo: con due HUD aperti si interromperebbero. Ascolta chi ha il lucchetto.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LOCAL = { langs: ['it-IT'], processLocally: true };
let rec = null, ear = 'prep', earLock = !navigator.locks, earTimer = 0, earBackoff = 300, earFails = 0;
const EAR_TEXT = { prep: 'preparo', install: 'installo il modello italiano', click: 'clic per attivare', on: 'acceso', denied: 'microfono negato', nolocal: 'non disponibile' };
navigator.locks?.request('oscar-ear', () => { earLock = true; scheduleEar(300); return new Promise(() => {}); });

const report = (line) => fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) }).catch(() => {});
const STOP = /^(stop|basta|zitto|fermati|aspetta|silenzio)\b/i;
// La finestra di continuità, scelta di Tony del 12/11: una frase cominciata entro 15 s dalla fine della voce di O.S.C.A.R. passa
// anche senza nome, così le domande di seguito vengono naturali. Si conta dall'inizio della frase, non dalla fine: chi
// comincia a parlare al dodicesimo secondo non deve perdere la risposta perché la frase finisce al sedicesimo.
// Nel registro, 20 domande in conversazione su 26 erano arrivate entro 9 s dalla fine della voce, 6 tra 15 e 20 s
// (misura dell'11/11, grossolana: lo stato arriva al registro ogni 5 s).
const FINESTRA_MS = 15000;
let fraseDa = 0; // quando è cominciata la frase in corso

// Per il registro: la prima parola e quella più simile a uno dei nomi (per scoprire come il riconoscitore storpia «oscar»,
// senza registrare la frase intera)
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function clue(text) {
  const words = text.trim().split(/\s+/).map(norm).filter(Boolean);
  const best = words.map((w) => [w, NOME, editDistance(w, NOME)]).sort((p, q) => p[2] - q[2])[0];
  return `${words.length} parole; prima: "${words[0] || ''}"` + (best && best[2] <= 3 ? `; più simile a ${best[1]}: "${best[0]}" (distanza ${best[2]})` : '');
}

// È per O.S.C.A.R.? Solo due vie, scelta di Tony del 12/11: il nome (anche storpiato), oppure una frase cominciata nella
// finestra di continuità. Le parole comuni all'inizio («dimmi», «fammi», «puoi», un saluto, un verbo dell'ologramma) non
// bastano più: facevano passare la TV e i discorsi con altri. Nella finestra passa anche un «sì» da solo, la risposta a «Vado?».
function addressed(text) {
  const words = text.trim().split(/\s+/);
  const nameAt = words.findIndex(isName);
  if (nameAt >= 0) return { why: 'nome', text: [...words.slice(0, nameAt), ...words.slice(nameAt + 1)].join(' ').replace(/^[\s,.:;!?]+/, '').trim() || 'Ciao!' };
  const da = fraseDa || performance.now();
  if (da - lastReplyAt < FINESTRA_MS && S.mode !== 'thinking') return { why: 'conversazione', text };
  return null;
}

async function prepareEar() {
  if (!SR || typeof SR.available !== 'function') { ear = 'nolocal'; allarmeAscolto(); return; } // senza riconoscimento locale O.S.C.A.R. non sente: è un'anomalia
  let st = await SR.available(LOCAL).catch(() => 'unavailable');
  if (st === 'downloadable' || st === 'downloading') {
    ear = 'install';
    const ok = await SR.install(LOCAL).catch(() => false);
    st = ok ? 'available' : await SR.available(LOCAL).catch(() => 'unavailable');
  }
  ear = st === 'available' ? 'on' : st === 'downloadable' ? 'click' : 'nolocal';
  if (ear !== 'on') { warn(`Ascolto: ${EAR_TEXT[ear]}.`, 'attenzione'); if (ear === 'nolocal') retryEar(); }
  allarmeAscolto();
  scheduleEar(300);
}
// L'ascolto spento è un'anomalia (arancione); il modello che si installa no, è l'avvio
function allarmeAscolto() {
  const testi = { denied: 'MICROFONO NEGATO', nolocal: 'ASCOLTO NON DISPONIBILE', click: "CLIC PER ATTIVARE L'ASCOLTO" };
  allarme('ascolto', testi[ear] ? 1 : 0, testi[ear] || '');
  evento(`EAR · ${EAR_TEXT[ear].toUpperCase()}`);
}
let retryTimer = 0;
function retryEar() { clearTimeout(retryTimer); retryTimer = setTimeout(prepareEar, 45000); } // permesso dato dopo, modello reinstallato…
function scheduleEar(ms = 300) { clearTimeout(earTimer); if (ear === 'on' && earLock) earTimer = setTimeout(startEar, ms); }

// ?debug&wav=file.wav: l'ascolto sente quel file invece del microfono (prove senza voce)
let debugTrack = null;
async function loadDebugTrack(file) {
  const c = new AudioContext();
  const b = await c.decodeAudioData(await (await fetch(file)).arrayBuffer());
  const dest = c.createMediaStreamDestination();
  const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.connect(dest); s.start();
  debugTrack = dest.stream.getAudioTracks()[0];
}

let earlySent = '', earlyTimer = 0, joinTimer = 0, pending = '', heardAt = 0, spokeUntil = -1e9;
// Eco: le ultime parole di O.S.C.A.R. arrivano al riconoscitore anche dopo che ha smesso di parlare.
// Le scarto se arrivano entro 1,2 s dalla fine o se somigliano per più del 60% a ciò che ha appena detto.
// Le parole della sua voce: tutte quelle della risposta in corso, più quelle finite da meno di 6 secondi. Mentre la voce va
// avanti senza pause il riconoscitore trascrive il discorso dall'inizio: fino al 27/11 il filtro ricordava 4 frasi per 6 s,
// e O.S.C.A.R. che spiegava «mi hai detto aspetta, mi basta così» si fermava da solo, più volte di fila (prove/hud-foto.mjs).
function echoWords() {
  const now = performance.now();
  return new Set(recentSpoken.filter((r) => r.gen === generation || now - r.at < 6000).flatMap((r) => r.text.split(/\s+/).map(norm).filter(Boolean)));
}
// Detta da lui, anche storpiata: il riconoscitore cambia una lettera («fermato» → «fermati», «pasta» → «basta»).
// Solo parole di almeno 4 lettere, così un «stop» di Tony non si confonde con un «top» detto da lui.
function dettaDaLui(parola, said) {
  const p = norm(parola);
  if (!p || said.has(p)) return true;
  if (p.length < 4) return false;
  for (const w of said) if (w.length >= 4 && Math.abs(w.length - p.length) <= 1 && editDistance(w, p) <= 1) return true;
  return false;
}
function isEcho(text) {
  const words = text.split(/\s+/);
  if (words.some(isName)) return false;
  const w = words.map(norm).filter((x) => x.length > 2);
  if (w.length < 1) return performance.now() - spokeUntil < 1200;
  const said = echoWords(), sue = w.filter((x) => dettaDaLui(x, said)).length;
  return sue / w.length > 0.6 || (performance.now() - spokeUntil < 1200 && sue > 0);
}
// Mentre parla o lavora: "stop", "basta"… oppure il nome, in qualunque punto della frase, tolte le parole della sua eco
function wantsStop(text) {
  const said = echoWords();
  const mine = text.split(/\s+/).filter((x) => !dettaDaLui(x, said));
  return mine.some((x) => STOP.test(x) || isName(x));
}
function startEar() {
  if (ear !== 'on' || !earLock || rec) return;
  const r = new SR();
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.processLocally = true;
  rec = r;
  ensureAudio().then(ensureMic); // l'anello e i cerchi si muovono quando parli
  r.onresult = (e) => {
    earBackoff = 300; earFails = 0;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], text = res[0].transcript.trim();
      if (!text) continue;
      if (res.isFinal) heard(text); else interim += ' ' + text;
    }
    onInterim(interim.trim());
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed') { ear = 'denied'; warn('Serve il permesso del microfono.', 'attenzione'); allarmeAscolto(); retryEar(); return; }
    if (e.error === 'service-not-allowed' || e.error === 'language-not-supported') { ear = 'nolocal'; allarmeAscolto(); retryEar(); return; }
    if (e.error !== 'no-speech') {
      earBackoff = Math.min(10000, earBackoff * 2);
      if (++earFails === 5) report(`ascolto in errore: ${e.error}`);
    }
  };
  r.onend = () => { if (rec === r) { rec = null; S.hearing = false; if (!pending) fraseDa = 0; scheduleEar(earBackoff); } }; // Chrome chiude dopo un po' di silenzio: riparto
  try { if (debugTrack) r.start(debugTrack); else r.start(); } catch { rec = null; scheduleEar(1000); }
}

// Parole parziali: mentre parli O.S.C.A.R. ti "guarda" (anelli e sfera); se ti fermi 0,8 s su una richiesta, parte già
function onInterim(text) {
  text = unisciSigla(text);
  S.hearing = Boolean(text);
  if (!text) { ascolto.viva(''); return; }
  dbg('parziale', text, '| modo', S.mode);
  heardAt = performance.now();
  const said = echoWords();
  if ((S.mode === 'speaking' || S.mode === 'thinking') && text.split(/\s+/).some((x) => STOP.test(x) && !dettaDaLui(x, said))) {
    interrupt(); report('fermato a voce'); ascolto.esito('STOP', true); return; // "stop" funziona anche mentre clicca e scrive, senza aspettare la fine della frase
  }
  if (S.mode === 'speaking' || isEcho(text)) return; // mentre parla, e subito dopo, ignora l'eco della sua voce (e non la scrive)
  if (!fraseDa) fraseDa = performance.now();
  ascolto.viva(text);
  if (pending) clearTimeout(joinTimer); // stai ancora parlando: la frase non è finita
  clearTimeout(earlyTimer);
  const a = addressed(pending ? `${pending} ${text}` : text);
  if (!a) return;
  if (S.mode === 'idle') { setMode('listening'); sfx?.listen(); }
  earlyTimer = setTimeout(() => {
    if (a.text.split(/\s+/).length < 3 || norm(a.text) === norm(earlySent)) return;
    earlySent = a.text; report(`parto in anticipo (${a.why})`); evento(`ASK · ${a.why.toUpperCase()} · IN ANTICIPO`);
    ascolto.esito(`PER O.S.C.A.R. · ${PERCHE[a.why]}`, true); ask(a.text, { why: a.why });
  }, 800);
}

// Frase finita: decido se è per O.S.C.A.R., poi aspetto 0,6 s nel caso continui
function heard(text) {
  text = unisciSigla(text);
  dbg('finale', text, '| modo', S.mode);
  S.hearing = false;
  clearTimeout(earlyTimer);
  if (S.mode === 'speaking' || S.mode === 'thinking') { // si può interrompere: "stop", "basta", oppure chiamandolo per nome
    if (wantsStop(text)) {
      interrupt(); report('interrotto a voce');
      const a = addressed(text), riparte = a && a.why === 'nome' && !STOP.test(a.text) && a.text.split(/\s+/).length > 1;
      ascolto.fissa(text); ascolto.esito(riparte ? `PER O.S.C.A.R. · ${PERCHE.nome}` : 'STOP', true); // chiamato per nome: riparte con la frase intera, non si ferma
      if (riparte) ask(a.text, { why: a.why });
      fraseDa = 0;
      return;
    }
    if (S.mode === 'speaking') return;
  }
  if (isEcho(text)) { report('scartata: eco della voce di O.S.C.A.R.'); evento('INPUT · ECO'); ascolto.viva(''); if (!pending) fraseDa = 0; return; }
  if (!fraseDa) fraseDa = performance.now(); // frase finita senza parole parziali prima
  pending = pending ? `${pending} ${text}` : text;
  ascolto.fissa(pending);
  clearTimeout(joinTimer);
  // Solo il nome ("O.S.C.A.R.…"): aspetto di più, probabilmente stai per dire la domanda
  const onlyName = pending.trim().split(/\s+/).every(isName);
  joinTimer = setTimeout(() => {
    const full = pending; pending = '';
    const a = addressed(full);
    fraseDa = 0;
    dbg('decido', full, '->', a ? a.why + ': ' + a.text : 'non per O.S.C.A.R.');
    if (!a) { report(`non per O.S.C.A.R.; ${clue(full)}`); evento('INPUT · NON PER O.S.C.A.R.'); ascolto.esito('NON PER O.S.C.A.R.', false); if (S.mode === 'listening') setMode('idle'); return; }
    ascolto.esito(`PER O.S.C.A.R. · ${PERCHE[a.why]}`, true);
    // già partito in anticipo con lo stesso identico testo: non ricomincio; se è cambiato anche di una parola, riparto
    const sameAsEarly = earlySent && norm(a.text) === norm(earlySent);
    earlySent = '';
    if (sameAsEarly) return;
    report(`domanda (${a.why})`); evento(`ASK · ${a.why.toUpperCase()}`);
    ask(a.text, { why: a.why });
  }, onlyName ? 2000 : 700);
}

// ---------- La scheda dell'ascolto: le parole mentre arrivano, poi cosa ne ha fatto O.S.C.A.R. Solo sullo schermo: mai nei registri ----------
const PERCHE = { nome: 'NOME', conversazione: 'CONVERSAZIONE' };
const ascolto = (() => {
  const box = $('ascolto'), elFissa = $('frase-fissa'), elViva = $('frase-viva'), elEsito = $('esito');
  let fissa = '', viva = '', timer = 0;
  const MAX = 150; // una frase lunga si legge dalla fine: restano le ultime parole
  const coda = (s) => { if (s.length <= MAX) return s; const t = s.slice(-MAX), sp = t.indexOf(' '); return '… ' + (sp >= 0 && sp < 24 ? t.slice(sp + 1) : t); };
  function mostra() {
    const tutto = coda(`${fissa}${fissa && viva ? ' ' : ''}${viva}`), nf = Math.max(0, tutto.length - viva.length);
    scrivi(elFissa, tutto.slice(0, nf)); scrivi(elViva, tutto.slice(nf)); // il testo entra solo con textContent
    box.classList.toggle('on', !!tutto); box.classList.toggle('vivo', !!viva);
    clearTimeout(timer);
    if (tutto && !viva) timer = setTimeout(() => { fissa = ''; viva = ''; scrivi(elEsito, ''); mostra(); }, 7000); // poi si svuota
  }
  return {
    viva(t) { if (t && !viva && !pending) { fissa = ''; scrivi(elEsito, ''); } viva = t; mostra(); }, // una frase nuova comincia pulita
    fissa(t) { fissa = t; viva = ''; mostra(); },
    esito(t, per) { if (!fissa && !viva) return; scrivi(elEsito, t); elEsito.classList.toggle('per', !!per); }, // senza frase non dice niente
  };
})();

// ---------- Tastiera e mouse: niente più push-to-talk. Esc zittisce e chiude, un clic sblocca l'audio se Chrome lo blocca ----------
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { pending = ''; earlySent = ''; interrupt(); closeReport(); chiudiOlo(true); chiudiMeteo(); corsia.pulisci(); }
  else if (holoAperto && e.key.toLowerCase() === 'm' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) { cambiaMani(); e.preventDefault(); }
  else if (meteo?.aperto && tastoMeteo(e)) e.preventDefault();
});
addEventListener('pointerdown', () => { ensureAudio(); if (ear !== 'on' && ear !== 'install') prepareEar(); });

// livello: '' per le notizie (ciano), 'attenzione' (arancione) e 'critico' (rosso) solo per le anomalie
function warn(msg, livello = '') {
  const w = $('warn'); w.textContent = msg; w.className = `${livello} on`;
  clearTimeout(warn.t); warn.t = setTimeout(() => w.classList.remove('on'), 5000);
}

// ---------- Ai bordi e a raggiera: tutti numeri veri ----------
// A destra gli eventi (solo tipi e nomi di strumenti, mai frasi), in alto ora e memoria. Ogni evento si spegne col suo tempo
// di dimezzamento: la luce di una riga dice quanto è vecchia. Lo spettro del microfono non è più una colonna di esadecimali
// (illeggibile): è l'anello dello spettro del nucleo. 4 aggiornamenti al secondo.
const EVENTI = []; // { el, at }
const DIMEZZA_S = 25;
const due = (n) => String(n).padStart(2, '0');
const orario = (d = new Date()) => `${due(d.getHours())}:${due(d.getMinutes())}:${due(d.getSeconds())}`;
function evento(testo) {
  const el = document.createElement('div');
  el.textContent = `${testo.toUpperCase()}  ${orario()}`; // solo testo: nomi di strumenti e siti arrivano da fuori
  $('eventi').append(el);
  EVENTI.push({ el, at: performance.now() });
  if (EVENTI.length > 48) EVENTI.shift().el.remove();
}
function aggiornaBordi() {
  if (document.body.classList.contains('olo') || document.body.classList.contains('report') || document.body.classList.contains('meteo')) return; // spenti: niente da scrivere
  const ora = performance.now();
  for (const e of EVENTI) { // 0,2 di fondo, così anche le righe vecchie si leggono
    const o = (0.2 + 0.8 * 2 ** (-(ora - e.at) / 1000 / DIMEZZA_S)).toFixed(2);
    if (e.o !== o) { e.o = o; e.el.style.opacity = o; }
  }
  const d = new Date(), su = Math.floor((performance.now()) / 1000);
  scrivi($('cima-ora'), `${due(d.getDate())}.${due(d.getMonth() + 1)}.${d.getFullYear()}  ${orario(d)}`);
  const heap = performance.memory ? ` · HEAP ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '';
  scrivi($('cima-dati'), `UPTIME ${due(Math.floor(su / 3600))}:${due(Math.floor(su / 60) % 60)}:${due(su % 60)}${heap}`);
  // I valori a raggiera
  const v = ultimoStato?.voice;
  scrivi($('d-voce').lastChild, !v ? '—' : `MAC · ${String(v.voce || 'SISTEMA').toUpperCase().slice(0, 22)}`);
  scrivi($('d-latenza').lastChild, latenza === null ? '—' : `${latenza.toFixed(1).replace('.', ',')} S`);
  const db = micLivello > 0 ? Math.max(-60, Math.round(20 * Math.log10(micLivello))) : null;
  scrivi($('d-ascolto').lastChild, ear !== 'on' ? EAR_TEXT[ear].toUpperCase() : db === null ? 'IN ATTESA' : `${db} DB`);
  scrivi($('d-sistemi').lastChild, ultimoStato ? `BROWSER ${ultimoStato.browser ? 'ON' : 'OFF'} · AGENDA ${Number(ultimoStato.agenda) || 0}` : '—');
  const ultimo = SECONDI[SECONDI.length - 1];
  scrivi($('d-grafica').lastChild, ultimo ? `${ultimo.n} FPS` : '—');
  aggiornaAllarme(); // le cause a tempo scadono anche se nessuno le tocca
}

// Lo spettro per il nucleo: 64 bande a passo logaritmico da circa 94 Hz a 8 kHz (fftSize 1024), dal microfono quando
// O.S.C.A.R. ascolta, dalla sua voce quando parla. Il nucleo ci fa l'anello dello spettro e ci spinge la goccia.
// Sotto la frase, il livello del microfono è una riga sola: la sua lunghezza (solo una trasformazione).
const bande = new Uint8Array(512), SPETTRO = new Uint8Array(64);
const BANDE_I = Array.from({ length: 65 }, (_, k) => Math.round(2 * (170 / 2) ** (k / 64)));
S.spettro = SPETTRO;
function leggiSpettro() {
  const an = S.mode === 'speaking' && currentSource ? outAnalyser : micAnalyser;
  if (!an) { SPETTRO.fill(0); return; }
  an.getByteFrequencyData(bande);
  for (let k = 0; k < 64; k++) { let m = 0; for (let i = BANDE_I[k]; i < Math.max(BANDE_I[k] + 1, BANDE_I[k + 1]); i++) m = Math.max(m, bande[i]); SPETTRO[k] = m; }
}
const rigaLivello = $('livello').firstElementChild;
let livelloScritto = '';
function disegnaLivello() {
  if (document.body.classList.contains('olo') || document.body.classList.contains('report') || document.body.classList.contains('meteo')) return;
  const s = Math.min(1, S.mic * 1.4).toFixed(3);
  if (s !== livelloScritto) { livelloScritto = s; rigaLivello.style.transform = `scaleX(${s})`; }
}

// ---------- Avvio ----------
// Prove senza microfono e senza ricerca: oscarSente è una frase finita e oscarParziale una parziale, come dal riconoscimento;
// oscarAllarme(causa, livello, testo, ms) accende un'anomalia finta
if (DEBUG) { window.oscarCorsia = corsia; window.oscarAsk = ask; window.oscarReport = openReport; window.oscarSente = heard; window.oscarParziale = onInterim; window.oscarAllarme = allarme; window.oscarNome = isName; }
// oscarMeteo(dati): apre la meteo senza cervello, con i dati dati o con gli ultimi del server (GET /api/meteo); oscarVistaMeteo() per info() e gesto()
if (DEBUG) { window.oscarMeteo = async (dati) => apriMeteo(dati || await (await fetch('/api/meteo', { cache: 'no-store' })).json()); window.oscarVistaMeteo = () => meteo; }
if (DEBUG && params.get('wav')) await loadDebugTrack(params.get('wav'));
prepareEar();
const { createScene, TIMING } = await import('./nucleo.js');
const scene = await createScene($('gl'), S);
scenaPronta(scene);
// Se il Mac fa perdere il contesto grafico (sospensione, GPU riavviata) i campi precalcolati vanno rifatti: ricarico l'HUD
$('gl').addEventListener('webglcontextlost', (e) => e.preventDefault());
$('gl').addEventListener('webglcontextrestored', () => location.reload());
rileggiOlogramma(holoAncora); // una versione vista da /api/status prima che la scena fosse pronta
// oscarOlogramma(stato): accende le mani come con un ologramma aperto, senza server né Blender (per le prove delle mani)
if (DEBUG) window.oscarOlogramma = (st) => { applicaOlogramma(st); return { aperto: holoAperto }; };
const freeze = params.get('t'); // ?t=3 ferma la formazione a 3 secondi (per le prove)
const t0 = performance.now();
let last = t0, revealed = false;
ensureAudio().then(() => { if (!freeze) sfx?.boot(undefined, TIMING.formEnd); }); // il suono della formazione dura quanto lei
// Fotogrammi disegnati, contati in ogni secondo intero (gli ultimi 3600), con le mani accese o no per tutto il secondo.
// Servono a misuraMani() e a chi misura via CDP (window.__misure: mediana, p10 e minimo degli ultimi 20 secondi, più i
// conti uno per uno). Sono fotogrammi di requestAnimationFrame: col thread in ritardo possono superare quelli presentati,
// ma contati per secondo non li gonfia più la mediana degli intervalli (59,9 fps contro i 55 della traccia, 7/11).
const SECONDI = []; // { s: il secondo, n: fotogrammi, mani: accese per tutto il secondo }
let nQuadri = 0, secOra = null, secPieno = false, secN = 0, secMani = false, maniPrima = false;
function contaQuadro(now) {
  const s = Math.floor(now / 1000), m = !!mani?.attivo;
  nQuadri++;
  if (s !== secOra) {
    if (secPieno) SECONDI.push({ s: secOra, n: secN, mani: secMani }); // il primo secondo, preso a metà, non conta
    if (secOra !== null) for (let k = secOra + 1; k < s && k <= secOra + 10; k++) SECONDI.push({ s: k, n: 0, mani: secMani && m }); // fermi del thread
    if (SECONDI.length > 3600) SECONDI.splice(0, SECONDI.length - 3600);
    secPieno = secOra !== null; secOra = s; secN = 0; secMani = m && maniPrima;
  }
  secN++; secMani &&= m; maniPrima = m;
}
function statFps(lista) {
  const v = lista.map((x) => x.n).sort((a, b) => a - b), q = (p) => v[Math.floor(p * (v.length - 1))];
  return v.length ? { mediana: q(0.5), p10: q(0.1), minimo: v[0], secondi: v.length } : { mediana: null, p10: null, minimo: null, secondi: 0 };
}
Object.defineProperty(window, '__misure', { get() {
  const ultimi = SECONDI.slice(-20);
  return { fotogrammi: nQuadri, fps: { ...statFps(ultimi), conti: ultimi.map((x) => x.n) }, ologramma: holoAperto, mani: mani ? { attive: mani.attivo, ...mani.misure } : null };
} });
let lastActive = 0, skip = false;
const mollaSplit = molla(0), mollaDock = molla(0);
function loop(now) {
  requestAnimationFrame(loop);
  // In attesa e senza nessuno che parla da 20 s: 20 fotogrammi al secondo bastano, la GPU (e la batteria) ringraziano.
  // L'ologramma e la meteo aperti contano come attività: a metà frequenza mani, rotazione e foto andrebbero a scatti.
  if (booting || S.mode !== 'idle' || S.hearing || S.split > 0.01 || corsia.attiva || holoAperto || meteo?.aperto) lastActive = now;
  if (now - lastActive > 20000) { skip = !skip; if (skip || now - last < 45) return; }
  contaQuadro(now);
  if (holoAperto) { last = now; return; } // davanti c'è Blender: il nucleo non si disegna e la grafica resta a Blender e alle mani
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = freeze ? Number(freeze) : (now - t0) / 1000;
  if (!revealed && t >= TIMING.reveal) { revealed = true; if (!freeze) sfx?.reveal(); }
  if (booting && t >= TIMING.ready) { booting = false; document.body.classList.add('ready'); }
  const out = outAnalyser && currentSource ? Math.min(1, rms(outAnalyser) * 4.5) : 0;
  S.audio += (out - S.audio) * Math.min(1, dt * 18);
  micLivello = micAnalyser ? rms(micAnalyser) : 0; micPeak = Math.max(micPeak, micLivello);
  const mic = micAnalyser && S.mode !== 'speaking' ? Math.min(1, micLivello * 6) : 0;
  S.mic += (mic - S.mic) * Math.min(1, dt * 18);
  leggiSpettro();
  disegnaLivello();
  if (S.mode === 'listening' && !S.hearing && !pending && performance.now() - heardAt > 4000) setMode('idle');
  // il nucleo si sposta su due molle (fisica.js): verso il browser e nell'angolo del report o della meteo
  S.split = mollaSplit.verso(S.splitTarget).passo(dt); S.dock = mollaDock.verso(S.dockTarget).passo(dt);
  meteo?.fotogramma(t, dt); // il globo: camera, anelli, vento e scritte, prima del render
  scene.frame(t, ((now - t0) / 1000) % 3600, dt); // orologio che riparte ogni ora: in float32 resta preciso anche dopo giorni
  disegnaAttorno(t, scene.anchor(), dt);
}
requestAnimationFrame(loop);
setInterval(aggiornaBordi, 250); // dopo la scena: usa i fotogrammi contati
