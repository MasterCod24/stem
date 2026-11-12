// Nexus — la vista meteo a schermo intero: radar al centro, vento e pressione a sinistra, profilo termico a destra, avvisi e
// condizioni per spostarsi sotto, timeline in basso. I dati arrivano dal server (meteo.mjs, evento 'meteo'), il radar da
// RainViewer (radar.js). Una linea del tempo sola comanda tutto: scorrendola (mani, mouse, frecce) i moduli mostrano il tempo a
// quell'ora e il radar la mappa di quell'ora, se è nelle ultime due. Ad «adesso» il radar gira sulle ultime due ore.
// Le mani: pizzico e trascina sul radar per spostarlo, altrove per scorrere il tempo; due pizzichi per lo zoom del radar;
// un pizzico breve sceglie l'ora sulla timeline, rimette il radar al centro o torna ad adesso; prendi e lancia per chiudere.
// Tutto il testo entra con textContent: nomi dei luoghi e numeri arrivano da fuori.
import { analizza, valoriA, condizioniA, beaufort, bussola, num, oraDi, durata, CODICI, SOGLIE, H, Q } from './dati.js';
import { createRadar, BANDE } from './radar.js';

const PRIMA_MS = 2 * H, DOPO_MS = 12 * H; // la timeline: due ore indietro (le mappe del radar), dodici avanti (il modello)
const T_MIN = -10, T_MAX = 40;            // la scala delle temperature, la stessa per aria, percepita e rugiada
const SEG = 30, SEG_O = 20;               // segmenti delle barre del profilo termico e dell'operatività

const CSS = `
#meteo { position: absolute; inset: 0; z-index: 3; display: none; pointer-events: none; color: var(--testo); }
#meteo.on { display: block; }
#meteo.via { opacity: 0; filter: blur(8px); transform: scale(.97); transition: opacity .45s ease-in, filter .45s, transform .45s; }
#meteo .m-top { position: absolute; left: 2.2vw; right: 2.2vw; top: 2.2vh; display: flex; justify-content: space-between; align-items: baseline; gap: 2vw;
  white-space: nowrap; text-transform: uppercase; animation: m-entra .5s ease-out .3s both; }
#meteo .m-titolo { overflow: hidden; text-overflow: ellipsis; font: 200 15px/1.2 var(--sottile); letter-spacing: .26em; color: var(--ciano-vivo); text-shadow: var(--bagliore); }
#meteo .m-top small { font: 400 9.5px/1 var(--mono); letter-spacing: .2em; color: var(--ciano); text-shadow: var(--bagliore); }
#meteo .m-griglia { position: absolute; left: 2.2vw; right: 2.2vw; top: 6vh; bottom: 2.6vh; display: grid; gap: 14px;
  grid-template-columns: minmax(250px, 23fr) 54fr minmax(250px, 23fr); grid-template-rows: 54fr 40fr 33fr; }
#meteo .m-mod { position: relative; min-width: 0; min-height: 0; overflow: hidden; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px;
  background: linear-gradient(160deg, rgba(62, 230, 255, .085), rgba(0, 18, 26, .5) 40%, rgba(0, 10, 16, .55));
  box-shadow: inset 0 1px 0 rgba(62, 230, 255, .35), inset 0 0 22px rgba(62, 230, 255, .05); transition: box-shadow .25s;
  animation: m-entra .6s cubic-bezier(.16, .84, .24, 1) both; animation-delay: var(--d, 0s); }
@keyframes m-entra { from { opacity: 0; transform: translate3d(0, 18px, 0) scale(.97); filter: blur(10px); } }
#meteo .m-mod.mira { box-shadow: inset 0 1px 0 rgba(182, 248, 255, .8), inset 0 0 34px rgba(62, 230, 255, .18); }
#meteo header { display: flex; justify-content: space-between; gap: 10px; flex: none; font: 400 8px/1.2 var(--mono); letter-spacing: .16em;
  color: var(--testo-2); text-transform: uppercase; white-space: nowrap; }
#meteo header span { overflow: hidden; text-overflow: ellipsis; }
#meteo header b { font-weight: 400; color: var(--ciano); text-shadow: var(--bagliore); }
#meteo .m-vento { grid-area: 1 / 1; } #meteo .m-oper { grid-area: 2 / 1; } #meteo .m-radar { grid-area: 1 / 2 / 3 / 3; }
#meteo .m-termico { grid-area: 1 / 3; } #meteo .m-linea { grid-area: 3 / 1 / 4 / 3; }
#meteo .m-avvisi { grid-area: 2 / 3; margin-bottom: 24px; } /* sopra al nucleo restano stato, strumento e anomalia */
#meteo .m-dock { grid-area: 3 / 3; visibility: hidden; }
#meteo .m-big { font: 100 clamp(30px, 2.8vw, 48px)/1 var(--sottile); color: #fff; text-shadow: 0 0 18px rgba(150, 240, 255, .55); white-space: nowrap; }
#meteo .m-big small { margin-left: 6px; font: 400 9px/1 var(--mono); letter-spacing: .18em; color: var(--testo-2); text-shadow: none; }
#meteo .m-riga { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font: 400 8.5px/1.3 var(--mono); letter-spacing: .14em;
  color: var(--testo-2); text-transform: uppercase; white-space: nowrap; }
#meteo .m-riga b { font: 300 13px/1 var(--sottile); letter-spacing: .06em; color: #fff; text-shadow: 0 0 10px rgba(160, 240, 255, .35); }
#meteo .m-nota { font: 400 7.5px/1.45 var(--mono); letter-spacing: .1em; color: var(--testo-2); opacity: .8; text-transform: uppercase; }

/* radar: un cerchio con la scansione che gira (solo trasformazioni, la fa il compositore) */
#meteo .m-radar { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 6px; padding: 0; overflow: visible;
  background: none; box-shadow: none; }
#meteo .m-radar header { width: 100%; }
#meteo .m-cerchio { position: relative; flex: none; border-radius: 50%; overflow: hidden; pointer-events: auto; cursor: grab; touch-action: none;
  background: radial-gradient(circle, rgba(0, 30, 40, .5), rgba(0, 12, 18, .72) 70%, rgba(0, 6, 10, .85));
  box-shadow: 0 0 0 1px rgba(62, 230, 255, .35), 0 0 46px rgba(62, 230, 255, .13), inset 0 0 60px rgba(62, 230, 255, .08); }
#meteo .m-cerchio:active { cursor: grabbing; }
#meteo .m-cerchio canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#meteo .m-scan { position: absolute; inset: 0; border-radius: 50%; mix-blend-mode: screen; pointer-events: none;
  background: conic-gradient(from 0deg, rgba(62, 230, 255, 0) 0deg 285deg, rgba(62, 230, 255, .07) 325deg, rgba(62, 230, 255, .3) 357deg,
    rgba(215, 252, 255, .95) 359.3deg, rgba(62, 230, 255, 0) 360deg);
  animation: m-giro 4s linear infinite; }
#meteo .m-cerchio.fermo .m-scan { animation-play-state: paused; opacity: .35; }
@keyframes m-giro { to { transform: rotate(1turn); } }
#meteo .m-legenda { display: flex; gap: 2px; align-items: center; }
#meteo .m-legenda i { width: 16px; height: 5px; }
#meteo .m-r-piede { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px; }

/* vento */
#meteo .m-v-corpo { flex: 1; min-height: 0; display: flex; align-items: center; gap: 12px; }
#meteo .m-rosa { position: relative; flex: none; width: min(58%, 190px); aspect-ratio: 1; }
#meteo .m-rosa svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
#meteo .m-flusso { position: absolute; inset: 18%; border-radius: 50%; overflow: hidden; }
#meteo .m-giro-f { position: absolute; inset: -50%; transition: transform .8s cubic-bezier(.2, .8, .2, 1); }
#meteo .m-strisce { position: absolute; top: 0; bottom: 0; left: calc(-1 * var(--passo, 48px)); right: 0; background-size: 48px 32px;
  animation: m-scorri var(--durata, 2s) linear infinite; }
@keyframes m-scorri { to { transform: translateX(var(--passo, 48px)); } }
#meteo .m-ago { transition: transform .8s cubic-bezier(.2, .8, .2, 1); transform-origin: 100px 100px; }
#meteo .m-v-num { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 9px; }
#meteo .m-press { flex: none; display: flex; flex-direction: column; gap: 5px; }
#meteo .m-press svg { width: 100%; height: 34px; overflow: visible; }

/* barre a segmenti */
#meteo .m-barra { display: flex; gap: 2px; height: 7px; }
#meteo .m-barra i { flex: 1; background: rgba(62, 230, 255, .1); }
#meteo .m-barra.sottile { height: 4px; }
#meteo .m-o-fattori { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
#meteo .m-o-fattori .m-riga b { font-size: 11px; }
#meteo .m-barra i.on { background: rgba(62, 230, 255, .62); box-shadow: 0 0 4px rgba(62, 230, 255, .45); }
#meteo .m-barra i.punta { background: #d2fbff; box-shadow: 0 0 8px rgba(182, 248, 255, .95); }
#meteo .m-t-righe { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: space-around; gap: 6px; }
#meteo .m-t-riga { display: flex; flex-direction: column; gap: 5px; }
#meteo .m-scala { display: flex; justify-content: space-between; font: 400 7px/1 var(--mono); letter-spacing: .12em; color: var(--testo-2); opacity: .7; }

/* avvisi: arancione e rosso solo qui, come le anomalie dell'HUD; il primo lampeggia */
#meteo .m-a-lista { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 6px; overflow: hidden; }
#meteo .m-avviso { flex: none; padding: 6px 9px; border: 1px solid currentColor; color: var(--arancio); background: rgba(255, 155, 51, .07);
  box-shadow: 0 0 14px rgba(255, 155, 51, .18), inset 0 0 14px rgba(255, 155, 51, .08); }
#meteo .m-avviso.l2 { color: var(--rosso); background: rgba(255, 67, 67, .08); box-shadow: 0 0 16px rgba(255, 67, 67, .25), inset 0 0 14px rgba(255, 67, 67, .1); }
#meteo .m-avviso.primo { animation: m-lampo 1.3s steps(2) infinite; }
#meteo .m-avviso.l2.primo { animation-duration: .8s; }
@keyframes m-lampo { 50% { border-color: transparent; box-shadow: none; background: none; } }
#meteo .m-avviso b { display: block; font: 400 8.5px/1 var(--mono); letter-spacing: .22em; text-shadow: 0 0 8px currentColor; }
#meteo .m-avviso p { margin-top: 4px; font: 300 11px/1.3 var(--sottile); letter-spacing: .05em; text-transform: uppercase; color: #fff; }
#meteo .m-avviso small { display: block; margin-top: 4px; font: 400 7.5px/1.3 var(--mono); letter-spacing: .12em; text-transform: uppercase; opacity: .9; }
#meteo .m-calmo { font: 300 12px/1.4 var(--sottile); letter-spacing: .06em; text-transform: uppercase; color: var(--testo-2); }

/* timeline */
#meteo .m-l-frase { font: 300 clamp(12px, 1.05vw, 16px)/1.1 var(--sottile); letter-spacing: .1em; color: var(--ciano-vivo); text-shadow: var(--bagliore); }
#meteo .m-l-area { position: relative; flex: 1; min-height: 0; pointer-events: auto; cursor: ew-resize; touch-action: none; }
#meteo .m-l-area canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#meteo .m-l-cur { position: absolute; top: 0; bottom: 0; left: 0; width: 0; opacity: 0; transition: opacity .2s; pointer-events: none; }
#meteo .m-l-cur.on { opacity: 1; }
#meteo .m-l-cur i { position: absolute; top: 0; bottom: 14px; left: -1px; width: 2px; background: #d2fbff; box-shadow: 0 0 10px rgba(182, 248, 255, .95); }
#meteo .m-l-cur span { position: absolute; top: -2px; left: 8px; padding: 3px 6px; white-space: nowrap; font: 400 8.5px/1.2 var(--mono); letter-spacing: .12em;
  color: #fff; background: rgba(0, 20, 28, .85); box-shadow: inset 0 0 0 1px rgba(62, 230, 255, .4); }
#meteo .m-l-cur.sx span { left: auto; right: 8px; }

#meteo .m-cur { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 1px solid var(--ciano-vivo); border-radius: 50%;
  box-shadow: 0 0 10px rgba(62, 230, 255, .6); opacity: 0; transition: opacity .2s; z-index: 2; }
#meteo .m-cur.on { opacity: 1; }
#meteo .m-cur.presa { background: rgba(62, 230, 255, .22); }
#meteo .m-cur.azione { box-shadow: 0 0 14px rgba(62, 230, 255, .95); }
`;

// Solo struttura, niente dati: i testi li scrive textContent
const SCHELETRO = `
<div class="m-top"><span class="m-titolo"></span><small class="m-sotto"></small></div>
<div class="m-griglia">
  <section class="m-mod m-radar" style="--d:.05s">
    <header><span>RADAR // <b>RIFLETTIVITÀ · RAINVIEWER</b></span><span class="m-r-ora"></span></header>
    <div class="m-cerchio"><canvas class="m-eco"></canvas><canvas class="m-base"></canvas><div class="m-scan"></div></div>
    <div class="m-r-piede"><span class="m-riga m-r-eco"></span><span class="m-riga"><span>10</span><span class="m-legenda"></span><span>50+ DBZ</span></span></div>
  </section>
  <section class="m-mod m-vento staffe" style="--d:.15s">
    <header><span>VENTO // <b class="m-v-dir"></b></span><span class="m-v-bf"></span></header>
    <div class="m-v-corpo">
      <div class="m-rosa"><div class="m-flusso"><div class="m-giro-f"><div class="m-strisce"></div></div></div><svg viewBox="0 0 200 200"></svg></div>
      <div class="m-v-num"><div class="m-big"><span class="m-v-kmh"></span><small>KM/H</small></div>
        <div class="m-riga">RAFFICHE <b class="m-v-raff"></b></div><div class="m-riga">DIREZIONE <b class="m-v-gradi"></b></div></div>
    </div>
    <div class="m-press"><div class="m-riga">PRESSIONE <b class="m-p-hpa"></b></div><div class="m-riga"><span class="m-p-tend"></span></div>
      <svg viewBox="0 0 200 34" preserveAspectRatio="none"><polyline class="m-p-linea" fill="none" stroke="rgba(182,248,255,.85)" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
        <line class="m-p-ora" y1="0" y2="34" stroke="rgba(62,230,255,.6)" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
        <line class="m-p-cur" y1="0" y2="34" stroke="#d2fbff" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0"/></svg></div>
  </section>
  <section class="m-mod m-oper staffe" style="--d:.35s">
    <header><span>OPERATIVITÀ</span><span class="m-o-giud"></span></header>
    <div class="m-riga">CONDIZIONI DI SPOSTAMENTO <b class="m-o-cond"></b></div><div class="m-barra m-o-bcond"></div>
    <div class="m-o-fattori"></div>
    <div class="m-nota">VALE IL FATTORE PEGGIORE · VISIBILITÀ: LA PARTE DEI 10 KM DEL METAR · VENTO: 0% CON RAFFICHE DA 62 KM/H (BEAUFORT 8) · PIOGGIA: 0% DA 8 MM/H</div>
  </section>
  <section class="m-mod m-termico staffe" style="--d:.25s">
    <header><span>PROFILO TERMICO // <b class="m-t-cielo"></b></span></header>
    <div class="m-t-righe"></div>
    <div class="m-scala"><span>−10 °C</span><span>15</span><span>40 °C</span></div>
    <div class="m-riga m-t-scarto"></div>
  </section>
  <section class="m-mod m-avvisi staffe" style="--d:.45s">
    <header><span>AVVISI // <b>PROSSIME 12 H</b></span><span class="m-a-n"></span></header>
    <div class="m-a-lista"></div>
  </section>
  <section class="m-mod m-linea staffe" style="--d:.55s">
    <header><span class="m-l-frase"></span><span class="m-l-scala">MM/H · °C · ORA DEL POSTO</span></header>
    <div class="m-l-area"><canvas></canvas><div class="m-l-cur"><i></i><span></span></div></div>
  </section>
  <i class="m-dock"></i>
</div>
<i class="m-cur"></i>`;

function rosa() { // la rosa dei venti: anello, tacche ogni 5°, punti cardinali e l'ago (punta dove va il vento)
  const t = [];
  for (let g = 0; g < 360; g += 5) {
    const a = (g * Math.PI) / 180, l = g % 45 ? 4 : 10, s = Math.sin(a), c = -Math.cos(a);
    t.push(`<line x1="${(100 + s * 96).toFixed(1)}" y1="${(100 + c * 96).toFixed(1)}" x2="${(100 + s * (96 - l)).toFixed(1)}" y2="${(100 + c * (96 - l)).toFixed(1)}"
      stroke="${g % 45 ? 'rgba(62,230,255,.35)' : 'rgba(182,248,255,.9)'}" stroke-width="${g % 90 ? 1 : 1.6}"/>`);
  }
  const nomi = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]].map(([n, g]) => {
    const a = (g * Math.PI) / 180;
    return `<text x="${(100 + Math.sin(a) * 75).toFixed(1)}" y="${(100 - Math.cos(a) * 75).toFixed(1)}" fill="${g % 90 ? 'rgba(150,222,238,.7)' : 'rgba(182,248,255,.95)'}"
      font-family="Menlo, monospace" font-size="${g % 90 ? 7.5 : 10}" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  });
  return `<circle cx="100" cy="100" r="96" fill="none" stroke="rgba(62,230,255,.45)"/><circle cx="100" cy="100" r="64" fill="none" stroke="rgba(62,230,255,.18)"/>
    ${t.join('')}${nomi.join('')}
    <g class="m-ago"><line class="m-ago-l" x1="100" y1="160" x2="100" y2="46" stroke="#d2fbff" stroke-linecap="round" style="filter:drop-shadow(0 0 4px rgba(62,230,255,.9))"/>
      <path class="m-ago-p" d="M100 34 L109 52 L100 47 L91 52 Z" fill="#d2fbff"/><circle cx="100" cy="160" r="3.5" fill="none" stroke="#d2fbff"/></g>`;
}

// Le frecce che scorrono nella rosa: una tessera con due frecce, spessore e luce dalla velocità
function tessera(kmh) {
  const c = document.createElement('canvas'), w = Math.min(4.5, 1 + kmh / 14), a = Math.min(0.95, 0.3 + kmh / 60);
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = `rgba(150, 240, 255, ${a})`; g.lineWidth = w * 2; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const [x, y] of [[34, 16], [82, 48]]) { g.beginPath(); g.moveTo(x - 14, y - 9); g.lineTo(x, y); g.lineTo(x - 14, y + 9); g.stroke(); }
  return c.toDataURL();
}

export function createVistaMeteo({ contenitore, prima = null, sfx = null, onChiudi = () => {} }) {
  if (!document.getElementById('meteo-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'meteo-css', textContent: CSS }));
  const root = document.createElement('div');
  root.id = 'meteo';
  root.innerHTML = SCHELETRO;
  contenitore.insertBefore(root, prima);
  const $ = (s) => root.querySelector(s);
  $('.m-rosa svg').innerHTML = rosa();
  for (const [min, r, g, b, al] of BANDE) {
    const i = document.createElement('i');
    i.style.background = `rgba(${r}, ${g}, ${b}, ${Math.min(1, al + 0.1)})`; i.title = `${min}`;
    $('.m-legenda').append(i);
  }
  const barra = (el, n) => { for (let i = 0; i < n; i++) el.append(document.createElement('i')); return el; };
  const RIGHE_T = [['temp', 'TEMPERATURA', '°C'], ['percepita', 'PERCEPITA', '°C'], ['rugiada', 'PUNTO DI RUGIADA', '°C'], ['umidita', 'UMIDITÀ RELATIVA', '%']].map(([k, nome, u]) => {
    const r = document.createElement('div'), riga = document.createElement('div'), b = document.createElement('b'), e = document.createElement('div');
    r.className = 'm-t-riga'; riga.className = 'm-riga'; riga.append(nome, b); e.className = 'm-barra';
    r.append(riga, e); $('.m-t-righe').append(r);
    return { k, u, b, barra: barra(e, SEG), n: -1 };
  });
  const BARRA_COND = { barra: barra($('.m-o-bcond'), SEG_O), n: -1 }, FATTORI = new Map(); // fattore → { b, barra, n }
  const cerchio = $('.m-cerchio'), area = $('.m-l-area'), tela = area.querySelector('canvas'), curL = $('.m-l-cur'), cur = $('.m-cur');
  const scrivi = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const SU = (s) => String(s).toUpperCase();

  let d = null, a = null, aperto = false, tCur = null, timerOra = 0, timerDati = 0, presa = null, trascina = null, sotto = null, ultimoCur = 0;
  let angoloAgo = null, angoloFlusso = null, kmhTessera = -1;
  const off = () => d?.luogo?.offset ?? 0, ora = (t) => oraDi(t, off());
  const radar = createRadar({ eco: $('.m-eco'), base: $('.m-base'), onInfo: infoRadar });

  // ---------------------------------------------------------------- i moduli all'ora scelta
  function segmenti(b, n, quanti) {
    const k = Math.max(0, Math.min(n, Math.round(quanti)));
    if (b.n === k) return;
    b.n = k;
    [...b.barra.children].forEach((x, i) => { x.classList.toggle('on', i < k); x.classList.toggle('punta', i === k - 1); });
  }
  const gira = (vecchio, nuovo) => (vecchio === null ? nuovo : vecchio + ((((nuovo - vecchio) % 360) + 540) % 360) - 180); // per la via più corta

  function scriviModuli() {
    if (!d) return;
    const adesso = Date.now(), t = tCur ?? adesso, v = valoriA(d, t);
    // vento: l'ago punta dove va il vento, le frecce scorrono da quella parte, più veloci e spesse col vento forte
    const b = beaufort(v.vento), dir = v.dir;
    scrivi($('.m-v-dir'), Number.isFinite(dir) ? `DA ${bussola(dir)}` : '—');
    scrivi($('.m-v-bf'), b ? `BEAUFORT ${b.n} · ${SU(b.nome)}` : '');
    scrivi($('.m-v-kmh'), num(v.vento));
    scrivi($('.m-v-raff'), v.raffiche === null ? '—' : `${num(v.raffiche)} KM/H`);
    scrivi($('.m-v-gradi'), Number.isFinite(dir) ? `${num(dir)}°` : '—');
    if (Number.isFinite(dir)) {
      angoloAgo = gira(angoloAgo, dir + 180);
      $('.m-ago').style.transform = `rotate(${angoloAgo}deg)`;
      angoloFlusso = gira(angoloFlusso, dir + 90); // la tessera scorre verso destra: ruotata di (verso − 90°)
      $('.m-giro-f').style.transform = `rotate(${angoloFlusso}deg)`;
    }
    const kmh = Math.round(v.vento ?? 0), str = $('.m-strisce');
    $('.m-ago-l').setAttribute('stroke-width', (1.5 + Math.min(5, (v.vento ?? 0) / 12)).toFixed(1));
    if (kmh !== kmhTessera) {
      kmhTessera = kmh;
      str.style.display = kmh < 1 ? 'none' : '';
      if (kmh >= 1) { str.style.backgroundImage = `url(${tessera(kmh)})`; str.style.setProperty('--durata', `${(48 / (8 + kmh * 1.6)).toFixed(2)}s`); }
    }
    // pressione: valore, tendenza delle ultime 3 ore (sempre da adesso) e la linea da −6 a +12 ore
    const p = a.pressione, ph = v.adesso ? p.hpa : v.pressione;
    scrivi($('.m-p-hpa'), ph === null ? '—' : `${num(ph, 1)} HPA`);
    scrivi($('.m-p-tend'), p.delta === null ? '' : `${p.delta < -0.05 ? '▼' : p.delta > 0.05 ? '▲' : '■'} ${p.delta > 0 ? '+' : ''}${num(p.delta, 1)} HPA IN 3 H · ${SU(p.tendenza)}`);
    // profilo termico
    for (const r of RIGHE_T) {
      const x = v[r.k];
      scrivi(r.b, x === null ? '—' : `${num(x, r.u === '%' ? 0 : 1)} ${r.u}`);
      segmenti(r, SEG, x === null ? 0 : r.u === '%' ? (x / 100) * SEG : ((x - T_MIN) / (T_MAX - T_MIN)) * SEG);
    }
    scrivi($('.m-t-cielo'), [v.codice !== null && SU(CODICI[v.codice] || ''), v.nuvole !== null && `NUVOLE ${num(v.nuvole)}%`].filter(Boolean).join(' · '));
    const sc = v.temp !== null && v.rugiada !== null ? v.temp - v.rugiada : null;
    scrivi($('.m-t-scarto'), sc === null ? '' : `SCARTO ARIA − RUGIADA ${num(sc, 1)} °C${sc <= 1 ? ' · ARIA SATURA' : sc <= 3 ? ' · ARIA QUASI SATURA' : ''}`);
    // operatività: le condizioni sono il fattore peggiore, e ogni fattore ha la sua riga col dato vero accanto
    const c = condizioniA(v);
    scrivi($('.m-o-cond'), c ? `${c.pct}%` : '—');
    segmenti(BARRA_COND, SEG_O, ((c?.pct ?? 0) / 100) * SEG_O);
    scrivi($('.m-o-giud'), c ? `${SU(c.giudizio)}${c.limite ? ` · LIMITE ${SU(c.limite)}` : ''}` : '');
    const dato = { visibilità: v.vis === null ? '' : v.vis >= 1000 ? `${num(v.vis / 1000, 1)} KM` : `${num(v.vis)} M`, vento: v.raffiche === null ? '' : `RAFFICHE ${num(v.raffiche)} KM/H`,
      pioggia: v.mmh === null ? '' : `${num(v.mmh, 1)} MM/H`, temporale: 'TEMPORALE', neve: 'NEVE', ghiaccio: 'GELO' };
    const chiave = (c?.fattori || []).map(([k]) => k).join('|'), box = $('.m-o-fattori');
    if (box.dataset.k !== chiave) {
      box.dataset.k = chiave; FATTORI.clear();
      box.replaceChildren(...(c?.fattori || []).flatMap(([k]) => {
        const riga = document.createElement('div'), b = document.createElement('b'), e = document.createElement('div');
        riga.className = 'm-riga'; riga.append(SU(k), b); e.className = 'm-barra sottile';
        FATTORI.set(k, { b, barra: barra(e, SEG_O), n: -1 });
        return [riga, e];
      }));
    }
    for (const [k, pct] of c?.fattori || []) { const f = FATTORI.get(k); scrivi(f.b, `${pct}%${dato[k] ? ` · ${dato[k]}` : ''}`); segmenti(f, SEG_O, (pct / 100) * SEG_O); }
    // la linea della pressione e il cursore
    const pts = d.ore.filter((o) => o.pressione !== null);
    if (pts.length > 1) {
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t, lo = Math.min(...pts.map((o) => o.pressione)) - 0.5, hi = Math.max(...pts.map((o) => o.pressione)) + 0.5;
      const X = (tt) => (((tt - t0) / (t1 - t0)) * 200).toFixed(1);
      $('.m-p-linea').setAttribute('points', pts.map((o) => `${X(o.t)},${(32 - ((o.pressione - lo) / (hi - lo)) * 30).toFixed(1)}`).join(' '));
      for (const [cl, tt, on] of [['.m-p-ora', adesso, true], ['.m-p-cur', t, tCur !== null]]) {
        const l = $(cl), x = X(Math.max(t0, Math.min(t1, tt)));
        l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('opacity', on ? 1 : 0);
      }
    }
  }

  function scriviAvvisi() {
    const lista = $('.m-a-lista'), av = a.avvisi;
    scrivi($('.m-a-n'), av.length ? `${av.length} ${av.length === 1 ? 'AVVISO' : 'AVVISI'}` : '');
    const chiave = av.map((x) => `${x.livello}${x.titolo}${x.dettaglio}`).join('|');
    if (lista.dataset.k === chiave) return;
    lista.dataset.k = chiave;
    lista.replaceChildren(...(av.length ? av.slice(0, 3).map((x, i) => {
      const box = document.createElement('div'), b = document.createElement('b'), p = document.createElement('p'), s = document.createElement('small');
      box.className = `m-avviso l${x.livello}${i === 0 ? ' primo' : ''}`;
      b.textContent = `▲ ${x.livello === 2 ? 'ALLERTA ROSSA' : 'ALLERTA'}`; p.textContent = SU(x.titolo); s.textContent = SU(x.dettaglio || '');
      box.append(b, p, s);
      return box;
    }) : [Object.assign(document.createElement('div'), { className: 'm-calmo', textContent: 'NESSUN AVVISO · NESSUNA ANOMALIA NELLE PROSSIME 12 H' })]));
  }

  // ---------------------------------------------------------------- la timeline: −2 h … +12 h, pioggia al quarto d'ora, temperatura, eventi
  function disegnaLinea() {
    const s = Math.min(2, devicePixelRatio || 1), r = area.getBoundingClientRect();
    const W = Math.max(1, Math.round(r.width * s)), Hc = Math.max(1, Math.round(r.height * s));
    if (tela.width !== W) tela.width = W;
    if (tela.height !== Hc) tela.height = Hc;
    const g = tela.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, Hc);
    if (!d || !a) return;
    const adesso = Date.now(), t0 = adesso - PRIMA_MS, t1 = adesso + DOPO_MS, X = (t) => ((t - t0) / (t1 - t0)) * W;
    const alto = 16 * s, medio = Math.round(Hc * 0.42), basso = Hc - 15 * s;
    g.font = `400 ${8 * s}px Menlo, monospace`; g.textBaseline = 'alphabetic';
    // le due ore del radar
    g.fillStyle = 'rgba(62, 230, 255, .05)'; g.fillRect(0, alto, X(adesso), basso - alto);
    g.fillStyle = 'rgba(150, 222, 238, .55)'; g.textAlign = 'left'; g.fillText('RADAR · 2 H', 4 * s, alto + 10 * s);
    // le ore, con l'ora del posto
    for (let t = Math.ceil(t0 / H) * H; t <= t1; t += H) {
      const x = Math.round(X(t)) + 0.5;
      g.fillStyle = 'rgba(62, 230, 255, .12)'; g.fillRect(x, alto, 1, basso - alto);
      g.fillStyle = 'rgba(150, 222, 238, .7)'; g.textAlign = 'center'; g.fillText(ora(t).slice(0, 2), x, Hc - 3 * s);
    }
    g.fillStyle = 'rgba(62, 230, 255, .3)'; g.fillRect(0, basso, W, 1);
    // pioggia al quarto d'ora: radice dei mm/h fino a 16, così si vede anche la pioggerella
    for (const q of d.quarti) {
      if (!(q.mm > 0)) continue;
      const xa = X(q.t - Q), xb = X(q.t);
      if (xb < 0 || xa > W) continue;
      const mmh = q.mm * 4, h = Math.max(2 * s, Math.sqrt(Math.min(1, mmh / 16)) * (basso - medio));
      g.fillStyle = mmh >= SOGLIE.pioggia_violenta ? 'rgba(255, 67, 67, .95)' : mmh >= SOGLIE.pioggia_forte ? 'rgba(255, 155, 51, .9)'
        : `rgba(62, 230, 255, ${(0.35 + 0.55 * Math.min(1, mmh / 8)).toFixed(2)})`;
      g.fillRect(xa + 0.5 * s, basso - h, Math.max(1, xb - xa - 1 * s), h);
    }
    // temperatura: una linea sopra le barre, con i gradi ogni 3 ore
    const tp = d.ore.filter((o) => o.temp !== null && o.t >= t0 - H && o.t <= t1 + H);
    if (tp.length > 1) {
      const lo = Math.min(...tp.map((o) => o.temp)), hi = Math.max(...tp.map((o) => o.temp)), sp = Math.max(2, hi - lo);
      const Y = (v) => medio - 6 * s - ((v - lo) / sp) * (medio - alto - 16 * s);
      g.strokeStyle = 'rgba(182, 248, 255, .85)'; g.lineWidth = 1.3 * s; g.beginPath();
      tp.forEach((o, i) => (i ? g.lineTo(X(o.t), Y(o.temp)) : g.moveTo(X(o.t), Y(o.temp))));
      g.stroke();
      g.fillStyle = 'rgba(222, 251, 255, .85)'; g.textAlign = 'center';
      for (const o of tp) if (Math.round(o.t / H) % 3 === 0 && o.t > t0 && o.t < t1) g.fillText(`${num(o.temp)}°`, X(o.t), Y(o.temp) - 5 * s);
    }
    // eventi: una staffa sopra, con tipo e orari
    g.textAlign = 'left';
    for (const ev of a.eventi) {
      const xa = Math.max(0, X(ev.inizio)), xb = Math.min(W, X(ev.fine));
      if (xb <= xa) continue;
      g.strokeStyle = 'rgba(182, 248, 255, .8)'; g.lineWidth = 1 * s; g.beginPath();
      g.moveTo(xa, alto + 4 * s); g.lineTo(xa, alto); g.lineTo(xb, alto); g.lineTo(xb, alto + 4 * s); g.stroke();
      g.fillStyle = 'rgba(182, 248, 255, .95)';
      const quando = ev.in_corso ? `fino alle ${ora(ev.fine)}` : `${ora(ev.inizio)}–${ora(ev.fine)}`;
      g.fillText(SU(`${ev.tipo} ${quando}${ev.oltre ? ' e oltre' : ''}`), xa + 3 * s, alto - 4 * s);
    }
    // adesso
    const xo = Math.round(X(adesso));
    g.fillStyle = 'rgba(61, 255, 208, .95)'; g.fillRect(xo, alto - 2 * s, 1.5 * s, basso - alto + 2 * s);
    g.textAlign = 'right'; g.fillText(`ORA ${ora(adesso)}`, xo - 4 * s, basso - 4 * s);
    posizionaCursore();
  }

  function posizionaCursore() {
    if (!d || tCur === null) { curL.classList.remove('on'); return; }
    const adesso = Date.now(), w = area.clientWidth, x = ((tCur - (adesso - PRIMA_MS)) / (PRIMA_MS + DOPO_MS)) * w, v = valoriA(d, tCur);
    curL.style.transform = `translateX(${x.toFixed(1)}px)`;
    curL.classList.add('on'); curL.classList.toggle('sx', x > w * 0.75);
    const dt = tCur - adesso;
    scrivi(curL.querySelector('span'), `${ora(tCur)} · ${dt < 0 ? `${durata(-dt)} FA` : `TRA ${durata(dt)}`}`.toUpperCase() +
      `${v.mmh !== null ? ` · ${num(v.mmh, 1)} MM/H` : ''}${v.temp !== null ? ` · ${num(v.temp)} °C` : ''}`);
  }

  function scriviTutto() {
    if (!d) return;
    a = analizza(d, Date.now());
    const l = d.luogo;
    scrivi($('.m-titolo'), SU(`meteo // ${[l.nome, l.regione, l.paese].filter(Boolean).filter((x, i, xs) => xs.indexOf(x) === i).join(' · ')}`));
    scrivi($('.m-l-frase'), SU(a.frase));
    scriviAvvisi(); scriviModuli(); disegnaLinea(); scriviSotto();
  }
  let fase = '';
  function scriviSotto() {
    const l = d.luogo;
    scrivi($('.m-sotto'), [`${num(Math.abs(l.lat), 2)}° ${l.lat >= 0 ? 'N' : 'S'} ${num(Math.abs(l.lon), 2)}° ${l.lon >= 0 ? 'E' : 'O'}`,
      l.quota !== null && `${num(l.quota)} M`, `OPEN-METEO ${ora(d.preso)}`, fase].filter(Boolean).join(' · '));
  }

  function infoRadar(i) {
    const adesso = Date.now();
    cerchio.classList.toggle('fermo', !i.live);
    scrivi($('.m-r-ora'), i.errore ? SU(i.errore) : i.t === null ? 'CARICO…' :
      `${ora(i.t)} · ${durata(adesso - i.t).toUpperCase()} FA${i.scaricate < i.totali ? ` · CARICO ${i.scaricate}/${i.totali}` : ''}${tCur !== null && tCur > (i.ultima ?? 0) + 10 * 60_000 ? ' · ULTIMO DATO' : ''}`);
    const an = i.analisi;
    // Marshall-Palmer (Z = 200·R^1,6): dai dBZ la pioggia in mm/h, la stessa formula delle soglie dei colori
    const mmh = (dbz) => (10 ** (dbz / 10) / 200) ** (1 / 1.6);
    scrivi($('.m-r-eco'), !an ? '' : an.sopra !== null && an.sopra >= 15 ? `SOPRA DI TE ${an.sopra} DBZ · CIRCA ${num(mmh(an.sopra), 1)} MM/H`
      : an.vicina ? `SOPRA DI TE NIENTE · ECO PIÙ VICINA ${num(an.vicina.km)} KM ${bussola(an.vicina.gradi)}, ${an.vicina.dbz} DBZ` : `NESSUNA ECO ENTRO ${num(i.raggio)} KM`);
  }

  // ---------------------------------------------------------------- la linea del tempo
  function scegli(t) {
    if (!d) return;
    const adesso = Date.now();
    t = t === null ? null : Math.max(adesso - PRIMA_MS, Math.min(adesso + DOPO_MS, t));
    if (t !== null && Math.abs(t - adesso) < 4 * 60_000) t = null; // vicino ad adesso: si torna al vivo
    tCur = t;
    radar.tempo(t);
    scriviModuli(); posizionaCursore();
  }
  const tempoA = (clientX) => { const r = area.getBoundingClientRect(); return Date.now() - PRIMA_MS + ((clientX - r.left) / r.width) * (PRIMA_MS + DOPO_MS); };

  // ---------------------------------------------------------------- mouse
  let tira = null;
  cerchio.addEventListener('pointerdown', (e) => { tira = { x: e.clientX, y: e.clientY }; try { cerchio.setPointerCapture(e.pointerId); } catch {} });
  cerchio.addEventListener('pointermove', (e) => { if (!tira) return; radar.sposta(e.clientX - tira.x, e.clientY - tira.y); tira = { x: e.clientX, y: e.clientY }; });
  for (const t of ['pointerup', 'pointercancel']) cerchio.addEventListener(t, () => { tira = null; });
  cerchio.addEventListener('wheel', (e) => { e.preventDefault(); radar.zoom(Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0015)); }, { passive: false });
  cerchio.addEventListener('dblclick', () => radar.reimposta());
  let scorre = false;
  area.addEventListener('pointerdown', (e) => { scorre = true; try { area.setPointerCapture(e.pointerId); } catch {} scegli(tempoA(e.clientX)); });
  area.addEventListener('pointermove', (e) => { if (scorre) scegli(tempoA(e.clientX)); });
  for (const t of ['pointerup', 'pointercancel']) area.addEventListener(t, () => { scorre = false; });
  area.addEventListener('dblclick', () => scegli(null));

  // ---------------------------------------------------------------- mani (gesti.js, via nexus.js)
  const dentroCerchio = (x, y) => { const r = cerchio.getBoundingClientRect(); return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) <= r.width / 2; };
  const dentro = (el, x, y) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  function sottoA(x, y) {
    if (dentroCerchio(x, y)) return 'radar';
    if (dentro($('.m-linea'), x, y)) return 'linea';
    return [...root.querySelectorAll('.m-mod')].find((m) => dentro(m, x, y))?.classList[1] || null;
  }
  function mira(dove) {
    if (dove === sotto) return;
    sotto = dove;
    root.querySelectorAll('.m-mod.mira').forEach((m) => m.classList.remove('mira'));
    if (dove && dove !== 'radar') root.querySelector(`.m-mod.${dove === 'linea' ? 'm-linea' : dove}`)?.classList.add('mira');
    cerchio.style.boxShadow = dove === 'radar' ? '0 0 0 1px rgba(182, 248, 255, .8), 0 0 56px rgba(62, 230, 255, .3), inset 0 0 70px rgba(62, 230, 255, .14)' : '';
  }
  let curXY = [0, 0];
  function gesto(g) {
    if (!aperto || !g || typeof g !== 'object') return;
    const x = Number(g.x) * innerWidth, y = Number(g.y) * innerHeight;
    switch (g.tipo) {
      case 'stato': {
        const testo = { riposo: 'mani: mostra il palmo', pronto: 'mani pronte', azione: 'mani pronte' }[g.fase] || '';
        fase = SU(testo); if (d) scriviSotto();
        cur.classList.toggle('azione', g.fase === 'azione');
        if (g.fase !== 'azione') trascina = null;
        if (g.fase !== 'pronto' && g.fase !== 'azione') { cur.classList.remove('on', 'presa'); mira(null); }
        break;
      }
      case 'cursore':
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        curXY = [x, y]; ultimoCur = performance.now();
        cur.classList.add('on'); cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        if (!trascina) mira(sottoA(x, y));
        break;
      case 'ruota': case 'sposta': { // sul radar sposta la mappa, altrove scorre il tempo
        const dx = Number(g.dx), dy = Number(g.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (presa) presa.mosso = true;
        trascina ||= { su: sotto === 'radar' ? 'radar' : 'tempo' };
        if (trascina.su === 'radar') radar.sposta(dx * innerWidth, dy * innerHeight);
        else scegli((tCur ?? Date.now()) + ((dx * innerWidth) / Math.max(200, area.clientWidth)) * (PRIMA_MS + DOPO_MS));
        break;
      }
      case 'zoom': radar.zoom(Number(g.fattore)); break;
      case 'afferra': presa = { x, y, mosso: false }; cur.classList.add('presa'); sfx?.afferra?.(); break;
      case 'lascia': // senza 'sposta' in mezzo è un clic: il pizzico breve, o una presa tenuta ferma e lasciata
        if (presa && !presa.mosso) {
          const dove = sottoA(presa.x, presa.y);
          if (dove === 'linea') scegli(tempoA(presa.x)); else if (dove === 'radar') radar.reimposta(); else scegli(null);
        }
        presa = null; trascina = null; cur.classList.remove('presa');
        break;
      case 'lancia': presa = null; cur.classList.remove('presa'); sfx?.lancia?.(); onChiudi(); break;
    }
  }
  // le mani escono senza dirlo: dopo 400 ms senza cursore si spegne
  const spegniCursore = setInterval(() => { if (aperto && ultimoCur && performance.now() - ultimoCur > 400) { ultimoCur = 0; cur.classList.remove('on', 'presa'); mira(null); } }, 200);

  // ---------------------------------------------------------------- tastiera: frecce il tempo, + e − lo zoom, R ricomincia
  function tasto(e) {
    if (!aperto || e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') scegli((tCur ?? Date.now()) + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? H : Q));
    else if (k === 'Home' || k === '0') scegli(null);
    else if (k === '+' || k === '=') radar.zoom(1.25);
    else if (k === '-') radar.zoom(0.8);
    else if (k === 'r' || k === 'R') { if (e.repeat) return true; radar.reimposta(); scegli(null); }
    else return false;
    return true;
  }

  // ---------------------------------------------------------------- misure, apri, chiudi
  function ridimensiona() {
    if (!aperto) return;
    const cella = $('.m-radar').getBoundingClientRect(), alto = $('.m-radar header').offsetHeight + $('.m-r-piede').offsetHeight + 12;
    const lato = Math.max(120, Math.floor(Math.min(cella.width, cella.height - alto)));
    cerchio.style.width = cerchio.style.height = `${lato}px`;
    radar.ridimensiona(); disegnaLinea();
  }
  addEventListener('resize', ridimensiona);

  async function rileggi() { // ogni 5 minuti: il server riscarica se i dati hanno più di 10 minuti
    try {
      const n = await (await fetch('/api/meteo', { cache: 'no-store' })).json();
      if (aperto && n?.preso > d?.preso && n.luogo?.lat === d.luogo.lat && n.luogo?.lon === d.luogo.lon) { d = n; scriviTutto(); }
    } catch {}
  }

  return {
    // Restituisce i tempi d'arrivo dei moduli per i suoni (come report.js), o null se i dati non bastano
    apri(dati) {
      if (!dati?.luogo || !Array.isArray(dati.ore) || !Array.isArray(dati.quarti)) return null;
      const primo = !aperto;
      d = dati; tCur = null; a = analizza(d, Date.now());
      root.classList.remove('via');
      root.classList.add('on');
      if (primo) root.querySelectorAll('.m-mod, .m-top').forEach((m) => { m.style.animation = 'none'; void m.offsetWidth; m.style.animation = ''; }); // l'entrata riparte
      aperto = true;
      ridimensiona();
      scriviTutto();
      radar.avvia(d.luogo);
      radar.tempo(null);
      clearInterval(timerOra); timerOra = setInterval(() => { if (aperto) scriviTutto(); }, 30_000); // «tra 42 min» scende, «ora» si sposta
      clearInterval(timerDati); timerDati = setInterval(rileggi, 5 * 60_000);
      return primo ? { hero: 0.65, lands: [0.75, 0.85, 0.95, 1.05, 1.15] } : null;
    },
    chiudi() {
      if (!aperto) return;
      aperto = false; presa = null; trascina = null;
      clearInterval(timerOra); clearInterval(timerDati);
      radar.ferma();
      cur.classList.remove('on', 'presa'); mira(null);
      root.classList.add('via');
      setTimeout(() => { if (!aperto) root.classList.remove('on', 'via'); }, 460);
    },
    gesto, tasto,
    dock() { const r = $('.m-dock').getBoundingClientRect(); return { dockX: r.x + r.width / 2, dockY: r.y + r.height * 0.6 }; },
    get aperto() { return aperto; },
    info() { return { aperto, tCur, luogo: d?.luogo?.nome ?? null, frase: a?.frase ?? null, avvisi: a?.avvisi?.length ?? 0, radar: radar.stato, cursore: curXY }; },
    distruggi() { clearInterval(spegniCursore); },
  };
}
