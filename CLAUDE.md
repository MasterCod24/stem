# STEM: appunti per chi ci lavora

STEM è l'assistente vocale di Tony sul Mac, stile JARVIS. È sempre in ascolto, parla con voce ElevenLabs o con quella del Mac, mostra un HUD a schermo intero e usa Google, le app e lo schermo al posto suo. Quello che fa, visto da Tony, sta in [LEGGIMI.md](LEGGIMI.md); qui c'è quello che serve per lavorarci.

## Ripartire da dove eravamo
1. **Cosa è stato fatto:** `git log --oneline -10`. Ogni commit dice nel titolo cosa è cambiato per Tony e nel corpo il perché.
2. **Lavoro lasciato a metà:** `git status`. File non committati vogliono dire che una sessione si è interrotta prima di chiudere.
3. **Lo stato vivo** non è scritto qui, perché invecchierebbe: si guarda.
   - `curl -s localhost:4321/api/status`: se non stampa niente, STEM è spento. Da acceso risponde `{"voice":{"provider":"eleven"|"mac","credits":…,"mac":"voce del Mac"},"browser":…,"gifs":…,"agenda":…}`.
     - `provider` dice quale voce useranno le prossime risposte.
     - `browser` dice che Playwright è pronto, non che la finestra di Google sia aperta.
     - `agenda` conta i compiti arrivati all'ora e non ancora detti. Tutta l'agenda sta in `runtime/agenda.json`.
   - `tail -50 runtime/server.log` mostra server, cervello e voce. Le righe non hanno l'ora: gli avvii si separano dalle righe «STEM online». Il file si riempie solo se STEM è partito da `STEM.app`.
   - `tail -50 runtime/ascolto.log` dice di che tipo era ogni frase sentita: per STEM (nome, conversazione, comando, saluto), scartata, eco. Le frasi non ci sono mai, per privacy. Delle frasi scartate annota solo la prima parola e quella più simile a «stem». Tiene le ultime 300 righe.
4. **Cosa resta aperto:** la sezione qui sotto.

## Aperto (al 10/11/2026)
- **HUD in stile JARVIS: costruito e fotografato, mai visto da Tony** (10/11). Al posto dell'umanoide c'è la sfera-cervello di `public/nucleo.js` dentro gli anelli. Le montagne sono state tolte e lo sfondo è nero.
  - **Costo** (`prove/grafica-banco.mjs`, GPU libera): 2,76–3,00 ms a fotogramma in ogni stato, contro i 4,15 dell'umanoide. Il margine per le mani cresce invece di calare.
  - **Mani col nucleo nuovo** (`prove/ologramma-hud.mjs`, headless sulla GPU dell'M2, turbofan con le quote e due mani, due giri il 10/11): fotogrammi contati per secondo con mediana 60 e p10 60. Nella misura mandata alla chiusura il minimo è stato 32, 42 e 43. È sempre con l'ascolto spento e la foto al posto della fotocamera, e la traccia del compositore non è stata rifatta.
  - **Sforzi:** il rosso parte da fs 1, dove il materiale snerva, come dice il contratto. Prima il rosso pieno partiva già da fs 1,25. Sopra fs 1 la scala va dal blu al viola al magenta.
  - **Quote in mm:** le ha il pezzo scelto, e senza pezzo scelto l'ingombro del modello. Un cilindro è quotato sulla scatola che lo contiene, quindi le linee di riferimento possono partire da angoli vuoti. Va guardato con Tony.
  - **La scheda dell'ascolto mostra tutto quello che il microfono sente**, anche le frasi di altri nella stanza. Restano solo sullo schermo, mai nei registri. Se a Tony non va, si spegne nascondendo `#ascolto`.
  - **Micro-dati:** quelli ai bordi e a raggiera sono numeri veri. Le coordinate e gli esadecimali che girano negli anelli sono decorazione.
  - **Mai provati:**
    - la scheda dell'ascolto con la voce vera di Tony, cioè con le parole parziali del riconoscitore locale;
    - l'HUD sul suo schermo, che ha accanto un secondo monitor 1920×1080;
    - i colori delle anomalie in un caso vero.
- **Ologrammi: costruiti e provati, mai usati da Tony** (9/11). Cosa è vero e cosa no, e come si parlano i pezzi, sta nel contratto `public/ologramma/LEGGIMI-ologramma.md`. Tony non ha file CAD: i suoi oggetti veri fatti a occhio li ha bocciati 3 volte su 3, mentre gli sono piaciuti un modello di Sketchfab con vista esplosa ed etichette e un turbofan fatto di primitive.
  - **Mani, la regola di Tony:** si accendono solo se l'HUD resta sopra 45 fps sul suo M2. Headless sulla GPU dell'M2, con il turbofan e due mani, la traccia del compositore ha dato 54,4 fps: mediana per secondo 55 e p10 48, quindi 3 fps di margine. Era però con l'ascolto spento e una foto al posto della fotocamera.
    - La misura vera arriva da sola. Quando l'ologramma si chiude, dopo almeno 10 s di mani accese, `runtime/server.log` riceve una riga «[ologramma] mani accese N s: fps mediana …, p10 …, minimo …, detect … ms» (`grep 'mani accese' runtime/server.log`).
    - Se il p10 vero sta sotto 45, le mani si spengono di base cambiando `maniVolute` in `public/stem.js`.
    - La riga non arriva se Tony chiude la finestra dell'HUD con l'ologramma aperto.
  - **A batteria sotto il 20%** il Risparmio energetico di Chrome limita ogni pagina a 30 fps, HUD compreso (misurato l'8/11). Una riga «mani accese» con mediana 30 viene da lì. Spegnerlo nel profilo dell'HUD costa batteria: lo decide Tony.
  - **Mai provati:**
    - la fotocamera vera: la prima volta macOS chiede il permesso per STEM.app e Chrome quello dell'HUD; se Tony li nega, resta il mouse;
    - i gesti su Tony: le soglie sono da rifare con lui (filtro con beta 5, palmo 90 mm, presa 350 ms, lancio da circa 1 m/s);
    - i suoni nuovi, che nessuno ha ascoltato;
    - la frase breve («Te lo costruisco.») che la persona chiede prima di un modello nuovo.
  - **Tempi col cervello vero** (7/11, tre domande):
    - turbofan da 22 pezzi: 46 s prima della prima parola, cioè 20 s di pensiero, 17 s per scrivere il modello e 3 s di strumento;
    - staffa con analisi: prima parola a 13 s, fine a 28 s;
    - cambio di lega: prima parola a 3 s, fine a 15 s.
  - **Il calcolo non è conservativo:**
    - lo sforzo al centro dei voxel sottostima quello in superficie: −5,8% con 16 voxel nello spessore, −12,4% con 8, fino al 40% vicino agli incastri;
    - il picco sugli spigoli vivi dipende dalla griglia: nella staffa di prova 128 MPa sulla punta della nervatura, contro 31–48 MPa della teoria della trave;
    - i pezzi sottili sono lenti: una piastra curva da 52.000 voxel richiede 13 s, e una trave da 10 m × 10 × 10 mm non finisce nei 55 s del calcolo. Il rimedio vero sta nel risolutore (operatore grossolano di Galerkin).
  - **File 3D:** si aprono fino a 1 milione di triangoli (`TRIANGOLI_MAX` in `geometrie.js`). Con le mani, 1 milione fa 50,7 fps e 2 milioni 33,3. Caricarne un milione ferma l'HUD per circa 2,5 s.
  - **Comandi a voce:** con l'ologramma aperto, una frase che comincia con esplod…, rimont…, tagli…, togli…, rimett… o chiud… è per STEM anche se è di una parola e anche senza il nome. Qualche frase non sua arriva al cervello, per esempio «tagliatelle stasera?».

Restano decisioni di Tony, non lavoro sul codice:
- **A batteria il Mac va in stop, e l'agenda con lui.** L'orologio gira solo con STEM acceso e il Mac sveglio. A batteria lo schermo si spegne dopo 10 minuti senza tocchi e il Mac va in stop circa 5 secondi dopo (`pmset -g custom` e `pmset -g log` del 1/11); a corrente non va mai in stop. Parlare a STEM non conta come tocco. Non è misurato se l'HUD acceso basta a tenerlo sveglio.
  - Oggi `ricorda`, a batteria, dice al cervello di avvisare Tony.
  - Il rimedio sarebbe `caffeinate -i` finché un compito è vicino, al costo di un po' di batteria: lo decide Tony.
- **Opus 5.5 al posto di Sonnet** (5/11, scelta di Tony). Con `prove/latenza.mjs` (8 domande brevi, persona di STEM, misure una dopo l'altra), la prima parola dal secondo turno in poi è arrivata così:
  - Sonnet 5.5: mediana 0,8 s, massimo 1,3 s;
  - Opus 5.5 a `xhigh`, l'effort ereditato da Claude Code: mediana 4,1 s, massimo 10,4 s;
  - Opus 5.5 a `medium`, la scelta: mediana 2,3 s, massimo 3,4 s;
  - Opus 5.5 a `low`: mediana 2,2 s, massimo 2,4 s.

  Se a Tony la pausa sembra lunga, in `.env` può mettere `STEM_MODEL=sonnet` oppure `STEM_EFFORT=low`. Mai provato sulle ricerche lunghe nel browser, dove l'effort più alto potrebbe valere l'attesa.
- **Memoria provata una volta** (5/11, cervello vero). Detto di passaggio «L'evocazione l'ho già visto», entro 13 secondi dalla chiusura dell'HUD finto STEM ha cominciato a fare memoria e ha salvato un ricordo sui gusti horror di Tony; prima, il 1/11, la stessa frase non era stata salvata. Dopo il riavvio ha ripreso la conversazione e sapeva l'ora esatta della domanda. Dopo `/api/reset` sapeva ancora che L'evocazione era già visto, dalla memoria. Il ricordo di prova è stato tolto: la memoria vera è com'era.
  - Le 184 domande del 1/11 non sono mai state rilette: lì ci sono persone e gusti che STEM non ha salvato. Se Tony vuole, si può fargliele rileggere una volta.
- **Orologio provato una volta** (5/11, HUD headless e muto, cervello vero). «Ricordami tra due minuti di bere»: `ricorda` è stato chiamato al primo colpo, il server è stato riavviato in mezzo, il compito è arrivato alle 04:20:20 esatte e STEM ha parlato per primo. «Che ore sono a Tokyo?»: risposta giusta in un secondo, senza browser. Mai provato con la voce vera e l'HUD a schermo intero.
- **Crediti ElevenLabs a zero fino al 19/11/2026 alle 05:19.** È il piano gratuito: 10.000 crediti al mese, e non se ne comprano altri a parte. Intanto STEM parla con la voce di sistema, oggi Siri Paolo. Se Tony passa a un piano a pagamento, STEM sceglie da solo la prima voce maschile italiana del suo account.
- **`GIPHY_API_KEY` assente:** `[gif: …]` non mostra niente, mentre le animazioni `[anim: …]` di Wikimedia funzionano.
- **Mai provati:** come suona `eleven_v4_turbo` (servono crediti) e le prestazioni dell'HUD nelle sessioni lunghe.
- **Report a schermo intero: provato una volta con una ricerca vera** (1/11). Alla domanda «fammi una ricerca sullo stato della realtà virtuale… mettimela a schermo» il cervello ha chiamato `mostra_report` da solo dopo 54 s. Il report aveva 10 blocchi e 9 fonti (IDC, Wikimedia, due video YouTube), e video e immagine si sono caricati.
  - **Fluidità:** in quella prova, con la voce e il browser attivi, l'entrata ha avuto scatti fino a 284 ms. Riaprendo un report di prova a riposo, 24 aperture su 26 sono state pulite (circa 50 fotogrammi al secondo, il limite della grafica WebGL). I due blocchi, di 100 e 400 ms, sono capitati subito dopo la prova vera.
  - Se gli scatti si notano, il primo indiziato è la sfocatura (`filter: blur`) delle schede in volo. Senza sfocatura sul lampo, però, le misure pulite non sono cambiate.

## Come è fatto
- **`server.mjs`** avvia e collega tutto:
  - HUD e API su `127.0.0.1:4321`. Le difese:
    - accetta solo l'Host `localhost:4321` o `127.0.0.1:4321`;
    - le POST richiedono `content-type: application/json` e un'origine locale, o nessuna;
    - su `/api/`, `/mediapipe/` e `/modelli/`, con ogni metodo, `sec-fetch-site` deve mancare o valere `same-origin`;
    - ogni file servito porta `x-frame-options: SAMEORIGIN` e `frame-ancestors 'self'`. Senza, un sito qualsiasi metteva l'HUD in un iframe e, con un ologramma aperto, accendeva la fotocamera (provato l'8/11);
    - un corpo JSON rotto, o che non è un oggetto, vale `{}`.
  - le variabili d'ambiente date a mano vincono su `.env`. `STEM_CERVELLO=<cartella>`, solo per le prove, fa vivere uno STEM di prova tutto lì: conversazione, `mcp.json`, ologramma e `ascolto.log`, con le cartelle dei documenti come sue sottocartelle. Così non tocca la memoria vera né i file di Tony.
  - un Chrome per Google con il suo profilo (`runtime/browser-profile`, CDP 9333);
  - Playwright MCP 0.0.83 sulla porta 8931, agganciato a quel Chrome, perché un browser lanciato da Playwright verrebbe chiuso alla fine di ogni risposta. Le schede nuove il server le chiude e ne apre l'indirizzo nella pagina principale;
  - lo screencast CDP mandato all'HUD come MJPEG su `/api/screen`;
  - l'HUD stesso, un Chrome `--app` a schermo intero con il profilo `runtime/hud-profile`.
- **`brain.mjs`** è il cervello: un solo `claude -p` in stream-json, sempre acceso. Il modello è Opus 5.5 (`claude-opus-5-5`) a effort `medium`, scelti con `STEM_MODEL` e `STEM_EFFORT`. Senza `--effort` il cervello prenderebbe l'effort delle impostazioni di Claude Code di Tony (`modelSettings` in `~/.claude/settings.json`, oggi `xhigh` per Opus 5.5), che servono a programmare.
  - **Cosa può fare** (flag in `server.mjs`): `Read`, `Write`, `Edit`, `Glob` e `Grep`, ma non `Bash`. I file sono solo quelli delle cartelle dei documenti (`--add-dir`), e come MCP ha solo `playwright` e `mac`. Non ci sono domande di permesso: è approvato quello che sta dentro le cartelle, il resto è negato.
  - **Dove vive:** il suo `cwd` è `~/Library/Application Support/STEM/cervello`, fuori dalla repository. La sua memoria è quella di Claude Code per quella cartella: `~/.claude/projects/-Users-tony-Library-Application-Support-STEM-cervello/memory/`. Lì STEM scrive da solo. `runtime/cervello` e `~/.claude/projects/-Users-tony-STEM-runtime-cervello` sono avanzi del vecchio `cwd`, usato fino al 1/11.
  - **Fare memoria:** da solo salvava quasi niente (3 ricordi in 184 domande al 1/11), quindi glielo chiede il server. Dopo 3 minuti senza domande, o circa 20 secondi dopo che l'HUD si è chiuso, gli manda un messaggio `[memoria]` che non viene letto ad alta voce. Le frasi finite in `[ignora]` non contano. Con `STEM_APP`, chiuso l'HUD, il server aspetta che la memoria finisca prima di spegnersi, ma non oltre 5 minuti dalla chiusura.
  - **Interruzioni:** una domanda nuova interrompe quella in corso con un `control_request` di tipo interrupt; se il turno non si chiude entro 4 secondi, il processo viene ucciso e rilanciato. Se muore, riparte con `--resume` sulla stessa sessione, mentre `/api/reset` lo fa ripartire da zero.
  - **Dopo un riavvio del server** riprende la stessa conversazione, se l'ultima risposta è di meno di 2 ore fa: id e ora stanno in `runtime/cervello.json`, che `/api/reset` cancella. Se una conversazione ripresa muore entro 20 secondi, per esempio perché non esiste più, ne apre una nuova.
  - **Marcatori nella risposta:** `[ignora]` vale solo prima che STEM abbia detto qualcosa. `[[mostra]]` apre il pannello del browser, che comunque si apre da solo alla quarta azione su Google. Poi ci sono `[gif: …]` e `[anim: …]`.
  - **Report:** il cervello chiama lo strumento `mostra_report` di `mac/mac-mcp.mjs`, che risponde e basta. È `brain.mjs` a leggere i blocchi dalla chiamata nel flusso e a mandarli all'HUD come evento `report`. Zero blocchi lo chiudono, come `Esc` e come un `[[mostra]]` nuovo. Un report con blocchi, `[[mostra]]` e la quarta azione nel browser chiudono anche l'ologramma, nell'HUD e nel server.
- **`stem-persona.md`** è il carattere di STEM, passato con `--append-system-prompt`. Il modo di ragionare è il `~/.claude/CLAUDE.md` di Tony, che Claude Code carica da solo. **Questo file non arriva a STEM:** per cambiare come risponde si modifica `stem-persona.md` e **si riavvia il server**, che lo legge una volta sola (`/api/reset` non basta).
- **`voice.mjs`** fa parlare STEM con ElevenLabs (`eleven_v4_turbo`, scelto con `ELEVENLABS_MODEL`) o con `say`. Il fornitore si decide alla prima frase di ogni risposta: ElevenLabs solo se i crediti sono almeno 400, o non ancora letti.
  - Se ElevenLabs fallisce alla prima frase, tutta la risposta passa al Mac (`x-stem-voce: mac;cambio`).
  - Se fallisce dopo aver già parlato, la frase si salta invece di cambiare voce.
  - La voce del Mac è quella di sistema, se italiana, anche Siri, letta da `defaults`. `STEM_MAC_VOICE` la scavalca.
- **`media.mjs`** cerca le immagini: `[gif: …]` su GIPHY (senza chiave non trova niente), `[anim: …]` su Wikimedia Commons.
- **`orologio.mjs`** è l'ora e l'agenda.
  - **L'ora:** il server mette `[adesso: giorno, ora (fuso, UTC±n)]` davanti a ogni messaggio per il cervello, perché Claude Code gli dà solo la data.
  - **L'agenda** è `runtime/agenda.json`. La scrivono gli strumenti `ricorda` e `agenda` di `mac/mac-mcp.mjs`, durante un turno del cervello, e il server, che toglie i compiti quando li consegna. I numeri dei compiti non si riusano mai.
  - **La consegna:** l'HUD chiede `/api/status` ogni 5 s. Se `agenda` è più di zero e STEM è fermo, senza nessuno che parla, manda `/api/ask` con `{"agenda":true}`. Il server toglie i compiti scaduti e passa al cervello un messaggio `[agenda]` che contiene tutto il compito: serve perché, dopo un riavvio, il cervello non ricorda di averlo segnato. I compiti scaduti mentre STEM era spento arrivano appena si riaccende, detti come in ritardo.
- **`ologramma.mjs`** è lo stato unico degli ologrammi, e il server è l'unico che lo scrive. Valida i modelli del cervello, tiene modello e versione, scrive i testi per il cervello e salva in `runtime/ologramma.json` e `runtime/ologramma-campo.bin`. All'avvio del server un ologramma rimasto aperto si chiude. Il contratto fra i pezzi è `public/ologramma/LEGGIMI-ologramma.md`.
  - **Gli strumenti** `mostra_ologramma`, `modifica_ologramma` (anche titolo e descrizione) e `analizza_struttura` stanno in `mac/mac-mcp.mjs`. Sono client sottili: chiamano `POST /api/ologramma` sulla porta che `mcp.json` passa con `--porta`, perché le variabili di `.env` non arrivano ai processi figli.
  - **La foto:** gli strumenti restituiscono il testo più la foto PNG che l'HUD manda dopo ogni versione nuova, così STEM vede quello che ha fatto. Il server la aspetta fino a 8 s dopo `mostra` (o con pezzi da file) e 4 s dopo una modifica.
  - **Le altre vie:**
    - `/api/ologramma/campo?v=`: il fattore di sicurezza di ogni voxel;
    - `POST /api/ologramma/foto`;
    - `/api/ologramma/file/<modello>/<id>`: solo il file di un pezzo dello stato attuale, dentro le cartelle di Tony;
    - `/mediapipe/` (da `node_modules`) e `/modelli/`: il modello delle mani si scarica al primo avvio in `runtime/modelli/` e si usa solo se lo SHA-256 è giusto.
  - **Come si riconosce l'HUD:** manda `origin` o `sec-fetch-site`, e il processo MCP no. Dall'HUD passano solo togli, rimetti, chiudi e la misura delle mani, che il server scrive nel registro.
- **`fisica/`** calcola gli sforzi in un `worker_threads`, fermato dopo 55 s:
  - `voxel-fea.mjs`: elasticità lineare statica a voxel, con multigriglia;
  - `struttura.mjs`: dal modello ai voxel, poi carichi, vincoli e risultati per pezzo;
  - `lavoratore.mjs`: l'ingresso del worker.

  Se cambia solo la lega e ν resta uguale, si rifà solo fs, senza risolvere di nuovo.
- **`public/`** è l'HUD:
  - `index.html`: la palette sta in variabili CSS.
    - Colori: `--ciano` dominante; `--arancio` e `--rosso` solo per le anomalie.
    - Caratteri: `--sottile` è Helvetica Neue, `--mono` è Menlo, tutti e due di sistema. L'HUD non chiede niente ad altri siti per disegnarsi.
    - I moduli hanno angoli a staffa (`.staffe`) al posto delle cornici piene.
  - `stem.js`:
    - ascolto sempre acceso, decide se una frase è per STEM, coda audio, consegna dell'agenda;
    - **la scheda dell'ascolto** (`#ascolto`): le parole mentre arrivano e, a frase finita, cosa ne ha fatto STEM. Solo `textContent`, mai nei registri;
    - **i dati a raggiera** appesi ad `anchor().R`, con i fili SVG: stato, voce, tempo di risposta, ingresso audio, sistemi, fps;
    - **i micro-dati ai bordi**: lo spettro del microfono in esadecimale, gli eventi (tipi e nomi di strumenti, mai frasi), ora, memoria e livelli. Si aggiornano 8 volte al secondo;
    - **gli allarmi**: `allarme(causa, livello, testo, ms)` tiene le cause attive e ne ricava `S.allarme`.
      - 1, arancione: ascolto spento, calcolo degli sforzi fallito;
      - 2, rosso: server perso per due giri di `/api/status`, cervello in errore, un pezzo dell'ologramma con fs sotto 1.
  - `report.js`: il report a schermo intero, ricalcato sui secondi 34–46 del video di ROSE. È una griglia 12×6; le ultime due colonne delle ultime due righe restano al nucleo, che ci scivola rimpicciolito (`S.dock` in `nucleo.js`). I blocchi entrano in quattro tempi: un lampo di copie in profondità (0–0,8 s), il primo video (0,4–0,9 s), gli altri uno alla volta (fino a circa 2 s), poi partono i video. I suoni dell'entrata stanno in `sfx.js` (`report`), agganciati ai tempi di atterraggio che `showReport` restituisce. I blocchi in più si impilano e cambiano ogni 9 s. Il testo del cervello entra solo con `textContent`, le immagini solo da `https`, i video solo come ID di YouTube;
  - `nucleo.js`: la sfera-cervello e gli anelli (three.js 0.160 con bloom). Il contratto è quello che usava l'umanoide: `TIMING` e `createScene(canvas, S)`, che restituisce `frame`, `anchor` (con `R`, il raggio dell'anello più esterno), `assembling`, `renderer` e `strato`.
    - Dall'esterno: un guscio di particelle che sente il microfono, un gomitolo di filamenti dove nel pensiero corrono gli impulsi, un nucleo che pulsa con la voce.
    - Intorno ci sono anelli a velocità e versi diversi: gradi, tacche, segmenti, archi di dati, un arco che scansiona.
    - Arancione e rosso arrivano solo con `S.allarme`.
    - Il composer usa un render target con lo stencil, che serve alla sezione piena dell'ologramma. `strato` aggancia la scena dell'ologramma prima del bloom.
  - `ologramma/`: `forme.js` e `materiali.js` (anche nel server), `geometrie.js`, `scena.js` (la scena), `gesti.js` e `mani.js` (MediaPipe 0.10.35 in locale). Il colore degli sforzi è lo sforzo diviso lo snervamento: blu se è lontano, rosso dove il materiale snerva;
  - in `stem.js`, con l'ologramma aperto:
    - tasti: E esplodi; X raggi X, D densità, F sforzi (premuti di nuovo tornano all'ologramma); O ologramma, L solido; S sezione lungo x, y, z o niente, con le frecce che la spostano; R ritorna alla vista di partenza; Z rimette l'ultimo pezzo tolto; M accende o spegne le mani (la scelta resta in `localStorage` `stem-mani`); Esc chiude tutto;
    - mouse: trascinare ruota, la rotella fa lo zoom, il clic sceglie un pezzo e il doppio clic lo isola;
    - mani: un pizzico con una mano ruota, con due fa lo zoom, due palmi aperti esplodono, e un pezzo afferrato e lanciato si toglie;
  - `sfx.js`: suoni sintetizzati, anche quelli dell'ologramma.
  - `lab-sfx.html` prova i suoni, anche quelli del report. `lab.html` prova la grafica, ma funziona solo servendo la radice della repository (per esempio `python3 -m http.server` in `~/STEM`, poi `/public/lab.html`), non da `localhost:4321`. `lab-ologramma.html?demo=turbofan|staffa` e `lab-mani.html` provano ologramma e mani da soli.
- **`mac/`** controlla il Mac: un server MCP su stdio senza pacchetti, più un aiutante Swift che si compila da solo in `runtime/stem-mac` quando `helper.swift` cambia. I dettagli stanno in `mac/LEGGIMI-mac.md`.
- **`browser-fx.js`** è iniettato in ogni pagina di Google: disegna il mirino e l'animazione dei clic e tiene i link nella stessa scheda.
- **Avvio:**
  - `STEM.app`, nella radice della repository, lancia `avvia-app.sh`, che imposta `STEM_APP=1`: con l'HUD chiuso per circa 150 secondi, il server si spegne (più tardi se sta facendo memoria, al massimo dopo 5 minuti). I permessi di macOS vanno a STEM.app; Accessibilità e Registrazione schermo sono stati dati il 1/11.
  - `avvia.command` è la via da Terminale. Chiede la chiave finché `.env` non ne ha una valida. Il registro va nella finestra e i permessi al Terminale; chiudendo l'HUD il server resta acceso.
- **Per girare servono:** il comando `claude` nel PATH, la rete (`npx` scarica Playwright MCP, e al primo avvio il server scarica il modello delle mani) e `/usr/bin/swiftc`. `avvia-app.sh` e `avvia.command` lanciano `npm install` se manca `node_modules/@mediapipe/tasks-vision`. Le impostazioni stanno in `.env` (elenco commentato in `.env.example`); `ELEVENLABS_VOICE_ID`, se è pieno, blocca la scelta automatica della voce.

## Provare
- **Riavviare.** Il kill colpisce solo il processo sulla porta di STEM, non altri `node` di Tony:
  ```bash
  lsof -ti tcp:4321 -sTCP:LISTEN | xargs kill
  ```
  poi:
  ```bash
  open ~/STEM/STEM.app
  ```
  - Dopo circa 14 secondi, controlla `/api/status`.
  - Uscendo con SIGTERM, il server chiude i Chrome e il Playwright che ha lanciato lui. Con `kill -9` restano accesi, e il server successivo riusa il Chrome di Google che trova sulla porta 9333.
  - Se STEM è in uso (`ascolto.log` si muove), avvisa Tony prima di riavviarlo.
- **Senza microfono:** apri `http://localhost:4321/?debug&wav=prova.wav`, e STEM ascolta quel file invece del microfono.
  - Il file va in `public/`, l'unica cartella servita, e deve avere pause vere: 2 secondi prima della frase e 5 dopo.
  - Suona in loop finché la scheda resta aperta: chiudila subito dopo la prova.
  - Poi cancella il file: `*.wav` non è nel `.gitignore`, e una registrazione della voce di Tony non deve finire online.
  - Con `?debug` ci sono anche `window.stemAsk('domanda')` e `window.stemReport({ titolo, blocchi })`, che apre un report senza fare la ricerca. I blocchi hanno la forma dello strumento `mostra_report`.
- **HUD vero comandato da te, senza microfono né voce di Tony:**
  1. avvia il server con `STEM_NO_OPEN=1 node server.mjs`, che non apre finestre;
  2. apri l'HUD con lo stesso profilo e gli stessi flag di `openHud` in `server.mjs`, più `--remote-debugging-port=9556` e l'indirizzo `/?debug`;
  3. via CDP chiama `stemAsk` o `stemReport`, fotografa con `Page.captureScreenshot` e misura con `Page.startScreencast`.

  Alla fine chiudi quel Chrome tu: il server chiude solo quelli che ha aperto lui.
  - Per non far comparire la finestra di Google, prima del server avvia tu un Chrome headless con `--remote-debugging-port=9333` e un profilo temporaneo: il server lo trova sulla porta e lo usa. Sull'HUD di prova metti `--mute-audio`.
- **Grafica, senza STEM acceso:**
  - `node prove/grafica-banco.mjs [--modulo public/nucleo.js]` fa girare il modulo del nucleo in un Chrome headless sulla GPU, a 1470×956 punti e 2x.
    - Per 12 stati (formazione, attesa, ascolto, pensiero, voce, i due allarmi, browser, angolo) misura:
      - una foto;
      - gli fps contati per secondo;
      - il costo vero a fotogramma.
    - Porte 4471 e 9571.
    - Il budget è il costo dell'umanoide di prima: 4,15 ms.
  - `node prove/hud-foto.mjs [--uscita <cartella>]` fa girare l'HUD vero con un server finto:
    - cervello a copione, voce e riconoscimento finti;
    - foto di avvio, casa, ascolto, pensiero, voce, allarmi, browser, report, ologramma e server perso;
    - controlla anche console e rete.
    - Porte 4481 e 9581, circa 2 minuti.
  - Con `?debug` ci sono anche:
    - `stemParziale('frase')`: le parole parziali, per la scheda dell'ascolto;
    - `stemAllarme(causa, livello, testo, ms)`.
- **Latenza del cervello:** `node prove/latenza.mjs <modello> [effort]`. Fa 8 domande a un `claude -p` sempre acceso con la persona di STEM, in una cartella vuota, e stampa il tempo alla prima parola per ogni turno, con mediana e massimo dal secondo. Consuma come 8 domande a STEM.
- **Memoria:** una prova con il cervello vero scrive nella memoria vera di STEM. Prima copia la cartella `memory/` del cervello, dopo confrontala e rimettila com'era. Per provare la chiusura dell'HUD senza HUD: `STEM_APP=1 STEM_NO_OPEN=1 node server.mjs`, un ciclo di `curl` su `/api/status?hud=1` ogni 5 secondi, la domanda con `curl` su `/api/ask`, poi si ferma il ciclo. Il registro scrive `[memoria] rileggo la conversazione` e, dopo un riavvio, `[cervello] riprendo la conversazione di prima`.
- **Agenda:** con `?debug`, `stemAsk('ricordami tra due minuti di …')`. Il compito compare in `runtime/agenda.json`, e quando STEM lo dice il registro del server scrive `[agenda] parlo per primo`. Gli strumenti da soli si provano anche senza cervello, con `ricorda` nella prova a mano di `mac/LEGGIMI-mac.md`.
- **Ologrammi:** le prove stanno in `prove/`, non vogliono STEM acceso e vanno lanciate una alla volta, perché hanno porte fisse.
  - `node prove/ologramma-forme.mjs`, `ologramma-stato.mjs`, `struttura.mjs` (25 s), `ologramma-geometrie.mjs`, `gesti.mjs` e `fea/test-trave.mjs --mg 4 8`.
  - `node prove/ologramma-server.mjs <cartella>`: il server vero sulle porte 4422, 8932, 9334 e 4498, con un cervello finto e un Chrome headless suo. Dura circa 30 s.
  - `node prove/ologramma-hud.mjs <cartella> <cartella-foto>`: l'HUD vero headless, sulla GPU dell'M2, porte 4431 e 9562. Dura circa 2 minuti e spegne il Risparmio energetico nel suo profilo. Vuole `runtime/modelli/prova-mani.jpg`, che non è nella repository: è un'immagine di prova di MediaPipe, e si scarica con
    ```bash
    curl -sS --fail -o runtime/modelli/prova-mani.jpg https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/right_hands.jpg
    ```
  - Con `?debug` ci sono:
    - `stemOlogrammaDemo('turbofan')` o `'staffa'`, che apre un ologramma senza server né cervello;
    - `stemSente('frase')`, che passa una frase al filtro dell'ascolto;
    - `__misure`, con gli fps per secondo e le misure delle mani;
    - `?debug&mani=immagine`, che usa la foto di prova al posto della fotocamera.
  - Uno STEM di prova completo: `STEM_CERVELLO=<cartella> STEM_PORT=… STEM_BROWSER_PORT=… STEM_CDP_PORT=… STEM_NO_OPEN=1 node server.mjs`. Gli strumenti si chiamano senza cervello con `node mac/mac-mcp.mjs --porta <porta>`. Senza un turno del cervello l'HUD vede le versioni nuove solo col giro di `/api/status`, ogni 5 s, e la foto può non arrivare in tempo.
- **Voce:**
  ```bash
  curl -s -X POST localhost:4321/api/tts -H 'content-type: application/json' -d '{"text":"prova","answer":"prova-1"}' -o /tmp/prova.audio -D -
  ```
  - L'intestazione `x-stem-voce` dice chi ha parlato.
  - Cambia `answer` a ogni prova, perché il fornitore resta fisso per risposta.
  - Con ElevenLabs consuma crediti.

## Regole del progetto
- **Dipendenze:** in `package.json` ci sono solo three.js e `@mediapipe/tasks-vision`, fissata alla 0.10.35 perché dalla 1.0 manda statistiche a Google ogni 60 s. Node con moduli ES, nessuna build. Commenti e testi sono in italiano.
- **Commit:** in italiano. Nel titolo, `Area: cosa cambia per Tony`; nel corpo, il perché. Dopo ogni lavoro si fa commit e push su `main` della repository privata MasterCod24/stem: Tony vuole tutto online per non perdere niente.
- **Fine lavoro:** prima di chiudere aggiorna la sezione **Aperto**. Togli ciò che è risolto e aggiungi ciò che resta da decidere a Tony.
- **Segreti:** `.env` (con la chiave ElevenLabs) e `runtime/` non vanno mai online, e la chiave non si ripete mai in chat.
- **Colori dell'HUD** (scelta di Tony del 10/11):
  - ciano dominante;
  - arancione e rosso solo per le anomalie (`S.allarme`, `.attenzione`, `.cede`, la scala degli sforzi), mai per decorare.
  - Un colore nuovo con un significato va scritto qui.

## Lezioni da non ripetere
- **Registri e crediti prima del codice.** La voce che saltava tra ElevenLabs e il Mac dipendeva dai crediti finiti: le frasi corte passavano, quelle lunghe no.
- **Il riconoscitore locale storpia il nome.** «Stem» diventa "System", «Ciao STEM» diventa "Charge them", e c'è «Stemma».
  - In `public/stem.js`, `isName` accetta già ogni parola che differisce da «stem» di una lettera. Gli alias veri stanno in `NAME_ALIASES`, quelli validi solo a inizio frase in `NAME_AT_START`. `NOT_NAME` elenca invece le parole da *escludere*.
  - Prima di aggiungere un alias, cercalo in `ascolto.log`. Di una storpiatura di due parole il registro mostra una parola sola.
- **Un Chrome dimenticato continua ad ascoltare.** Un HUD di prova lasciato aperto ascolta e scrive nel registro, quindi chiudi sempre i Chrome di prova.
- **La cache di Chrome nasconde le modifiche** quando servi i file con `python3 -m http.server`. Disattivala con il comando CDP `Network.setCacheDisabled`.
- **Shader:** un NaN produce riquadri neri. Limita sempre la base di `pow` e fai i quadrati a mano. Passa i colori come uniform lineari: quelli scritti in sRGB nello shader escono grigi.
- **Voci di Siri:** non si chiamano con `say -v`. Si usano come voce di sistema, con `say` senza `-v`, e STEM legge la scelta da `defaults read com.apple.Accessibility SpokenContentDefaultVoiceSelectionsByLanguage`.
- **Strumenti che chiudono le app** (`chiudi_app`): prima di provarli controlla quali istanze sono aperte. Un agente ha chiuso il Chrome personale di Tony, e `chiudi_app` risparmia solo i Chrome di STEM.
- **Non toccare i `chrome-headless-shell` in `~/.cache/hyperframes`:** sono di un altro strumento di Tony.
- **Il pannello del browser di Claude, se è nascosto, non fa avanzare le animazioni:** le schermate restano vecchie e le promesse `finished` non si risolvono. Per misurare un'animazione dell'HUD:
  - usa un Chrome headless tuo, con profilo in una cartella temporanea e una porta diversa da 9333;
  - rallentala con il comando CDP `Animation.setPlaybackRate`.
  - Quel comando rallenta anche il tempo passato a `requestAnimationFrame`. Non mescolarlo con `performance.now()`: la scrittura a macchina delle note restava vuota proprio per questo.
- **La latenza di un modello si misura in fila e su più turni.** Il 5/11 avevo previsto Opus 5.5 a `xhigh` tra 3 e 8 secondi, e a `low` vicino a Sonnet. Una prima misura con quattro processi in parallelo dava Opus quasi pari a Sonnet e `low` come il più lento: era rumore. Le misure una dopo l'altra, su 8 turni, hanno mostrato altro: Opus ha un fondo di circa 2 secondi a qualunque effort, e `xhigh` aggiunge pause fino a 10 secondi nei turni in cui pensa di più (più token in uscita).
- **Un CLAUDE.md scritto a memoria sbaglia.** La prima versione di questo file, scritta da un riassunto, aveva una ventina di errori o mancanze contro il codice. Ogni affermazione nuova va controllata sul codice prima del commit.
- **Gli fps non si misurano con la mediana degli intervalli di `requestAnimationFrame`.** Con le mani diceva 59,9, mentre i fotogrammi contati in ogni secondo erano 51–55.
  - Si usa la traccia del compositore (DrawFrame contro DroppedFrame), oppure si contano i fotogrammi in ogni secondo intero, come fa ora `__misure`.
  - Servono almeno due giri, perché il carico di fondo cambia: sullo stesso codice il p10 con le mani è stato 30, poi 59,5, poi 59,9.
- **A batteria sotto il 20% Chrome dimezza gli fps:** il Risparmio energetico porta ogni pagina a 30.
  - Il flag `--disable-features=BatterySaverModeAvailable` non basta.
  - Serve la preferenza `performance_tuning.battery_saver_mode.state = 0` nel `Local State` del profilo.
- **Un profilo Chrome nuovo con l'HUD scarica il modello vocale italiano**, e intanto le misure sbagliano. Nelle prove di prestazioni il riconoscimento va spento.
- **three.js: un `Box3` vuoto vale ±Infinity.** Un NaN finito nella camera ci resta per sempre, perché un lerp da NaN dà NaN: l'ingombro si controlla prima di usarlo.
- **Un limite scritto senza misurarlo era falso.** Il commento di `TRIANGOLI_MAX` prometteva 45 fps con 2 milioni di triangoli; misurati con le mani, erano 33.
- **Un criterio largo nasconde gli errori sistematici.** L'errore di volume del cavo era −0,6%, cioè 10σ, e passava la soglia dell'1%. L'ha preso solo il controllo «errore ≤ 4σ».
- **Cercando i processi di una prova per argomento si trova anche la shell che l'ha lanciata**, perché nei suoi argomenti ci sono la cartella e le porte. Vanno esclusi tutti gli antenati, non solo il genitore.
- **Un agente fermato dal limite di utilizzo lascia accesi i suoi STEM di prova**, con i loro Chrome e Playwright. È successo due volte, per tre ore e per tre ore e mezza. Alla ripresa si cercano con `lsof` sulle porte di prova e con `ps` sui profili della scratchpad.
- **In Chrome `gl.finish()` non aspetta la GPU.** Il 10/11 dava 0,1 ms a fotogramma per l'umanoide col bagliore a 2205×1434. Il costo vero si misura con n fotogrammi di fila e un solo `readPixels` alla fine, che deve restituire pixel veri: 4,15 ms, con tre giri uguali entro l'1%.
