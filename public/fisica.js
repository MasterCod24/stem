// O.S.C.A.R. — il moto dell'HUD. Tutto quello che si muove segue un'equazione: niente durate e curve scelte a occhio.
//
// La molla è un oscillatore smorzato, x'' + 2ζω·x' + ω²·(x − meta) = 0, integrato in forma esatta: stabile a ogni passo,
// anche con un fotogramma perso. Si sceglie col tempo ts (secondi) in cui l'inviluppo scende al 2% e con lo smorzamento
// ζ: ω = 4 / (ζ·ts). Con un po' di rimbalzo la corsa vera entra nel 2% prima (corpo: 0,21 s su 0,3, prove/fisica.mjs).
// Cambiare meta a metà corsa tiene la velocità: niente scatti quando lo stato cambia di nuovo.
//
// Le transizioni CSS usano la stessa molla: curvaCSS() ne campiona la risposta a gradino in una funzione linear(),
// e avvia() la mette in --molla e --t-molla. Così anche quello che si anima in CSS ha la stessa fisica.

// Le due molle dell'HUD. «corpo»: le cose con una massa (nucleo, schede, pannelli), un filo di rimbalzo (2%).
// «lieve»: opacità e colori, smorzamento critico, senza rimbalzo.
export const MOTO = { corpo: { ts: 0.3, zeta: 0.78 }, lieve: { ts: 0.22, zeta: 1 } };

// Avanza di dt secondi l'errore e = x − meta e la velocità v. Restituisce [e, v].
function avanza(e, v, w, z, dt) {
  if (z < 1) {
    const a = z * w, wd = w * Math.sqrt(1 - z * z), c = Math.cos(wd * dt), s = Math.sin(wd * dt), k = Math.exp(-a * dt);
    return [k * (e * c + ((v + a * e) / wd) * s), k * (v * c - ((a * v + w * w * e) / wd) * s)];
  }
  const k = Math.exp(-w * dt), b = v + w * e; // smorzamento critico
  return [(e + b * dt) * k, (v - w * b * dt) * k];
}
const omega = ({ ts, zeta }) => (zeta < 1 ? 4 / (zeta * ts) : 5.83 / ts); // critico: al 2% dopo 5,83/ω

export function molla(x = 0, tipo = MOTO.corpo) {
  const w = omega(tipo), z = tipo.zeta;
  return {
    x, v: 0, meta: x,
    verso(m) { this.meta = m; return this; },
    salta(m) { this.x = this.meta = m; this.v = 0; return this; },
    passo(dt) {
      if (this.ferma()) { this.x = this.meta; this.v = 0; return this.x; }
      const [e, v] = avanza(this.x - this.meta, this.v, w, z, Math.max(0, dt));
      this.x = this.meta + e; this.v = v;
      return this.x;
    },
    ferma(eps = 1e-4) { return Math.abs(this.x - this.meta) < eps && Math.abs(this.v) < eps * 10; },
  };
}

// La risposta a gradino da 0 a 1, campionata finché l'inviluppo non scende sotto lo 0,2%: quello che resta non si vede.
export function curvaCSS(tipo = MOTO.corpo, n = 36) {
  const w = omega(tipo), z = tipo.zeta;
  const a = z < 1 ? z * w : w, wd = z < 1 ? w * Math.sqrt(1 - z * z) : 0;
  // fine: per ζ < 1 l'inviluppo è e^(−at)·√(1 + (a/ωd)²); per ζ = 1 basta (1 + ωt)e^(−ωt) < 0,002, cioè circa 8,4/ω
  const fine = z < 1 ? Math.log(Math.sqrt(1 + (a / wd) ** 2) / 0.002) / a : 8.4 / w;
  const punti = [];
  for (let i = 0; i <= n; i++) {
    const t = (fine * i) / n, [e] = avanza(-1, 0, w, z, t);
    punti.push(i === n ? 1 : +(1 + e).toFixed(4));
  }
  return { linear: `linear(${punti.join(', ')})`, ms: Math.round(fine * 1000) };
}

// Le variabili CSS: --molla e --t-molla per le cose con massa, --lieve e --t-lieve per opacità e colori.
export function avvia(radice = document.documentElement) {
  const c = curvaCSS(MOTO.corpo), l = curvaCSS(MOTO.lieve);
  radice.style.setProperty('--molla', c.linear); radice.style.setProperty('--t-molla', `${c.ms}ms`);
  radice.style.setProperty('--lieve', l.linear); radice.style.setProperty('--t-lieve', `${l.ms}ms`);
  return { corpo: c, lieve: l };
}
