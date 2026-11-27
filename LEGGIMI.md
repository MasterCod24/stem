# O.S.C.A.R.

![O.S.C.A.R.](public/icona.png)

Assistente vocale stile JARVIS per il Mac: ragiona col tuo `~/.claude/CLAUDE.md`, ascolta sempre, parla con la voce del Mac, naviga su Google, usa le app e lo schermo al posto tuo.

## Avvio
Per l’agenda serve Node.js con il modulo integrato `node:sqlite`.

- **App O.S.C.A.R.:** doppio clic su `O.S.C.A.R.app` (o Spotlight, o trascinala nel Dock). Si apre l'HUD a schermo intero: una nube di particelle collassa in una goccia e un'onda disegna gli anelli, in un secondo e mezzo. Se O.S.C.A.R. è già acceso, riapre solo l'HUD. Quando chiudi l'HUD (Cmd+Q), O.S.C.A.R. si spegne da solo entro un paio di minuti, qualcuno in più se sta ancora facendo memoria.
- Se macOS richiede nuovamente Accessibilità o Registrazione schermo, scegli **O.S.C.A.R.** nelle Impostazioni di Sistema.
- **Da Terminale:** `./avvia.command`. Ctrl-C o chiudere la finestra spegne tutto.

## Parlare con O.S.C.A.R.
L’assistente si chiama **O.S.C.A.R.** e si pronuncia **Oscar**. Puoi dire «Ciao Oscar» oppure «Oscar, che ore sono?».
- **Sempre in ascolto**, senza tasti: O.S.C.A.R. capisce da solo quando parli con lui. Una frase è per lui se:
  - contiene il suo nome (anche sbagliato di una lettera dal riconoscitore);
  - la cominci entro 15 secondi da quando ha finito di parlare: così puoi continuare il discorso senza ripetere il nome, anche solo con un «sì».

  Nient'altro passa: né la TV, né un «dimmi» detto a qualcun altro. Il cervello sa anche quale delle due è: senza il nome, nel dubbio tace (`[ignora]`). Con l'ologramma aperto vale lo stesso: «O.S.C.A.R., esplodilo».
- **Il cervello** è un processo Claude Code sempre acceso, con Opus 5.5. Risponde a effort basso, con la prima parola in circa due secondi (con Sonnet 5.5, `OSCAR_MODEL=claude-sonnet-5-5` in `.env`, meno di uno). Per un ologramma, una ricerca con un report o un calcolo, dice prima una frase breve («Te lo costruisco.») e poi lavora a effort alto. Si cambiano in `.env` con `OSCAR_EFFORT` e `OSCAR_EFFORT_PENSA`. Se fai una pausa a metà di una richiesta, O.S.C.A.R. parte già e, se poi continui, riparte con la frase completa.
- **Interromperlo:** mentre parla di' "stop", "basta" o "aspetta", oppure chiamalo per nome. `Esc` lo zittisce.
- **La scheda dell'ascolto:** in basso, sotto la goccia, O.S.C.A.R. scrive quello che dici mentre lo dici. A frase finita aggiunge cosa ne ha fatto: «PER O.S.C.A.R. · NOME», «PER O.S.C.A.R. · CONVERSAZIONE», «NON PER O.S.C.A.R.». Così vedi subito perché non ti ha risposto.
- **Privacy:** l'ascolto usa il riconoscimento vocale locale di Chrome: l'audio della stanza non esce dal Mac. Le frasi della scheda dell'ascolto restano sullo schermo e non finiscono in nessun registro. In `runtime/ascolto.log` O.S.C.A.R. annota solo se una frase era per lui e la prima parola di quelle scartate, per capire come il riconoscitore ti sente.

Se il cervello tace per 45 secondi, sullo schermo appare un avviso. Puoi dire «stop» o premere Esc. Dopo tre minuti senza progressi il turno si interrompe automaticamente. Il limite sale a sette minuti durante l’uso di uno strumento. Puoi quindi fare una nuova domanda.

## Cosa vedi
- **La goccia è il cervello di O.S.C.A.R.** Tutto quello che si muove segue la fisica vera, come una goccia d'acqua che vibra:
  - in attesa trema appena, come una goccia ferma;
  - quando parli vibra col tuo microfono, e l'anello dello spettro mostra le tue frequenze (basse in basso, alte in alto);
  - quando pensa si allunga e gira, nelle linee di campo dentro corrono le cariche e sulla corda attorno girano onde che si incrociano;
  - quando parla vibra con la sua voce, e la voce fa partire onde dalla cima della corda;
  - in un'anomalia seria trema forte e si fa rossa.
- **Le animazioni** sono molle: brevi (un quinto di secondo), con un filo di rimbalzo, e se cambi idea a metà ripartono senza scatti.
- **Intorno alla goccia** ci sono i dati veri, appesi agli anelli come pesi su una molla: lo stato, la voce in uso, quanto ha messo a rispondere l'ultima volta, il microfono in dB, browser e agenda, gli fps.
- **Ai bordi:** a destra gli eventi (domande, strumenti, voce, mai le frasi), che si spengono man mano che invecchiano; in alto ora e memoria.
- **I colori:**
  - ciano vuol dire che tutto va;
  - arancione è un'anomalia da guardare: microfono negato o spento, calcolo degli sforzi fallito;
  - rosso è un'anomalia seria: server o cervello persi, un pezzo dell'ologramma che cede.

  La causa è scritta sotto lo stato.

## Cosa fa
- **Browser:** lavora su Google in un Chrome suo, sempre nella stessa pagina. Il pannello compare nell'HUD **solo per i compiti complessi** (ricerche lunghe, creazioni); le cose banali le fa in silenzio e ti dice il risultato.
- **GIF ed esempi:** quando spiega, mostra accanto alla goccia animazioni da Wikimedia Commons (per esempio un motore a quattro tempi); per le GIF simpatiche serve una chiave gratuita GIPHY in `.env` (`GIPHY_API_KEY`, da developers.giphy.com).
- **Report a schermo intero:** alla fine di una ricerca che vuoi vedere, O.S.C.A.R. apre un report come quello di ROSE. È una griglia di note, grafici, un dato in grande, immagini e video di YouTube muti, che arrivano dal fondo e si mettono a fuoco uno alla volta, con i loro suoni, mentre lui si sposta nell'angolo in basso a destra. Le note in più si alternano ogni 9 secondi. Si chiude con `Esc`, oppure chiedendoglielo.
- **Ologrammi:** chiedigli di mostrarti un oggetto in 3D («mostrami un motore a reazione», «fammi una staffa a L in alluminio») e lo costruisce. Dal 22/11 non compare più nell'HUD: si apre in una finestra di Blender, davanti a tutto, e si chiude quando chiudi Blender o lo chiude lui.
  - **Blender:** O.S.C.A.R. costruisce ogni ologramma in Blender, da solo, senza che tu glielo chieda: da vertici e curve, mai da forme già pronte. Le forme semplici di prima restano solo per i cavi e per i pezzi di cui chiedi gli sforzi. Blender gira invisibile e chiuso in una gabbia: niente internet, niente file tuoi, niente altri programmi. I file finiscono in Documenti, nella cartella OSCAR-Blender. Quei pezzi non hanno il calcolo degli sforzi.
  - **Com'è fatto davvero:** per un oggetto che esiste prima cerca in rete com'è fatto. Poi guarda fino a tre foto vere, fuori e dentro (uno spaccato o uno smontaggio), e le misure ufficiali: le rimette accanto alla foto dell'ologramma per confrontarle, e gli scarti delle misure li vede in percentuale. Nella scheda di ogni pezzo trovi materiale e lavorazione. Le fonti non ci sono: se vuoi sapere da dove viene un dato, chiediglielo. Per questo la prima vista può arrivare dopo qualche minuto.
  - **Cosa ci fai:** lo giri, lo esplodi, lo tagli, guardi dentro ai raggi X e togli i pezzi, a voce («esplodilo», «taglialo a metà», «togli il coperchio»), con le mani davanti alla fotocamera, o in Blender col mouse.
  - **La scheda:** a destra, nella scheda «O.S.C.A.R.», ci sono il modello (modo, esploso, sezione, massa, risultato degli sforzi) e il pezzo che scegli: nome, materiale, come è fatto, colore e misure in millimetri con i centimetri accanto. Lì puoi cambiarli: la modifica va a O.S.C.A.R., che ricalcola gli sforzi, e la scheda ti dice se l'ha presa o perché no. Sopra il modello vedi le misure in mm e cm del pezzo scelto, o di tutto il modello.
  - **I cavi:** se O.S.C.A.R. ci mette un flusso (elettrico, fluido, aria o dati), lungo il cavo scorrono degli impulsi. Sono disegnati, non simulati.
  - **Le mani:** prima mostra il palmo aperto per un attimo, al centro dell'inquadratura: la barra passa da «mani: mostra il palmo» a «mani pronte». Dopo 4 secondi senza gesti tornano a riposo. Poi un pizzico gira il modello, con due mani lo ingrandisci, e un pezzo afferrato e lanciato via si toglie. Per esploderlo unisci le due mani aperte al centro, tienile un attimo e allargale. Dopo uno zoom stacca prima le mani: finché non si separano l'esploso non parte.
  - **I pezzi restano dove li metti:** l'ologramma non gira da solo. Un pezzo afferrato con le mani resta dove lo lasci. Per rimettere tutto a posto chiudi **due pugni** e tienili mezzo secondo: i pezzi tornano al loro posto e l'esploso si chiude.
  - **I tasti:** quelli di Blender. Nell'HUD restano M, che accende o spegne le mani, ed Esc, che chiude l'ologramma.
  - **Gli sforzi:** se gli dici il materiale, dove è fissato e che forza riceve, O.S.C.A.R. calcola gli sforzi e in Blender, nel modo «Sforzi», li colora dal blu al rosso; il rosso è dove il materiale cede. Nel modo «Densità» i materiali leggeri sono blu scuro e quelli pesanti ciano. È una stima statica lineare: buona per capire dove lavora un pezzo, non una garanzia per costruirlo.
  - **Prima volta:** il Mac e l'HUD chiedono il permesso della fotocamera; se dici di no, restano Blender e la voce. I fotogrammi non escono dal Mac. Il Blender che si apre parte con le impostazioni di fabbrica, non con le tue.
  - **I limiti:** un oggetto vero fatto da O.S.C.A.R. è stilizzato, e per quello vero conviene scaricare un modello, per esempio da Sketchfab in GLB. Un oggetto nuovo può richiedere quasi un minuto.
- **Meteo:** chiedigli che tempo fa («O.S.C.A.R., che tempo fa a Milano?», «piove domani a Torino?») e in un paio di secondi apre la vista meteo a schermo intero, mentre ti dice a voce la cosa che conta. Senza città usa l'ultima che gli hai detto.
  - **Cosa vedi:** al centro un globo olografico. Prima gira tutto il mondo, poi scende sulla tua città e si inclina, e scendendo vedi la curva della Terra. Sopra c'è il radar vero delle piogge delle ultime due ore (RainViewer), a curve di livello ciano, che gira sulle due ore; arancione e rosso solo per i rovesci molto forti. Il tuo posto pulsa in verde acqua, le linee del vento scorrono sulla zona (il vento del posto, accelerato) e da vicino compaiono i nomi delle città attorno. A sinistra la rosa dei venti con le frecce che scorrono più veloci e spesse col vento, raffiche e pressione con la sua tendenza. A destra temperatura, percepita, punto di rugiada e umidità a barre. Sotto, gli avvisi (calo rapido di pressione, temporale, raffiche, pioggia forte, nebbia, gelo) in un riquadro che lampeggia, le condizioni per spostarsi in percentuale, e la timeline delle prossime 12 ore: «precipitazioni tra 42 min · durata stimata 1 h 15 min».
  - **Cosa ci fai:** la timeline comanda tutto: scegli un'ora e i moduli ti dicono il tempo a quell'ora, e il radar la mappa di allora se è nelle ultime due ore. Col mouse giri e ingrandisci il globo, fino al mondo intero col radar di tutta la Terra; clicchi o trascini sulla timeline. Con le mani: mostra il palmo, poi un pizzico trascinato sul globo lo gira e altrove scorre il tempo, due pizzichi fanno lo zoom del globo, un pizzico breve sceglie l'ora (sul globo lo rimette sul tuo posto), e una presa lanciata via chiude la vista.
  - **I tasti:** frecce per il tempo (con Maiusc un'ora alla volta), 0 torna ad adesso, + e − zoom del globo, R ricomincia, M accende o spegne le mani, Esc chiude.
  - **Da dove vengono i dati:** previsioni di Open-Meteo, gratuite e al quarto d'ora; Windy avrebbe voluto 990 € l'anno. La percentuale delle condizioni è una scala di O.S.C.A.R.: vale il fattore peggiore fra visibilità, raffiche e pioggia, e la vista dice quale.
- **Il Mac:** apre e chiude app, guarda lo schermo, clicca, scrive e usa la tastiera (strumenti in `mac/`). Per le azioni normali procede da solo; prima di inviare, cancellare, comprare, pubblicare, cambiare impostazioni o installare chiede il tuo sì. Non scrive mai nei campi password. Serve il permesso in Impostazioni di Sistema → Privacy e sicurezza: **Accessibilità** e **Registrazione schermo e audio di sistema** per l'app che lo avvia (O.S.C.A.R. o il Terminale).
- **File:** legge, crea e modifica in Scrivania, Documenti, Download, Immagini, Filmati, Musica e iCloud Drive; il resto del Mac (file nascosti, Libreria, cartella del progetto) gli è chiuso.
- **Memoria:** quando una conversazione finisce (3 minuti di silenzio, o chiudi l'HUD), O.S.C.A.R. la rilegge e si segna quello che varrà ancora tra un mese: persone, gusti, abitudini, correzioni. Niente salute, soldi o password, a meno che tu non glielo chieda. Se riapri O.S.C.A.R. entro 2 ore, riprende la conversazione da dove eravate. Puoi chiedergli «cosa ricordi di me?» o dirgli «dimentica…».
- **Orologio e agenda:** sa sempre che ore sono. Se gli chiedi qualcosa per dopo («ricordami alle 18 di chiamare la mamma», «tra un'ora guarda se è uscito il trailer di GTA 6»), se lo segna e all'ora giusta parla lui per primo, anche se nel frattempo O.S.C.A.R. si è riavviato. Funziona solo con O.S.C.A.R. acceso e il Mac sveglio: se a quell'ora era spento o in stop, te lo dice appena si riaccende. L’avviso resta in agenda finché l’interfaccia lo mostra o ne termina la lettura. Se perdi la consegna, riappare con il risultato salvato. Se l’esecuzione si è interrotta, indica che l’esito è da verificare. A batteria il Mac può andare in stop.

## La voce
- È la voce del Mac: quella che scegli in Impostazioni di Sistema → Accessibilità → Contenuti letti → Voce di sistema (anche una voce di Siri), se è italiana; altrimenti la migliore italiana installata. `OSCAR_MAC_VOICE` in `.env` la scavalca.
- Gira tutta sul Mac: niente crediti, niente rete, la stessa voce sempre.

## Come funziona
- `server.mjs`: avvio, finestre, pannello del browser (screencast), voce e cervello.
- `brain.mjs`: un processo Claude Code sempre acceso (stream-json), interrotto quando arriva una domanda nuova.
- `voice.mjs`: la voce del Mac, con `say`.
- `media.mjs`: GIF e animazioni.
- `orologio.mjs` fornisce l’ora. `agenda.mjs` conserva i promemoria in `runtime/agenda.sqlite` e importa automaticamente la precedente agenda JSON al primo avvio.
- `ologramma.mjs`: lo stato degli ologrammi; `blender.mjs`: il collegamento con Blender, che li mostra; `fisica/`: il calcolo degli sforzi.
- `meteo.mjs`: le previsioni di Open-Meteo per la vista meteo, e il riassunto per il cervello.
- `public/`: l'HUD (`nucleo.js` per la goccia e gli anelli, `fisica.js` per le molle delle animazioni, `sfx.js` per i suoni sintetizzati, `oscar.js` per ascolto e logica, `report.js` per il report a schermo intero, `ologramma/` per le mani e per le forme dei pezzi, `meteo/` per la vista meteo, il globo e il radar).
- `mac/`: controllo del Mac (server MCP + aiutante Swift); `mac/blender/` la gabbia e gli attrezzi per i pezzi fatti in Blender, e `vivo.py`, che mostra l'ologramma in Blender.
- `oscar-persona.md`: il carattere. O.S.C.A.R. ha una memoria sua, separata dalla repository.

Prove senza microfono: `http://localhost:4321/?debug&wav=file.wav` fa ascoltare un file a O.S.C.A.R.
