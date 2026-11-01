// STEM — il report a schermo intero, come nel video di ROSE (secondi 34–46).
// I blocchi (testi, grafici, dati, immagini, video) stanno in una griglia 12×6. Entrano in quattro tempi:
// un lampo di pannelli che attraversano lo schermo in profondità, il protagonista (il primo video) che atterra per primo,
// gli altri che arrivano dal fondo uno alla volta, sfocati e inclinati, e infine i video che partono.
// I blocchi che non ci stanno si impilano su uno dello stesso tipo e si alternano ogni 9 secondi.
// Tutto il testo entra con textContent: quello che scrive il cervello non diventa mai HTML.

const COLS = 12, ROWS = 6;
const DOCK = { c: 10, r: 4 };      // le ultime due colonne delle ultime due righe: lì si siede la testa di STEM
// misure in celle (larghezza, altezza), dalla preferita alla più piccola accettabile
const SIZES = { video: [[4, 2]], verticale: [[2, 3], [2, 2]], testo: [[3, 2], [2, 2]], grafico: [[3, 2], [2, 2]],
  immagine: [[3, 2], [2, 2]], dato: [[2, 2], [3, 1], [2, 1]] };
const KICKER = { testo: 'NOTA', grafico: 'GRAFICO', dato: 'DATO', immagine: 'IMMAGINE', video: 'VIDEO', verticale: 'VIDEO' };
const EASE = 'cubic-bezier(.16, .84, .24, 1)';
const SWAP_MS = 9000;
const LAND_MS = 480;                // durata del volo di una scheda

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v) : '');
const rand = (a, b) => a + Math.random() * (b - a);

function youtube(v) {
  const s = str(v, 300);
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m && { id: m[1], vertical: s.includes('shorts/') };
}
function https(v) {
  try { const u = new URL(str(v, 2000)); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

// Dal formato del cervello a blocchi puliti: quelli senza niente da mostrare si scartano
function clean(b, i) {
  if (!b || typeof b !== 'object') return null;
  const x = { kind: str(b.tipo, 20).toLowerCase(), title: str(b.titolo, 120), text: str(b.testo, 700), source: str(b.fonte, 120), n: i + 1 };
  if (x.kind === 'testo') return x.title || x.text ? x : null;
  if (x.kind === 'grafico') {
    x.bars = (Array.isArray(b.valori) ? b.valori : []).slice(0, 8)
      .map((v) => ({ label: str(v?.etichetta, 40), value: Number(v?.valore) }))
      .filter((v) => Number.isFinite(v.value) && v.value >= 0);
    x.unit = str(b.unita, 30);
    return x.bars.length >= 2 ? x : null;
  }
  if (x.kind === 'dato') { x.value = str(b.valore, 16); return x.value ? x : null; }
  if (x.kind === 'immagine') { x.url = https(b.url); return x.url ? x : null; }
  if (x.kind === 'video') {
    const y = youtube(b.youtube || b.url);
    if (!y) return null;
    x.yt = y.id;
    if (y.vertical) x.kind = 'verticale';
    return x;
  }
  return null;
}

// Incastro: prima i video, da destra (come nel video di ROSE), poi un blocco per tipo, poi il resto, da sinistra.
// Ogni blocco prova la sua misura preferita e poi quelle più piccole; se non trova posto si impila sul blocco
// dello stesso tipo che ne ha meno. Alla fine le schede si allargano nei buchi rimasti, così la griglia è piena.
function pack(blocks) {
  const used = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => c >= DOCK.c && r >= DOCK.r));
  const free = (c, r, w, h) => {
    if (c < 0 || r < 0 || c + w > COLS || r + h > ROWS) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (used[y][x]) return false;
    return true;
  };
  const take = (c, r, w, h) => { for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) used[y][x] = true; };
  const isVideo = (b) => b.kind === 'video' || b.kind === 'verticale';
  const firsts = blocks.filter((b, i) => !isVideo(b) && blocks.findIndex((o) => o.kind === b.kind) === i);
  const order = [...blocks.filter(isVideo), ...firsts, ...blocks.filter((b) => !isVideo(b) && !firsts.includes(b))];
  const slots = [];
  for (const b of order) {
    let at = null;
    for (const [w, h] of SIZES[b.kind]) {
      for (let r = 0; r <= ROWS - h && !at; r++) {
        for (let k = 0; k <= COLS - w && !at; k++) {
          const c = isVideo(b) ? COLS - w - k : k;
          if (free(c, r, w, h)) at = { c, r, w, h };
        }
      }
      if (at) break;
    }
    if (at) {
      take(at.c, at.r, at.w, at.h);
      slots.push({ kind: b.kind, at, w: at.w, h: at.h, items: [b], i: 0 });
      continue;
    }
    const same = slots.filter((s) => s.kind === b.kind);
    if (same.length) same.reduce((a, s) => (s.items.length < a.items.length ? s : a)).items.push(b);
  }
  // buchi: ogni scheda (tranne i video verticali) prova ad allargarsi di una fila alla volta, finché si può
  for (let grew = true; grew;) {
    grew = false;
    for (const s of slots) {
      if (s.kind === 'verticale') continue;
      const { c, r } = s.at;
      if (free(c + s.w, r, 1, s.h)) { take(c + s.w, r, 1, s.h); s.w++; grew = true; }
      else if (free(c, r + s.h, s.w, 1)) { take(c, r + s.h, s.w, 1); s.h++; grew = true; }
      else if (free(c - 1, r, 1, s.h)) { take(c - 1, r, 1, s.h); s.at.c--; s.w++; grew = true; }
      else if (free(c, r - 1, s.w, 1)) { take(c, r - 1, s.w, 1); s.at.r--; s.h++; grew = true; }
    }
  }
  return slots;
}

// ---------- Le schede ----------
function fill(card, slot) {
  const b = slot.items[slot.i];
  const media = b.kind === 'immagine' || b.kind === 'video' || b.kind === 'verticale';
  const right = b.kind === 'grafico' ? b.unit : b.kind === 'dato' ? 'FATTO' : '';
  const head = el('header');
  head.append(el('span', 'k', `${KICKER[b.kind]} // ${String(b.n).padStart(2, '0')}${media && b.title ? ' · ' + b.title : ''}`), el('span', '', right));
  card.replaceChildren(head);

  if (!media) card.append(el('h3', '', b.title));
  if (b.kind === 'testo') card.append(el('p', '', b.text));
  if (b.kind === 'dato') card.append(el('div', 'num', b.value), el('p', '', b.text));
  if (b.kind === 'grafico') {
    const max = Math.max(...b.bars.map((v) => v.value)) || 1;
    const bars = el('div', 'bars'), labels = el('div', 'labels');
    for (const v of b.bars) {
      const bar = el('i');
      bar.style.height = `${Math.max(1.5, (v.value / max) * 100)}%`;
      bar.append(el('b', '', v.value.toLocaleString('it-IT', { maximumFractionDigits: 1 })));
      bars.append(bar);
      labels.append(el('span', '', v.label));
    }
    card.append(bars, labels, el('p', 'note', b.text));
  }
  if (b.kind === 'immagine') {
    const frame = el('div', 'frame'), img = el('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.onerror = () => frame.classList.add('broken');
    img.src = b.url;
    frame.append(img);
    card.append(frame);
    if (b.text) card.append(el('p', 'note', b.text));
  }
  if (b.kind === 'video' || b.kind === 'verticale') {
    const frame = el('div', 'frame');
    frame.append(el('i', 'spin'));
    card.append(frame);
  }

  const foot = el('footer');
  foot.append(el('span', '', b.kind === 'video' || b.kind === 'verticale' ? 'MUTO · YOUTUBE' : b.source ? 'FONTE: ' + b.source : ''));
  if (slot.items.length > 1) {
    const dots = el('span', 'dots');
    slot.items.forEach((_, j) => dots.append(el('i', j === slot.i ? 'on' : '')));
    foot.append(dots);
  } else foot.append(el('span', '', `BLOCCO ${String(b.n).padStart(2, '0')}`));
  card.append(foot);
}

// Il video parte solo quando la scheda è atterrata: nel lampo si vede la cornice vuota con il cerchio che gira
function goLive(card, slot) {
  const b = slot.items[slot.i], frame = card.querySelector('.frame');
  if (!b.yt || !frame) return;
  const f = el('iframe');
  f.allow = 'autoplay; encrypted-media';
  f.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube rifiuta gli embed senza origine
  f.src = `https://www.youtube-nocookie.com/embed/${b.yt}?autoplay=1&mute=1&controls=0&loop=1&playlist=${b.yt}` +
    '&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&cc_load_policy=0';
  f.onload = () => setTimeout(() => f.classList.add('on'), 900); // il tempo che il lettore parta, poi si accende
  frame.append(f);
}

function typeOn(p, text) {
  const dur = Math.min(900, text.length * 5);
  let t0 = 0;
  const step = (now) => { // un orologio solo, quello dei fotogrammi: performance.now() può non coincidere
    t0 ||= now;
    const k = Math.min(1, (now - t0) / dur);
    p.textContent = text.slice(0, Math.ceil(text.length * k));
    if (k < 1 && p.isConnected) requestAnimationFrame(step);
  };
  p.textContent = '';
  requestAnimationFrame(step);
}

function next(card, slot) {
  slot.i = (slot.i + 1) % slot.items.length;
  fill(card, slot);
  goLive(card, slot);
  card.animate([{ opacity: 0.25, filter: 'blur(5px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 450, easing: 'ease-out' });
  const b = slot.items[slot.i], p = card.querySelector('p:not(.note)');
  if (p && b.text) typeOn(p, b.text);
}

// ---------- Entrata in quattro tempi (tempi presi dal video, fotogramma per fotogramma) ----------
function land(card, delay, from, onLand) {
  card.animate([
    { transform: from, opacity: 0, filter: 'blur(14px)' },
    { opacity: 0.75, offset: 0.35 },
    { transform: 'none', opacity: 1, filter: 'blur(0px)' },
  ], { duration: LAND_MS, delay, easing: EASE, fill: 'backwards' }).finished.then(() => {
    card.classList.add('landed');
    onLand?.();
  }).catch(() => {});
}

// Restituisce quando atterrano le schede (secondi dall'apertura): sfx.js ci aggancia i suoni
function assemble(grid, cards) {
  // 1. lampo (0–0,8 s): copie dei pannelli che attraversano lo schermo dal fondo e svaniscono
  cards.forEach(({ card }, i) => {
    const g = card.cloneNode(true);
    g.classList.add('ghost');
    grid.append(g);
    const dx = rand(-260, 260), dy = rand(-140, 140);
    g.animate([
      { transform: `translate3d(${dx}px, ${dy}px, -1700px)`, opacity: 0, filter: 'blur(14px)' },
      { opacity: 0.8, filter: 'blur(0px)', offset: 0.5 },
      { transform: `translate3d(${dx * 0.5}px, ${dy * 0.5}px, -350px)`, opacity: 0, filter: 'blur(10px)' },
    ], { duration: 560, delay: i * 25 + rand(0, 60), easing: 'linear', fill: 'both' }).finished.then(() => g.remove()).catch(() => g.remove());
  });
  // 2. il protagonista atterra (0,42–0,9 s), con il bordo che si accende
  const [hero, ...rest] = cards;
  land(hero.card, 420, 'translate3d(-90px, 60px, -900px) rotateY(14deg) rotateX(6deg)', hero.live);
  // 3. gli altri, uno alla volta: l'ultimo atterra entro circa 2 s
  const gap = Math.min(90, 760 / Math.max(1, rest.length - 1));
  rest.forEach(({ card, live }, i) => {
    const s = Math.random() < 0.5 ? -1 : 1;
    land(card, 860 + i * gap, `translate3d(${s * 50}px, 30px, -700px) rotateY(${-s * 16}deg) rotateX(9deg)`, live);
  });
  return { hero: (420 + LAND_MS) / 1000, lands: rest.map((_, i) => (860 + i * gap + LAND_MS) / 1000) };
}

// ---------- Apri e chiudi ----------
const root = el('div');
root.id = 'report';
const top = el('div', 'top'), titleEl = el('span', 'title'), countEl = el('span', 'count');
top.append(titleEl, countEl);
const grid = el('div', 'grid');
const dock = el('i', 'dock'); // segnaposto invisibile per la testa
root.append(top, grid);
document.body.append(root);

let timers = [], shown = 0;

// Restituisce i tempi di atterraggio per i suoni, oppure null se non c'è niente da mostrare (e allora il report si chiude)
export function showReport(data) {
  const blocks = (Array.isArray(data?.blocchi) ? data.blocchi : []).slice(0, 30).map(clean).filter(Boolean);
  const slots = blocks.length ? pack(blocks) : [];
  if (!slots.length) { hideReport(); return null; }
  const id = ++shown;
  timers.forEach(clearInterval); timers = [];
  root.getAnimations({ subtree: true }).forEach((a) => a.cancel()); // anche la chiusura di un report precedente

  const sources = new Set(blocks.map((b) => b.source.toLowerCase()).filter(Boolean)).size;
  titleEl.textContent = `REPORT // ${str(data.titolo, 80) || 'RICERCA'}`.toUpperCase();
  countEl.textContent = `${blocks.length} BLOCCHI${sources ? ` · ${sources} FONTI` : ''}`;
  dock.style.gridArea = `${DOCK.r + 1} / ${DOCK.c + 1} / span ${ROWS - DOCK.r} / span ${COLS - DOCK.c}`;

  const cards = slots.map((slot) => {
    const card = el('section', `card ${slot.kind}`);
    card.style.gridArea = `${slot.at.r + 1} / ${slot.at.c + 1} / span ${slot.h} / span ${slot.w}`;
    fill(card, slot);
    return { card, slot, live: () => goLive(card, slot) };
  });
  grid.replaceChildren(dock, ...cards.map((c) => c.card));
  root.classList.add('on');
  const plan = assemble(grid, cards);
  top.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 300, fill: 'backwards' });

  // le pile cambiano la prima volta dopo 9 s, come nel video, e poi ogni 9 s, sfasate di 1,3 s l'una dall'altra
  cards.filter(({ slot }) => slot.items.length > 1).forEach(({ card, slot }, j) => {
    setTimeout(() => { if (shown === id) timers.push(setInterval(() => next(card, slot), SWAP_MS)); }, j * 1300);
  });
  return plan;
}

export function hideReport() {
  if (!root.classList.contains('on')) return;
  const id = ++shown;
  timers.forEach(clearInterval); timers = [];
  root.animate([{ opacity: 1, filter: 'blur(0px)', transform: 'none' }, { opacity: 0, filter: 'blur(10px)', transform: 'scale(.97)' }],
    { duration: 450, easing: 'ease-in' }).finished.then(() => {
    if (shown !== id) return;
    root.classList.remove('on');
    grid.replaceChildren(); // fuori anche gli iframe: i video smettono di girare
  }).catch(() => {});
}

// Centro del posto riservato alla testa, in pixel: lì humanoid.js porta il busto
export function reportDock() {
  const r = dock.getBoundingClientRect();
  return { dockX: r.x + r.width / 2, dockY: r.y + r.height * 0.6 };
}
