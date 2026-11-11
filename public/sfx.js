// Effetti sonori di Nexus: sintesi Web Audio pura, nessun file audio.
// Ricostruiti misurando lo spettrogramma del video di riferimento:
//   formazione  fondamentale ~30 → 77 Hz (esponenziale) con molte armoniche, passa-basso
//               risonante che si apre ~240 Hz → ~1.9 kHz, scaletta di blip k×49.2 Hz,
//               stop netto, poi "ting" ~2.95 kHz
//   rivelazione ronzio ~207 Hz (Sol#3) con ronzio di Sol#1 sotto, attacco morbido, ~0.7 s
//   ascolto     due seni a ~207 Hz che battono a ~1.5 Hz: gli "impulsi" sonar
//   conferma    pop basso, poi ~294 Hz (Re4) e ~880 Hz (La5) sfalsati
//   report      dal video di ROSE (34,4–36,6 s): salita a gradini prima di ogni ondata di pannelli,
//               tappeto di toni fissi pulsati a ~24 Hz mentre volano, colpo quando atterra il
//               protagonista, blip acuto ~10,6 kHz per ogni scheda che atterra
// Ogni metodo accetta un istante facoltativo (secondi di ctx) da cui partire: serve al
// rendering offline; senza argomenti parte subito.

export function createSfx(ctx) {
  const out = ctx.createGain();
  out.gain.value = 0.9;                       // formazione a ~-6 dBFS di picco
  const now = () => ctx.currentTime;

  // spazio: riverbero corto sintetico, mandata bassa
  const verb = ctx.createConvolver();
  verb.buffer = impulse(1.6, 0.32);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  verb.connect(wet).connect(out);

  const noise = noiseBuffer(2);

  // una voce: guadagno → uscita, più una mandata al riverbero
  function voice(level, send) {
    const g = ctx.createGain();
    g.gain.value = 0;
    const v = ctx.createGain();
    v.gain.value = level;
    g.connect(v).connect(out);
    if (send) { const s = ctx.createGain(); s.gain.value = send; v.connect(s).connect(verb); }
    return g;
  }
  function osc(type, f, a, b, dest, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    if (dest) o.connect(dest);
    o.start(a);
    if (Number.isFinite(b)) o.stop(b);
    return o;
  }
  function filt(type, f, q, gain) {
    const n = ctx.createBiquadFilter();
    n.type = type; n.frequency.value = f;
    if (q !== undefined) n.Q.value = q;
    if (gain !== undefined) n.gain.value = gain;
    return n;
  }
  function chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[0]; }
  // curva da punti [u, valore] con u 0..1, interpolata in scala logaritmica
  function logCurve(pts, n = 96) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      let k = 0; while (k < pts.length - 2 && u > pts[k + 1][0]) k++;
      const [u0, v0] = pts[k], [u1, v1] = pts[k + 1];
      const w = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
      c[i] = Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * w);
    }
    return c;
  }

  // ── formazione ─────────────────────────────────────────────────────────────
  // fine = secondi dopo t0 in cui la formazione si chiude (stop netto del tappeto)
  function boot(t0 = now(), fine = 4.1) {
    const L = Math.min(3.73, fine - 0.05);
    const a = t0 + fine - L, b = t0 + fine;
    // fondamentale misurata (u = frazione della durata)
    const F0 = logCurve([[0, 29.8], [0.064, 30.6], [0.172, 33.6], [0.306, 38.5], [0.44, 44],
      [0.574, 50.5], [0.708, 58], [0.842, 66.5], [1, 77]]);
    // taglio del passa-basso: lento all'inizio, poi si spalanca
    const FC = logCurve([[0, 190], [0.17, 220], [0.24, 250], [0.306, 300], [0.44, 420], [0.574, 560],
      [0.64, 800], [0.708, 1050], [0.775, 1450], [0.842, 1800], [1, 2200]]);

    const v = voice(1, 0.12);
    const lp = filt('lowpass', 230, 10);       // Q in dB: picco risonante che sale
    // sotto i 100 Hz il riferimento è quasi vuoto: passa-alto ripido (8° ordine) + corpo sui 125 Hz
    const hp = [-5.85, -4.42, -0.92, 8.17].map(q => filt('highpass', 112, q));
    const pk = filt('peaking', 121, 4, 7);    // le armoniche che ci passano sopra si accendono a turno
    // due passa-tutto spalmano i fronti dell'impulso: meno picco a parità di volume
    const ap = [filt('allpass', 260, 0.7), filt('allpass', 900, 0.7)];
    chain(lp, ...hp, pk, ...ap, v);
    lp.frequency.setValueCurveAtTime(FC, a, L);
    // onda a impulsi al 18% = dente di sega meno sé stessa ritardata di 0.18/f0:
    // 5ª armonica quasi spenta, come nel riferimento
    const D = F0.map(f => 0.195 / f);
    const saw = osc('sawtooth', 30, a, b + 0.08, lp);
    saw.frequency.setValueCurveAtTime(F0, a, L);
    const dl = ctx.createDelay(0.05), neg = ctx.createGain();
    neg.gain.value = -1;
    saw.connect(dl).connect(neg).connect(lp);
    dl.delayTime.setValueCurveAtTime(D, a, L);
    // volume: attacco secco, crescendo nell'ultimo terzo, stop netto
    const e = v.gain;
    e.setValueAtTime(0, a);
    e.linearRampToValueAtTime(0.088, a + 0.03);
    e.setValueCurveAtTime(new Float32Array([0.088, 0.096, 0.1, 0.098, 0.1, 0.104, 0.104, 0.11, 0.21, 0.27, 0.255, 0.235]),
      a + 0.04, L - 0.06);
    e.setValueAtTime(0.235, b - 0.02);
    e.setTargetAtTime(0, b - 0.01, 0.025);

    // scaletta di blip acuti: armoniche 21..47 di 49.2 Hz, sempre più fitte
    const st = voice(1, 0.35);
    let t = a - 0.04, dt = 0.135 * (L / 3.73);
    for (let k = 21; k <= 47 && t < a + L * 0.68; k++) {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(st);
      const lv = 0.0026 * (1 + (k - 21) / 18);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lv, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.02, 0.025);
      const o = osc('sine', 49.2 * k, t, t + 0.16, g);
      o.frequency.setValueAtTime(49.2 * k, t + 0.03);
      o.frequency.exponentialRampToValueAtTime(49.2 * k * 0.985, t + 0.15);
      t += dt; dt *= 0.968;
    }
    st.gain.setValueAtTime(1, a);

    // ting dopo lo stop: ~2.95 kHz che sale appena
    const tg = voice(1, 0.5), tt = b + 0.13;
    tg.gain.setValueAtTime(0, tt);
    tg.gain.linearRampToValueAtTime(0.026, tt + 0.03);
    tg.gain.setTargetAtTime(0, tt + 0.06, 0.06);
    const o = osc('sine', 2940, tt, tt + 0.5, tg);
    o.frequency.setValueAtTime(2940, tt);
    o.frequency.linearRampToValueAtTime(3000, tt + 0.15);

    // coda: la risonanza che si spegne (~935 Hz) e un letto quieto Do3 + Sol#3
    const rg = voice(1, 0.4);
    rg.gain.setValueAtTime(0, b - 0.06);
    rg.gain.linearRampToValueAtTime(0.012, b);
    rg.gain.setTargetAtTime(0, b + 0.05, 0.22);
    osc('sine', 935, b - 0.06, b + 1.6, rg);
    bed(b + 0.1, b + 0.45, b + 1.3, 1.1, 0.008);
    // aria dopo lo stop: fruscio che si scurisce e si spegne in qualche secondo
    const air = voice(1, 0.2);
    const ns = ctx.createBufferSource(); ns.buffer = noise; ns.loop = true;
    const ah = filt('highpass', 150, 0), al = filt('lowpass', 2500, 0);
    chain(ns, ah, al, air);
    ns.start(b); ns.stop(b + 16);
    al.frequency.setValueAtTime(2500, b);
    al.frequency.exponentialRampToValueAtTime(1000, b + 0.7);
    air.gain.setValueAtTime(0, b);
    air.gain.linearRampToValueAtTime(0.13, b + 0.1);
    air.gain.setTargetAtTime(0.08, b + 0.3, 0.3);
    air.gain.setTargetAtTime(0, b + 1.2, 3.5);
    return fine;
  }

  // letto tenue: Do3 + Sol#3 con un respiro lento; a = attacco, h = inizio rilascio
  function bed(a, full, h, tau, lv) {
    const g = voice(1, 0.3);
    g.gain.setValueAtTime(0, a);
    g.gain.linearRampToValueAtTime(lv, full);
    const br = ctx.createGain(); br.connect(g);              // respiro: 0.65..1.35
    const dep = ctx.createGain(); dep.gain.value = 0.35; dep.connect(br.gain);
    const lfo = osc('sine', 0.31, a, Infinity, dep);
    const hi = ctx.createGain(); hi.gain.value = 0.35; hi.connect(br);
    const oo = [lfo, osc('sine', 130.8, a, Infinity, br), osc('sine', 207.6, a, Infinity, br, 4), osc('sine', 932, a, Infinity, hi)];
    if (h !== Infinity) { g.gain.setTargetAtTime(0, h, tau); for (const o of oo) o.stop(h + tau * 7); }
    return { g, oo };
  }

  // ── rivelazione: ronzio che si gonfia mentre l'anello si allarga ───────────
  function reveal(t0 = now()) {
    const v = voice(1, 0.25);
    // ruvidità: modulazione d'ampiezza a 25.9 Hz (bande laterali a 181 e 233 Hz, puntinato)
    const lfo = osc('sine', 25.9, t0, t0 + 1.6, null);
    const am = (depth, dest) => {
      const g = ctx.createGain(), d = ctx.createGain();
      d.gain.value = depth; lfo.connect(d).connect(g.gain); g.connect(dest);
      return g;
    };
    const m = osc('sine', 205.5, t0, t0 + 1.6, am(0.14, v));
    m.frequency.linearRampToValueAtTime(209.5, t0 + 0.7);
    m.frequency.linearRampToValueAtTime(207.5, t0 + 1.0);
    v.gain.setValueAtTime(0, t0);
    v.gain.setTargetAtTime(0.23, t0, 0.13);
    v.gain.setTargetAtTime(0, t0 + 0.52, 0.22);

    // ronzio di Sol#1 sopra: armoniche 311, 363, 415, 519 … fino a ~1.2 kHz, quasi piatte
    const z = voice(1, 0.35);
    const h1 = filt('highpass', 260, 0.7), h2 = filt('highpass', 260, 0.7), lp = filt('lowpass', 2500, 0);
    chain(h1, h2, lp, am(0.5, z));
    osc('sawtooth', 51.9, t0, t0 + 1.4, h1);
    z.gain.setValueAtTime(0, t0);
    z.gain.setTargetAtTime(0.17, t0 + 0.03, 0.1);
    z.gain.setTargetAtTime(0.085, t0 + 0.55, 0.15);
    z.gain.setTargetAtTime(0, t0 + 0.8, 0.12);

    // soffio d'aria acuto con l'onda
    const w = voice(1, 0.4);
    const src = ctx.createBufferSource(); src.buffer = noise;
    const nb = filt('bandpass', 2600, 0.45);
    chain(src, nb, w);
    src.start(t0); src.stop(t0 + 1.4);
    w.gain.setValueAtTime(0, t0);
    w.gain.setTargetAtTime(0.03, t0 + 0.05, 0.12);
    w.gain.setTargetAtTime(0, t0 + 0.7, 0.15);
  }

  // ── ascolto: pochi impulsi sonar (battimento), poi silenzio ────────────────
  let listening = null, lastListen = -1e9;
  function listen(t0 = now()) {
    if (listening && t0 < listening.end) return;           // già in corso: niente doppioni
    const tired = t0 - lastListen < 25 ? 0.6 : 1;            // se ascolta spesso, più discreto
    lastListen = t0;
    const keep = tired < 1 ? 0.95 : 1.75, end = t0 + keep + 3;   // da stanco: due impulsi invece di tre
    const v = voice(1, 0.3);
    const f = 207.6, beat = 1.48;                             // un impulso ogni ~0.68 s
    osc('sine', f, t0, end, v);
    const inv = ctx.createGain(); inv.gain.value = -1; inv.connect(v);   // in controfase: si parte dal silenzio
    osc('sine', f + beat, t0, end, inv);
    const lv = 0.032 * tired;
    v.gain.setValueAtTime(0, t0);
    v.gain.linearRampToValueAtTime(lv, t0 + 0.1);
    v.gain.setValueAtTime(lv, t0 + keep);
    v.gain.setTargetAtTime(0, t0 + keep, 0.42);

    // primo anello: fioritura leggera di La2 sopra
    const z = voice(1, 0.35);
    const hb = filt('highpass', 205, 0.7), hb2 = filt('highpass', 205, 0.7), lb = filt('lowpass', 800, 0);
    chain(hb, hb2, lb, z);
    osc('sawtooth', 110, t0, t0 + 1.2, hb, 8);
    osc('sawtooth', 110, t0, t0 + 1.2, hb, -8);              // battono: lo scintillio a puntini
    z.gain.setValueAtTime(0, t0);
    z.gain.setTargetAtTime(0.1 * tired, t0 + 0.05, 0.1);
    z.gain.setTargetAtTime(0, t0 + 0.45, 0.13);
    listening = { g: v.gain, z: z.gain, end: t0 + keep + 1.2 };
  }

  // ── conferma: la frase è presa, Nexus sta per rispondere ────────────────────
  function ack(t0 = now()) {
    if (listening && t0 < listening.end) {                    // zittisce il sonar
      for (const p of [listening.g, listening.z]) { hold(p, t0); p.setTargetAtTime(0, t0, 0.04); }
      listening.end = t0;
    }
    // pop basso (112 + 190 Hz) con un'unghiata a 415 Hz appena prima
    const p = voice(1, 0.15);
    p.gain.setValueAtTime(0, t0);
    p.gain.linearRampToValueAtTime(0.11, t0 + 0.065);
    p.gain.setTargetAtTime(0.016, t0 + 0.075, 0.022);
    p.gain.setTargetAtTime(0, t0 + 0.2, 0.05);
    osc('sine', 112, t0, t0 + 0.6, p);
    const p2 = ctx.createGain(); p2.gain.value = 0.7; p2.connect(p);
    osc('sine', 190, t0, t0 + 0.6, p2);
    const q = voice(1, 0.2);
    q.gain.setValueAtTime(0, t0);
    q.gain.linearRampToValueAtTime(0.055, t0 + 0.035);
    q.gain.setTargetAtTime(0, t0 + 0.05, 0.04);
    osc('sine', 415, t0, t0 + 0.5, q);
    // primo tono: Re4, attacco breve, decadimento rapido poi una coda che resta
    const d = voice(1, 0.3), td = t0 + 0.05;
    d.gain.setValueAtTime(0, td);
    d.gain.linearRampToValueAtTime(0.26, td + 0.08);
    d.gain.setTargetAtTime(0.2, td + 0.08, 0.06);
    d.gain.setTargetAtTime(0.03, td + 0.17, 0.05);
    d.gain.setTargetAtTime(0, td + 0.75, 0.18);
    osc('sine', 294, td, td + 2.2, d);
    // secondo tono: La5, entra subito dopo
    const h = voice(1, 0.45), th = t0 + 0.11;
    h.gain.setValueAtTime(0, th);
    h.gain.linearRampToValueAtTime(0.07, th + 0.07);
    h.gain.setTargetAtTime(0.002, th + 0.09, 0.055);
    h.gain.setTargetAtTime(0, th + 0.4, 0.2);
    osc('sine', 880, th, th + 2.0, h);
    // scintilla
    const s = voice(1, 0.3), ts = t0 + 0.09;
    s.gain.setValueAtTime(0, ts);
    s.gain.linearRampToValueAtTime(0.012, ts + 0.02);
    s.gain.setTargetAtTime(0, ts + 0.03, 0.03);
    osc('sine', 1106, ts, ts + 0.3, s);
  }

  // ── report: i pannelli che entrano. plan = { hero, lands } in secondi dall'apertura (da report.js) ──
  function report({ hero, lands }, t0 = now()) {
    steps(t0, 0.22);                                          // prima ondata: lampo e protagonista
    shimmer(t0 + 0.2, t0 + hero);
    thud(t0 + hero);
    if (!lands.length) return;
    steps(t0 + hero + 0.04, 0.2);                             // seconda ondata: le schede
    shimmer(t0 + hero + 0.24, t0 + Math.max(...lands) + 0.12);
    for (const t of lands) blip(t0 + t);
  }
  // salita a gradini: due file di note brevi, 1,45 → 2,9 kHz e 6,9 → 8,6 kHz
  function steps(a, len) {
    const v = voice(1, 0.3), n = 6;
    v.gain.setValueAtTime(1, a);
    for (let k = 0; k < n; k++) {
      const t = a + (len * k) / n, u = k / (n - 1);
      for (const [f0, f1, lv] of [[1450, 2900, 0.011], [6900, 8600, 0.007]]) {
        const g = ctx.createGain(); g.gain.value = 0; g.connect(v);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lv, t + 0.006);
        g.gain.setTargetAtTime(0, t + 0.018, 0.014);
        osc('sine', f0 * Math.pow(f1 / f0, u), t, t + 0.12, g);
      }
    }
  }
  // tappeto di dati: toni fissi con un tremolo a ~24 Hz (i puntini dello spettrogramma)
  function shimmer(a, b) {
    if (b - a < 0.05) return;
    const v = voice(1, 0.25), am = ctx.createGain(), d = ctx.createGain();
    am.gain.value = 0.5; d.gain.value = 0.5;                  // tremolo pieno: puntini netti, come nel riferimento
    osc('sine', 24, a, b + 0.3, d);
    d.connect(am.gain); am.connect(v);
    for (const [f, lv] of [[1850, 0.012], [7600, 0.004], [8500, 0.006], [10400, 0.002], [10800, 0.011]]) {
      const g = ctx.createGain(); g.gain.value = lv; g.connect(am);
      osc('sine', f, a, b + 0.3, g);
    }
    v.gain.setValueAtTime(0, a);
    v.gain.linearRampToValueAtTime(1, a + 0.03);
    v.gain.setValueAtTime(1, b - 0.02);
    v.gain.setTargetAtTime(0, b - 0.02, 0.04);
  }
  // il protagonista atterra: schiocco largo (rumore sui 2 kHz) e un tonfo che scende
  function thud(a) {
    const v = voice(1, 0.3);
    const src = ctx.createBufferSource(); src.buffer = noise;
    chain(src, filt('bandpass', 2000, 0.8), v);
    src.start(a, 0.3); src.stop(a + 0.1);
    v.gain.setValueAtTime(0, a);
    v.gain.linearRampToValueAtTime(0.05, a + 0.004);
    v.gain.setTargetAtTime(0, a + 0.01, 0.018);
    const p = voice(1, 0.15);
    const o = osc('sine', 150, a, a + 0.35, p);
    o.frequency.exponentialRampToValueAtTime(62, a + 0.14);
    p.gain.setValueAtTime(0, a);
    p.gain.linearRampToValueAtTime(0.12, a + 0.008);
    p.gain.setTargetAtTime(0, a + 0.03, 0.05);
  }
  // una scheda atterra: soffio stretto sui 10,6 kHz. Modulazione ad anello (seno × rumore sotto i 450 Hz):
  // un passa-banda sul rumore lascerebbe fianchi larghi fino a 1 kHz, il riferimento invece è una macchia stretta
  function blip(a) {
    const v = voice(1, 0.35), ring = ctx.createGain();
    ring.gain.value = 0; ring.connect(v);
    const src = ctx.createBufferSource(); src.buffer = noise;
    chain(src, filt('lowpass', 450, 0.7), filt('lowpass', 450, 0.7), ring.gain);
    src.start(a, (a * 7.3) % 1.5); src.stop(a + 0.12);
    osc('sine', 10600, a, a + 0.12, ring);
    v.gain.setValueAtTime(0, a);
    v.gain.linearRampToValueAtTime(0.5, a + 0.008);
    v.gain.setTargetAtTime(0, a + 0.025, 0.02);
  }

  // ── ologramma: gli stessi attrezzi del report, per i gesti sul modello ─────
  // soffio di rumore filtrato che sale (si apre) o scende (si richiude)
  function whoosh(a, len, f0, f1, lv) {
    const v = voice(1, 0.35), src = ctx.createBufferSource(); src.buffer = noise;
    const bp = filt('bandpass', f0, 1.2);
    chain(src, bp, v);
    src.start(a, (a * 3.1) % 1.2); src.stop(a + len + 0.2);
    bp.frequency.setValueAtTime(f0, a);
    bp.frequency.exponentialRampToValueAtTime(f1, a + len);
    v.gain.setValueAtTime(0, a);
    v.gain.linearRampToValueAtTime(lv, a + len * 0.35);
    v.gain.setTargetAtTime(0, a + len * 0.6, len * 0.25);
  }
  // vista esplosa: i pezzi si allontanano (salita a gradini e soffio) o si riuniscono (soffio che scende e tonfo)
  function esplodi(apre = true, t0 = now()) {
    if (apre) { steps(t0, 0.2); whoosh(t0 + 0.04, 0.5, 600, 3200, 0.05); shimmer(t0 + 0.1, t0 + 0.55); }
    else { whoosh(t0, 0.42, 3000, 500, 0.045); thud(t0 + 0.45); }
  }
  // sezione: una scansione, seno che sale con il tremolo dei dati, e un blip quando il piano si ferma
  function sezione(t0 = now()) {
    const v = voice(1, 0.3), am = ctx.createGain(), d = ctx.createGain();
    am.gain.value = 0.5; d.gain.value = 0.5;
    osc('sine', 24, t0, t0 + 0.5, d);
    d.connect(am.gain); am.connect(v);
    const o = osc('sine', 1200, t0, t0 + 0.5, am);
    o.frequency.exponentialRampToValueAtTime(2600, t0 + 0.36);
    v.gain.setValueAtTime(0, t0);
    v.gain.linearRampToValueAtTime(0.02, t0 + 0.04);
    v.gain.setTargetAtTime(0, t0 + 0.3, 0.05);
    blip(t0 + 0.38);
  }
  // afferra: presa secca, un pop più alto del tonfo del report e un blip
  function afferra(t0 = now()) {
    const p = voice(1, 0.15);
    const o = osc('sine', 340, t0, t0 + 0.2, p);
    o.frequency.exponentialRampToValueAtTime(170, t0 + 0.07);
    p.gain.setValueAtTime(0, t0);
    p.gain.linearRampToValueAtTime(0.09, t0 + 0.005);
    p.gain.setTargetAtTime(0, t0 + 0.02, 0.03);
    blip(t0 + 0.015);
  }
  // lancia: il pezzo vola via, soffio e tono che scendono
  function lancia(t0 = now()) {
    whoosh(t0, 0.38, 2600, 380, 0.06);
    const v = voice(1, 0.3), o = osc('sine', 950, t0, t0 + 0.5, v);
    o.frequency.exponentialRampToValueAtTime(190, t0 + 0.4);
    v.gain.setValueAtTime(0, t0);
    v.gain.linearRampToValueAtTime(0.025, t0 + 0.03);
    v.gain.setTargetAtTime(0, t0 + 0.2, 0.08);
  }
  // calcolo finito: gradini fitti, tappeto di dati, poi il La5 della conferma
  function calcolo(t0 = now()) {
    steps(t0, 0.3);
    shimmer(t0 + 0.06, t0 + 0.36);
    const h = voice(1, 0.45), th = t0 + 0.38;
    h.gain.setValueAtTime(0, th);
    h.gain.linearRampToValueAtTime(0.06, th + 0.05);
    h.gain.setTargetAtTime(0, th + 0.12, 0.15);
    osc('sine', 880, th, th + 1.2, h);
  }

  // ── elaborazione: letto quasi impercettibile ───────────────────────────────
  let thinking = null;
  function think(on, t0 = now()) {
    if (on && !thinking) thinking = bed(t0, t0 + 1.2, Infinity, 0, 0.0045);
    else if (!on && thinking) {
      const { g, oo } = thinking; thinking = null;
      hold(g.gain, t0); g.gain.setTargetAtTime(0, t0, 0.18);
      for (const o of oo) o.stop(t0 + 1.4);
    }
  }

  function hold(p, t) {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
  }

  // ── materiali ─────────────────────────────────────────────────────────────
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
  function noiseBuffer(sec) {
    const b = ctx.createBuffer(1, Math.round(sec * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0), r = rng(7);
    for (let i = 0; i < d.length; i++) d[i] = r();
    return b;
  }
  // risposta all'impulso: rumore stereo che decade, più scuro verso la coda
  function impulse(sec, tau) {
    const sr = ctx.sampleRate, n = Math.round(sec * sr), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), r = rng(11 + c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, k = 0.55 - 0.4 * (t / sec);
        lp += k * (r() - lp);
        d[i] = lp * Math.exp(-t / tau) * Math.min(1, t / 0.004);
      }
    }
    return b;
  }

  return { out, boot, reveal, listen, ack, think, report, esplodi, sezione, afferra, lancia, calcolo };
}
