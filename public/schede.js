// O.S.C.A.R. — la corsia delle schede: le cose concrete che O.S.C.A.R. nomina mentre parla (richiesta di Tony del 27/11).
// Il server (schede.mjs) manda la scheda subito dopo la frase che la nomina; oscar.js la fa comparire quando quella frase
// comincia a suonare, più la posizione stimata del nome nella frase. Qui solo il disegno:
//   - una scheda grande (foto, nome, cos'è, fino a tre numeri, fonte); quando arriva la successiva la precedente si riduce a
//     una riga (nome e primo numero) sotto di lei; al massimo tre righe, le più vecchie se ne vanno;
//   - «pieno» accanto agli anelli; «compatto» col browser o con report e meteo (il nucleo nell'angolo): solo la scheda
//     grande, piccola, senza righe;
//   - i movimenti su molle: entrate con la curva di fisica.js (CSS), e quando le schede si spostano nella pila FLIP con la
//     stessa curva, così niente salta;
//   - tutto il testo entra con textContent: nomi e numeri arrivano dal web.
import { curvaCSS, MOTO } from './fisica.js';

const RIGHE = 3;
const CORPO = curvaCSS(MOTO.corpo), LIEVE = curvaCSS(MOTO.lieve);
const el = (tag, cls, testo) => { const e = document.createElement(tag); if (cls) e.className = cls; if (testo) e.textContent = testo; return e; };

export function createSchede(genitore = document.body) {
  const root = el('div'); root.id = 'schede';
  genitore.append(root);
  const tutte = new Map(); // id → { d, el, stato: 'attesa' | 'grande' | 'riga' | 'via' }
  let ordine = [];          // le visibili, dalla più nuova
  let modo = 'pieno', scade = 0;

  function crea(d) {
    const s = el('section', 'scheda staffe');
    const foto = el('div', 'foto'), testo = el('div', 'testo'), testa = el('header');
    testa.append(el('span', 'tipo', d.tipo || ''), el('span', 'fonte', d.fonte ? `FONTE: ${d.fonte}` : ''));
    const numeri = el('ul', 'numeri');
    for (const n of d.numeri || []) numeri.append(el('li', '', n));
    testo.append(testa, el('b', 'nome', d.nome), numeri);
    s.append(foto, testo);
    return s;
  }
  // FLIP: dove stavano prima, dove stanno dopo, e la differenza recuperata con la molla
  function sposta(cambia) {
    const prima = new Map(ordine.map((id) => [id, tutte.get(id).el.getBoundingClientRect()]));
    cambia();
    for (const id of ordine) {
      const s = tutte.get(id), a = prima.get(id);
      if (!a || !s.el.isConnected) continue;
      const b = s.el.getBoundingClientRect(), dy = a.top - b.top, dx = a.left - b.left;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) s.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: CORPO.ms, easing: CORPO.linear });
    }
  }
  function via(id) {
    const s = tutte.get(id);
    if (!s || s.stato === 'via') return;
    s.stato = 'via';
    ordine = ordine.filter((x) => x !== id);
    s.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(12px)' }], { duration: LIEVE.ms, easing: LIEVE.linear }).finished
      .catch(() => {}).then(() => { s.el.remove(); tutte.delete(id); });
  }
  function aggiorna() {
    root.dataset.modo = modo;
    root.classList.toggle('on', ordine.length > 0);
  }

  return {
    el: root,
    // Arriva dal server: pronta ma nascosta, finché la sua frase non comincia
    aggiungi(d) {
      if (!d?.id || tutte.has(d.id)) return;
      tutte.set(d.id, { d, el: crea(d), stato: 'attesa' });
    },
    // La foto, quando il server l'ha trovata: si decodifica prima di entrare, così non ferma un fotogramma
    foto(id, url) {
      const s = tutte.get(id);
      if (!s || typeof url !== 'string' || !url.startsWith('/api/schede/foto/')) return;
      const img = new Image();
      img.alt = '';
      img.src = url;
      img.decode().then(() => {
        if (!s.el.isConnected && s.stato === 'via') return;
        s.el.querySelector('.foto').replaceChildren(img);
        s.el.classList.add('con-foto');
      }).catch(() => {});
    },
    // La sua frase sta suonando e il nome sta arrivando: grande in cima, la precedente diventa una riga
    mostra(id) {
      const s = tutte.get(id);
      if (!s || s.stato !== 'attesa') return;
      clearTimeout(scade);
      sposta(() => {
        for (const x of ordine) { const o = tutte.get(x); if (o.stato === 'grande') { o.stato = 'riga'; o.el.classList.add('riga'); } }
        s.stato = 'grande';
        root.prepend(s.el);
        ordine.unshift(id);
      });
      ordine.filter((x) => tutte.get(x).stato === 'riga').slice(RIGHE).forEach(via);
      aggiorna();
    },
    // Una risposta nuova, Esc, o il tempo scaduto dopo la fine della risposta
    pulisci() { clearTimeout(scade); [...ordine].forEach(via); for (const [id, s] of tutte) if (s.stato === 'attesa') tutte.delete(id); aggiorna(); },
    scadi(ms) { clearTimeout(scade); scade = setTimeout(() => this.pulisci(), ms); },
    // modo: 'pieno' accanto agli anelli, 'compatto' col browser o nell'angolo
    modo(m) { if (m !== modo) { modo = m; aggiorna(); } },
    get attiva() { return ordine.length > 0; },
    info: () => ({ modo, schede: ordine.map((id) => { const s = tutte.get(id); return { id, nome: s.d.nome, stato: s.stato, foto: s.el.classList.contains('con-foto') }; }),
      inAttesa: [...tutte.values()].filter((s) => s.stato === 'attesa').length }),
  };
}
