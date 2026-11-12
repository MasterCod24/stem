// meteo-mappa.mjs — rifà public/meteo/mappa.json, la mappa del globo della vista meteo: terre, laghi, confini di terra e città,
// dai GeoJSON di Natural Earth 5.1.2 (pubblico dominio). Non è una prova: si lancia solo per cambiare la mappa.
//   node prove/meteo-mappa.mjs <cartella con i .geojson>
// I file, da https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson:
//   ne_50m_land e ne_50m_lakes (anelli chiusi), ne_50m_admin_0_boundary_lines_land (linee) e ne_10m_populated_places (città,
//   coi nomi italiani)
// Formato: { linee: { coste, confini, laghi }, citta }. Ogni linea è [lon, lat, dlon, dlat, …] in centesimi di grado (circa 1 km),
// il primo punto intero e gli altri come differenze; semplificata con Douglas-Peucker a 0,01°: la scala 1:50 milioni non ha di
// più. Ogni città è [nome, lon, lat, migliaia di abitanti], sempre in centesimi di grado.
// Coste e laghi sono anelli chiusi (l'ultimo punto torna sul primo): il globo li riempie per sapere dove è terra, e li disegna
// come linee. Le terre tagliate a ±180° e l'Antartide hanno lati finti lungo l'antimeridiano e a −90°: chi disegna li salta.
// Fino al 12/11 le coste venivano da ne_50m_coastline e un anello chiuso usciva vuoto (vedi semplifica): restavano 24 linee
// aperte, senza isole né laghi.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.argv[2];
if (!DIR) { console.error('uso: node prove/meteo-mappa.mjs <cartella con i .geojson di Natural Earth>'); process.exit(1); }
const USCITA = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public', 'meteo', 'mappa.json');
const leggi = (f) => JSON.parse(fs.readFileSync(path.join(DIR, `${f}.geojson`), 'utf8'));

// Douglas-Peucker, senza ricorsione. Su un anello chiuso il primo e l'ultimo punto coincidono: la corda è lunga zero e conta
// la distanza dal punto, non dalla retta (prima ogni distanza valeva 0 e l'anello si riduceva ai due estremi).
function semplifica(p, eps) {
  if (p.length < 3) return p;
  const tieni = new Uint8Array(p.length), pila = [[0, p.length - 1]];
  tieni[0] = tieni[p.length - 1] = 1;
  while (pila.length) {
    const [a, b] = pila.pop(), [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
    let m = -1, dm = 0;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-9 ? Math.abs(dy * (p[i][0] - x1) - dx * (p[i][1] - y1)) / L : Math.hypot(p[i][0] - x1, p[i][1] - y1);
      if (d > dm) { dm = d; m = i; }
    }
    if (dm > eps && m > 0) { tieni[m] = 1; pila.push([a, m], [m, b]); }
  }
  return p.filter((_, i) => tieni[i]);
}
function linee(f) {
  const out = [];
  for (const ft of leggi(f).features) {
    const g = ft.geometry;
    if (!g) continue;
    const ls = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' || g.type === 'Polygon' ? g.coordinates
      : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    for (const l of ls) {
      const a = [];
      let px = 0, py = 0;
      for (const [x, y] of semplifica(l, 0.01)) {
        const qx = Math.round(x * 100), qy = Math.round(y * 100);
        if (a.length && qx === px && qy === py) continue;
        a.push(qx - px, qy - py); px = qx; py = qy;
      }
      if (a.length >= (g.type.endsWith('Polygon') ? 6 : 4)) out.push(a); // un anello vuole almeno tre punti
    }
  }
  return out;
}
// Le città che servono a orientarsi sul radar: oltre 100 mila abitanti, o importanti per Natural Earth (scalerank ≤ 7)
const citta = leggi('ne_10m_populated_places').features.map((f) => f.properties)
  .filter((p) => p.POP_MAX >= 100_000 || p.SCALERANK <= 7)
  .sort((a, b) => b.POP_MAX - a.POP_MAX)
  .map((p) => [String(p.NAME_IT || p.NAME).trim(), Math.round(p.LONGITUDE * 100), Math.round(p.LATITUDE * 100), Math.round(p.POP_MAX / 1000)]);
const mappa = { linee: { coste: linee('ne_50m_land'), confini: linee('ne_50m_admin_0_boundary_lines_land'), laghi: linee('ne_50m_lakes') }, citta };
fs.writeFileSync(USCITA, JSON.stringify(mappa));
const punti = Object.values(mappa.linee).flat().reduce((n, l) => n + l.length / 2, 0);
console.log(`${USCITA}: ${punti} punti, ${citta.length} città, ${fs.statSync(USCITA).size} B`);
