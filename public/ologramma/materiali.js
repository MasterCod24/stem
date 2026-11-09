// materiali.js — i materiali degli ologrammi, con la fonte di ogni numero.
// Puro (niente three.js, DOM o Node): lo usano il server, il calcolo degli sforzi e l'HUD.
// Unità: E e snervamento in MPa, densità in kg/m³. I valori sono quelli dello studio
// del 5/11 (agente «fisica-prova»): molte schede sono state lette da fonti secondarie,
// e i ν di PETG, ABS e PA12 sono stime senza fonte, come dicono le note.

const tabella = {
  'acciaio-s235': {
    nome: 'acciaio S235', classe: 'metallo', E: 210000, nu: 0.3, densita: 7850, snervamento: 235, affidabile: true,
    fonte: 'EN 1993-1-1 §3.2.6 (E, ν), EN 1991-1-1 allegato A (ρ), EN 10025-2:2019 (ReH); norme a pagamento, lette da ' +
      'https://cdn.eurocodeapplied.com/design/en1993/steel-design-properties e https://infosteel.be/images/Steel-Buildings-in-Europe/MSB03/17',
    nota: 'snervamento minimo per spessori fino a 16 mm; da 16 a 40 mm vale 225 MPa',
  },
  'acciaio-s355': {
    nome: 'acciaio S355', classe: 'metallo', E: 210000, nu: 0.3, densita: 7850, snervamento: 355, affidabile: true,
    fonte: 'EN 1993-1-1 §3.2.6 (E, ν), EN 1991-1-1 allegato A (ρ), EN 10025-2:2019 (ReH); norme a pagamento, lette da ' +
      'https://cdn.eurocodeapplied.com/design/en1993/steel-design-properties e https://infosteel.be/images/Steel-Buildings-in-Europe/MSB03/17',
    nota: 'snervamento minimo per spessori fino a 16 mm; da 16 a 40 mm vale 345 MPa',
  },
  'alluminio-6061': {
    nome: 'alluminio 6061-T6', classe: 'metallo', E: 68900, nu: 0.33, densita: 2700, snervamento: 240, affidabile: true,
    fonte: 'Aluminum Association, da https://www.gabrian.com/wp-content/uploads/2018/09/6061-Aluminum-Alloy-Properties.pdf ' +
      'e https://en.wikipedia.org/wiki/6061_aluminium_alloy; ν da https://matmatch.com/materials/mitf349-6061-t6-aluminium',
    nota: 'snervamento minimo garantito: il tipico è 276 MPa, ma per i colori conta il minimo',
  },
  'titanio-ti6al4v': {
    nome: 'titanio Ti-6Al-4V', classe: 'metallo', E: 113800, nu: 0.342, densita: 4430, snervamento: 880, affidabile: true,
    fonte: 'https://www.aerospacemetals.com/wp-content/uploads/2023/07/Titanium-Ti-6Al-4V-Grade-5-Annealed.pdf, ' +
      'https://www.ulbrich.com/alloys/ti-6-al-4-v-uns-r56400/',
    nota: 'grado 5 ricotto, rottura a 950 MPa; altre fonti danno E 110000 MPa e ν 0,32',
  },
  pla: {
    nome: 'PLA', classe: 'polimero', E: 3600, nu: 0.35, densita: 1240, snervamento: 60, affidabile: true,
    fonte: 'NatureWorks Ingeo 4043D, https://cdn.shopify.com/s/files/1/1223/5992/files/PLA_4043D_TDS.pdf; ' +
      'ν da Grasso, citato da Gaweł 2023, https://pmc.ncbi.nlm.nih.gov/articles/PMC10096656',
    nota: 'valori del filamento (il produttore dà ν 0,36): un pezzo stampato è più debole e cambia con gli strati',
  },
  petg: {
    nome: 'PETG', classe: 'polimero', E: 1500, nu: 0.38, densita: 1270, snervamento: 47, affidabile: true,
    fonte: 'Prusament PETG, scheda v1.1 (ISO 527-1), https://www.3dprintergear.com.au/assets/files/technical-data-sheet%20(1).pdf; ' +
      'ρ da https://filament2print.com/fr/pet-petg-cpe/3427-prusament-petg-.html',
    nota: 'stampato in orizzontale (in verticale E 1600 e snervamento 50); ν è una stima senza fonte; ρ è di un rivenditore, non verificata',
  },
  abs: {
    nome: 'ABS', classe: 'polimero', E: 1960, nu: 0.35, densita: 1045, snervamento: 27.5, affidabile: true,
    fonte: 'Stratasys ABS-M30 stampato FDM (ASTM D638), https://go.stratasys.com/rs/533-LAV-099/images/MDS_FDM_ABS-M30_A4_0920a.pdf',
    nota: 'orientamento debole ZX (in XZ: E 2220, snervamento 31); ν è una stima senza fonte; ρ fra 1040 e 1050, non verificata sulla scheda',
  },
  'nylon-pa12': {
    nome: 'nylon PA12', classe: 'polimero', E: 1650, nu: 0.4, densita: 930, snervamento: 48, affidabile: true,
    fonte: 'EOS PA 2200 sinterizzato laser, https://www.eos.info/polymer-solutions/polymer-materials/data-sheets/mds-pa-2200',
    nota: '48 MPa è la resistenza a trazione: non c\'è uno snervamento netto; ν è una stima senza fonte',
  },
  'fibra-carbonio': {
    nome: 'fibra di carbonio', classe: 'composito', E: 70000, nu: 0.1, densita: 1600, snervamento: 600, affidabile: false,
    fonte: 'ACP Composites, tessuto 0/90 con Vf 50%, https://acpcomposites.com/wp-content/uploads/2024/05/Mechanical-Properties-of-Carbon-Fiber-Composite-Materials.pdf',
    nota: 'non è isotropa: a ±45° E scende a 19100 MPa, e l\'unidirezionale va da 135000 a 10000 MPa; non snerva, si rompe fragile: ' +
      '600 MPa è la resistenza a trazione del tessuto, e von Mises qui non è il criterio giusto',
  },
  generico: {
    nome: 'generico', classe: null, E: null, nu: null, densita: null, snervamento: null, affidabile: false,
    fonte: 'nessuna: è un segnaposto, non un materiale',
    nota: 'si disegna e basta: il calcolo lo rifiuta e la massa non lo conta',
  },
};

// Congelati: la tabella è condivisa fra moduli, e una modifica per sbaglio cambierebbe i conti di tutti.
for (const m of Object.values(tabella)) Object.freeze(m);
export const MATERIALI = Object.freeze(tabella);

/** Il materiale con quella chiave, o null. Solo chiavi proprie: «constructor» o «__proto__» non sono materiali. */
export function materiale(chiave) {
  return typeof chiave === 'string' && Object.hasOwn(MATERIALI, chiave) ? MATERIALI[chiave] : null;
}
