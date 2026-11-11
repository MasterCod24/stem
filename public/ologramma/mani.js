// Le mani: fotocamera (o un'immagine di prova) → MediaPipe HandLandmarker 0.10.35 in locale → gesti.js.
// MediaPipe si carica solo in avvia(), con un import dinamico: l'HUD non paga 11 MB di wasm finché le mani sono spente,
// e Node può importare questo file per leggere MODELLO_MANI, con cui il server controlla il modello che serve.
// La fotocamera è accesa solo fra avvia() e ferma(), e i suoi fotogrammi non escono dalla pagina. Il rilevatore invece
// resta fra un'apertura e l'altra: ricrearlo voleva dire riscaricare 19,3 MB, un blocco di 150–250 ms durante l'entrata del
// modello e uno <script> in più ogni volta (revisione del 7/11). Si chiude solo quando si guasta, e si rifà all'avvio dopo.
import { createGesti } from './gesti.js';

export const MEDIAPIPE = Object.freeze({ versione: '0.10.35', bundle: '/mediapipe/vision_bundle.mjs', wasm: '/mediapipe/wasm' });
export const MODELLO_MANI = Object.freeze({
  url: '/modelli/hand_landmarker.task',
  byte: 7819105,
  sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  origine: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
});
const CAMPIONI = 2400; // tempi di detectForVideo tenuti per mediana, p90 e massimo: 40 s a 60 Hz

const dimensioni = (f) => [f.videoWidth || f.naturalWidth || f.displayWidth || f.width, f.videoHeight || f.naturalHeight || f.displayHeight || f.height];

// MediaPipe dà il lato supponendo un'immagine già specchiata, come un selfie (documentazione di MediaPipe Hands); la
// nostra non lo è, quindi si scambia: 'Right' vuol dire la mano destra di chi sta davanti alla fotocamera, vista dal
// palmo. Provato solo in parte: su prova-mani.jpg, due destre viste dal dorso, MediaPipe dice 'Right', e col dorso la
// regola si inverte. gesti.js usa il lato solo per riconoscere le mani fra un fotogramma e l'altro.
// Le x si specchiano perché lo schermo fa da specchio.
function converti(ris) {
  const out = [], L = ris?.landmarks || [];
  for (let i = 0; i < L.length; i++) {
    if (!Array.isArray(L[i]) || L[i].length !== 21) continue;
    const nome = ris.handedness?.[i]?.[0]?.categoryName;
    out.push({ lato: nome === 'Left' ? 'Right' : nome === 'Right' ? 'Left' : null, punti: L[i].map((q) => ({ x: 1 - q.x, y: q.y, z: q.z })) });
  }
  return out;
}

// onMani(mani, risultato) a ogni rilevazione, onGesto(g) per ogni gesto, onErrore(err) se MediaPipe si ferma a metà.
// sorgente 'immagine': detectForVideo sull'immagine data (img, canvas, ImageBitmap) a ogni fotogramma della pagina,
// o hz volte al secondo; serve alle prove e alla misura. delegato 'GPU' ripiega sulla CPU se la GPU non parte.
export function createMani({ onGesto, onMani, onErrore, sorgente = 'camera', immagine = null, delegato = 'GPU', hz = 0, gesti: opzioniGesti } = {}) {
  if (sorgente !== 'camera' && sorgente !== 'immagine') throw new Error("mani: la sorgente è 'camera' o 'immagine'");
  if (delegato !== 'GPU' && delegato !== 'CPU') throw new Error("mani: il delegato è 'GPU' o 'CPU'");
  hz = typeof hz === 'number' && Number.isFinite(hz) && hz > 0 ? hz : 0;
  createGesti(opzioniGesti); // opzioni sbagliate: l'errore arriva qui, non a metà avvio
  let attivo = false, avvio = null, gen = 0, giro = 0, rilevatore = null, flusso = null, video = null, fonte = null, gesti = null;
  let usato = null, errore = null, avvioMs = null, primoMs = null, nMani = 0, ultimoT = 0, ultimoVideo = -1, ultimaRil = -Infinity, altezza = 0, aspetto = 0;
  const tempi = new Float64Array(CAMPIONI), quadri = [], rilevati = [];
  let nTempi = 0;

  const crea = (mp, fileset, d, modello) => mp.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: modello, delegate: d },
    runningMode: 'VIDEO', numHands: 2,
  });

  // Dove si è fermato l'avvio, per il messaggio d'errore: un avvio alla volta (avvia() aspetta quello in corso)
  let passo = '';
  async function parti(mio) {
    const t0 = performance.now();
    try {
      if (!rilevatore) await creaRilevatore();
      if (mio !== gen) return; // ferma() è arrivato durante l'avvio: il rilevatore resta per la prossima volta
      if (sorgente === 'camera') {
        passo = 'la fotocamera non si accende';
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia non c\'è');
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        if (mio !== gen) { for (const t of s.getTracks()) t.stop(); return; }
        flusso = s;
        video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.srcObject = s;
        // dentro la pagina e grande 2 px: un video staccato o fuori vista Chrome può metterlo in pausa
        video.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none';
        document.body.appendChild(video);
        await video.play();
        if (mio !== gen) return;
        fonte = video;
      } else {
        passo = "con la sorgente 'immagine' serve un'immagine";
        fonte = immagine;
        if (!fonte) throw new Error('immagine mancante');
      }
      const [w, h] = dimensioni(fonte);
      passo = 'la sorgente non ha dimensioni';
      if (!(w > 0 && h > 0)) throw new Error(`${w}×${h}`);
      // gesti.js resta fra un avvio e l'altro, così le sue misure contano tutta l'apertura dell'ologramma anche se Tony
      // spegne e riaccende le mani col tasto M; si rifà solo se cambiano le proporzioni dell'immagine
      if (!gesti || altezza !== h || aspetto !== w / h) gesti = createGesti({ ...opzioniGesti, aspetto: w / h });
      altezza = h; aspetto = w / h;
      attivo = true; avvioMs = performance.now() - t0;
      // la fase di partenza ('riposo') subito, senza aspettare la prima rilevazione: l'HUD dice cosa fare appena le mani partono
      for (const g of gesti.aggiorna([], (ultimoT = Math.max(performance.now(), ultimoT + 0.01)))) onGesto?.(g);
      giro = requestAnimationFrame(fotogramma);
    } catch (e) {
      const messaggio = `mani: ${passo} (${e?.message || e})`;
      if (mio === gen) { spegni(); errore = messaggio; } // un avvio già annullato non tocca quello nuovo
      throw new Error(messaggio, { cause: e });
    }
  }

  // MediaPipe, il wasm, il modello e il rilevatore: una volta sola, finché non si guasta.
  async function creaRilevatore() {
    passo = `MediaPipe non si carica da ${MEDIAPIPE.bundle}`;
    const mp = await import(MEDIAPIPE.bundle);
    passo = 'il wasm di MediaPipe non parte';
    const fileset = await mp.FilesetResolver.forVisionTasks(MEDIAPIPE.wasm);
    // il modello lo scarica mani.js, una volta: così un errore di rete non sembra un guasto della GPU
    passo = `il modello ${MODELLO_MANI.url} non si scarica`;
    const risposta = await fetch(MODELLO_MANI.url);
    if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
    const modello = new Uint8Array(await risposta.arrayBuffer());
    if (modello.length !== MODELLO_MANI.byte) throw new Error(`${modello.length} B invece di ${MODELLO_MANI.byte}`);
    passo = 'il rilevatore delle mani non parte';
    let r, d = delegato;
    try { r = await crea(mp, fileset, d, modello); }
    catch (e) {
      if (d !== 'GPU') throw e;
      console.warn('[mani] la GPU non parte, provo la CPU:', e);
      r = await crea(mp, fileset, (d = 'CPU'), modello);
    }
    if (rilevatore) r.close(); // due avvii accavallati (ferma e avvia durante la creazione): ne basta uno
    else { rilevatore = r; usato = d; }
  }

  function fotogramma(ora) {
    if (!attivo) return;
    giro = requestAnimationFrame(fotogramma);
    quadri.push(ora);
    while (quadri[0] < ora - 1000) quadri.shift();
    if (video) { // solo i fotogrammi nuovi della fotocamera
      if (video.readyState < 2 || video.currentTime === ultimoVideo) return;
      ultimoVideo = video.currentTime;
    } else if (hz && ora - ultimaRil < 1000 / hz - 4) return;
    ultimaRil = ora;
    const t = (ultimoT = Math.max(ora, ultimoT + 0.01)); // MediaPipe vuole tempi crescenti
    let ris;
    const a = performance.now();
    try { ris = rilevatore.detectForVideo(fonte, t); } catch (e) { guasto(e); return; }
    const ms = performance.now() - a;
    if (primoMs === null) primoMs = ms; // il primo compila gli shader: si tiene a parte
    else tempi[nTempi++ % CAMPIONI] = ms;
    rilevati.push(ora);
    while (rilevati[0] < ora - 1000) rilevati.shift();
    const mani = converti(ris);
    nMani = mani.length;
    onMani?.(mani, ris);
    for (const g of gesti.aggiorna(mani, t)) onGesto?.(g);
  }

  function guasto(e) {
    console.warn('[mani]', e);
    ferma();
    try { rilevatore?.close(); } catch { /* già chiuso */ }
    rilevatore = null; // rotto: il prossimo avvio ne crea uno nuovo
    errore = `mani: MediaPipe si è fermato (${e?.message || e})`;
    onErrore?.(new Error(errore, { cause: e }));
  }

  function spegni() { // fotocamera e video; gesti.js dimentica le mani ma tiene le misure; il rilevatore resta
    attivo = false;
    if (flusso) for (const t of flusso.getTracks()) t.stop();
    if (video) { video.pause(); video.srcObject = null; video.remove(); }
    gesti?.azzera();
    flusso = video = fonte = null;
    nMani = 0; ultimoVideo = -1;
  }

  function avvia() {
    if (attivo) return Promise.resolve();
    if (!avvio) {
      errore = null;
      const p = parti(++gen), fine = () => { if (avvio === p) avvio = null; };
      avvio = p;
      p.then(fine, fine);
    }
    return avvio;
  }

  function ferma() {
    gen++; avvio = null;
    if (giro) cancelAnimationFrame(giro);
    giro = 0;
    spegni();
  }

  // gesti: le misure d'uso vero di gesti.js da azzeraMisure() (null se le mani non sono mai partite), col tremolio anche in
  // pixel della fotocamera
  function misure() {
    const n = Math.min(nTempi, CAMPIONI), v = Array.from(tempi.subarray(0, n)).sort((a, b) => a - b);
    const q = (p) => (n ? +v[Math.min(n - 1, Math.floor(p * n))].toFixed(2) : null);
    const g = gesti?.misure();
    return {
      delegato: usato, mani: nMani, rilevazioni: nTempi, detect_ms: { mediana: q(0.5), p90: q(0.9), massimo: q(1), primo: primoMs === null ? null : +primoMs.toFixed(1) },
      fps: quadri.length, rilevazioni_s: rilevati.length, avvio_ms: avvioMs === null ? null : Math.round(avvioMs), errore,
      gesti: g ? { ...g, tremolio_px: g.tremolio === null ? null : g.tremolio * altezza } : null,
    };
  }

  return {
    avvia, ferma, get attivo() { return attivo; }, get misure() { return misure(); },
    azzeraMisure() { nTempi = 0; gesti?.azzeraMisure(); }, // per misurare a regime, dopo che gli shader sono compilati, e a ogni apertura
  };
}
