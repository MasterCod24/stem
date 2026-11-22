// Caricato da Playwright in ogni pagina che O.S.C.A.R. apre (--init-script).
// 1) Tutto nella stessa scheda (il server chiude comunque ogni scheda nuova e la riapre nella principale).
// 2) Mostra dove O.S.C.A.R. clicca e scrive, con grafica olografica. Solo DOM + Web Animations:
//    niente innerHTML (Trusted Types) né <style> (CSP), così funziona anche su Google.
(() => {
  if (window.top !== window || window.__oscarFx) return;
  window.__oscarFx = true;

  // --- Una sola pagina: link e moduli restano nella scheda, anche dentro gli shadow root ---
  const keepHere = (e) => {
    const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement && n.href);
    const t = a && (a.getAttribute('target') || document.querySelector('base[target]')?.getAttribute('target'));
    if (t && t !== '_self') a.target = '_self';
  };
  addEventListener('click', keepHere, true);
  addEventListener('auxclick', keepHere, true);
  addEventListener('submit', (e) => { const f = e.target; if (f instanceof HTMLFormElement && f.target && f.target !== '_self') f.target = '_self'; }, true);

  // --- Grafica ---
  const CYAN = '#1ec8ff', ICE = '#e6f8ff', DARK = 'rgba(0, 18, 40, .55)'; // DARK: contorno che si vede anche su pagine bianche
  const el = (tag, css, parent) => { const n = document.createElement(tag); Object.assign(n.style, css); if (parent) parent.appendChild(n); return n; };
  let host = null, root = null, cursor = null, label = null, spinner = null, visible = false;
  // Il mirino riparte da dove era nella pagina precedente, così lo vedi volare verso il nuovo bersaglio
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('oscarFxPos')); } catch { return null; } })();
  const pos = saved || { x: innerWidth / 2, y: innerHeight / 2 }, target = { x: pos.x, y: pos.y };

  function mount() {
    if (!document.documentElement) return false;
    if (host) { if (!host.isConnected) document.documentElement.appendChild(host); return true; } // pagina riscritta: lo riattacco
    host = document.createElement('oscar-fx');
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', margin: '0', padding: '0', border: '0',
      background: 'transparent', overflow: 'visible', zIndex: '2147483647', pointerEvents: 'none', display: 'block' });
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'closed' });
    try { host.popover = 'manual'; host.showPopover(); } catch {} // top layer: sopra anche a <dialog> e popup

    // Mirino: anello, croce, punto centrale. Il contenitore si sposta, la parte interna ruota
    cursor = el('div', { position: 'fixed', left: '0', top: '0', width: '0', height: '0', opacity: '0' }, root);
    const spin = el('div', { position: 'absolute', left: '0', top: '0', width: '0', height: '0' }, cursor);
    el('div', { position: 'absolute', left: '-15px', top: '-15px', width: '30px', height: '30px', borderRadius: '50%',
      border: `2px solid ${CYAN}`, boxShadow: `0 0 0 1px ${DARK}, 0 0 14px ${CYAN}, inset 0 0 8px rgba(30,200,255,.5)` }, spin);
    for (const [w, h, l, t] of [[10, 1.5, -23, -0.75], [10, 1.5, 13, -0.75], [1.5, 10, -0.75, -23], [1.5, 10, -0.75, 13]]) {
      el('div', { position: 'absolute', width: `${w}px`, height: `${h}px`, left: `${l}px`, top: `${t}px`, background: CYAN, boxShadow: `0 0 0 1px ${DARK}, 0 0 6px ${CYAN}` }, spin);
    }
    el('div', { position: 'absolute', left: '-2.5px', top: '-2.5px', width: '5px', height: '5px', borderRadius: '50%', background: ICE, boxShadow: `0 0 10px ${ICE}` }, cursor);
    label = el('div', { position: 'absolute', left: '22px', top: '14px', font: '600 10px/1 ui-monospace, Menlo, monospace',
      letterSpacing: '.18em', color: ICE, textShadow: `0 0 3px ${DARK}, 0 0 6px ${CYAN}`, background: DARK, padding: '3px 5px', borderRadius: '2px', whiteSpace: 'nowrap', opacity: '.9' }, cursor);
    spinner = spin.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 9000, iterations: Infinity });
    spinner.pause();
    cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    if (saved) show();
    scan();
    return true;
  }

  // Sopra eventuali <dialog> o popup aperti dalla pagina (il top layer va in ordine di apertura)
  function raise() {
    try { if (document.querySelector(':modal, :popover-open:not(oscar-fx)')) { host.hidePopover(); host.showPopover(); } } catch {}
  }

  // Il mirino si vede solo mentre O.S.C.A.R. agisce: poi sfuma e non fa più disegnare niente (niente fotogrammi inutili)
  let idleTimer = 0, running = false, last = 0;
  function show() {
    if (!visible) { visible = true; cursor.style.opacity = '1'; cursor.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 }); }
    spinner.play();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      spinner.pause();
      cursor.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500 }).onfinish = () => { cursor.style.opacity = '0'; visible = false; };
    }, 2500);
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(follow); }
  }

  // Il mirino vola verso il punto con una scia, invece di saltare; si ferma quando è arrivato
  function follow(t) {
    const k = Math.min(1, (t - last) / 1000 * 9); last = t;
    const px = pos.x, py = pos.y;
    pos.x += (target.x - pos.x) * k; pos.y += (target.y - pos.y) * k;
    if (Math.hypot(target.x - pos.x, target.y - pos.y) < 0.5) { pos.x = target.x; pos.y = target.y; running = false; }
    cursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    if (Math.hypot(pos.x - px, pos.y - py) > 4) trail(pos.x, pos.y);
    if (running) requestAnimationFrame(follow);
  }
  function trail(x, y) {
    const d = el('div', { position: 'fixed', left: `${x - 2}px`, top: `${y - 2}px`, width: '4px', height: '4px', borderRadius: '50%',
      background: CYAN, boxShadow: `0 0 8px ${CYAN}` }, root);
    d.animate([{ opacity: 0.8, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.2)' }], { duration: 420, easing: 'ease-out' }).onfinish = () => d.remove();
  }

  function moveTo(x, y) {
    if (!mount()) return;
    raise();
    target.x = x; target.y = y;
    try { sessionStorage.setItem('oscarFxPos', JSON.stringify(target)); } catch {}
    label.textContent = `X ${Math.round(x)}  Y ${Math.round(y)}`;
    show();
  }

  // Clic: staffe che agganciano il bersaglio, lampo, due onde d'urto, raggi
  function click(x, y) {
    if (!mount()) return;
    moveTo(x, y);
    const fx = el('div', { position: 'fixed', left: `${x}px`, top: `${y}px`, width: '0', height: '0' }, root);
    for (let i = 0; i < 4; i++) {
      const b = el('div', { position: 'absolute', width: '14px', height: '14px', borderColor: ICE, borderStyle: 'solid', borderWidth: '0',
        filter: `drop-shadow(0 0 1px ${DARK}) drop-shadow(0 0 4px ${CYAN})` }, fx);
      const sx = i % 2 ? 1 : -1, sy = i < 2 ? -1 : 1;
      b.style[sy < 0 ? 'borderTopWidth' : 'borderBottomWidth'] = '2px';
      b.style[sx < 0 ? 'borderLeftWidth' : 'borderRightWidth'] = '2px';
      const at = (r) => `translate(${sx * r - 7}px, ${sy * r - 7}px)`;
      b.animate([{ transform: at(54), opacity: 0 }, { transform: at(20), opacity: 1, offset: 0.55 }, { transform: at(20), opacity: 1, offset: 0.8 }, { transform: at(26), opacity: 0 }],
        { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    }
    const disc = el('div', { position: 'absolute', left: '-34px', top: '-34px', width: '68px', height: '68px', borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(230,248,255,.9), rgba(30,200,255,.35) 45%, transparent 70%)' }, fx);
    disc.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 450, easing: 'ease-out', fill: 'both' });
    for (const [delay, size] of [[0, 120], [140, 200]]) {
      const ring = el('div', { position: 'absolute', left: `${-size / 2}px`, top: `${-size / 2}px`, width: `${size}px`, height: `${size}px`,
        borderRadius: '50%', border: `2.5px solid ${CYAN}`, boxShadow: `0 0 0 1px ${DARK}, 0 0 18px ${CYAN}, inset 0 0 12px rgba(30,200,255,.5)` }, fx);
      ring.animate([{ transform: 'scale(.1)', opacity: 1 }, { transform: 'scale(1)', opacity: 0 }], { duration: 700, delay, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ray = el('div', { position: 'absolute', left: '0', top: '-1px', width: '16px', height: '2px', background: ICE, boxShadow: `0 0 6px ${CYAN}`, transformOrigin: '0 50%' }, fx);
      ray.animate([{ transform: `rotate(${a}rad) translateX(8px) scaleX(.2)`, opacity: 1 }, { transform: `rotate(${a}rad) translateX(46px) scaleX(1)`, opacity: 0 }],
        { duration: 520, easing: 'ease-out', fill: 'both' });
    }
    const tag = el('div', { position: 'absolute', left: '30px', top: '-34px', font: '700 11px/1 ui-monospace, Menlo, monospace', letterSpacing: '.3em',
      color: ICE, textShadow: `0 0 8px ${CYAN}`, background: DARK, padding: '4px 7px', borderRadius: '2px', whiteSpace: 'nowrap' }, fx);
    tag.textContent = 'CLIC';
    tag.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 1100, fill: 'both' });
    setTimeout(() => fx.remove(), 1300);
  }

  // Campo di testo: cornice luminosa che pulsa a ogni tasto
  let box = null, boxFor = null;
  function frame(field) {
    if (!mount()) return;
    const r = field.getBoundingClientRect();
    if (!box) {
      box = el('div', { position: 'fixed', border: `2px solid ${CYAN}`, borderRadius: '6px', boxShadow: `0 0 0 1px ${DARK}, 0 0 14px ${CYAN}, inset 0 0 10px rgba(30,200,255,.25)` }, root);
      const t = el('div', { position: 'absolute', left: '0', top: '-20px', font: '700 10px/1 ui-monospace, Menlo, monospace', letterSpacing: '.3em',
        color: ICE, textShadow: `0 0 8px ${CYAN}`, background: DARK, padding: '3px 6px', borderRadius: '2px' }, box);
      t.textContent = 'INPUT';
    }
    boxFor = field;
    Object.assign(box.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`, display: 'block' });
  }
  function pulse() { box?.animate([{ boxShadow: `0 0 28px ${CYAN}, inset 0 0 18px rgba(30,200,255,.5)` }, { boxShadow: `0 0 14px ${CYAN}, inset 0 0 10px rgba(30,200,255,.25)` }], { duration: 260 }); }

  // Pagina nuova: una linea di scansione la attraversa
  function scan() {
    const line = el('div', { position: 'fixed', left: '0', right: '0', top: '0', height: '2px', background: CYAN, boxShadow: `0 0 24px 6px rgba(30,200,255,.55)` }, root);
    line.animate([{ transform: 'translateY(0)', opacity: 0.9 }, { transform: `translateY(${innerHeight}px)`, opacity: 0.2 }], { duration: 900, easing: 'ease-in-out' }).onfinish = () => line.remove();
  }

  // Un clic su un link che cambia pagina: la navigazione parte 0,3 s dopo, così l'aggancio si vede.
  // Solo se la pagina non l'ha già gestito da sé (defaultPrevented), e sotto l'attesa di Playwright (0,5 s).
  addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement && n.href);
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    const url = new URL(a.href, location.href);
    const samePage = url.origin + url.pathname + url.search === location.origin + location.pathname + location.search;
    if (!/^https?:$/.test(url.protocol) || (samePage && url.hash)) return;
    e.preventDefault();
    setTimeout(() => location.assign(url.href), 300);
  });

  const isField = (n) => n instanceof Element && (n.matches('input, textarea, [contenteditable=""], [contenteditable="true"]') || n.isContentEditable);
  addEventListener('mousemove', (e) => moveTo(e.clientX, e.clientY), { capture: true, passive: true });
  addEventListener('mousedown', (e) => click(e.clientX, e.clientY), { capture: true, passive: true });
  addEventListener('focusin', (e) => { if (isField(e.target)) frame(e.target); }, true);
  addEventListener('focusout', () => { if (box) box.style.display = 'none'; boxFor = null; }, true);
  addEventListener('keydown', () => { if (boxFor) { frame(boxFor); pulse(); } }, true);
  addEventListener('scroll', () => { if (boxFor) frame(boxFor); }, { capture: true, passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
