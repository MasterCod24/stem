// demo.js — due modelli nel formato del contratto, per il laboratorio e per provare l'ologramma senza il cervello.
// DEMO_TURBOFAN è un motore a reazione generico fatto di primitive (82 pezzi, 11 gruppi, interni e cavi con
// flusso): non è un motore vero, le misure sono plausibili e i materiali indicativi. DEMO_STAFFA è una staffa
// a L in alluminio 6061 con fori, già incastrata al muro e caricata, pronta per il calcolo degli sforzi.

const r2 = (v) => Math.round(v * 100) / 100;
const giro = (n, passo = 360 / n, da = 0) => Array.from({ length: n }, (_, k) => da + k * passo);
const ASSE_X = [0, 0, 90]; // le forme con l'asse lungo Y locale, girate lungo X (il motore sta disteso)

function turbofan() {
  const P = [];
  const metti = (gruppo, esplodi, lista) => { for (const p of lista) P.push({ gruppo, esplodi, ...p }); };

  metti('gondola', [0, 1.6, 0], [
    { id: 'presa', nome: "labbro della presa d'aria", forma: 'toro', misure: { R: 880, r: 40 }, posizione: [0, 0, 0], rotazione: ASSE_X, materiale: 'alluminio-6061' },
    { id: 'carenatura-fan', nome: 'carenatura del fan', forma: 'tubo', misure: { r: 920, r_interno: 880, h: 1300 }, posizione: [650, 0, 0], rotazione: ASSE_X, materiale: 'fibra-carbonio' },
    { id: 'carenatura-post', nome: 'carenatura posteriore', forma: 'tubo', misure: { r: 860, r_interno: 830, h: 800 }, posizione: [1700, 0, 0], rotazione: ASSE_X, materiale: 'fibra-carbonio' },
  ]);
  metti('pilone', [0, 2.4, 0], [
    { id: 'pilone', nome: 'pilone', forma: 'scatola', misure: { x: 1500, y: 260, z: 140 }, posizione: [1250, 1050, 0], materiale: 'titanio-ti6al4v' },
    { id: 'attacco-ant', nome: 'attacco anteriore', forma: 'scatola', misure: { x: 120, y: 80, z: 160 }, posizione: [700, 1220, 0], materiale: 'titanio-ti6al4v' },
    { id: 'attacco-post', nome: 'attacco posteriore', forma: 'scatola', misure: { x: 120, y: 80, z: 160 }, posizione: [1800, 1220, 0], materiale: 'titanio-ti6al4v' },
  ]);
  metti('fan', [-1.6, 0, 0], [
    { id: 'ogiva', nome: 'ogiva', forma: 'cono', misure: { r: 230, h: 380 }, posizione: [290, 0, 0], rotazione: ASSE_X, materiale: 'alluminio-6061' },
    { id: 'disco-fan', nome: 'disco del fan', forma: 'cilindro', misure: { r: 280, h: 140 }, posizione: [520, 0, 0], rotazione: ASSE_X, materiale: 'titanio-ti6al4v' },
    // pale: Y locale lungo il raggio, la corda (X) girata di 32° attorno al raggio, poi il giro attorno a X
    ...giro(18).map((a, k) => ({
      id: `pala-fan-${k + 1}`, nome: `pala del fan ${k + 1}`, forma: 'scatola', misure: { x: 160, y: 590, z: 12 },
      posizione: [520, r2(585 * Math.cos(a * Math.PI / 180)), r2(585 * Math.sin(a * Math.PI / 180))], rotazione: [a, 32, 0], materiale: 'fibra-carbonio',
    })),
  ]);
  metti('albero', null, [
    { id: 'albero', nome: 'albero', forma: 'cilindro', misure: { r: 55, h: 2500 }, posizione: [1450, 0, 0], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true },
  ]);
  metti('compressore', [-0.7, 0, 0], [
    ...[9, 8.6, 8.2, 7.8, 7.4, 7].map((m, k) => ({
      id: `compressore-${k + 1}`, nome: `stadio del compressore ${k + 1}`, forma: 'ingranaggio', misure: { denti: 56, modulo: m, spessore: 45, foro: 56 },
      posizione: [760 + 85 * k, 0, 0], rotazione: ASSE_X, materiale: 'titanio-ti6al4v', interno: true,
    })),
    { id: 'carcassa-comp', nome: 'carcassa del compressore', forma: 'tubo', misure: { r: 300, r_interno: 285, h: 600 }, posizione: [975, 0, 0], rotazione: ASSE_X, materiale: 'titanio-ti6al4v', interno: true },
  ]);
  metti('combustore', [0.15, 0, 0], [
    { id: 'camera', nome: 'camera di combustione anulare', forma: 'toro', misure: { R: 245, r: 60 }, posizione: [1430, 0, 0], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true },
    ...giro(12).map((a, k) => ({
      id: `iniettore-${k + 1}`, nome: `iniettore ${k + 1}`, forma: 'cilindro', misure: { r: 12, h: 90 },
      posizione: [1335, r2(245 * Math.cos(a * Math.PI / 180)), r2(245 * Math.sin(a * Math.PI / 180))], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true,
    })),
    { id: 'involucro-comb', nome: 'involucro del combustore', forma: 'tubo', misure: { r: 335, r_interno: 320, h: 380 }, posizione: [1430, 0, 0], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true },
    { id: 'candela-1', nome: 'candela di accensione 1', forma: 'cilindro', misure: { r: 10, h: 120 }, posizione: [1430, 380, 0], materiale: 'acciaio-s355', interno: true },
    { id: 'candela-2', nome: 'candela di accensione 2', forma: 'cilindro', misure: { r: 10, h: 120 }, posizione: [1430, -380, 0], materiale: 'acciaio-s355', interno: true },
  ]);
  metti('turbina', [0.8, 0, 0], [
    ...[8.5, 9, 9.5, 10].map((m, k) => ({
      id: `turbina-${k + 1}`, nome: `stadio della turbina ${k + 1}`, forma: 'ingranaggio', misure: { denti: 48, modulo: m, spessore: 40, foro: 56 },
      posizione: [1700 + 80 * k, 0, 0], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true,
    })),
    { id: 'carcassa-turb', nome: 'carcassa della turbina', forma: 'tubo', misure: { r: 300, r_interno: 285, h: 400 }, posizione: [1820, 0, 0], rotazione: ASSE_X, materiale: 'acciaio-s355', interno: true },
  ]);
  metti('ugello', [1.6, 0, 0], [
    { id: 'cono-scarico', nome: 'cono di scarico', forma: 'cono', misure: { r: 170, r_cima: 30, h: 520 }, posizione: [2290, 0, 0], rotazione: [0, 0, -90], materiale: 'titanio-ti6al4v' },
    { id: 'ugello', nome: 'ugello primario', forma: 'tubo', misure: { r: 400, r_interno: 380, h: 480 }, posizione: [2250, 0, 0], rotazione: ASSE_X, materiale: 'titanio-ti6al4v' },
    { id: 'miscelatore', nome: 'anello del miscelatore', forma: 'toro', misure: { R: 390, r: 18 }, posizione: [2490, 0, 0], rotazione: ASSE_X, materiale: 'titanio-ti6al4v' },
  ]);
  metti('supporti', [-0.2, 0, 0], giro(12, 30, 15).map((a, k) => ({
    id: `supporto-${k + 1}`, nome: `palette di raddrizzamento ${k + 1}`, forma: 'scatola', misure: { x: 60, y: 520, z: 14 },
    posizione: [1250, r2(570 * Math.cos(a * Math.PI / 180)), r2(570 * Math.sin(a * Math.PI / 180))], rotazione: [a, 0, 0], materiale: 'alluminio-6061', interno: true,
  })));
  metti('accessori', [0, -1.4, 0], [
    { id: 'scatola-acc', nome: 'scatola degli accessori', forma: 'scatola', misure: { x: 420, y: 160, z: 260 }, posizione: [900, -1010, 0], materiale: 'alluminio-6061' },
    ...[760, 880, 1000].map((x, k) => ({
      id: `ingranaggio-acc-${k + 1}`, nome: `ingranaggio degli accessori ${k + 1}`, forma: 'ingranaggio', misure: { denti: 24, modulo: 5, spessore: 30, foro: 8 },
      posizione: [x, -1010, 0], rotazione: [90, 0, k * 7.5], materiale: 'acciaio-s355', interno: true,
    })),
    { id: 'generatore', nome: 'generatore', forma: 'cilindro', misure: { r: 80, h: 220 }, posizione: [1220, -1010, 0], rotazione: ASSE_X, materiale: 'alluminio-6061' },
    { id: 'pompa', nome: 'pompa del carburante', forma: 'cilindro', misure: { r: 60, h: 160 }, posizione: [580, -1010, 0], rotazione: ASSE_X, materiale: 'alluminio-6061' },
    { id: 'fadec', nome: 'centralina FADEC', forma: 'scatola', misure: { x: 260, y: 200, z: 120 }, posizione: [700, 0, 990], materiale: 'nylon-pa12' },
  ]);
  metti('cablaggi', [0, -0.3, 1.2], [
    { id: 'cavo-carburante', nome: 'tubo del carburante', forma: 'cavo', flusso: 'fluido', misure: { r: 14, punti: [[580, -940, 60], [700, -880, 320], [1000, -650, 520], [1290, -420, 420], [1335, -300, 40]] } },
    { id: 'collettore', nome: 'collettore del carburante', forma: 'cavo', flusso: 'fluido', misure: { r: 10, punti: giro(12).map((a) => [1335, r2(300 * Math.cos(a * Math.PI / 180)), r2(300 * Math.sin(a * Math.PI / 180))]) } },
    { id: 'cavo-generatore', nome: 'cavo del generatore', forma: 'cavo', flusso: 'elettrico', misure: { r: 14, punti: [[1300, -935, 70], [1400, -600, 720], [1500, 0, 965], [1550, 600, 720], [1600, 930, 60]] } },
    { id: 'cavo-dati', nome: 'cavo dati della FADEC', forma: 'cavo', flusso: 'dati', misure: { r: 8, punti: [[700, -60, 930], [760, -520, 800], [880, -930, 140]] } },
    { id: 'condotto-spurgo', nome: "condotto dell'aria spillata", forma: 'cavo', flusso: 'aria', misure: { r: 32, punti: [[1100, 300, 0], [1200, 560, 40], [1350, 900, 0], [1450, 1000, 0]] } },
  ]);
  for (const p of P) if (p.esplodi === null) delete p.esplodi;
  return P;
}

export const DEMO_TURBOFAN = Object.freeze({
  titolo: 'Turbofan generico',
  descrizione: "Un turbofan fatto di primitive, non un motore vero: misure plausibili, materiali indicativi (l'acciaio sta per le superleghe di nichel). I flussi sui cavi sono dati dichiarati, non simulati.",
  pezzi: turbofan(),
  vista: { modo: 'ologramma' },
});

// Staffa a L: flangia contro il muro (x = 0), braccio lungo +X, nervatura nel mezzo. Quattro fori da 6,6 mm (M6).
export const DEMO_STAFFA = Object.freeze({
  titolo: 'Staffa a L in alluminio 6061',
  descrizione: 'Staffa a L con nervatura e quattro fori M6: incastrata al muro sulla faccia −x della flangia, 1500 N verso il basso sul braccio.',
  pezzi: [
    { id: 'flangia', nome: 'flangia al muro', forma: 'estrusione', gruppo: 'staffa', materiale: 'alluminio-6061', posizione: [4, 0, 0], rotazione: [0, 90, 0],
      misure: { profilo: [[-20, 0], [20, 0], [20, 80], [-20, 80]], profondita: 8, fori_tondi: [{ x: -12, y: 62, r: 3.3 }, { x: 12, y: 62, r: 3.3 }] } },
    { id: 'braccio', nome: 'braccio', forma: 'estrusione', gruppo: 'staffa', materiale: 'alluminio-6061', posizione: [0, 4, 0], rotazione: [90, 0, 0],
      misure: { profilo: [[8, -20], [100, -20], [100, 20], [8, 20]], profondita: 8, fori_tondi: [{ x: 85, y: -12, r: 3.3 }, { x: 85, y: 12, r: 3.3 }] } },
    { id: 'nervatura', nome: 'nervatura', forma: 'estrusione', gruppo: 'staffa', materiale: 'alluminio-6061',
      misure: { profilo: [[8, 8], [60, 8], [8, 60]], profondita: 6 } },
  ],
  carichi: [{ pezzo: 'braccio', faccia: '+y', forza_N: 1500, direzione: [0, -1, 0] }],
  vincoli: [{ pezzo: 'flangia', faccia: '-x', tipo: 'incastro' }],
  vista: { modo: 'ologramma' },
});
