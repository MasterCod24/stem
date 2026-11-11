// STEM — l'HUD: ascolto sempre acceso, voce, pannello del browser, GIF, suoni, ologramma, la scheda dell'ascolto,
// i dati a raggiera e i micro-dati ai bordi. La grafica (sfera e anelli) sta in nucleo.js.
import { showReport, hideReport, reportDock } from './report.js';
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
  if (m === 'idle') { if (document.body.classList.contains('browsing')) showScreen(false); }
  else clearTimeout(screenTimer);
}
const scrivi = (el, testo) => { if (el.textContent !== testo) el.textContent = testo; }; // riscrivere lo stesso testo rifà il layout

// ---------- Attorno al nucleo: scritta di stato e dati a raggiera, con i fili che partono dall'anello più esterno ----------
// anchor() di nucleo.js: centro (x, y), raggio della sfera r e dell'anello più esterno R, in pixel CSS.
// I dati stanno su raggi fissi: angolo in gradi (0 a destra, in senso antiorario); lato 1 scritta a destra, -1 a sinistra.
const RAGGI = [
  { el: $('status'), ang: 38, lato: 1, stato: true },
  { el: $('d-voce'), ang: 6, lato: 1 },
  { el: $('d-latenza'), ang: -30, lato: 1 },
  { el: $('d-ascolto'), ang: 150, lato: -1 },
  { el: $('d-sistemi'), ang: 186, lato: -1 },
  { el: $('d-grafica'), ang: 220, lato: -1 },
];
const SVG = 'http://www.w3.org/2000/svg';
for (const r of RAGGI) { // un filo e un punto per dato: si spostano solo quando si sposta il nucleo
  r.filo = document.createElementNS(SVG, 'polyline'); r.punto = document.createElementNS(SVG, 'circle');
  r.punto.setAttribute('r', '2'); $('fili').append(r.filo, r.punto);
}
let chiaveAttorno = '', largAscolto = 0;
function disegnaAttorno(t, at) {
  const docked = S.dock > 0.5, split = S.split > 0.5, R = at.R ?? at.r * 1.5, st = $('status');
  if (booting) scrivi(st, `ASSEMBLING... ${Math.min(99, Math.round(scene.assembling(t) * 100))}%`);
  else scrivi(st, ear !== 'on' && S.mode === 'idle' ? (docked ? 'STATUS: MIC OFF' : `STATUS: MIC OFF  (${EAR_TEXT[ear]})`.toUpperCase()) // nell'angolo il perché uscirebbe dallo schermo
    : S.mode === 'speaking' && S.audio > 0.35 && !docked ? 'STATUS: SPEAKING  INTENSITY: HIGH' : LABELS[S.mode]);
  const media = $('media').classList.contains('on'), sm = $('small'), an = $('anomalia');
  // anche la lunghezza dei testi: una scritta che si allunga può arrivare sopra le colonne dei bordi
  const lunghi = `${RAGGI.map((r) => r.el.textContent.length)} ${sm.classList.contains('on') && sm.textContent.length} ${an.classList.contains('on') && an.textContent.length}`;
  const chiave = `${Math.round(at.x)} ${Math.round(at.y)} ${Math.round(R)} ${docked} ${split} ${media} ${innerWidth} ${innerHeight} ${lunghi}`;
  if (chiave === chiaveAttorno) return; // fermo: niente da spostare
  chiaveAttorno = chiave;
  document.body.classList.toggle('media', media);
  if (docked) { // nell'angolo del report e dell'ologramma: la scritta sopra gli anelli, centrata e corta, per non finire sulle schede
    const y = Math.round(at.y - R - 24);
    st.style.transform = `translate(${Math.round(at.x)}px, ${y}px) translateX(-50%)`;
    $('small').style.transform = `translate(${Math.round(at.x)}px, ${y - 18}px) translateX(-50%)`;
    $('anomalia').style.transform = `translate(${Math.round(at.x)}px, ${y - 36}px) translateX(-50%)`;
    for (const r of RAGGI) { r.filo.classList.add('spento'); r.punto.classList.add('spento'); }
  } else {
    for (const r of RAGGI) {
      // col browser il nucleo sta a sinistra: i dati uscirebbero dallo schermo o finirebbero sulla pagina, resta solo lo stato, in alto
      const lato = r.lato, ang = (r.stato && split ? 72 : r.ang) * Math.PI / 180;
      const c = Math.cos(ang), s = Math.sin(ang);
      const x0 = at.x + R * c, y0 = at.y - R * s, x1 = at.x + (R + 22) * c, y1 = at.y - (R + 22) * s, x2 = x1 + lato * 44;
      const nascosto = !r.stato && (split || (lato === 1 && media)); // a destra la GIF
      r.filo.setAttribute('points', `${x0.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y1.toFixed(1)}`);
      r.punto.setAttribute('cx', x0.toFixed(1)); r.punto.setAttribute('cy', y0.toFixed(1));
      r.filo.classList.toggle('spento', nascosto); r.punto.classList.toggle('spento', nascosto);
      r.el.classList.toggle('spento', nascosto && !r.stato);
      const tx = Math.round(x2 + lato * 8), ty = Math.round(y1 - 7), via = lato === -1 ? ' translateX(-100%)' : '';
      r.el.style.transform = `translate(${tx}px, ${ty}px)${via}`;
      if (r.stato) {
        $('small').style.transform = `translate(${tx}px, ${ty + 20}px)${via}`;
        $('anomalia').style.transform = `translate(${tx}px, ${ty + 38}px)${via}`;
      }
    }
  }
  // La GIF a destra degli anelli (i dati di destra si spengono), oppure a sinistra quando a destra c'è il browser
  const mx = split ? Math.round(at.x - R - 330) : Math.round(at.x + R + 28);
  $('media').style.transform = `translate(${Math.max(16, Math.min(innerWidth - 316, mx))}px, ${Math.round(at.y - 150)}px)`;
  // La scheda dell'ascolto sotto il nucleo, centrata su di lui (col report e l'ologramma è una riga in basso, centrata sullo schermo)
  const el = $('ascolto');
  largAscolto = el.offsetWidth;
  const cx = docked ? innerWidth * 0.44 : at.x;
  el.style.transform = `translateX(${Math.round(Math.max(12, cx - largAscolto / 2))}px)`;
  liberaColonne(docked || split ? null : [...RAGGI.map((r) => r.el), ...[sm, an].filter((e) => e.classList.contains('on')), ...(media ? [$('media')] : [])]);
}
// Le colonne dei bordi non passano sotto le scritte: quella di sinistra si stringe fino ai dati di sinistra («BROWSER ON ·
// AGENDA 0» ci finiva sopra), quella di destra comincia sotto stato, dati, anomalia e GIF che le stanno sopra (riempita di
// eventi arrivava fino a «MAC · SIRI PAOLO»). Gira solo quando cambia la chiave, non a ogni fotogramma.
function liberaColonne(scritte) {
  const sx = $('colonna-sx'), dx = $('colonna-dx');
  sx.style.width = ''; dx.style.top = ''; dx.style.width = '';
  if (!scritte) return; // col browser, il report o l'ologramma le colonne sono spente
  const cs = sx.getBoundingClientRect(), cd = dx.getBoundingClientRect(), asc = $('ascolto').getBoundingClientRect();
  let bordo = asc.left < cs.right + 12 ? asc.left : Infinity, sotto = cd.top;
  for (const e of scritte) {
    if (e.classList.contains('spento')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width || r.bottom < cs.top || r.top > cs.bottom) continue;
    if (r.left < cs.right + 12) bordo = Math.min(bordo, r.left);
    if (r.right > cd.left - 12) sotto = Math.max(sotto, r.bottom + 12);
  }
  // meno di quattro caratteri sarebbero una striscia di cifre tagliate: allora niente colonna
  if (bordo < Infinity) { const w = Math.floor(bordo - 12 - cs.left); sx.style.width = `${w < 30 ? 0 : w}px`; }
  if (sotto > cd.top) dx.style.top = `${Math.ceil(sotto)}px`;
  // in basso la scheda dell'ascolto: con finestre strette la colonna di destra si stringe invece di finirle sopra
  if (asc.right > cd.left - 12) dx.style.width = `${Math.max(0, Math.floor(cd.right - asc.right - 12))}px`;
}

// ---------- Stato dei sistemi (al server, per il registro: solo stati, niente audio né testo) ----------
// La risposta dice anche quanti compiti dell'agenda sono arrivati all'ora: se STEM è fermo e nessuno sta parlando, parla per primo
let micPeak = 0, ultimoStato = null, statoFalliti = 0;
async function pollStatus() {
  try {
    const q = new URLSearchParams({ hud: 1, ear: ear, lock: earLock ? 1 : 0, rec: rec ? 'ear' : '-', mic: micPeak.toFixed(3), mode: S.mode });
    micPeak = 0;
    const st = await (await fetch('/api/status?' + q)).json();
    ultimoStato = st; statoFalliti = 0; allarme('server', 0);
    if (st.agenda > 0 && S.mode === 'idle' && !S.hearing && !pending) { report('agenda: STEM parla per primo'); evento('AGENDA · PARLO PER PRIMO'); ask('', { agenda: true }); }
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

// ---------- Pannello del browser: solo per i compiti complessi (STEM lo chiede con [[mostra]]) ----------
let screenTimer = 0;
function showScreen(on) { // si chiude 15 s dopo che STEM ha finito
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
  mostra_ologramma: 'Costruisco l\'ologramma', modifica_ologramma: 'Modifico l\'ologramma', analizza_struttura: 'Calcolo gli sforzi' };
let smallTimer = 0;
function showSmall(name, detail) {
  $('small').textContent = `${SMALL_VERBS[name] || name.replace(/_/g, ' ')}${detail ? ' · ' + detail : ''}`.toUpperCase();
  $('small').classList.add('on');
  clearTimeout(smallTimer);
  smallTimer = setTimeout(() => $('small').classList.remove('on'), 6000);
}

// ---------- Report a schermo intero (STEM lo manda con lo strumento mostra_report) ----------
function openReport(r) {
  const plan = showReport(r);
  if (!plan) return closeReport(); // zero blocchi: STEM lo sta chiudendo
  chiudiOlo(); // anche l'ologramma: un report del cervello lo chiude anche nel server (server.mjs), così il cervello lo sa
  sfx?.report(plan);
  clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0; // il report prende il posto del browser
  document.body.classList.add('report'); // micro-dati e raggiera si spengono, l'ascolto diventa una riga in basso
  evento(`REPORT · ${Array.isArray(r?.blocchi) ? r.blocchi.length : 0} BLOCCHI`);
  Object.assign(S, reportDock()); S.dockTarget = 1;
}
function closeReport() { hideReport(); document.body.classList.remove('report'); if (!holo?.aperto) S.dockTarget = 0; } // con l'ologramma il nucleo resta nell'angolo
addEventListener('resize', () => { if (S.dockTarget) Object.assign(S, holo?.aperto ? dockOlo() : reportDock()); });

// ---------- Ologramma (scena.js): lo stato è del server, qui si mostra. Dall'HUD tornano solo togli, rimetti e chiudi ----------
// Modi, esploso, sezione e camera cambiano solo qui, con tastiera, mouse e mani: non tornano al server (contratto).
let OLO = null, holo = null;                       // il modulo e l'ologramma, se scena.js è partito
let holoV = 0, holoAncora = 0, holoLeggo = false;  // l'ultima versione del server letta, e una da leggere appena si può
let holoStato = null, holoLocale = false, modelloProva = 0; // locale: un ologramma di prova (?debug), senza server
const post = (url, dati) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dati) });
const sfxOlo = new Proxy({}, { get: (_, k) => (...a) => sfx?.[k]?.(...a) }); // sfx nasce più tardi, con l'audio
const dockOlo = () => { const a = OLO.angoloTesta(); return { dockX: a.dockX, dockY: a.dockY }; };

// Una versione più alta arriva dall'evento 'holo' del cervello o da /api/status: si rilegge lo stato intero, una lettura alla volta.
// Lo stato del server vince anche su un ologramma di prova.
async function rileggiOlogramma(v) {
  if (!(v > holoV)) return;
  if (!holo || holoLeggo) { holoAncora = Math.max(holoAncora, v); return; }
  holoLeggo = true;
  try {
    const st = await (await fetch('/api/ologramma', { cache: 'no-store' })).json();
    if (Number.isFinite(st?.versione) && st.versione > holoV) { holoV = st.versione; holoLocale = false; applicaOlogramma(st); }
  } catch {}
  holoLeggo = false;
  const dopo = holoAncora; holoAncora = 0;
  rileggiOlogramma(dopo);
}
function applicaOlogramma(st) {
  const prima = holo.aperto;
  holo.mostra(st); // scena.js rinormalizza tutto con forme.js e chiude se aperto non è true
  holoStato = holo.aperto ? st : null;
  if (holo.aperto && !prima) apriOlo(); else if (!holo.aperto && prima) chiusoOlo();
  allarmeOlogramma(holoStato);
}
// Aperto: il nucleo va nell'angolo come col report, report e browser lasciano il posto, le mani si accendono
let oloDa = 0; // il secondo in cui si è aperto: la misura delle mani conta da lì
function apriOlo() {
  hideReport(); document.body.classList.remove('report'); clearTimeout(screenTimer); document.body.classList.remove('browsing'); S.splitTarget = 0;
  Object.assign(S, dockOlo()); S.dockTarget = 1;
  document.body.classList.add('olo');
  oloDa = Math.floor(performance.now() / 1000); mani?.azzeraMisure();
  avviaMani();
}
function chiusoOlo() { misuraMani(); holoStato = null; holoLocale = false; document.body.classList.remove('olo'); S.dockTarget = 0; fermaMani(); allarme('calcolo', 0); }
// La regola di Tony: mani solo sopra 45 fps sul suo M2. Alla chiusura, se le mani sono state accese almeno 10 secondi interi,
// i fotogrammi di quei secondi e il tempo di MediaPipe vanno al registro del server: solo numeri, la riga la scrive lui.
// Con loro vanno le misure d'uso vero dei gesti (gesti.js, misure()): solo i numeri finiti, quelli senza campioni restano fuori.
function misuraMani() {
  const s = SECONDI.filter((x) => x.s >= oloDa && x.mani);
  if (s.length < 10 || !mani) return;
  const m = mani.misure, f = statFps(s), d = m.detect_ms.mediana;
  const gesti = Object.fromEntries(Object.entries(m.gesti || {}).filter(([k, v]) => k !== 'tremolio' && Number.isFinite(v)));
  post('/api/ologramma', { azione: 'misura', secondi: s.length, fps: { mediana: f.mediana, p10: f.p10, minimo: f.minimo }, detect_ms: d, prova: maniProva, gesti }).catch(() => {});
}
// Chiuso dall'HUD. Solo Esc lo dice al server, che al cervello scrive «Tony ha chiuso l'ologramma»: report e browser lo nascondono e basta
// La risposta porta la versione nuova; un 409 (il cervello ha già fatto un modello nuovo) porta lo stato: si rilegge e si mostra quello
const versioneDi = (d) => Number(d?.versione ?? d?.stato?.versione);
function chiudiOlo(esc = false) {
  if (!holo?.aperto) return;
  const corpo = { azione: 'chiudi', modello: holoStato?.modello }, locale = holoLocale;
  holo.chiudi(); chiusoOlo();
  if (esc && !locale) post('/api/ologramma', corpo).then((r) => r.json()).then((d) => rileggiOlogramma(versioneDi(d))).catch(() => {});
}
// Togli (il lancio con le mani) e rimetti (Z): al server, poi si rilegge; un ologramma di prova cambia qui
async function azioneOlo(azione, id) {
  const s = holoStato, tolti = Array.isArray(s?.tolti) ? s.tolti : [];
  if (!s || typeof id !== 'string') return;
  if (holoLocale) return applicaOlogramma({ ...s, versione: s.versione + 1, tolti: azione === 'togli' ? [...new Set([...tolti, id])] : tolti.filter((x) => x !== id) });
  try { rileggiOlogramma(versioneDi(await (await post('/api/ologramma', { azione, id, modello: s.modello })).json())); } catch {}
}

// Dove sta il modello lungo un asse (mm del mondo, dall'ingombro del server): il taglio parte a metà e si sposta del 2% a colpo
function asseOlo(a) {
  const g = holoStato?.ingombro_mm, c = 'xyz'.indexOf(a), lo = g?.min?.[c], hi = g?.max?.[c];
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: -1e5, hi: 1e5, centro: 0, passo: 1 }; // solo pezzi da file
  return { lo, hi, centro: (lo + hi) / 2, passo: Math.max(0.1, (hi - lo) / 50) };
}
// Tasti, solo con l'ologramma aperto. X, D e F tornano all'ologramma se il modo è già quello
const TASTI_MODO = { x: 'raggi-x', d: 'densita', f: 'sforzi', o: 'ologramma', l: 'solido' };
function tastoOlo(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false; // Cmd+R ricarica ancora l'HUD
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, freccia = k.startsWith('Arrow'), v = holo.info().vista;
  if (e.repeat && !freccia) return true; // un tasto tenuto giù non fa avanti e indietro
  if (TASTI_MODO[k]) holo.comando('modo', 'xdf'.includes(k) && v.modo === TASTI_MODO[k] ? 'ologramma' : TASTI_MODO[k]);
  else if (k === 'e') holo.comando('esploso', v.esploso > 0.5 ? 0 : 1);
  else if (k === 's') { // a giro: x, y, z, niente
    const assi = [null, 'x', 'y', 'z'], a = assi[(assi.indexOf(v.sezione?.asse ?? null) + 1) % 4];
    holo.comando('sezione', a && { asse: a, posizione: asseOlo(a).centro, verso: 1 });
  } else if (freccia) {
    if (!v.sezione) return true;
    const L = asseOlo(v.sezione.asse), d = k === 'ArrowUp' || k === 'ArrowRight' ? 1 : -1;
    holo.comando('sezione', { ...v.sezione, posizione: Math.min(L.hi, Math.max(L.lo, v.sezione.posizione + d * L.passo)) });
  } else if (k === 'r') holo.comando('reset');
  else if (k === 'm') { const on = !maniVolute(); vogliMani(on); warn(on ? 'Mani accese' : 'Mani spente'); evento(on ? 'HANDS · ON' : 'HANDS · OFF'); if (on) avviaMani(); else fermaMani(); }
  else if (k === 'z') { const t = holoStato?.tolti; if (t?.length) azioneOlo('rimetti', t[t.length - 1]); }
  else return false;
  return true;
}

// ---------- Mani: MediaPipe in locale, accese solo con l'ologramma aperto. La scelta del tasto M resta fra un avvio e l'altro ----------
let mani = null, maniPronte = null, mappaMani = null; // mappaMani: la mappa a S di gesti.js, la stessa del cursore
const maniProva = DEBUG && params.get('mani') === 'immagine'; // la foto di prova al posto della fotocamera
const maniVolute = () => { try { return localStorage.getItem('stem-mani') !== '0'; } catch { return true; } };
const vogliMani = (on) => { try { localStorage.setItem('stem-mani', on ? '1' : '0'); } catch {} };
function creaMani() { // una volta sola, anche con due aperture di fila
  maniPronte ||= (async () => {
    const [{ createMani }, { mappa }] = await Promise.all([import('./ologramma/mani.js'), import('./ologramma/gesti.js')]);
    mappaMani = mappa;
    // ?debug&mani=immagine: la foto di prova al posto della fotocamera, a 30 Hz come lei, per misurare
    const prova = maniProva ? { sorgente: 'immagine', immagine: await telaProva(), hz: 30 } : {};
    return (mani = createMani({ ...prova, onGesto: gestoMani, onMani: disegnaDita, onErrore: (e) => { warn(e.message, 'attenzione'); disegnaDita([]); faseMani('spente'); } }));
  })().catch((e) => { maniPronte = null; throw e; });
  return maniPronte;
}
async function avviaMani() {
  if (!maniVolute() || !holo?.aperto) return;
  try {
    const m = await creaMani();
    if (!holo.aperto || !maniVolute()) return;
    await m.avvia(); // se MediaPipe o la fotocamera non partono: un avviso, e l'ologramma resta col mouse
    if (!holo.aperto || !maniVolute()) fermaMani(); // chiuso, o spente col tasto M, mentre partivano
  } catch (e) { warn(String(e?.message || e), 'attenzione'); console.warn(e); }
}
function fermaMani() { mani?.ferma(); disegnaDita([]); faseMani('spente'); }
// La fase delle mani (gesti.js: 'riposo', 'pronto', 'azione'; 'spente' quando si fermano): scena.js la mostra nella barra
// e spegne il cursore a riposo, qui i pallini delle dita si fanno più tenui. Cambia di rado: nessun costo a fotogramma.
function faseMani(fase) {
  $('dita').classList.toggle('riposo', fase === 'riposo');
  holo?.gesto({ tipo: 'stato', fase });
}
function gestoMani(g) { if (g.tipo === 'stato') faseMani(g.fase); else holo.gesto(g); }
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

// ---------- GIF e animazioni accanto alla testa ----------
let mediaTimer = 0;
function showMedia(m) {
  const box = $('media'), img = $('media-img');
  img.onload = () => {
    $('media-title').textContent = (m.kind === 'anim' ? 'ESEMPIO · ' : '') + (m.title || '').toUpperCase().slice(0, 48);
    box.classList.add('on');
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(hideMedia, m.kind === 'anim' ? 16000 : 9000);
  };
  img.src = m.url;
}
function hideMedia() { $('media').classList.remove('on'); }

// ---------- Audio: una coda, una sola voce (il server decide ElevenLabs o Mac per l'intera risposta) ----------
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

const PAGE = crypto.randomUUID(); // la stessa risposta non si confonde con quelle di un HUD ricaricato
let generation = 0, queue = [], playing = false, streamDone = true, currentSource = null, ttsAbort = new AbortController();
let spokeThisAnswer = false;
// Mai più di 2 sintesi insieme: il piano di ElevenLabs ne accetta 2
let ttsActive = 0;
const ttsWaiting = [];
const ttsSlot = () => new Promise((go) => { if (ttsActive < 2) { ttsActive++; go(); } else ttsWaiting.push(go); });
const ttsFree = () => { const next = ttsWaiting.shift(); if (next) next(); else ttsActive--; };

const recentSpoken = []; // frasi davvero riprodotte di recente, con l'ora: servono a riconoscere l'eco della sua voce
function speak(text) {
  const gen = generation, signal = AbortSignal.any([ttsAbort.signal, AbortSignal.timeout(15000)]); // annullabile, e mai bloccata per sempre
  const job = ttsSlot().then(() => (gen !== generation ? null // risposta annullata: non spendo caratteri
    : fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, answer: `${PAGE}:${gen}` }), signal })
      .then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null))).finally(ttsFree);
  job.text = text;
  queue.push({ gen, job });
  if (!playing) playNext();
}
async function playNext() {
  const item = queue.shift();
  if (!item) {
    playing = false;
    if (streamDone && (S.mode === 'speaking' || S.mode === 'thinking')) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); }
    else if (!streamDone && S.mode === 'speaking') setMode('thinking'); // la frase è finita ma STEM sta ancora lavorando
    return;
  }
  playing = true;
  const data = await item.job;
  if (item.gen !== generation) return; // risposta annullata: silence() ha già azzerato tutto
  if (!data) return playNext();         // frase persa: meglio un salto che un'altra voce
  await ensureAudio();
  try {
    const audio = await ctx.decodeAudioData(data);
    if (item.gen !== generation) return;
    const src = ctx.createBufferSource();
    src.buffer = audio; src.connect(outAnalyser);
    currentSource = src;
    spokeThisAnswer = true;
    recentSpoken.push({ text: item.job.text || '', at: performance.now() + audio.duration * 1000 }); if (recentSpoken.length > 4) recentSpoken.shift();
    if (S.mode !== 'speaking') setMode('speaking');
    src.onended = () => { if (currentSource === src) currentSource = null; if (item.gen === generation) playNext(); };
    src.start();
  } catch { playNext(); }
}
function silence() {
  generation++;
  ttsAbort.abort(); ttsAbort = new AbortController(); // le sintesi della risposta vecchia liberano subito i posti
  queue = []; playing = false;
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
}

// ---------- Cervello ----------
let controller = null, lastReplyAt = -1e9, latenza = null; // latenza: secondi dalla domanda alla prima frase dell'ultima risposta
async function ask(text, { agenda = false } = {}) { // agenda: niente testo, il server prende i compiti arrivati all'ora
  silence();
  spokeThisAnswer = false; earlySent = '';
  const gen = generation, chiesto = performance.now();
  let primaFrase = true;
  controller?.abort();
  controller = new AbortController();
  setMode('thinking');
  sfx?.ack();
  streamDone = false;
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(agenda ? { agenda } : { text }), signal: controller.signal });
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
          speak(ev.s);
        }
        else if (ev.t === 'show') { evento('BROWSER · SHOW'); chiudiOlo(); closeReport(); showScreen(true); } // ricerca nuova: report e ologramma lasciano il posto al browser
        else if (ev.t === 'report') openReport(ev);
        else if (ev.t === 'holo') { evento(`HOLO · V${Number(ev.v) || 0}`); rileggiOlogramma(Number(ev.v)); }
        else if (ev.t === 'tool') { evento(`TOOL · ${String(ev.name).slice(0, 24)}`); showAction(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        else if (ev.t === 'page') $('p-host').textContent = '· ' + ev.detail;
        else if (ev.t === 'file' || ev.t === 'mac') { evento(`${ev.t === 'mac' ? 'MAC' : 'FILE'} · ${String(ev.name).slice(0, 24)}`); showSmall(ev.name, ev.detail); if (!playing) setMode('thinking'); }
        // Ricerca senza browser (WebSearch, WebFetch): un'etichetta piccola, e l'ologramma resta aperto. Dal server arriva
        // solo il tipo e, per una pagina, il nome del sito: mai le parole cercate.
        else if (ev.t === 'web') { const pagina = ev.name === 'pagina'; evento(`WEB · ${pagina ? 'PAGINA' : 'RICERCA'}`); showSmall(pagina ? 'Leggo' : 'Cerco in rete', pagina ? String(ev.detail || '').slice(0, 60) : ''); if (!playing) setMode('thinking'); }
        else if (ev.t === 'media') { evento(`MEDIA · ${ev.kind === 'anim' ? 'ANIM' : 'GIF'}`); showMedia(ev); }
        else if (ev.t === 'ignore') { evento('IGNORE'); report('frase non per STEM (ignorata dal cervello)'); lastReplyAt = -1e9; } // niente finestra di conversazione
        else if (ev.t === 'error') { evento('ERROR · CERVELLO'); allarme('cervello', 2, 'IL CERVELLO HA PERSO IL FILO', 12000); speak('Ho perso il filo, scusami. Riprova tra un attimo.'); }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') { evento('ERROR · CERVELLO IRRAGGIUNGIBILE'); allarme('cervello', 2, 'CERVELLO NON RAGGIUNGIBILE', 15000); speak('Non riesco a raggiungere il mio cervello. Il server è acceso?'); }
  } finally {
    if (gen === generation) { streamDone = true; if (!playing && queue.length === 0) { setMode('idle'); if (spokeThisAnswer) lastReplyAt = performance.now(); } }
  }
}
function interrupt() { evento('STOP'); silence(); controller?.abort(); fetch('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' } }); setMode('idle'); }

// ---------- Ascolto sempre acceso (riconoscimento locale: l'audio della stanza non esce dal Mac) ----------
// Chrome tiene un solo riconoscimento per processo: con due HUD aperti si interromperebbero. Ascolta chi ha il lucchetto.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LOCAL = { langs: ['it-IT'], processLocally: true };
let rec = null, ear = 'prep', earLock = !navigator.locks, earTimer = 0, earBackoff = 300, earFails = 0;
const EAR_TEXT = { prep: 'preparo', install: 'installo il modello italiano', click: 'clic per attivare', on: 'acceso', denied: 'microfono negato', nolocal: 'non disponibile' };
navigator.locks?.request('stem-ear', () => { earLock = true; scheduleEar(300); return new Promise(() => {}); });

const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const report = (line) => fetch('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line }) }).catch(() => {});
function lev1(a, b) { // distanza di modifica ≤ 1?
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
// Il nome è Nexus dall'11/11, scelta di Tony provata con STEM a voce (Vega era stato bocciato: 4 trascrizioni giuste su 6).
// Il vecchio «stem», con le sue storpiature, sveglia ancora per un periodo di prova chiesto da Tony: si toglie quando lo decide.
// Come «stem», «nexus» vale anche sbagliato di una lettera, tranne «lexus»: con «nesso» e «annessi» è una delle attivazioni
// per sbaglio che la prova di Tony vuole evitare (le altre due distano più di una lettera).
const NOMI = ['nexus', 'stem'];
const NOT_NAME = new Set(['item', 'step', 'stei', 'sto', 'tema', 'ste', 'lexus']); // "Ste" è un diminutivo di Stefano
// Storpiature reali del riconoscitore: "System" (locale it-IT), "Charge them" per "Ciao STEM" (memoria di STEM)
const NAME_ALIASES = new Set(['system', 'sistem', 'sistemm', 'charge']);
// "Stemma" (registro del 1/11: due richieste perse) è anche una parola vera: vale come nome solo a inizio frase o dopo un saluto
const NAME_AT_START = new Set(['stemma']);
const isName = (w) => { const n = norm(w); return n.length >= 3 && !NOT_NAME.has(n) && (NOMI.some((x) => lev1(n, x)) || NAME_ALIASES.has(n)); };
const COMMANDS = /^(apri|chiudi|cerca|trova|dimmi|dammi|fammi|mostrami|fai|crea|scrivi|leggi|leggimi|metti|ricordami|calcola|traduci|spiegami|raccontami|avvia|controlla|prepara|manda|riassumi|aiutami|puoi|potresti|sai|mi\s+(dici|fai|trovi|apri|cerchi|spieghi|racconti))\b/i;
const STOP = /^(stop|basta|zitto|fermati|aspetta|silenzio)\b/i;
const GREETING = /^(buongiorno|buon\s?giorno|buonasera|buona\s?sera|buonanotte|ciao|ehi|ehy|hey|salve|eccomi|sono\s+tornato)\b/i;
const FOLLOW_UP_MS = 25000;
// Con l'ologramma aperto Tony parla all'ologramma: un suo verbo all'inizio basta, anche da solo e anche fuori dalla
// conversazione («esplodilo», «togli il coperchio», «chiudilo»). Un falso positivo costa al massimo un pezzo tolto, che si rimette.
const COMANDI_OLO = /^(esplod|rimont|tagli|togli|rimett|chiud)/i;

// Per il registro: la prima parola e quella più simile a uno dei nomi (per scoprire come il riconoscitore storpia «nexus»,
// di cui all'11/11 non c'è ancora nessuna storpiatura vista), mai la frase
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function clue(text) {
  const words = text.trim().split(/\s+/).map(norm).filter(Boolean);
  const best = words.flatMap((w) => NOMI.map((x) => [w, x, editDistance(w, x)])).sort((p, q) => p[2] - q[2])[0];
  return `${words.length} parole; prima: "${words[0] || ''}"` + (best && best[2] <= 3 ? `; più simile a ${best[1]}: "${best[0]}" (distanza ${best[2]})` : '');
}

// È per STEM? Il nome (anche storpiato), la conversazione in corso, o un comando all'inizio della frase
function addressed(text) {
  const words = text.trim().split(/\s+/);
  const nameAt = words.findIndex((w, i) => isName(w) || (NAME_AT_START.has(norm(w)) && (i === 0 || (i === 1 && GREETING.test(words[0])))));
  if (nameAt >= 0) return { why: 'nome', text: [...words.slice(0, nameAt), ...words.slice(nameAt + 1)].join(' ').replace(/^[\s,.:;!?]+/, '').trim() || 'Ciao!' };
  if (holo?.aperto && COMANDI_OLO.test(text.trim())) return { why: 'comando', text };
  if (words.length < 2) return GREETING.test(text.trim()) ? { why: 'saluto', text } : null; // un "sì" isolato è quasi sempre per altri, un "ciao" no
  if (performance.now() - lastReplyAt < FOLLOW_UP_MS && S.mode !== 'thinking') return { why: 'conversazione', text };
  if (COMMANDS.test(text.trim())) return { why: 'comando', text };
  if (GREETING.test(text.trim()) && words.length <= 5) return { why: 'saluto', text }; // "Buongiorno!": se poi non era per lui, il cervello risponde [ignora]
  return null;
}

async function prepareEar() {
  if (!SR || typeof SR.available !== 'function') { ear = 'nolocal'; allarmeAscolto(); return; } // senza riconoscimento locale STEM non sente: è un'anomalia
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
// Eco: le ultime parole di STEM arrivano al riconoscitore anche dopo che ha smesso di parlare.
// Le scarto se arrivano entro 1,2 s dalla fine o se somigliano per più del 60% a ciò che ha appena detto.
function echoWords() { // parole dette da STEM negli ultimi 6 secondi
  const now = performance.now();
  return new Set(recentSpoken.filter((r) => now - r.at < 6000).flatMap((r) => r.text.split(/\s+/).map(norm)));
}
function isEcho(text) {
  const words = text.split(/\s+/);
  if (words.some(isName)) return false;
  const w = words.map(norm).filter((x) => x.length > 2);
  if (w.length < 1) return performance.now() - spokeUntil < 1200;
  const said = echoWords();
  const similar = w.filter((x) => said.has(x)).length / w.length > 0.6;
  return similar || (performance.now() - spokeUntil < 1200 && w.filter((x) => said.has(x)).length > 0);
}
// Mentre parla o lavora: "stop", "basta"… oppure il nome, in qualunque punto della frase, tolte le parole della sua eco
function wantsStop(text) {
  const said = echoWords();
  const mine = text.split(/\s+/).filter((x) => !said.has(norm(x)));
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
  r.onend = () => { if (rec === r) { rec = null; S.hearing = false; scheduleEar(earBackoff); } }; // Chrome chiude dopo un po' di silenzio: riparto
  try { if (debugTrack) r.start(debugTrack); else r.start(); } catch { rec = null; scheduleEar(1000); }
}

// Parole parziali: mentre parli STEM ti "guarda" (anelli e sfera); se ti fermi 0,8 s su una richiesta, parte già
function onInterim(text) {
  S.hearing = Boolean(text);
  if (!text) { ascolto.viva(''); return; }
  dbg('parziale', text, '| modo', S.mode);
  heardAt = performance.now();
  const said = echoWords();
  if ((S.mode === 'speaking' || S.mode === 'thinking') && text.split(/\s+/).some((x) => STOP.test(x) && !said.has(norm(x)))) {
    interrupt(); report('fermato a voce'); ascolto.esito('STOP', true); return; // "stop" funziona anche mentre clicca e scrive, senza aspettare la fine della frase
  }
  if (S.mode === 'speaking' || isEcho(text)) return; // mentre parla, e subito dopo, ignora l'eco della sua voce (e non la scrive)
  ascolto.viva(text);
  if (pending) clearTimeout(joinTimer); // stai ancora parlando: la frase non è finita
  clearTimeout(earlyTimer);
  const a = addressed(pending ? `${pending} ${text}` : text);
  if (!a) return;
  if (S.mode === 'idle') { setMode('listening'); sfx?.listen(); }
  earlyTimer = setTimeout(() => {
    if (a.text.split(/\s+/).length < 3 || norm(a.text) === norm(earlySent)) return;
    earlySent = a.text; report(`parto in anticipo (${a.why})`); evento(`ASK · ${a.why.toUpperCase()} · IN ANTICIPO`);
    ascolto.esito(`PER NEXUS · ${PERCHE[a.why]}`, true); ask(a.text);
  }, 800);
}

// Frase finita: decido se è per STEM, poi aspetto 0,6 s nel caso continui
function heard(text) {
  dbg('finale', text, '| modo', S.mode);
  S.hearing = false;
  clearTimeout(earlyTimer);
  if (S.mode === 'speaking' || S.mode === 'thinking') { // si può interrompere: "stop", "basta", oppure chiamandolo per nome
    if (wantsStop(text)) {
      interrupt(); report('interrotto a voce');
      const a = addressed(text), riparte = a && a.why === 'nome' && !STOP.test(a.text) && a.text.split(/\s+/).length > 1;
      ascolto.fissa(text); ascolto.esito(riparte ? `PER NEXUS · ${PERCHE.nome}` : 'STOP', true); // chiamato per nome: riparte con la frase intera, non si ferma
      if (riparte) ask(a.text);
      return;
    }
    if (S.mode === 'speaking') return;
  }
  if (isEcho(text)) { report('scartata: eco della voce di STEM'); evento('INPUT · ECO'); ascolto.viva(''); return; }
  pending = pending ? `${pending} ${text}` : text;
  ascolto.fissa(pending);
  clearTimeout(joinTimer);
  // Solo il nome ("Stem…"): aspetto di più, probabilmente stai per dire la domanda
  const onlyName = pending.trim().split(/\s+/).every(isName);
  joinTimer = setTimeout(() => {
    const full = pending; pending = '';
    const a = addressed(full);
    dbg('decido', full, '->', a ? a.why + ': ' + a.text : 'non per STEM');
    if (!a) { report(`non per STEM; ${clue(full)}`); evento('INPUT · NON PER NEXUS'); ascolto.esito('NON PER NEXUS', false); if (S.mode === 'listening') setMode('idle'); return; }
    ascolto.esito(`PER NEXUS · ${PERCHE[a.why]}`, true);
    // già partito in anticipo con lo stesso identico testo: non ricomincio; se è cambiato anche di una parola, riparto
    const sameAsEarly = earlySent && norm(a.text) === norm(earlySent);
    earlySent = '';
    if (sameAsEarly) return;
    report(`domanda (${a.why})`); evento(`ASK · ${a.why.toUpperCase()}`);
    ask(a.text);
  }, onlyName ? 2000 : 700);
}

// ---------- La scheda dell'ascolto: le parole mentre arrivano, poi cosa ne ha fatto STEM. Solo sullo schermo: mai nei registri ----------
const PERCHE = { nome: 'NOME', conversazione: 'CONVERSAZIONE', comando: 'COMANDO', saluto: 'SALUTO' };
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
  if (e.code === 'Escape') { pending = ''; earlySent = ''; interrupt(); closeReport(); chiudiOlo(true); }
  else if (holo?.aperto && tastoOlo(e)) e.preventDefault();
});
addEventListener('pointerdown', () => { ensureAudio(); if (ear !== 'on' && ear !== 'install') prepareEar(); });
// Mouse sull'ologramma, solo quando è aperto: trascina per ruotare, rotella per lo zoom, clic per scegliere, doppio clic per
// isolare. Niente stopPropagation: il pointerdown arriva lo stesso alla finestra, che sblocca l'audio.
for (const tipo of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'wheel']) $('gl').addEventListener(tipo, (e) => {
  if (!holo?.aperto) return;
  if (tipo === 'pointerdown') { try { $('gl').setPointerCapture(e.pointerId); } catch {} } // il trascinamento finisce anche fuori dalla finestra
  holo.puntatore(e);
}, { passive: tipo !== 'wheel' }); // la rotella vuole preventDefault

// livello: '' per le notizie (ciano), 'attenzione' (arancione) e 'critico' (rosso) solo per le anomalie
function warn(msg, livello = '') {
  const w = $('warn'); w.textContent = msg; w.className = livello; w.style.display = 'block';
  clearTimeout(warn.t); warn.t = setTimeout(() => { w.style.display = 'none'; }, 5000);
}

// ---------- Micro-dati ai bordi e valori a raggiera: tutti numeri veri ----------
// A sinistra lo spettro del microfono in esadecimale (della voce di STEM se il microfono non c'è), a destra gli eventi
// (solo tipi e nomi di strumenti, mai frasi), in alto ora e memoria, in basso i livelli. 8 aggiornamenti al secondo.
const EVENTI = [], RIGHE_ESA = [];
let eventiNuovi = false, indirizzo = 0x4f00, giro = 0;
const due = (n) => String(n).padStart(2, '0');
const orario = (d = new Date()) => `${due(d.getHours())}:${due(d.getMinutes())}:${due(d.getSeconds())}`;
function evento(testo) {
  EVENTI.push(`${testo.toUpperCase()}  ${orario()}`);
  if (EVENTI.length > 48) EVENTI.shift();
  eventiNuovi = true;
}
const spettro = new Uint8Array(512);
function aggiornaBordi() {
  giro++;
  const an = micAnalyser || outAnalyser;
  if (an) an.getByteFrequencyData(spettro); else spettro.fill(0);
  const b = []; // 8 bande a passo logaritmico, da 60 Hz a 8 kHz circa
  for (let k = 0; k < 8; k++) { const i0 = Math.round(1.5 * 1.9 ** k), i1 = Math.max(i0 + 1, Math.round(1.5 * 1.9 ** (k + 1))); let m = 0; for (let i = i0; i < i1 && i < 512; i++) m = Math.max(m, spettro[i]); b.push(m); }
  indirizzo = (indirizzo + 8) & 0xffff;
  const hx = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  RIGHE_ESA.push(`${hx(indirizzo >> 8)}${hx(indirizzo & 255)}  ${hx(b[0])}${hx(b[1])} ${hx(b[2])}${hx(b[3])} ${hx(b[4])}${hx(b[5])} ${hx(b[6])}${hx(b[7])}`);
  if (RIGHE_ESA.length > 60) RIGHE_ESA.shift();
  if (document.body.classList.contains('olo') || document.body.classList.contains('report')) return; // spenti: niente da scrivere
  scrivi($('esa'), RIGHE_ESA.join('\n'));
  if (eventiNuovi) { eventiNuovi = false; scrivi($('eventi'), EVENTI.join('\n')); }
  if (giro % 2) return; // il resto 4 volte al secondo
  const d = new Date(), su = Math.floor((performance.now()) / 1000);
  scrivi($('cima-ora'), `${due(d.getDate())}.${due(d.getMonth() + 1)}.${d.getFullYear()}  ${orario(d)}`);
  const heap = performance.memory ? ` · HEAP ${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '';
  scrivi($('cima-dati'), `UPTIME ${due(Math.floor(su / 3600))}:${due(Math.floor(su / 60) % 60)}:${due(su % 60)}${heap}`);
  const pct = (v) => String(Math.round(Math.min(1, Math.max(0, v)) * 100)).padStart(3, '0');
  scrivi($('fondo-sx'), `MIC ${pct(S.mic)}%  ·  VOX ${pct(S.audio)}%`);
  scrivi($('fondo-dx'), `FRAME ${nQuadri}  ·  T+${due(Math.floor(su / 3600))}:${due(Math.floor(su / 60) % 60)}:${due(su % 60)}`);
  // I valori a raggiera
  const v = ultimoStato?.voice;
  scrivi($('d-voce').lastChild, !v ? '—' : v.provider === 'eleven' ? `ELEVENLABS${Number.isFinite(v.credits) ? ` · ${v.credits.toLocaleString('it-IT')} CR` : ''}` : `MAC · ${String(v.mac || 'SISTEMA').toUpperCase().slice(0, 22)}`);
  scrivi($('d-latenza').lastChild, latenza === null ? '—' : `${latenza.toFixed(1).replace('.', ',')} S`);
  const db = micLivello > 0 ? Math.max(-60, Math.round(20 * Math.log10(micLivello))) : null;
  scrivi($('d-ascolto').lastChild, ear !== 'on' ? EAR_TEXT[ear].toUpperCase() : db === null ? 'IN ATTESA' : `${db} DB`);
  scrivi($('d-sistemi').lastChild, ultimoStato ? `BROWSER ${ultimoStato.browser ? 'ON' : 'OFF'} · AGENDA ${Number(ultimoStato.agenda) || 0}` : '—');
  const ultimo = SECONDI[SECONDI.length - 1];
  scrivi($('d-grafica').lastChild, ultimo ? `${ultimo.n} FPS` : '—');
  aggiornaAllarme(); // le cause a tempo scadono anche se nessuno le tocca
}

// La fila di trattini della scheda dell'ascolto: il microfono in 24 bande, a ogni fotogramma (solo trasformazioni)
const TRATTI = Array.from({ length: 24 }, () => $('livello').appendChild(document.createElement('i')));
const bande = new Uint8Array(512);
function disegnaLivello() {
  if (!micAnalyser || document.body.classList.contains('olo') || document.body.classList.contains('report')) return;
  micAnalyser.getByteFrequencyData(bande);
  for (let k = 0; k < 24; k++) {
    const i0 = 2 + Math.round(k * k * 0.42), i1 = 3 + Math.round((k + 1) * (k + 1) * 0.42);
    let m = 0; for (let i = i0; i < i1 && i < 512; i++) m = Math.max(m, bande[i]);
    const h = Math.max(0.12, Math.min(1, (m - 70) / 140));
    const t = TRATTI[k], s = h.toFixed(2);
    if (t.dataset.s !== s) { t.dataset.s = s; t.style.transform = `scaleY(${s})`; }
  }
}

// ---------- Avvio ----------
// Prove senza microfono e senza ricerca: stemSente è una frase finita e stemParziale una parziale, come dal riconoscimento;
// stemAllarme(causa, livello, testo, ms) accende un'anomalia finta
if (DEBUG) { window.stemAsk = ask; window.stemReport = openReport; window.stemSente = heard; window.stemParziale = onInterim; window.stemAllarme = allarme; window.stemNome = isName; }
if (DEBUG && params.get('wav')) await loadDebugTrack(params.get('wav'));
prepareEar();
const [{ createScene, TIMING }, modOlo] = await Promise.all([import('./nucleo.js'),
  import('./ologramma/scena.js').catch((e) => { console.warn('ologramma non disponibile', e); return null; })]);
const scene = await createScene($('gl'), S);
// Se il Mac fa perdere il contesto grafico (sospensione, GPU riavviata) i campi precalcolati vanno rifatti: ricarico l'HUD
$('gl').addEventListener('webglcontextlost', (e) => e.preventDefault());
$('gl').addEventListener('webglcontextrestored', () => location.reload());
// L'ologramma disegna nello stesso renderer, prima del bagliore (strato di nucleo.js). Se non parte, l'HUD va avanti senza
try {
  holo = modOlo?.createOlogramma({ renderer: scene.renderer, strato: scene.strato, contenitore: $('holo'), sfx: sfxOlo,
    onTogli: (id) => azioneOlo('togli', id),
    onFoto: (png, versione, modello) => { if (!holoLocale) post('/api/ologramma/foto', { modello, versione, png }).catch(() => {}); } }) || null;
  OLO = modOlo;
} catch (e) { console.warn('ologramma non disponibile', e); holo = null; }
rileggiOlogramma(holoAncora); // una versione vista da /api/status prima che la scena fosse pronta
if (DEBUG && holo) {
  window.stemOlo = holo; // per le prove: info(), comando(), gesto()
  window.stemOlogramma = (st) => { holoLocale = true; applicaOlogramma(st); if (!holo.aperto) holoLocale = false; return holo.info(); };
  window.stemOlogrammaDemo = async (nome = 'turbofan') => { // lo stato come lo farebbe ologramma.mjs, senza server
    const [{ DEMO_TURBOFAN, DEMO_STAFFA }, F] = await Promise.all([import('./ologramma/demo.js'), import('./ologramma/forme.js')]);
    const r = F.normalizzaModello(structuredClone(nome === 'staffa' ? DEMO_STAFFA : DEMO_TURBOFAN));
    if (!r.modello) throw new Error(r.errori.slice(0, 3).join('; '));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const g of r.modello.pezzi.map(F.ingombro)) if (g) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], g.min[c]); max[c] = Math.max(max[c], g.max[c]); }
    return window.stemOlogramma({ aperto: true, modello: --modelloProva, versione: 1, ...r.modello, tolti: [], massa_kg: null,
      ingombro_mm: min[0] <= max[0] ? { min, max } : null, analisi: null });
  };
}
const freeze = params.get('t'); // ?t=3 ferma la formazione a 3 secondi (per le prove)
const t0 = performance.now();
let last = t0, revealed = false;
ensureAudio().then(() => { if (!freeze) sfx?.boot(); });
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
  return { fotogrammi: nQuadri, fps: { ...statFps(ultimi), conti: ultimi.map((x) => x.n) }, ologramma: !!holo?.aperto, mani: mani ? { attive: mani.attivo, ...mani.misure } : null };
} });
let lastActive = 0, skip = false;
function loop(now) {
  requestAnimationFrame(loop);
  // In attesa e senza nessuno che parla da 20 s: 20 fotogrammi al secondo bastano, la GPU (e la batteria) ringraziano.
  // L'ologramma aperto conta come attività: a metà frequenza mani, rotazione e foto andrebbero a scatti.
  if (booting || S.mode !== 'idle' || S.hearing || S.split > 0.01 || $('media').classList.contains('on') || holo?.aperto) lastActive = now;
  if (now - lastActive > 20000) { skip = !skip; if (skip || now - last < 45) return; }
  contaQuadro(now);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = freeze ? Number(freeze) : (now - t0) / 1000;
  if (!revealed && t >= TIMING.reveal) { revealed = true; if (!freeze) sfx?.reveal(); }
  if (booting && t >= TIMING.ready) { booting = false; document.body.classList.add('ready'); }
  const out = outAnalyser && currentSource ? Math.min(1, rms(outAnalyser) * 4.5) : 0;
  S.audio += (out - S.audio) * Math.min(1, dt * 18);
  micLivello = micAnalyser ? rms(micAnalyser) : 0; micPeak = Math.max(micPeak, micLivello);
  const mic = micAnalyser && S.mode !== 'speaking' ? Math.min(1, micLivello * 6) : 0;
  S.mic += (mic - S.mic) * Math.min(1, dt * 18);
  disegnaLivello();
  if (S.mode === 'listening' && !S.hearing && !pending && performance.now() - heardAt > 4000) setMode('idle');
  S.split += (S.splitTarget - S.split) * Math.min(1, dt * 2.5);
  S.dock += (S.dockTarget - S.dock) * Math.min(1, dt * 6); // nell'angolo in mezzo secondo: prima che atterri il protagonista
  holo?.fotogramma(t, dt);
  scene.frame(t, ((now - t0) / 1000) % 3600, dt); // orologio che riparte ogni ora: in float32 resta preciso anche dopo giorni
  holo?.dopoRender(); // nello stesso fotogramma: la foto legge il canvas prima che il buffer si svuoti
  disegnaAttorno(t, scene.anchor());
}
requestAnimationFrame(loop);
setInterval(aggiornaBordi, 125); // dopo la scena: usa i fotogrammi contati
