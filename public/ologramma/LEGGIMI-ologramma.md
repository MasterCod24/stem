# Ologrammi: il contratto

Questo file è il contratto fra i pezzi dell'abilità «ologrammi». Chi scrive un modulo rispetta i nomi, le unità e le forme dei dati scritti qui. Se un punto non si può rispettare, lo si dice e si cambia questo file, non il codice da solo.

## Cosa è vero e cosa no
- **Vero:** il modello 3D a schermo intero nell'HUD, con aspetto olografico, vista esplosa, sezione piena, raggi X, densità dei materiali e sforzi calcolati davvero. Si comanda con la voce (attraverso il cervello), con mouse e tastiera, e con le mani davanti alla fotocamera.
- **Calcolo degli sforzi:** elasticità lineare, statica, su voxel (`fisica/voxel-fea.mjs`, provato contro la trave a sbalzo). Calcola pezzi pieni fatti di primitive. I pezzi che si toccano sono considerati incollati: niente contatti, bulloni, plasticità, instabilità, fatica né dinamica. Un «impatto» è una forza statica equivalente.
- **Non si fa, perché sarebbe finto:** fisica molecolare, flussi di energia simulati, surriscaldamento senza sorgenti di calore, feedback aptico, precisione millimetrica delle mani (MediaPipe sbaglia di circa 1 cm). I «flussi» sui cavi sono un disegno di dati dichiarati, e si dice così.
- **Sicurezza:** il cervello descrive il modello solo con dati dichiarativi. Niente `eval`, niente `new Function`, niente `innerHTML` e niente shader che arrivano da fuori. I testi entrano nell'HUD solo con `textContent`, e i numeri passano da `Number.isFinite` più un limite. L'HUD è un telecomando di STEM (`/api/ask`), quindi non carica codice da internet.

## File e chi li usa
| file | dove gira | cosa fa |
|---|---|---|
| `public/ologramma/forme.js` | server e HUD | forme: misure, valori predefiniti, limiti, ingombro, volume, test «dentro», trasformazioni |
| `public/ologramma/materiali.js` | server e HUD | tabella dei materiali, con le fonti |
| `ologramma.mjs` | server | stato unico: valida, applica le modifiche, versioni, salvataggio, testi per il cervello |
| `fisica/voxel-fea.mjs` | worker | risolutore (spostato da `prove/fea/`) |
| `fisica/struttura.mjs` | worker | dal modello ai voxel, a carichi e vincoli, fino ai risultati per pezzo |
| `fisica/lavoratore.mjs` | worker | ingresso del `worker_threads`, perché il calcolo non blocchi il server |
| `public/ologramma/geometrie.js` | HUD | geometrie three.js dalle stesse misure di `forme.js` |
| `public/ologramma/scena.js` | HUD | l'ologramma: materiali, vista esplosa, sezione, modi, selezione, etichette, quote in mm, foto |
| `public/ologramma/gesti.js` | HUD e Node | i gesti calcolati dai punti delle mani, senza DOM: si prova in Node |
| `public/ologramma/mani.js` | HUD | fotocamera, MediaPipe 0.10.35 in locale, punti verso `gesti.js` |

## Unità e assi
- Lunghezze in **mm**, forze in **N**, sforzi in **MPa** (N/mm²), masse in **kg**, densità in **kg/m³**, angoli in **gradi** nei dati e in radianti nel codice.
- Asse **Y in alto**, come in three.js. Le forme con un asse (cilindro, tubo, cono, toro, rivoluzione, ingranaggio) hanno l'asse lungo **Y locale**.
- **Trasformazione di un pezzo:** `mondo = T(posizione) · Rx(rx) · Ry(ry) · Rz(rz) · locale`. È l'ordine `'XYZ'` di `THREE.Euler`, che `Matrix4.makeRotationFromEuler` applica proprio così. Per il test «dentro»: `locale = Rzᵀ · Ryᵀ · Rxᵀ · (mondo − posizione)`. `forme.js` esporta queste due funzioni, e `geometrie.js` usa `THREE.Euler(…, 'XYZ')`: devono coincidere (c'è un test).

## Il modello che manda il cervello
```js
{
  titolo: string,          // ≤ 80 caratteri
  descrizione?: string,    // ≤ 300
  pezzi: Pezzo[],          // da 1 a 200
  carichi?: Carico[],      // ≤ 20
  vincoli?: Vincolo[],     // ≤ 20
  vista?: Vista            // parziale
}
```

### Pezzo
```js
{
  id: string,              // /^[a-z0-9][a-z0-9_-]{0,39}$/, unico nel modello
  nome?: string,           // ≤ 60, se manca vale id
  forma: 'scatola'|'cilindro'|'tubo'|'sfera'|'cono'|'toro'|'piastra'|'estrusione'|'rivoluzione'|'ingranaggio'|'cavo'|'file',
  misure: {...},           // per forma, vedi sotto, in mm
  posizione?: [x, y, z],   // mm, predefinito [0,0,0], ogni valore entro ±100000
  rotazione?: [rx, ry, rz],// gradi, predefinito [0,0,0]
  materiale?: string,      // chiave di materiali.js, solo per il calcolo; se manca: 'generico' (si disegna, non si calcola)
  materiale_vero?: string, // ≤ 60: di cosa è fatto davvero, da una ricerca («alluminio 6063 riciclato, anodizzato»)
  fattura?: string,        // ≤ 140: come è fabbricato e montato («fresato da un blocco estruso», «stampato a iniezione», «incollato»)
  fonte?: string,          // ≤ 60: da dove vengono i due campi sopra («iFixit 2022»); se manca, sono una stima di STEM
  gruppo?: string,         // ≤ 40: i pezzi dello stesso gruppo esplodono insieme
  esplodi?: [dx, dy, dz],  // direzione della vista esplosa; la lunghezza (≤ 5) moltiplica la distanza
  interno?: boolean,       // pezzo interno: tenue in vista normale, evidente in raggi X e in sezione
  flusso?: 'elettrico'|'fluido'|'aria'|'dati', // solo per 'cavo': impulsi che scorrono, cioè dati dichiarati
  calcolo?: boolean        // entra nel calcolo degli sforzi; predefinito true, false per 'cavo' e 'file' (un 'file' con true resta false, con un avviso)
}
```
- `materiale_vero`, `fattura` e `fonte` (`CAMPI_RICERCA` di `forme.js`) sono testo libero con le regole di `nome`: devono essere testi, gli a capo e i caratteri di controllo diventano spazi, i più lunghi si tagliano con un avviso, e vuoti valgono non detti (null). Non toccano né la massa né il calcolo: un loro cambio non fa ricalcolare gli sforzi. L'HUD li mostra solo nella scheda del pezzo, con `textContent`.
- Perché due campi per il materiale: `materiale` serve al calcolo e ha solo le 9 chiavi qui sotto, dove vetro, litio, rame o silicio non ci sono. Il 10/11 un «MacBook Air» di 37 pezzi era uscito tutto 'generico', anche la «Base in alluminio», e la scheda diceva «non detto».

### Misure per forma (tutte in mm, tutte > 0 salvo dove detto)
| forma | misure | geometria locale |
|---|---|---|
| `scatola` | `{x, y, z}` | parallelepipedo centrato, lati x, y, z |
| `cilindro` | `{r, h}` | asse Y, da −h/2 a +h/2 |
| `tubo` | `{r, r_interno, h}` | come il cilindro, cavo; 0 < r_interno < r |
| `sfera` | `{r}` | centrata |
| `cono` | `{r, r_cima?, h}` | asse Y: raggio r a −h/2, raggio r_cima (predefinito 0, ≥ 0) a +h/2 |
| `toro` | `{R, r}` | anello nel piano XZ, asse Y, r < R |
| `piastra` | `{x, z, spessore, raggio?}` | senza raggio è una lastra x (lungo X) × spessore (Y) × z (Z), centrata. Con raggio R (|R| > spessore/2) la superficie media è un arco nel piano XY lungo x, tangente all'asse X nell'origine, con il centro di curvatura in (0, R, 0): con R > 0 si piega verso +Y, con R < 0 verso −Y. È larga z lungo Z e l'arco non supera i 360° (x ≤ 2π·|R|) |
| `estrusione` | `{profilo, profondita, fori?, fori_tondi?}` | `profilo` è un poligono semplice di 3–200 punti `[[x, y], …]` nel piano XY, estruso lungo Z da −profondita/2 a +profondita/2. `fori` sono fino a 20 poligoni dentro il profilo; `fori_tondi` sono fino a 50 `{x, y, r}`. I fori non toccano il bordo del profilo né fra loro: così il volume è l'area del profilo meno quella dei fori |
| `rivoluzione` | `{profilo}` | 2–200 punti `[[r, y], …]` con r ≥ 0, di solito chiuso dall'asse; ruota attorno a Y. Un profilo tutto fuori dall'asse (r > 0) che finisce dove comincia, o che chiuso dall'asse si incrocerebbe e su sé stesso no, è un **anello**: la parete di un ugello, una campana cava (`poligonoRivoluzione`, `anelloRivoluzione`). Prima era un errore, e il 10/11 il cervello ha dovuto riscrivere un turbofan intero per la parete dell'ugello. Se il primo e l'ultimo punto coincidono sull'asse, l'ultimo si toglie; un punto sull'asse a metà profilo è un errore |
| `ingranaggio` | `{denti, modulo, spessore, foro?}` | ruota dentata a denti dritti, asse Y, spessore lungo Y centrato; denti da 6 a 200; raggio primitivo modulo·denti/2, testa +modulo, piede −1,25·modulo; `foro` è il raggio del foro centrale |
| `cavo` | `{punti, r}` | tubo di raggio r lungo una curva Catmull-Rom centripeta per 2–100 punti `[[x, y, z], …]`, con le due estremità tagliate piatte, perpendicolari al primo e all'ultimo tratto: il volume è πr²·L |
| `file` | `{file, scala?, centra?}` | un modello da file: percorso assoluto dentro le cartelle di Tony; estensioni glb, stl, obj, 3mf, ply; `scala` dice quanti mm vale un'unità del file (predefinito 1; un GLB in metri vuole 1000); con `centra` (predefinito true) il modello è centrato sull'origine |

### Carico e vincolo
```js
Carico:  { pezzo: id, faccia: '+x'|'-x'|'+y'|'-y'|'+z'|'-z', forza_N: number, direzione: [x, y, z] }
Vincolo: { pezzo: id, faccia: '+x'|'-x'|'+y'|'-y'|'+z'|'-z', tipo: 'incastro' }
```
- Gli assi delle facce sono **del mondo**, non del pezzo.
- La «faccia +x» di un pezzo è l'insieme delle facce esterne dei suoi voxel con la normale verso +x e la coordinata x entro max(h, 2% dell'ingombro del pezzo lungo x) dal massimo in x dei suoi voxel (non dell'ingombro analitico, che con le rotazioni è largo). Lo stesso vale per gli altri assi.
- Un carico o un incastro su un pezzo senza voxel (più piccolo del voxel o chiuso dentro un altro), o su un lato coperto da altri pezzi, è un errore.
- La forza (da 0 a 1e7 N) si distribuisce su quelle facce in modo uniforme. `direzione` è un vettore non nullo, normalizzato dal server.
- Un incastro blocca i tre spostamenti dei nodi di quelle facce.

### Vista
```js
{
  esploso: number,             // da 0 a 1
  sezione: null | { asse: 'x'|'y'|'z', posizione: number /* mm, mondo */, verso: 1|-1 },
  modo: 'ologramma'|'solido'|'raggi-x'|'densita'|'sforzi',
  selezionato: id|null,
  isolato: id|null,
  rotazione_auto: boolean
}
```
La vista la cambiano il cervello (attraverso il server) e l'HUD, ma in locale. I cambi fatti nell'HUD con mani, mouse o tastiera non tornano al server: solo togliere e rimettere un pezzo ci tornano. L'HUD applica solo i campi della vista che il server ha cambiato, così un modo scelto a mano resta.

## Materiali (`materiali.js`)
```js
export const MATERIALI = {
  'acciaio-s235': { nome, classe: 'metallo', E /* MPa */, nu, densita /* kg/m³ */, snervamento /* MPa */, affidabile: true, fonte, nota },
  ...
}
```
Le chiavi sono `acciaio-s235`, `acciaio-s355`, `alluminio-6061`, `titanio-ti6al4v`, `pla`, `petg`, `abs`, `nylon-pa12`, `fibra-carbonio` e `generico`. I valori sono quelli con fonte dello studio del 5/11 (`fisica-prova`):
- S235 e S355: E 210000, ν 0,30, ρ 7850, snervamento 235 e 355;
- 6061-T6: E 68900, ν 0,33, ρ 2700, snervamento 240 (il minimo);
- Ti-6Al-4V: E 113800, ν 0,342, ρ 4430, snervamento 880;
- PLA: E 3600, ν 0,35, ρ 1240, snervamento 60;
- PETG: E 1500, ν 0,38 (stima), ρ 1270, snervamento 47;
- ABS: E 1960, ν 0,35 (stima), ρ 1045, snervamento 27,5 (orientamento debole);
- PA12: E 1650, ν 0,40 (stima), ρ 930, snervamento 48 (resistenza, non c'è uno snervamento netto);
- fibra di carbonio: E 70000, ν 0,1, ρ 1600, `affidabile: false`, perché non è isotropa;
- `generico`: senza proprietà meccaniche (E, nu e snervamento valgono null), ρ null.

Il calcolo rifiuta `generico` e segnala `affidabile: false` con un avviso. Una chiave diversa da `generico` si dà solo se il materiale vero è proprio quello o molto vicino; il materiale vero va in `materiale_vero`, e la scheda li mostra insieme («… · calcolato come Alluminio 6061-T6 · 2700 kg/m³»).

## Lo stato (solo nel server)
`GET /api/ologramma` restituisce:
```js
{
  aperto: boolean,
  modello: number,     // cresce a ogni 'mostra' e non si riusa mai
  versione: number,    // cresce a ogni cambio di qualunque tipo
  titolo, descrizione,
  pezzi: Pezzo[],      // normalizzati: tutti i campi presenti, numeri controllati
  tolti: id[],         // tolti a voce o con le mani: si possono rimettere
  carichi: Carico[], vincoli: Vincolo[],
  vista: Vista,        // completa
  massa_kg: number|null,       // somma di volume·densita dei pezzi non tolti con un materiale vero; null se nessuno ce l'ha
  ingombro_mm: { min: [x,y,z], max: [x,y,z] } | null, // senza i pezzi 'file', che il server non apre, e senza i tolti
  analisi: null | {            // sempre con tutti i campi: null quando non valgono
    stato: 'in-corso'|'fatta'|'errore',
    versione: number,          // la versione a cui il calcolo è partito
    errore: string|null,
    h_mm, voxel, iterazioni, convergito, tempo_s,
    sforzo_max_MPa, fs_min, spostamento_max_mm,
    scorciatoia_s: number|null,// dopo la scorciatoia della lega: in quanti secondi fs e spostamento sono stati rifatti; il campo viene dal calcolo di prima
    pezzi: [{ id, materiale, sforzo_max_MPa, fs_min, punto_mm: [x,y,z] }], // dal più a rischio
    avvisi: string[],          // per esempio «pezzo X: materiale non isotropo», «picco all'incastro: valore stimato»
    campo: { versione, nx, ny, nz, h, origine: [x,y,z] } | null  // versione: quella a cui il campo è nato
  }
}
```
- `GET /api/ologramma/campo?v=<versione>` restituisce un `Float32Array` di nx·ny·nz valori, in ordine `i + nx·(j + ny·k)`. Ogni valore è il fattore di sicurezza del voxel; −1 vuol dire vuoto, e 1e6 sicurezza enorme.
- Il colore lo calcola l'HUD: `rischio = clamp(1/fs, 0, 1)`, cioè lo sforzo diviso lo snervamento: cresce in proporzione ed è rosso da fs 1 in giù. Con la scala di prima, `log(3/fs)/log(3)`, tutto quello che reggeva con fs ≥ 3 era blu e non si vedeva dove il pezzo lavora.
- `ologramma.mjs` salva lo stato in `runtime/ologramma.json` con tmp+rename, e il campo in `runtime/ologramma-campo.bin`: un'intestazione Float64 [versione di base, n], poi vm (Float32) e voxel_pezzo (Uint16). fs non si salva: all'avvio si rifà uguale bit per bit. Il server è l'unico scrittore.
- Dopo un riavvio, un'analisi rimasta 'in-corso' diventa 'errore' («interrotta da un riavvio di STEM: chiedi di nuovo l'analisi») e il calcolo non riparte da solo.

## Le azioni: `POST /api/ologramma` (JSON)
Dal processo MCP, cioè dagli strumenti del cervello:
- `{azione:'mostra', modello}`: sostituisce tutto con un modello nuovo e apre l'ologramma.
- `{azione:'modifica', cambia?, aggiungi?, togli?, rimetti?, vista?, carichi?, vincoli?, titolo?, descrizione?}`:
  - `cambia: [{id, ...campi}]` sostituisce i campi indicati, e `misure` si fonde campo per campo; con una forma nuova misure, calcolo e flusso vanno dati interi; un testo vuoto in `materiale_vero`, `fattura` o `fonte` toglie il campo;
  - `aggiungi: Pezzo[]`;
  - `togli` e `rimetti` sono liste di id;
  - `vista` è parziale;
  - `carichi` e `vincoli`, se ci sono, sostituiscono quelli vecchi;
  - `titolo` e `descrizione` con le regole di mostra: ≤ 80 e ≤ 300 caratteri, i più lunghi tagliati con un avviso; una descrizione vuota la toglie.

  Senza nessun campo, restituisce solo lo stato in testo. Un campo null vale come assente (per togliere i carichi si manda []). Una modifica con almeno un campo, o un analizza, riapre un ologramma chiuso.
- `{azione:'analizza', carichi?, vincoli?}`: calcola gli sforzi.
- `{azione:'chiudi'}`

Dall'HUD arrivano solo `{azione:'togli'|'rimetti', id, modello}` e `{azione:'chiudi', modello}`, così il cervello sa che Tony l'ha chiuso con Esc. Se `modello` non è quello attuale, il server risponde 409 con lo stato. Dall'HUD non arriva mai testo libero.
- L'HUD si riconosce dalle intestazioni `origin` o `sec-fetch-site`, che una pagina non può togliere; il processo MCP non le manda. Le altre azioni dall'HUD ricevono 403.
- Risposte all'HUD: 200 `{ok, versione}` senza testo; 409 `{ok: false, errori, stato}` se il modello è vecchio; 400 o 403 `{ok: false, errori}`.
- `{azione:'misura', secondi, fps: {mediana, p10, minimo}, detect_ms, prova?, gesti?}`: alla chiusura dell'ologramma, se le mani sono state accese almeno 10 secondi interi. Solo numeri nei loro limiti (secondi interi da 10 a 86400, fps da 0 a 1000, detect da 0 a 10000 ms o null, prova booleano): il server risponde 204 e scrive una riga sola nel suo registro, «[ologramma] mani accese 42 s: fps mediana 55, p10 48, minimo 46, detect 21 ms», con «(foto di prova al posto della fotocamera)» se prova è true. Altrimenti 400.
  - `gesti`, facoltativo (un HUD vecchio non lo manda): le misure d'uso vero di `gesti.js` dall'apertura (vedi «I gesti»), solo le chiavi `secondi, tremolio_px, tremolio_n, buchi, gesti_persi, inneschi, scaduti, pizzichi, pizzico_min, pizzichi_profilo, lanci, prese_sparite_veloci, salti, profilo`, tutte facoltative, numeri finiti ≥ 0 nei limiti di `testoMisure` (per esempio `profilo` ≤ 1, `pizzico_min` ≤ 10). Con una chiave sconosciuta o un valore storto si scartano tutte le misure dei gesti, non la riga: gli fps servono alla regola dei 45 fps, e la riga finisce con «; misure dei gesti scartate (storte)». Vanno in coda alla stessa riga: «…detect 21 ms; mani viste 61 s; tremolio 1,3 px; inneschi 5 (scaduti 2); pizzichi 31 (minimo 0,16 U, 12 di profilo); buchi 4, gesti persi 1, lanci 2, prese sparite in corsa 0, salti 3, profilo 22%». Il testo lo fa `testoMisure` di `gesti.js`, provato in `prove/gesti.mjs`.
- Un report del cervello con almeno un blocco, `[[mostra]]` o la quarta azione nel browser coprono l'ologramma: il server lo chiude anche lui («Ologramma chiuso.», versione +1), così il cervello non riceve la foto di un ologramma che Tony non vede.
- Un'azione che non cambia niente non alza la versione e non avvisa l'HUD.

Gli strumenti MCP sanno la porta del server dagli argomenti: `mcp.json` li lancia con `node mac/mac-mcp.mjs --porta <STEM_PORT>`, perché le variabili di `.env` non arrivano ai processi figli. Per le prove c'è `STEM_CERVELLO` (sotto, «Il server e le prove»).

### Risposte agli strumenti
- In caso di successo: `{ ok: true, versione, testo, foto? }`. `testo` è in italiano e serve al cervello: pezzi, ingombro, massa, risultati dell'analisi e avvisi. `foto` è il PNG in base64 della vista dopo il cambio.
- La massa nel testo e nell'HUD ha una regola sola, `massaTesto` di `forme.js`: tre cifre significative, in g sotto 1 kg e in mg sotto 1 g.
- **La riga dei materiali** (dopo la massa) dice cosa manca alla ricerca sui pezzi, con gli id tagliati come gli altri elenchi: «Materiali: 4 pezzi su 6 hanno il materiale. Senza materiale: … Senza fattura: … Senza fonte, quindi stime: …». Un pezzo ha il materiale con `materiale_vero` o con una chiave diversa da `generico`; la fattura si chiede solo a chi ha `materiale_vero`; i pezzi tolti contano. Quando non manca niente la riga non c'è, quindi un pezzo che Tony progetta in PLA non la fa comparire. Dice cosa manca e non come trovarlo: il modo di lavorare sta in `stem-persona.md`.
- La prima riga dice com'è andato il calcolo quando la risposta parte: «Analisi degli sforzi avviata.» o «Ricalcolo degli sforzi avviato.» solo se è ancora in corso; se la risposta porta già i numeri, «finita» o «ricalcolati». Dopo la scorciatoia della lega la riga dei voxel dice che il campo viene dal calcolo di prima, col tempo vero della scorciatoia.
- Per la foto il server aspetta, se l'HUD è collegato (visto negli ultimi 15 s), fino a 8 s dopo mostra o se ci sono pezzi `file`, fino a 4 s dopo le altre modifiche: l'entrata di un modello nuovo dura circa 3 s. Senza foto, il testo lo dice («l'HUD non è acceso», «non l'ha mandata entro N s»). Se non è cambiato niente torna l'ultima foto di quella versione, o «Foto: nessuna nuova».
- In caso di errori: `400 { ok: false, errori: [string] }`, con messaggi chiari perché il cervello possa correggere.
- Dopo `analizza` il server aspetta la fine del calcolo fino a 60 s; il worker ha 55 s, quindi di solito arriva un risultato o un errore. Se non basta, risponde con `analisi.stato: 'in-corso'` e il testo lo dice.
- **Ricalcolo da solo:** se c'è un'analisi (fatta, in corso o in errore) e una `modifica` cambia geometria, materiali, carichi, vincoli o pezzi tolti, il server ricalcola e la risposta porta i numeri nuovi. Se non si può ricalcolare (per esempio l'HUD ha tolto il pezzo col carico), l'analisi diventa 'errore' col motivo e il campo sparisce. I cambi di sola vista o di nome alzano la versione ma non fermano un calcolo in corso. Un risultato di una corsa che non è più quella attuale si butta.
- **Scorciatoia della lega:** se tutti i pezzi calcolati tengono ν e il loro E scala dello stesso fattore k (un materiale solo, o S235 → S355 su un pezzo, con k = 1), si rifà solo fs, senza risolvere: K·u = f diventa (k·K)·(u/k) = f. Provata uguale al ricalcolo pieno.
- Alcuni avvisi li scrive `ologramma.mjs` (materiale non isotropo, picco vicino a un incastro, niente convergenza, pezzi esclusi o generici, carichi e incastri che non contano), e `fisica/struttura.mjs` non li ripete.
- Del calcolo (`fisica/struttura.mjs`): `tempo_max_s` ferma il risolutore solo col residuo già sotto 1e-2, se no il limite è il timeout del worker; un pezzo senza voxel non va in `esclusi` ma ha un avviso suo; un pezzo staccato solo in parte resta, con «N voxel su M sono staccati»; le frazioni dei voxel di bordo vengono da 64 campioni su una griglia ruotata; il risultato ha anche `tempi` e gli avvisi «il carico cade per il N% su nodi incastrati» e «modello largo e quasi vuoto».

### La foto
L'HUD, dopo aver mostrato una versione nuova (file caricati e animazioni ferme, al massimo 3 s dopo), manda `POST /api/ologramma/foto {modello, versione, png}`: base64 di un PNG largo al massimo 960 px e grande al massimo 1,5 MB. Lo strumento la restituisce al cervello come immagine, così STEM vede quello che ha fatto prima di dire «fatto».
- Il server risponde 204 se l'accetta, 409 se non è della versione attuale o l'ologramma è chiuso, 400 se non è un PNG valido (anche alto più di 4096 px).
- `GET /api/ologramma/campo`: 404 se non c'è, 409 se `v` non è la versione del campo.
- I MB dei corpi sono MiB: 1 MiB per `/api/ologramma`, 2 MiB per la foto. Un corpo JSON che non è un oggetto vale `{}`.

### Avvisi all'HUD
- A ogni cambio il server chiama `brain.notify({t:'holo', v: versione})`, se c'è un turno in corso.
- `/api/status` riporta `ologramma: versione`.
- L'HUD rilegge lo stato solo se v è maggiore di quella che mostra. Se lo stato dice `aperto: false`, chiude.

### File 3D
`GET /api/ologramma/file/<modello>/<id>` serve solo il file del pezzo citato nello stato attuale, mai un percorso scelto dall'HUD:
- solo se il percorso, dopo `realpath`, sta dentro una delle cartelle di Tony (FILE_DIRS), con il confine `path.sep`;
- solo se è un file regolare con un'estensione ammessa e non sta in una cartella nascosta;
- solo fino a 200 MB, mandato in stream;
- con le intestazioni `nosniff` e `cross-origin-resource-policy: same-origin`, e solo con `sec-fetch-site` uguale a same-origin o assente.

## Il modulo dell'HUD (`scena.js`)
```js
export function createOlogramma({ renderer, strato, contenitore, sfx, onTogli, onFoto, scarica? }) → {  // scarica: al posto di fetch, per le prove
  mostra(stato),        // apre o aggiorna: costruisce solo i pezzi cambiati
  chiudi(),             // dissolvenza, libera geometrie e texture
  get aperto(),
  fotogramma(t, dt),    // dal loop di stem.js, a ogni fotogramma, prima del render dell'HUD
  dopoRender(),         // subito dopo il render, nello stesso fotogramma: qui si legge il canvas per la foto (preserveDrawingBuffer è false)
  comando(nome, valore),// 'esploso' 0..1 | 'sezione' {asse, posizione, verso}|null | 'modo' | 'seleziona' id | 'isola' id | 'ruota' {dx, dy} | 'zoom' fattore | 'reset' | 'rotazione_auto' bool
  puntatore(ev),        // eventi del mouse: trascina per ruotare, rotella per lo zoom, clic per selezionare
  gesto(g),             // i gesti di gesti.js; {tipo:'stato', fase} mostra «mani: mostra il palmo» (riposo) o «mani pronte» nella barra, e 'spente' (da stem.js) la svuota
  ridimensiona(),
  info(),               // per le prove: lo stato locale, senza riferimenti interni
}
// onFoto(png, versione, modello); export anche angoloTesta(W, H), rischio(fs), TAPPE_FS e mmTesto(mm)
```
- `createScene` di `nucleo.js` (la sfera e gli anelli che hanno preso il posto di `humanoid.js`) restituisce anche `renderer` e `strato`. `strato(scene, camera)` è l'aggancio. Inserisce un RenderPass (clear false, clearDepth true) subito dopo quello dell'HUD e prima del bloom. Il composer dell'HUD usa un render target con `stencilBuffer: true`, perché la sezione piena funzioni (misurato).
- Il nucleo va nell'angolo come col report (`S.dockTarget`, `dockX`, `dockY`), e la camera dell'ologramma lascia libero quell'angolo.
- **Palette**, la stessa dell'HUD (variabili di `index.html`):
  - ciano dominante. Gli spigoli sono il ciano scalato alla luminanza dell'azzurro di prima, perché l'aspetto è tarato sulla soglia del bloom (0,18). Gli interni ai raggi X sono verde acqua;
  - densità dal blu petrolio (leggero) al ciano (denso), con la luminanza sotto la soglia del bloom come il solido;
  - flussi tutti nei freddi, distinti per colore, velocità e forma dell'impulso: elettrico scintille bianco-ciano corte e veloci, fluido onde blu lunghe e lente, aria soffi ciano pallido, dati trattini verde acqua fitti;
  - **arancione e rosso solo per le anomalie:** il rosso della scala degli sforzi (fs ≤ 1), `.cede` sul pezzo o sulla nota con fs sotto 1, `.attenzione` su un calcolo fallito, un campo che non arriva o un file che non si apre. Nient'altro è caldo.
  - Testi: «Helvetica Neue» sottile per titoli e valori, Menlo per etichette e numeri piccoli (`--sottile`, `--mono`), con un ripiego per il laboratorio, che le variabili non le ha. La scheda è un modulo trasparente: gli angoli a staffa li disegna `index.html`.
- **Quote in millimetri**, come in un disegno tecnico: linee di riferimento staccate dal pezzo, linea di quota con trattini a 45° e un testo `.holo-quota` per asse («1.240 MM», «12,5 MM»: `mmTesto`, punto per le migliaia e una cifra decimale sotto 100 mm).
  - Il pezzo scelto (clic, presa o selezione) ha le tre quote dell'ingombro lungo gli assi del mondo, dove sta adesso, esploso compreso. Senza pezzo scelto si vede l'ingombro del modello intero, più tenue, che si spegne nell'esploso. Un file non ancora aperto non ha misure, né nelle quote né nella scheda.
  - Per ogni asse si prova la quota su ognuno dei quattro spigoli paralleli, uscendo lungo uno dei due assi perpendicolari. Vince un posto col testo libero, e fra questi quello più lontano dal centro sullo schermo, cioè sul contorno; quello di prima vale il 12% in più, così la quota non salta mentre il modello gira. Un asse più corto di 18 px sullo schermo non si quota.
  - I testi stanno sotto la barra e dentro i margini, mai sull'angolo del nucleo né su scheda, legenda e descrizione (le registra `ostacolo`); le etichette dei gruppi evitano anche le quote. Un testo senza posto si spegne con le sue linee.
  - Le linee sono un solo `LineSegments` additivo senza test di profondità, con un buffer di 30 vertici che va alla GPU solo quando cambia.
  - Le linee di livello a passo vero in mm non ci sono (scelta del 10/11, mai provate). Le righe sul modello sono scansioni che scorrono: con un passo tondo non diventerebbero misure, e la misura la danno già le quote.
- Le etichette sono nodi DOM dentro `contenitore`, riempiti con `textContent`. La legenda di densità e sforzi usa la stessa funzione colore dello shader, con abbastanza tappe da non far vedere la differenza fra sRGB e lineare. Le tappe scritte degli sforzi sono fs 4, 2, 1,33 e ≤ 1, a un quarto, a metà, a tre quarti e in fondo.
- Gli sforzi si colorano per pixel: una texture 3D del rischio (8 bit per voxel, 255 = vuoto), letta trilineare sui soli voxel pieni, guardando dentro il pezzo lungo la normale (0,5, 1, 1,6, 2,4 e 0,2 h). Con la sezione, il tappo mostra il campo del materiale tagliato. Se un lato del campo supera `MAX_3D_TEXTURE_SIZE`, la legenda dice «campo non disponibile».
- Un pezzo `file` si sceglie (clic, presa, cursore) dal suo ingombro, non triangolo per triangolo: su un milione di triangoli il raycast costava 60 ms ogni 90 ms. Un file si carica fino a 1 milione di triangoli (`TRIANGOLI_MAX` di `geometrie.js`): con le mani, 1 milione dà 50,7 fps e 2 milioni 33,3.
- Il cursore delle mani, e l'evidenziazione del pezzo sotto, si spengono 400 ms dopo l'ultimo gesto 'cursore': un gesto «mani uscite» non c'è.

## I gesti (`gesti.js`)
```js
export function createGesti(opzioni) → { aggiorna(mani, t_ms) → Gesto[], azzera(), stato(), misure(), azzeraMisure() }
export PREDEFINITI, mappa(n, margine?, curva?), normale(a, b, c), inclinazione(n), testoMisure(g)
// mani: [{ lato: 'Left'|'Right', punti: [{x, y, z}] × 21 }], coordinate normalizzate 0..1 dell'immagine già specchiata
Gesto =
  {tipo:'stato', fase}                  // 'riposo' | 'pronto' | 'azione', a ogni cambio e una volta all'inizio
| {tipo:'cursore', x, y, mano}          // punta dell'indice, schermo 0..1
| {tipo:'ruota', dx, dy}                // pizzico con una mano e trascinamento
| {tipo:'zoom', fattore}                // due mani che pizzicano: rapporto delle distanze
| {tipo:'esplodi', delta}               // due palmi aperti che si allargano o si stringono
| {tipo:'afferra', x, y} | {tipo:'sposta', dx, dy} | {tipo:'lascia'}
| {tipo:'lancia', x, y, vx, vy}         // rilascio veloce di una presa: il pezzo preso si toglie
```
- `stato()`: la fase e lo stato di ogni mano (anche `inclinazione` in gradi, `profilo`, `dentro` la zona attiva), senza i punti, per le prove e il lab.
- Ruotare e afferrare stanno tutti e due sul pizzico di una mano: un pizzico che si muove entro 350 ms ruota, uno fermo per 350 ms afferra, uno breve e fermo è un clic che seleziona. Si afferra dove l'indice puntava prima di chiudersi (entro 300 ms).
- `lancia` parte solo da una presa: una mano che sparisce dà `lascia`. Un solo cursore per fotogramma; `mano` vale 'Left', 'Right' o null.
- Lo zoom usa il rapporto delle distanze fra i centri dei palmi, non fra i pizzichi.
- Il pizzico è relativo alla mano, come in MRTK3: la distanza pollice-indice divisa per la lunghezza dell'indice (5→6→7→8), chiuso sotto 0,25 e aperto sopra 0,75, con isteresi.
- Filtro One Euro sui punti. Il lancio parte da circa 1 m/s su 150 mm, misurati con la scala del palmo (1U, polso→nocca del medio, punti 0→9, rimisurato a ogni fotogramma).
- Le soglie stanno tutte in `opzioni`, con valori predefiniti esportati e il commento che dice da dove viene il numero.

### Le tre fasi (una sola macchina per tutte le mani)
- **riposo**: non esce niente, nemmeno il cursore; le tracce si aggiornano lo stesso. Si parte da qui, e `azzera()` ci torna.
- **riposo → pronto**: una mano stabile, aperta, non di profilo e dentro la zona attiva per `innesco_ms` (300). Un fotogramma falso in mezzo non azzera il conto, due di fila sì. All'innesco una mano che ha già il pizzico chiuso è «consumata»: deve riaprirlo.
- **pronto**: cursore e gesti come prima.
- **azione**: finché c'è un gesto continuo (ruota, presa, zoom o esplodi partiti) o nel fotogramma di un clic. L'evento 'azione' esce prima dei gesti del suo fotogramma, il ritorno a 'pronto' dopo.
- **pronto → riposo**: `riposo_ms` (4000) senza attività, cioè senza gesti emessi (il cursore non conta) e senza un palmo aperto dentro la zona. Da 'azione' non si scade, e il conto parte dalla fine del gesto: uno zoom tenuto fermo a lungo e poi lasciato con le mani fuori zona resta pronto per `riposo_ms`. `riposo_ms` deve essere sopra 0 (a 0 riposo e pronto si alternavano ogni `innesco_ms`).
- `innesco_ms: 0` vuol dire sempre pronto, come prima del 10/11: è l'interruttore se a Tony l'innesco non piace.

### Le opzioni nuove del 10/11 (regole di Tony, numeri suoi, non misurati su di lui)
- `assente_ms` 170 (era 150): «meno di 5 fotogrammi» a 30 al secondo, cioè fino a 4 mancanti. Con 4 fotogrammi mancanti la presa tiene, con 5 si chiude.
- `zona_morta` 0,00625 altezze d'immagine (3 px su 480), **a corda**, dopo il filtro, solo sulle due àncore che vanno allo schermo: la punta dell'indice (cursore, ruota, sposta, mira) e il centro del palmo (zoom, esplodi). Non tocca i punti del pizzico né il palmo. L'uscita sta ferma finché il punto filtrato le resta entro il raggio; oltre, lo segue a un raggio di distanza.
- `curva` 0,5: la mappa a S `mappa()`, una sola per cursore, gesti e pallini delle dita. Con u da −1 a 1 la posizione lineare, f(u) = (1−c)·u + c·u³, e fuori da ±1 prosegue dritta con la pendenza del bordo: al centro guadagno 0,5 (più preciso), ai bordi 2. Il cursore è f limitata allo schermo; ruota, sposta e la velocità del lancio sono differenze di posizioni mappate non limitate, così una mano oltre il bordo ruota ancora. Una sigmoide vera sulla posizione sarebbe ripida al centro, il contrario di quello che Tony chiedeva: per questo la forma è un'altra.
- `zona` 0,7: un gesto parte, e l'innesco vale, solo col centro del palmo nel 70% centrale dell'immagine, in x e in y. Un pizzico chiuso fuori è consumato. Un gesto partito continua anche fuori. I gesti a due mani partono solo con tutte e due dentro.
- `profilo_gradi` 75: la normale del palmo dai punti 0, 5 e 17 in 3D, con la z dei punti dell'immagine scalata come la x; l'inclinazione è l'angolo fra la normale e l'asse della fotocamera (0 palmo o dorso di fronte, 90 di taglio; palmo e dorso non si distinguono apposta) ed è lisciata a 1 Hz. Oltre 75° la mano è di profilo: non vale come palmo aperto, quindi niente innesco né esplodi. Il pizzico invece resta, perché davanti a un portatile si pizzica col palmo in giù, cioè di taglio.
- `innesco_ms` 300 e `riposo_ms` 4000: vedi le fasi.

### Delle 12 regole di Tony, cosa non si è fatto e perché
- **1.1 alla lettera** («fermo sotto 3 px dal fotogramma prima»): a 3 cm/s la mano fa 1 px a fotogramma e l'uscita non si muoverebbe mai (in 2 s resta indietro di 61 px). Si è fatta la zona morta a corda.
- **1.2 la profondità in 1U**: nessun gesto usa la z, quindi non si aggiunge. 1U c'era già (il palmo).
- **2.1 cinematica inversa**: MediaPipe non dice quale dito è nascosto e dà già 21 punti da un suo modello della mano; in 2D una falange non ha lunghezza fissa. Al suo posto una prova (un salto di un fotogramma non apre la presa) e il conto dei salti nell'uso vero.
- **2.2 i pesi delle dita nascoste**: di profilo le dita non si contano proprio (niente palmo aperto), non si pesano.
- **2.3 la previsione dalla velocità** durante un buco: non c'è, perché i buchi non sono mai stati contati. Ora li conta `misure()`.
- **3.2 il 10% e il 15% di 1U**: non adottati; restano 0,25 e 0,75 della lunghezza dell'indice (MRTK3). Sul banco i pizzichi veri arrivano a 0,08 e 0,10 U in 2D, cioè proprio sul 10%: con quella soglia uno dei due non si chiuderebbe. Si misura sulle mani di Tony con `pizzico_min`.
- **3.3 il tempo di ricarica di 300 ms**: niente timer. Ogni lancio vuole una presa nuova, cioè un pizzico riaperto e fermo per 350 ms: due lanci di fila non possono stare a meno di 350 ms più un fotogramma. Il più vicino trovato è a 567 ms (corsa di 3 fotogrammi a 1,5 m/s, scansione del revisore dell'11/11 su velocità, corse e attese); le sequenze di `prove/gesti.mjs` danno 667 ms.

### Le misure d'uso vero (`misure()`, solo numeri)
Servono a tarare sulle mani di Tony le soglie di oggi; `mani.js` le passa a `stem.js`, che le manda con l'azione `misura`. Dall'apertura (o da `azzeraMisure()`): `secondi` con almeno una mano stabile; `tremolio` e `tremolio_n`, lo scarto quadratico medio fra la punta dell'indice grezza e quella filtrata del fotogramma prima, nei fotogrammi col palmo sotto 0,05 altezze al secondo, in altezze d'immagine (`mani.js` aggiunge `tremolio_px`); `buchi`, mani riviste dopo almeno un fotogramma mancante; `gesti_persi`, mani sparite oltre `assente_ms` con un gesto in corso; `inneschi` e `scaduti`; `pizzichi`, `pizzico_min` (mediana della distanza minima pollice-indice in U: dice se il 10% di Tony è raggiungibile) e `pizzichi_profilo`; `lanci`; `prese_sparite_veloci` (prese chiuse dall'assenza mentre la mano correva oltre la soglia del lancio: lanci forse persi per il mosso); `salti` (fotogrammi in cui la punta di pollice o indice si sposta di più di 0,5 U rispetto al palmo); `profilo`, la frazione dei fotogrammi di profilo. `azzera()` dimentica le mani ma tiene le misure.

### I numeri (`node prove/gesti.mjs`, mani sintetiche; `node prove/mani-foto.mjs`, foto vere)
- Filtro, con rumore σ 0,004 a mano ferma: tremolio ÷2,84, ritardo 17,6 ms a 0,5 m/s; con la zona morta 23,5 ms (raggio/velocità aggiunge 5,9 ms). Gli 80,5 ms che la prova dava il 10/11 erano un errore della prova: supponeva la mappa lineare.
- Zona morta, mano ferma: il cursore si muove in 3 fotogrammi su 269 con σ 0,004 e in 2 con σ 0,002 (al massimo 1 px su uno schermo alto 1080), contro 269 su 269 senza. Non è zero: dopo uno strappo la corda resta sul bordo del raggio.
- Salti di un fotogramma durante una presa: la punta dell'indice regge fino a 2,9 U, quella del pollice fino a 1,0 U (0,5 senza filtro).
- Banco su foto vere (MediaPipe sulla GPU dell'M2, 11/11, 10 mani in 9 foto):
  - **profilo, quale 3D**: su mani piatte di fronte la z dei punti dell'immagine dà 12–21°, i punti del mondo 32–90° (le due sinistre di `left_hands.jpg`: 12° e 13° contro 90° e 81°). Si usa la z dell'immagine, e `mani.js` non passa i punti del mondo;
  - **pizzichi veri** (due gesti OK di Wikimedia Commons): pollice-indice a 0,08 e 0,10 U in 2D (0,22 e 0,19 in 3D con la z dell'immagine), rapporto 0,11 e 0,14: pizzico con le soglie di oggi. Una terza foto, in primo piano col polso fuori, non dà nessuna mano;
  - **falsi pizzichi**: il pugno ha rapporto 0,27, appena sopra la soglia di chiusura (0,25): non è pizzico, ma di poco. Pollice in su, indice in su e vittoria stanno sopra 1,2. Nessuno dei quattro è un palmo aperto.
  - la foto di prova dell'HUD: due palmi aperti a 20° e 21°, quindi `prove/ologramma-hud.mjs` fa l'innesco (in circa 660 ms dalla partenza delle mani).

## Le mani (`mani.js`)
- MediaPipe `@mediapipe/tasks-vision` **0.10.35**, servito in locale da `/mediapipe/`. Il modello `hand_landmarker.task` (float16, 7.819.105 B) sta in `runtime/modelli/` e si serve da `/modelli/hand_landmarker.task`. Lo scarica `mani.js` con fetch, controlla i byte e lo passa come `modelAssetBuffer`; la GPU ripiega sulla CPU.
- La fotocamera è accesa solo con l'ologramma aperto e le mani attive. Quando si chiude, le tracce si fermano. I fotogrammi non escono dall'HUD.
- Il rilevatore resta fra un'apertura e l'altra: si chiude solo se si guasta, e il prossimo avvio lo rifà. Ricrearlo a ogni apertura riscaricava 19,3 MB e bloccava l'entrata del modello.
- Anche `gesti.js` resta fra un avvio e l'altro (si rifà solo se cambiano le proporzioni dell'immagine): `ferma()` dimentica le mani, ma le misure contano tutta l'apertura anche se Tony spegne e riaccende col tasto M. `azzeraMisure()` azzera i tempi di MediaPipe e le misure dei gesti; `stem.js` lo chiama a ogni apertura.
- A ogni avvio manda subito la fase di partenza ('riposo'), senza aspettare la prima rilevazione.
- `misure.gesti`: le misure di `gesti.js`, più `tremolio_px` (il tremolio per l'altezza vera dell'immagine), o null se le mani non sono mai partite.
- Il lato è scambiato rispetto a MediaPipe: 'Right' è la mano destra di chi sta davanti alla fotocamera.
- In più rispetto al contratto: `onErrore`, `azzeraMisure()`, le opzioni `delegato`, `hz`, `gesti`, `sorgente: 'immagine'`, le esportazioni `MEDIAPIPE` e `MODELLO_MANI`.
- **Soglia per collegarle** (decisione di Tony del 5/11): l'HUD con l'ologramma e le mani deve restare sopra 45 fps sul suo M2. Se non regge, le mani restano spente. La misura nelle condizioni vere arriva da sola nel registro del server, con l'azione `misura`.
- Nell'HUD (`stem.js`): i pallini di pollice e indice usano la stessa `mappa()` del cursore, e a riposo sono più tenui (`#dita.riposo`). Quando le mani si fermano (Esc, tasto M, errore) `stem.js` manda a `scena.js` `{tipo:'stato', fase:'spente'}`. Nessun suono per l'innesco: in `sfx.js` non c'è un suono leggero adatto, e i suoni nuovi non si fanno.

## Nell'HUD (`stem.js`)
- Report e browser chiudono l'ologramma nell'HUD subito; nel server lo chiude il server (vedi sopra). Solo Esc lo dice al server come «chiuso da Tony».
- Con l'ologramma aperto, una frase che comincia con esplod…, rimont…, tagli…, togli…, rimett… o chiud… è per STEM anche se è di una parola e anche dopo i 25 s di conversazione; in `ascolto.log` è «domanda (comando)». Con l'ologramma chiuso il filtro è quello di prima.
- `window.__misure.fps`: mediana, p10 e minimo dei fotogrammi contati in ognuno degli ultimi 20 secondi interi, più i conti uno per uno. Gli intervalli di requestAnimationFrame davano 59,9 fps contro i 55 della traccia.
- Con `?debug`: `stemAsk`, `stemReport`, `stemSente(frase)` (una frase finita, come dal riconoscimento), `stemOlo`, `stemOlogramma(stato)` e `stemOlogrammaDemo(nome)`.

## Il server e le prove
- `STEM_CERVELLO=<cartella>` sposta lì, oltre al `cwd` del cervello, cervello.json, mcp.json, ologramma.json e .bin e ascolto.log; le cartelle dei documenti diventano le sue sottocartelle (Desktop, Documents…).
- Le variabili d'ambiente date a mano vincono su `.env`.
- Il controllo di `sec-fetch-site` vale su `/api/*`, `/mediapipe/*` e `/modelli/*` con ogni metodo. Le pagine hanno `x-frame-options: SAMEORIGIN` e `frame-ancestors 'self'`: l'HUD non si apre dentro un'altra origine.
- All'avvio, un ologramma salvato come aperto si chiude (versione +1, chiuso dallo STEM) e si riapre a voce.
- Gli strumenti: `mostra_ologramma` prende i campi del modello al primo livello, non dentro `{modello}`; `modifica_ologramma` ha `chiudi: true`, da solo; carichi e vincoli sono descritti per intero solo in `analizza_struttura`, la vista solo in `modifica_ologramma` e il pezzo solo in `mostra_ologramma`.
