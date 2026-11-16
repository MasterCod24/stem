# Nexus

![Nexus](public/icona.png)

Assistente vocale stile JARVIS per il Mac: ragiona col tuo `~/.claude/CLAUDE.md`, ascolta sempre, parla con voce ElevenLabs, naviga su Google, usa le app e lo schermo al posto tuo.

## Avvio
- **App Nexus:** doppio clic su `STEM.app`, che cambierà nome col trasloco della cartella (o Spotlight, o trascinala nel Dock). Si apre l'HUD a schermo intero: le particelle si raccolgono nella sfera, poi gli anelli si disegnano. Se Nexus è già acceso, riapre solo l'HUD. Quando chiudi l'HUD (Cmd+Q), Nexus si spegne da solo entro un paio di minuti, qualcuno in più se sta ancora facendo memoria.
- **Da Terminale:** `./avvia.command`, utile anche la prima volta per inserire la chiave ElevenLabs. Ctrl-C o chiudere la finestra spegne tutto.

## Parlare con Nexus
L'assistente si chiama Nexus: «Ciao Nexus», «Nexus, …». Dal 12/11/2026 il vecchio nome non lo sveglia più.
- **Sempre in ascolto**, senza tasti: Nexus capisce da solo quando parli con lui. Una frase è per lui se:
  - contiene il suo nome (anche sbagliato di una lettera dal riconoscitore);
  - la cominci entro 15 secondi da quando ha finito di parlare: così puoi continuare il discorso senza ripetere il nome, anche solo con un «sì».

  Nient'altro passa: né la TV, né un «dimmi» detto a qualcun altro. Il cervello sa anche quale delle due è: senza il nome, nel dubbio tace (`[ignora]`). Con l'ologramma aperto vale lo stesso: «Nexus, esplodilo».
- **Il cervello** è un processo Claude Code sempre acceso, con Sonnet 5.5. Risponde a effort basso, con la prima parola in meno di un secondo. Per un ologramma, una ricerca con un report o un calcolo, dice prima una frase breve («Te lo costruisco.») e poi lavora a effort alto. Si cambiano in `.env` con `NEXUS_EFFORT` e `NEXUS_EFFORT_PENSA`. Se fai una pausa a metà di una richiesta, Nexus parte già e, se poi continui, riparte con la frase completa.
- **Interromperlo:** mentre parla di' "stop", "basta" o "aspetta", oppure chiamalo per nome. `Esc` lo zittisce.
- **La scheda dell'ascolto:** in basso, sotto la sfera, Nexus scrive quello che dici mentre lo dici. A frase finita aggiunge cosa ne ha fatto: «PER NEXUS · NOME», «PER NEXUS · CONVERSAZIONE», «NON PER NEXUS». Così vedi subito perché non ti ha risposto.
- **Privacy:** l'ascolto usa il riconoscimento vocale locale di Chrome: l'audio della stanza non esce dal Mac. Le frasi della scheda dell'ascolto restano sullo schermo e non finiscono in nessun registro. In `runtime/ascolto.log` Nexus annota solo se una frase era per lui e la prima parola di quelle scartate, per capire come il riconoscitore ti sente.

## Cosa vedi
- **La sfera è il cervello di Nexus.** È fatta di particelle e filamenti, dentro anelli che girano a velocità diverse:
  - in attesa respira piano;
  - quando parli si accende col microfono;
  - quando pensa nei filamenti corrono gli impulsi e un arco scansiona gli anelli;
  - quando parla pulsa con la voce.
- **Intorno alla sfera** ci sono i dati veri, appesi agli anelli: lo stato, la voce in uso, quanto ha messo a rispondere l'ultima volta, il microfono in dB, browser e agenda, gli fps.
- **Ai bordi** scorrono i micro-dati: a sinistra lo spettro del microfono in esadecimale, a destra gli eventi (domande, strumenti, voce, mai le frasi), in alto ora e memoria.
- **I colori:**
  - ciano vuol dire che tutto va;
  - arancione è un'anomalia da guardare: microfono negato o spento, calcolo degli sforzi fallito;
  - rosso è un'anomalia seria: server o cervello persi, un pezzo dell'ologramma che cede.

  La causa è scritta sotto lo stato.

## Cosa fa
- **Browser:** lavora su Google in un Chrome suo, sempre nella stessa pagina. Il pannello compare nell'HUD **solo per i compiti complessi** (ricerche lunghe, creazioni); le cose banali le fa in silenzio e ti dice il risultato.
- **GIF ed esempi:** quando spiega, mostra accanto alla sfera animazioni da Wikimedia Commons (per esempio un motore a quattro tempi); per le GIF simpatiche serve una chiave gratuita GIPHY in `.env` (`GIPHY_API_KEY`, da developers.giphy.com).
- **Report a schermo intero:** alla fine di una ricerca che vuoi vedere, Nexus apre un report come quello di ROSE. È una griglia di note, grafici, un dato in grande, immagini e video di YouTube muti, che arrivano dal fondo e si mettono a fuoco uno alla volta, con i loro suoni, mentre lui si sposta nell'angolo in basso a destra. Le note in più si alternano ogni 9 secondi. Si chiude con `Esc`, oppure chiedendoglielo.
- **Ologrammi:** chiedigli di mostrarti un oggetto in 3D («mostrami un motore a reazione», «fammi una staffa a L in alluminio») e lo costruisce a schermo intero, con misure in millimetri.
  - **Blender:** le forme curve, come pale, eliche, gusci, raccordi e superfici morbide, Nexus le costruisce in Blender, da vertici e curve e mai da forme già pronte. Blender gira invisibile e chiuso in una gabbia: niente internet, niente file tuoi, niente altri programmi. I file finiscono in Documenti, nella cartella Nexus-Blender, e si aprono anche in Blender. Quei pezzi non hanno il calcolo degli sforzi.
  - **Com'è fatto davvero:** per un oggetto che esiste prima cerca in rete com'è fatto. Nella scheda di ogni pezzo trovi materiale e lavorazione. Le fonti non ci sono: se vuoi sapere da dove viene un dato, chiediglielo. Per questo la prima vista può arrivare dopo qualche minuto.
  - **Cosa ci fai:** lo giri, lo esplodi, lo tagli, guardi dentro ai raggi X e togli i pezzi, a voce («esplodilo», «taglialo a metà», «togli il coperchio»), col mouse, con la tastiera o con le mani davanti alla fotocamera.
  - **Le mani:** prima mostra il palmo aperto per un attimo, al centro dell'inquadratura: la barra passa da «mani: mostra il palmo» a «mani pronte». Dopo 4 secondi senza gesti tornano a riposo. Poi un pizzico gira il modello, con due mani lo ingrandisci, aprendo i palmi lo esplodi, e un pezzo afferrato e lanciato via si toglie.
  - **I tasti:** E esplodi, S taglia, X raggi X, F sforzi, R torna com'era, Z rimette l'ultimo pezzo tolto, M accende o spegne le mani, Esc chiude.
  - **Gli sforzi:** se gli dici il materiale, dove è fissato e che forza riceve, Nexus calcola gli sforzi e li colora dal blu al rosso; il rosso è dove il materiale cede. È una stima statica lineare: buona per capire dove lavora un pezzo, non una garanzia per costruirlo.
  - **Prima volta:** il Mac e l'HUD chiedono il permesso della fotocamera; se dici di no, restano mouse, tastiera e voce. I fotogrammi non escono dal Mac.
  - **I limiti:** un oggetto vero fatto da Nexus è stilizzato, e per quello vero conviene scaricare un modello, per esempio da Sketchfab in GLB. Un oggetto nuovo può richiedere quasi un minuto.
- **Meteo:** chiedigli che tempo fa («Nexus, che tempo fa a Milano?», «piove domani a Torino?») e in un paio di secondi apre la vista meteo a schermo intero, mentre ti dice a voce la cosa che conta. Senza città usa l'ultima che gli hai detto.
  - **Cosa vedi:** al centro un globo olografico. Prima gira tutto il mondo, poi scende sulla tua città e si inclina, e scendendo vedi la curva della Terra. Sopra c'è il radar vero delle piogge delle ultime due ore (RainViewer), a curve di livello ciano, che gira sulle due ore; arancione e rosso solo per i rovesci molto forti. Il tuo posto pulsa in verde acqua, le linee del vento scorrono sulla zona (il vento del posto, accelerato) e da vicino compaiono i nomi delle città attorno. A sinistra la rosa dei venti con le frecce che scorrono più veloci e spesse col vento, raffiche e pressione con la sua tendenza. A destra temperatura, percepita, punto di rugiada e umidità a barre. Sotto, gli avvisi (calo rapido di pressione, temporale, raffiche, pioggia forte, nebbia, gelo) in un riquadro che lampeggia, le condizioni per spostarsi in percentuale, e la timeline delle prossime 12 ore: «precipitazioni tra 42 min · durata stimata 1 h 15 min».
  - **Cosa ci fai:** la timeline comanda tutto: scegli un'ora e i moduli ti dicono il tempo a quell'ora, e il radar la mappa di allora se è nelle ultime due ore. Col mouse giri e ingrandisci il globo, fino al mondo intero col radar di tutta la Terra; clicchi o trascini sulla timeline. Con le mani: mostra il palmo, poi un pizzico trascinato sul globo lo gira e altrove scorre il tempo, due pizzichi fanno lo zoom del globo, un pizzico breve sceglie l'ora (sul globo lo rimette sul tuo posto), e una presa lanciata via chiude la vista.
  - **I tasti:** frecce per il tempo (con Maiusc un'ora alla volta), 0 torna ad adesso, + e − zoom del globo, R ricomincia, M accende o spegne le mani, Esc chiude.
  - **Da dove vengono i dati:** previsioni di Open-Meteo, gratuite e al quarto d'ora; Windy avrebbe voluto 990 € l'anno. La percentuale delle condizioni è una scala di Nexus: vale il fattore peggiore fra visibilità, raffiche e pioggia, e la vista dice quale.
- **Il Mac:** apre e chiude app, guarda lo schermo, clicca, scrive e usa la tastiera (strumenti in `mac/`). Per le azioni normali procede da solo; prima di inviare, cancellare, comprare, pubblicare, cambiare impostazioni o installare chiede il tuo sì. Non scrive mai nei campi password. Serve il permesso in Impostazioni di Sistema → Privacy e sicurezza: **Accessibilità** e **Registrazione schermo e audio di sistema** per l'app che lo avvia (Nexus o il Terminale).
- **File:** legge, crea e modifica in Scrivania, Documenti, Download, Immagini, Filmati, Musica e iCloud Drive; il resto del Mac (file nascosti, Libreria, cartella del progetto) gli è chiuso.
- **Memoria:** quando una conversazione finisce (3 minuti di silenzio, o chiudi l'HUD), Nexus la rilegge e si segna quello che varrà ancora tra un mese: persone, gusti, abitudini, correzioni. Niente salute, soldi o password, a meno che tu non glielo chieda. Se riapri Nexus entro 2 ore, riprende la conversazione da dove eravate. Puoi chiedergli «cosa ricordi di me?» o dirgli «dimentica…».
- **Orologio e agenda:** sa sempre che ore sono. Se gli chiedi qualcosa per dopo («ricordami alle 18 di chiamare la mamma», «tra un'ora guarda se è uscito il trailer di GTA 6»), se lo segna e all'ora giusta parla lui per primo, anche se nel frattempo Nexus si è riavviato. Funziona solo con Nexus acceso e il Mac sveglio: se a quell'ora era spento o in stop, te lo dice appena si riaccende. A batteria il Mac va in stop dopo un po' che nessuno lo tocca, e parlargli non conta: per una sveglia, attaccalo alla corrente.

## La voce
- ElevenLabs con il modello `eleven_v4_turbo` (il più espressivo e veloce, mezzo credito a carattere). Ogni risposta usa **una sola voce** dall'inizio alla fine.
- Quando i crediti finiscono Nexus passa alla voce del Mac per tutta la risposta, e torna a ElevenLabs da solo quando si rinnovano. Con il piano gratuito (10.000 caratteri al mese) bastano poche decine di risposte.
- La voce del Mac è quella che scegli in Impostazioni di Sistema → Accessibilità → Contenuti letti → Voce di sistema (anche una voce di Siri), se è italiana; altrimenti la migliore italiana installata.

## Come funziona
- `server.mjs`: avvio, finestre, pannello del browser (screencast), voce e cervello.
- `brain.mjs`: un processo Claude Code sempre acceso (stream-json), interrotto quando arriva una domanda nuova.
- `voice.mjs`: ElevenLabs o Mac, uno per risposta.
- `media.mjs`: GIF e animazioni.
- `orologio.mjs`: l'ora, data al cervello a ogni domanda, e l'agenda (`runtime/agenda.json`).
- `ologramma.mjs`: lo stato degli ologrammi; `fisica/`: il calcolo degli sforzi.
- `meteo.mjs`: le previsioni di Open-Meteo per la vista meteo, e il riassunto per il cervello.
- `public/`: l'HUD (`nucleo.js` per la sfera e gli anelli, `sfx.js` per i suoni sintetizzati, `nexus.js` per ascolto e logica, `report.js` per il report a schermo intero, `ologramma/` per ologrammi e mani, `meteo/` per la vista meteo, il globo e il radar).
- `mac/`: controllo del Mac (server MCP + aiutante Swift); `mac/blender/` la gabbia e gli attrezzi per i pezzi fatti in Blender.
- `nexus-persona.md`: il carattere. Nexus ha una memoria sua, separata dalla repository.

Prove senza microfono: `http://localhost:4321/?debug&wav=file.wav` fa ascoltare un file a Nexus.
