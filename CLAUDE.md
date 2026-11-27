# O.S.C.A.R.: appunti per chi ci lavora

O.S.C.A.R. è l'assistente vocale di Tony sul Mac, stile JARVIS. È sempre in ascolto, parla con la voce del Mac, mostra un HUD a schermo intero e usa Google, le app e lo schermo al posto suo. Quello che fa, visto da Tony, sta in [LEGGIMI.md](LEGGIMI.md); qui c'è quello che serve per lavorarci.

## Ripartire da dove eravamo
1. **Cosa è stato fatto:** `git log --oneline -10`. Ogni commit dice nel titolo cosa è cambiato per Tony e nel corpo il perché.
2. **Lavoro lasciato a metà:** `git status`. File non committati vogliono dire che una sessione si è interrotta prima di chiudere.
3. **Lo stato vivo** non è scritto qui, perché invecchierebbe: si guarda.
   - `curl -s localhost:4321/api/status`: se non stampa niente, O.S.C.A.R. è spento. Da acceso risponde `{"voice":{"provider":"mac","voce":…},"browser":…,"agenda":…,"ologramma":…}`.
     - `voce` dice quale voce del Mac parla: quella di sistema (anche Siri) o `OSCAR_MAC_VOICE`.
     - `browser` dice che Playwright è pronto, non che la finestra di Google sia aperta.
     - `agenda` conta i compiti arrivati all'ora e non ancora detti. L’archivio è `runtime/agenda.sqlite`.
   - `tail -50 runtime/server.log` mostra server, cervello e voce. Le righe non hanno l'ora: gli avvii si separano dalle righe «O.S.C.A.R. online». Il file si riempie solo se O.S.C.A.R. è partito da `O.S.C.A.R.app`.
   - `tail -50 runtime/ascolto.log` dice di che tipo era ogni frase sentita: per O.S.C.A.R. (nome o conversazione), scartata, eco. Le frasi non ci sono mai, per privacy. Delle frasi scartate annota solo la prima parola e quella più simile a «oscar». Tiene le ultime 300 righe. Lo stato dell'HUD (ascolto, lucchetto, modo) ci va solo quando cambia; i riavvii del riconoscitore di Chrome no, dal 22/11: erano 133 righe su 300.
4. **Cosa resta aperto:** la sezione qui sotto.

## Aperto (al 27/11/2026)
- **Schede sincronizzate con la voce: richiesta di Tony del 27/11, costruite e provate, mai usate da Tony.** Mentre O.S.C.A.R. spiega, l'HUD mostra la cosa che nomina (foto, nome, cos'è, fino a tre numeri, fonte). Compare quando la sua frase arriva al nome, si riduce a una riga quando arriva la successiva, non chiude ologramma né meteo. Le GIF di GIPHY sono state tolte (mai viste: mancava la chiave), e `[anim:]` è diventata una scheda.
  - **Come:** il cervello scrive `[[vedi: nome | cos'è | numeri | fonte sito]]` subito DOPO la frase che la nomina (prima tratterrebbe la frase). `brain.mjs` la tiene nel testo come segnaposto e la manda subito dopo la frase che la contiene o la precede, anche col testo tutto insieme dopo una ricerca. `schede.mjs` taglia i campi, toglie una fonte che non è fra gli indirizzi letti in quella risposta, e cerca la foto in parallelo: prima l'anteprima (og:image) della pagina letta di quella fonte, poi Wikipedia, solo se tutte le parole del nome stanno nel titolo e il tipo ha una parola in comune con la descrizione. La scarica con la guardia di `rete.mjs` e la serve all'HUD da `/api/schede/foto/<id>`. L'HUD (`public/schede.js`, `oscar.js`) la mostra all'inizio della sua frase più la quota del nome per la durata dell'audio: `say` non dice quando pronuncia ogni parola, quindi è una stima.
  - **Misurato** (27/11):
    - nell'HUD (`prove/hud-foto.mjs`, voce finta da 1,8 s a frase): ogni scheda compare 2–3 ms dopo il momento calcolato; la prima frase parte 7 ms dopo il suo arrivo (11 nella risposta senza schede); fra una frase e l'altra −4 e +10 ms. La voce non aspetta le schede. Quanto la stima del nome dentro la frase coincida con la voce vera non è misurato;
    - nel cervello e nel server (`prove/schede.mjs`, 40 su 40): ogni scheda esce dopo la frase che la contiene o la precede, col testo a pezzetti e tutto insieme. La prima versione falliva col testo a pezzetti: la frase partiva appena arrivava il punto, il segnale arrivava dopo e si legava alla frase successiva;
    - col cervello vero, prima del codice: la prova qui sotto.
  - **Foto, misurato:** il Colosseo da Wikipedia in 1,2–1,5 s, mentre la voce parla; TripAdvisor rifiuta i programmi (403), quindi una fonte TripAdvisor arriva senza foto. Le prime regole su Wikipedia davano foto sbagliate: «Beluga» (un ristorante) un aereo cargo, «Il Marin» uno storico del Cinquecento, «Ultima» una serie di videogiochi. Ora no, al prezzo di qualche foto giusta persa («Elbrus» contro «Monte Elbrus, monte più alto di Russia»).
  - **Scelte mie, da guardare con Tony:** 12 s di vita dopo la fine della risposta, tre righe al massimo, 300 punti di larghezza, il posto (a destra degli anelli; col browser sotto il nucleo; con report e meteo sopra il nucleo nell'angolo), le foto passate dal server, le misure dei campi (nome 40, tipo 32, numero 34 caratteri), nessuna foto senza «cos'è».
  - **Mai provati:** con Tony, la voce vera e lo schermo vero; quanto sbaglia la stima della posizione del nome dentro la frase; le schede con la meteo o un report aperti (provate solo con l'ologramma, che non si chiude); con l'ologramma Blender copre l'HUD e le schede non si vedono: disegnarle in Blender è da decidere con Tony.
  - **La prova prima del codice** (`prove/schede-cervello.mjs`, 27/11, Opus 5.5): due O.S.C.A.R. di prova isolati, 10 domande concrete, prima con la persona senza regola e poi con la regola (quella che ora sta nella persona). Criteri scritti prima:
    1. risposte con almeno una scheda: 10 su 10 (criterio 8): PASS;
    2. schede prima della fine della prima frase: 0: PASS;
    3. prima parola, differenza delle mediane: +0,19 s contro il limite di 0,1: **FAIL**. A coppie però, domanda per domanda, la differenza è +0,01 s di mediana e +0,008 di media, con deviazione 0,39 s: la soglia stava sotto il rumore del banco (errore mio, vedi **Lezioni**), e un effetto vero non si vede;
    4. schede nominate a voce: 0: PASS.
  - **Il resto:** 17 schede, tutte dopo frasi di almeno 8 parole; il nome nella frase prima 16 volte su 17; 12 fonti su 12 fra i siti letti in quella risposta, 5 schede senza fonte; una sola sopra i 120 caratteri (137). Esempi: «Louvre | museo d'arte | 9,05 mln visitatori (2025) | fonte theartnewspaper.com», «Elbrus | vulcano del Caucaso | alto 5.642 m».
  - **Il costo che non avevo previsto:** dopo una ricerca il testo arriva al server tutto insieme (5 frasi in 11 ms), non a pezzi: la prima frase dei risultati aspetta che sia scritta l'intera risposta. Ogni scheda (91 caratteri di media, circa 28 token a circa 110 al secondo, stima) la ritarda quindi di circa 0,25 s, cioè circa 0,5 s con due schede. Senza ricerca, dove il testo arriva a pezzi, la frase dopo una scheda arriva 0,6–1,2 s dopo la precedente contro 0,2–0,9 s senza, nascosta dalla voce che sta ancora dicendo quella prima. La fine della risposta: mediana 14,0 s senza regola, 15,3 con. Che il testo dopo `WebSearch` arrivi tutto insieme vale anche oggi, senza schede: non è indagato.
  - **Un effetto collaterale:** sui musei di Parigi, con la regola il cervello ha cercato per avere i numeri con la fonte (17,3 s alla fine contro 5,9 rispondendo a memoria). Un caso su 10.
- **Restyling fisico dell'HUD: richiesta di Tony del 27/11, costruito e fotografato, mai visto da lui.** «Stessa palette, design computazionale guidato dalla fisica, animazioni fluide e brevi.» Ogni forma è calcolata e ogni moto segue un'equazione; la decorazione inventata è tolta. È su `main`, ed è unito in `fix/rivoluzione-asse`, da cui gira O.S.C.A.R.app: acceso così il 27/11 alle 19:30, su richiesta di Tony.
  - **Il moto** (`public/fisica.js`): una molla smorzata in forma esatta. «Corpo» (nucleo, schede, scritte) è al 2% in 0,21 s con un rimbalzo del 2%; «lieve» (opacità) in 0,22 s senza rimbalzo. Le transizioni CSS usano la stessa curva, campionata in `linear()`. Prima c'erano durate scritte a mano, da 0,3 a 1,1 s.
  - **Il nucleo** (`nucleo.js`, riscritto; com'è fatto in **Come è fatto**): la goccia coi modi di Rayleigh al posto della sfera, le linee di campo di sette dipoli al posto del gomitolo inventato, cinque anelli invece di nove (spettro vero, una corda con l'equazione delle onde, una scala con l'inerzia). Tolti: gradi ed esadecimali negli anelli, segmenti, ventaglio radar, scintille, il tremito della posizione nel critico (ora trema la goccia).
  - **L'avvio:** pronto in 1,45 s invece di 6,5. Il suono dell'avvio dura quanto la formazione (0,85 s), ed è lo stesso suono compresso: non l'ha sentito nessuno.
  - **Attorno:** scritte e fili su molle; via la colonna degli esadecimali a sinistra e la barra in basso; gli eventi si spengono col tempo di dimezzamento; il livello del microfono sotto la frase è una riga.
  - **Report e meteo:** le schede entrano in ordine di distanza dal protagonista, come un fronte d'onda. Report: l'ultima scheda a posto in circa 0,54 s invece di 2; meteo in 0,34 s invece di 1,15. Tolti il lampo di copie e ogni sfocatura.
  - **Corretto per strada:** le schede «dato» del report non si erano mai viste (vedi **Lezioni**). La prova nuova di `prove/hud-foto.mjs` fallisce sul codice di prima e passa ora.
  - **Misurato** (27/11, M2, headless):
    - banco della grafica, 7 stati: 2,62–2,89 ms a fotogramma contro 2,70–2,74 del nucleo di prima, 60 fps ovunque. Avevo previsto ±0,3 ms: giusto;
    - entrata del report (`prove/hud-foto.mjs`, intervalli fra fotogrammi nei primi 2 s): il più lungo 16,8 ms in 2 giri su 2, come il codice di prima in 3 giri su 3. Le prime due versioni avevano un fotogramma da 33 ms all'apertura: `mete()` rileggeva la larghezza della scheda dell'ascolto a ogni passo del nucleo, forzando un layout; ora la rilegge solo quando cambiano classi o finestra. In headless anche il codice di prima non scattava: gli scatti del 1/11 erano con voce e browser veri.
  - **Avevo sbagliato** la corda: senza la tensione del cerchio derivava senza fine. Trovato con una simulazione a parte, non a occhio.
  - **Scelte mie, da guardare con Tony:**
    - i tempi delle molle (0,3 e 0,22 s) e il rimbalzo del 2%;
    - la goccia: 1,5 Hz per l = 2, deformazione del 4% con la voce e col pensiero, tremito nel critico;
    - i sette dipoli, la corda (un giro in 1,6 s), l'onda d'urto a 0,9 unità al secondo;
    - lo spettro: basse in basso e alte in alto, a specchio; il microfono pesa per intero solo mentre O.S.C.A.R. ascolta;
    - cosa ho tolto: gradi, esadecimali, colonna di sinistra, barra in basso, i 24 trattini del livello;
    - il tempo di dimezzamento degli eventi, 25 s.
  - **Prove:** `prove/fisica.mjs` 13 su 13 (anche le armoniche ortonormali), `prove/hud-foto.mjs` 11 su 11, `prove/meteo-hud.mjs` 33 su 33, banco della grafica.
  - **Primo uso vero** (27/11, 19:30–19:36, registro): meteo con le mani per 69 s, fps mediana 64, p10 49, minimo 43: sopra la regola dei 45. Tremolio 12,6 px, il doppio delle sessioni dell'11–12/11 (3,2–6,6), e 4 gesti persi: da guardare, ma le mani non le ho toccate. Il giudizio di Tony sull'aspetto non c'è ancora.
  - **Mai provati:** sul secondo monitor; con microfono e voce veri (spettro e corda li ho visti solo col dispositivo finto di Chrome e la voce finta); il suono dell'avvio corto.
- **Finestra di Google dietro l'HUD: richiesta di Tony del 27/11, provata a pezzi, mai vista da lui.** Con due monitor l'HUD stava a schermo intero sull'esterno e la finestra di Google sul portatile, in vista. Ora l'HUD manda la sua posizione a ogni `/api/status` (`schermo`), il server la salva in `runtime/schermo-hud.json` e apre il Chrome di Google lì con `--window-position`. La finestra resta così sulla scrivania di quello schermo, coperta dallo Spazio dell'HUD. Per scriverci a mano (accessi, pagamenti) Tony clicca la seconda icona di Chrome nel Dock.
  - **Perché non nascosta:** nascosta, ridotta nel Dock o headless non funziona (vedi **Lezioni**). La finestra serve anche a Tony: nel profilo ci sono accessi fatti da lui a mano, e il 12/11 O.S.C.A.R. gli ha lasciato da inserire il pagamento del cinema.
  - **Prove:** server vero con un Chrome finto che scrive i suoi argomenti. Senza posizione salvata non cambia niente; con quella dell'HUD esce `--window-position=-232,-1080`; valori strani e richieste da altri siti sono ignorati. `prove/hud-foto.mjs` 9 su 9.
  - Il primo avvio dopo l'aggiornamento non ha ancora la posizione. Quella di oggi (monitor esterno, -232,-1080, letta dalla finestra dell'HUD) l'ho scritta a mano nel `runtime/schermo-hud.json` della cartella di O.S.C.A.R.
  - **Previsto:** al prossimo avvio Google compare per 1–2 s sul monitor esterno, poi l'HUD va a schermo intero sopra di lui e il portatile resta libero.
  - **Limiti:**
    - con un monitor solo non cambia niente: Google sta sulla scrivania e l'HUD nel suo Spazio, come prima;
    - se Google viene chiuso e riaperto mentre l'HUD è a schermo intero, Chrome si attiva su quello schermo, e macOS può passare alla scrivania togliendo l'HUD dalla vista. Mai provato.
  - **Mai provati:** l'avvio vero con l'HUD e i due monitor.
- **Foto dei salti delle mani: richiesta di Tony del 23/11, costruita e provata senza la sua fotocamera, mai usata.** L'idea di partenza era «riavvolgere il laboratorio»: video, audio, registri e strumenti sincronizzati. Nel progetto però non c'è un laboratorio. Il caso vero sono i salti delle mani: 240 il 17/11, con causa sconosciuta, e il registro dice quanti sono, non quando.
  - **Cosa fa:** a ogni salto (in `gesti.js`, la punta di pollice o indice che si sposta di più di mezzo palmo rispetto al palmo) l'HUD fotografa quel fotogramma. La foto è specchiata, con le mani della rilevazione di prima in bianco, quelle di adesso in ciano e un cerchio sulle punte. Esce al più una foto al secondo, e al massimo 50 per apertura dell'ologramma o della meteo.
  - Il server le salva in `runtime/salti/<giorno>/<ora>-<vista>.jpg` (`salti.mjs`), al massimo 500 al giorno, e cancella da solo i giorni più vecchi di 7. «Era successo anche ieri?» vuol dire aprire la cartella di ieri accanto a quella di oggi: `open runtime/salti`.
  - **Privacy:** sono foto di Tony e della stanza. Restano solo sul Mac (`runtime/` è fuori da git), mai nei registri; il cervello non le vede.
  - **Misurato (23/11):**
    - una foto della prova pesa 26–32 KB (720×382); dalla fotocamera finta di Chrome 8–9 KB, ma è un'immagine semplice. Per la stanza vera la stima è 50–80 KB, cioè 2–4 MB per la sessione peggiore;
    - la parte che ferma l'HUD costa 1,4–1,8 ms dalla tela e 1,4–6 ms dalla fotocamera finta. La prima foto di ogni pagina costa 24–41 ms, e una volta su quattro giri 355 ms; dopo, anche con la fotocamera riaccesa, 2–5 ms.
  - **Avevo previsto** 30–60 KB e meno di 3 ms: le foto pesano meno, e la prima della pagina costa di più.
  - **Il criterio, scritto prima:** se su 20 foto vere non si vede una causa comune (mano al bordo, controluce, mano di profilo), l'idea del laboratorio da riavvolgere muore anche in grande.
  - **Scelte mie, da guardare con Tony:** una foto al secondo, 50 per apertura, 500 al giorno, 7 giorni, JPEG a qualità 0,7; le foto partono anche con `?debug&mani=immagine`.
  - **Prove:** `prove/salti.mjs` 24 su 24; `prove/ologramma-server.mjs` 135 su 135, con 7 casi nuovi (chi può mandare foto e dove finiscono); `gesti` 70 su 70, `hud-foto` 9 su 9.
  - **Mai provati:** la fotocamera vera di Tony, e quanto pesa una foto della sua stanza.
- **Rivoluzioni chiuse che toccano l'asse: corrette il 17/11, mai usate dal cervello dopo la correzione.** La mattina del 17/11, col ventilatore da tavolo, 4 costruzioni su 7 sono fallite con `ValueError: cannot convert float NaN to integer` nell'esportazione GLB. È lo stesso errore dei 130 s di debug delle AirPods (qui sotto), ma lì la causa non è verificata.
  - **La causa:** `rivoluzione(..., chiuso=True)` con un tratto del profilo sull'asse (r = 0) faceva un anello di facce di area zero lungo l'asse, e il raccordo (Bevel) di `oggetto()` ci produceva il NaN. Il cervello se l'era segnato in memoria come regola da ricordare.
  - **Ora** (`_chiuso_senza_asse` in `mac/blender/aiuti.py`): con chiuso=True il tratto sull'asse diventa una punta, come con chiuso=False, e il primo punto ripetuto in fondo si toglie (lasciava un anello di facce di area zero: 48 su 432 nel filo di prova). Un punto isolato sull'asse resta com'era; più tratti separati sull'asse danno un errore che lo dice (non provato).
  - **Prove:** `prove/blender.mjs` 32 su 32, e i due casi nuovi falliscono sul codice di prima. Nella memoria del cervello la regola è cambiata (`ologramma-blender-flusso.md`).
- **Ologrammi in Blender, non più nell'HUD: richiesta di Tony del 22/11, costruiti e provati senza cervello né mani vere, mai usati da Tony.** Tony ha chiesto di togliere gli ologrammi dall'HUD e di aprirli in Blender, girandoli con le mani come prima. Ha chiesto di tenere, visibili e modificabili in Blender, i colori degli sforzi, la densità, la scheda di ogni pezzo (materiale e come è fatto), le misure in mm e cm e i cavi coi flussi.
  - **Cosa c'è:** il cervello usa gli stessi strumenti di prima e lo stato resta tutto nel server (`ologramma.mjs`). A disegnare è Blender: `blender.mjs` lo apre con l'ologramma, gli manda stato, mesh delle forme native, campo degli sforzi e gesti delle mani, e prende la foto per il cervello. `mac/blender/vivo.py` fa tutto dentro Blender. Il come sta nel contratto (`public/ologramma/LEGGIMI-ologramma.md`, «Blender»).
  - **Modificabile da Tony,** nella scheda «O.S.C.A.R.» a destra: nome, materiale vero, fattura, lega del calcolo, colore e misure della forma in mm (con i cm accanto; per un file la scala). Ogni cambio va al server, che lo valida come una modifica del cervello e ricalcola gli sforzi; la scheda dice «Fatto» o perché no. Modo, esploso e sezione Tony li cambia in Blender, ma restano lì.
  - **Tolto dall'HUD:** `scena.js`, `demo.js`, `lab-ologramma.html`, `lab-mani.html`, tasti e mouse dell'ologramma, la foto dell'HUD (`POST /api/ologramma/foto`) e la via dei file (`/api/ologramma/file/…`), più le prove `ologramma-hud.mjs`, `ologramma-pezzi.mjs` e `mani-delegato.mjs`. Con l'ologramma aperto l'HUD accende le mani e smette di disegnare il nucleo.
  - **Prove:**
    - `prove/blender-vivo.mjs` 15 su 15, con Blender vero: sforzi colorati su 3 pezzi, densità, esploso, sezione, scheda, gesti e modifiche dalla scheda. Le foto le ho guardate io.
    - `prove/ologramma-server.mjs` 128 su 128, col Blender finto: stato, foto, gesti validati, modifiche e lanci di Tony, Blender chiuso da lui o dal cervello, file fuori dalle cartelle rifiutati.
    - Passano anche `gesti` 70, `ologramma-forme` 221, `ologramma-stato` 140, `blender` 30, `oggetto-vero` 34 e `meteo` 37.
  - **Misurato (22/11):**
    - Blender a 60 fps di mediana, p10 52–55, 9–14 ms dal gesto al disegno (p90 fino a 38 ms con i flussi accesi).
    - Mani dell'HUD, con la foto di prova e Blender che ridisegna davanti: da 30 a 26,6 rilevazioni al secondo (−11%) con l'HUD fermo, contro il −17% con l'HUD che disegnava (un giro).
    - Blender si apre e manda la prima foto in 2,7–6 s.
  - **Avevo previsto** p10 di 60 e meno di 20 ms in Blender: i flussi e le misure ridisegnati costano qualcosa, restando sopra i 45 fps.
  - **Scelte mie, da guardare con Tony:**
    - Blender parte con `--factory-startup`: niente sue preferenze né componenti aggiuntivi (il server MCP di Blender vorrebbe la sua porta), e quindi niente salvataggi delle preferenze da questa istanza;
    - l'aspetto: fondo blu notte, grigio, i colori dei dati; quello olografico (bagliore, ciano) non c'è più;
    - la sezione è il taglio di Blender, aperto: la faccia piena dell'HUD non c'è;
    - la densità è tre volte più chiara dell'HUD, se no sotto la luce di Blender è quasi nera;
    - posizione e rotazione dei pezzi, carichi e vincoli non si cambiano dalla scheda: li cambia il cervello;
    - i pezzi spostati a mano in Blender non tornano al server, come prima nell'HUD;
    - un file .3mf non si apre: Blender non ha l'importatore.
  - **Mai provati:** le mani vere di Tony davanti a Blender, il cervello vero con Blender, un modello Blender grande (290 mila triangoli) con le schede, il secondo monitor.
- **Voce: solo quella del Mac, dal 22/11, scelta di Tony.** Lo stesso giorno sono stati tolti ElevenLabs e Telegram, del tutto, e il modello di Whisper è finito nel Cestino. Kokoro (kokoro-onnx, voce italiana `im_nicola`) è stato messo e tolto in giornata, su richiesta di Tony; la sua installazione in `runtime/kokoro` è nel Cestino.
  - **Le misure, se se ne riparla** (M2, 22/11): `say` 0,8–1,4 s anche per «Guardo subito.», perché riparte e ricarica la voce a ogni frase; Kokoro sempre acceso 0,37 s per la stessa frase e 1,5 s per una di 106 caratteri. Il cervello dice la prima parola in 0,6 s: la voce del Mac è il pezzo più lento della catena.
- **Persona e conversazione ripresa (22/11).** Claude Code registra il prompt di sistema al primo messaggio di una conversazione (`--system-prompt-snapshot`, attivo di base) e ogni ripresa riusa quello. Provato con Haiku: una ripresa non vede la persona cambiata, con `--system-prompt-snapshot off` sì. Ora `runtime/cervello.json` tiene l'impronta della persona, e se è cambiata il cervello apre una conversazione nuova invece di riprendere. `prove/cervello-interruzioni.mjs` 6 su 6; sul `brain.mjs` di prima i 2 casi nuovi falliscono. Il primo avvio dopo l'aggiornamento apre una conversazione nuova, perché il file vecchio non ha l'impronta.
- **Nome, promemoria e cervello bloccato: fatti da ChatGPT il 22/11, controllati da Claude, mai usati da Tony.**
  - **Il nome:** O.S.C.A.R. al posto di Nexus. L'app è `O.S.C.A.R.app` e l'aiutante `runtime/oscar-mac`. macOS lega i permessi al percorso, quindi Tony deve ridare Accessibilità e Registrazione schermo e togliere le voci STEM. La cartella `~/STEM` e la repository hanno ancora il vecchio nome. Il cervello resta in `~/Library/Application Support/Nexus/cervello`, perché la sua memoria è legata al percorso. «Oscar» a voce non è provato.
  - **Cervello bloccato** (`brain.mjs`): dopo 45 s senza eventi l'HUD avvisa in arancione; a 180 s, o 420 con uno strumento in corso, il turno si interrompe. Il pensiero non fa scattare il limite: misurato il 22/11, mentre pensa Claude manda un `thinking_delta` vuoto ogni 1,1–1,5 s. L'avviso arriva quindi solo con gli strumenti oltre 45 s (Blender, sforzi). `prove/cervello-inattivo.mjs` 4 su 4.
  - **Promemoria** (`agenda.mjs`, SQLite in `runtime/agenda.sqlite`): il compito resta in agenda finché l'HUD non ha mostrato o letto la risposta. `prove/agenda-consegna.mjs` 6 su 6. Due effetti, che Tony ha scelto di lasciare così il 22/11:
    - con «stop», o una domanda sopra, a metà di un promemoria, il compito torna al giro dopo di `/api/status` e l'HUD legge «Promemoria. <compito>. L'esito del compito è da verificare.», anche se nessun comando era partito (provato col server vero e un cervello finto);
    - la scheda del promemoria resta a schermo finché non si clicca «Chiudi»: Esc non la chiude.
  - Le prove di prima passano: server 124 su 124, HUD 32 su 32, Blender 32 su 32, interruzioni 6 su 6.
- **Da sapere:** O.S.C.A.R.app gira dalla cartella del progetto, che al 27/11 è sul ramo `fix/rivoluzione-asse`, con `main` unito dentro fino al filtro dell'eco su tutta la risposta (27/11; le schede sono accese dalle 20:17, e con la persona nuova il cervello ha aperto una conversazione nuova). Così ha la correzione di Blender (e3ff30c), che su `main` non c'è ancora. Un `main` nuovo arriva lì solo con un altro merge.
- **Foto e misure vere accanto all'ologramma: richiesta di Tony del 17/11, costruito e provato senza cervello, mai usato.** Tony ha bocciato gli oggetti fatti «a occhio»: il cervello costruiva da quello che ricordava e confrontava la foto dell'HUD solo con sé stessa. Ora c'è `guarda_oggetto_vero` in `mac/mac-mcp.mjs`.
  - **Cosa fa:** il cervello gli dà 1–3 foto vere (`fuori`, oppure `dentro` per uno spaccato o uno smontaggio) e le misure ufficiali. Alla prima vista `mostra_ologramma` mette dopo la foto dell'HUD le foto «fuori»; `modifica_ologramma` mette quelle «dentro» quando passa ai raggi X o mette una sezione. `costruisci_in_blender` confronta l'ingombro di quello che esce da Blender con le misure vere, lato per lato dal più lungo (l'orientamento non conta), anche in scala. Un `mostra` senza foto nuove dice di guardare l'oggetto vero e non rimette quelle vecchie.
  - **Sicurezza:** solo https sulla porta 443 verso indirizzi pubblici, controllati dopo il DNS e a ogni rimando (Mac, rete di casa e O.S.C.A.R. restano fuori). Le foto non si aprono sul Mac: tipo e misure si leggono dai primi byte, e passano intere solo entro 2000 px per lato e 3,5 MB.
  - **Tolto prima di finire:** ridurre le foto con `sips` nella gabbia di Blender. Per farlo funzionare servivano i metadati delle cartelle sopra e le scritture temporanee di `sips` in `$TMPDIR` di sistema, cioè una gabbia con tre eccezioni. Il prezzo: una foto troppo grande si rifiuta, e l'errore dice di prendere l'anteprima (Wikimedia `/thumb/…/1280px-`, iFixit `.medium`).
  - **Prove:** `prove/oggetto-vero.mjs` 34 su 34, con la rete e Blender. `prove/blender.mjs` resta 30 su 30. `prove/ologramma-server.mjs` dà 121 su 122: il fallito (`runtime/modelli/prova-mani.jpg`) c'era già prima ed è la foto di prova da scaricare (vedi **Provare**). Una riga di quella prova voleva la nota della foto in fondo al testo, e ora controlla che ci sia e basta.
  - **Col cervello vero** (17/11, O.S.C.A.R. di prova con HUD headless, «fammi vedere in 3D le AirPods Pro con la custodia», due giri). Il primo giro è andato perso per un errore della prova: senza `<cartella>/Documents` il server non passa `--blender` (vedi **Provare**).
    - **Lo strumento:** chiamato da solo in tutti e due i giri, a 45 e 37 s, dopo tre ricerche e due WebFetch. 4 foto su 4 accettate al primo colpo: l'anteprima 1280px di Wikimedia, una TAC della custodia da MacRumors e una `.medium` di iFixit. Misure della custodia di Apple, con la fonte. Avevo previsto almeno un rifiuto: sbagliato, il cervello ha seguito gli esempi della descrizione.
    - **Le misure:** il modello finale esce da Blender a 60,6 × 45,2 × 21,8 mm contro 60,6 × 45,2 × 21,7: scarto zero, ed è vero. Nell'HUD la quota dice 23,3 mm, perché i pezzi spostati in `mostra_ologramma` il confronto non li vede. Durante il debug, i pezzi di prova hanno avuto scarti del −83%: rumore, ma innocuo.
    - **Il confronto con la foto: nessuna correzione.** La prima vista è arrivata con la foto dell'HUD e quella vera accanto; 8 s dopo il cervello ha detto che era fatto, «stilizzate». Gli auricolari sono a forma di lampadina, con lo stelo dritto, mentre quelli veri hanno la testa piegata di lato e il gommino che punta in fuori. Non è passato ai raggi X, quindi la foto «dentro» non è tornata. Avevo previsto almeno una correzione: sbagliato. Mettere le foto accanto non basta a far correggere il cervello, e la riga della persona sullo «stilizzato» gli dà un'uscita.
    - **Da qui il giro di `[confronto]`** (richiesta di Tony del 17/11, dopo un «no, per ora» detto per scherzo). In una risposta in cui il cervello ha chiamato `guarda_oggetto_vero` e aperto un ologramma nuovo, con l'HUD acceso, il server gli manda `CONFRONTO_TEXT` dopo il `[pensa]`: trovare le tre differenze più grandi con le foto vere, correggere le due più grandi, guardare il dentro ai raggi X, poi una frase a Tony. È uno solo, a effort alto, nella stessa risposta all'HUD, e mai dopo un'interruzione. Sta in `server.mjs`, accanto al `[pensa]`. Prova: `prove/ologramma-server.mjs`, col cervello finto, controlla che il giro parta con l'oggetto vero e non parta senza (123 su 124, il fallito è quello vecchio). Il caso dell'HUD spento non è provato.
    - **Col cervello vero** (terzo giro, stessa domanda): prima vista a 399 s. Questa volta, già prima del confronto, il cervello è passato ai raggi X e ha detto da solo che gli auricolari erano «più tozzi di quelli veri», ma non li ha corretti. Il `[confronto]` è partito a 429 s. In 44 s ha rifatto gli auricolari (testa più piccola, stelo più lungo e inclinato) e aggiunto incavo e spia, poi ha detto cosa aveva corretto, e che il foro USB-C e il ricontrollo ai raggi X restavano da fare. Fine a 473 s. Avevo previsto almeno un pezzo rifatto e 1–3 minuti in più: il pezzo sì, il tempo è stato meno di un minuto. Le foto `v01.png` (prima vista) e `v04.png` (dopo il confronto) sono in `runtime/prova-cervello-1794897446986/`. A occhio gli auricolari sono più vicini alla foto vera, non uguali.
    - **Un campione per giro:** la prima vista del secondo giro aveva auricolari a lampadina dentro la custodia, quella del terzo era già vicina al vero. Il cervello cambia molto da un giro all'altro, quindi quanto aiuta il confronto si saprà solo dall'uso di Tony.
    - **Tempi:** prima vista a 487 s, fine a 495 s (il 16/11 erano 248 e 458 s, senza lo strumento). Lo strumento ha preso meno di un secondo. Il tempo è andato allo script (da 42 a 311 s) e a 130 s di debug di un NaN nell'esportazione GLB (`ValueError: cannot convert float NaN to integer` in `gabbia.py`), che il cervello ha isolato per tentativi in 8 costruzioni.
    - **Rifiutata, come previsto:** la lettura di `mac/blender/aiuti.py` (fuori dalle cartelle del cervello), in tutti e due i giri.
  - **Scelte mie, da guardare con Tony:**
    - lo scarto oltre il quale il testo chiede di correggere: 10% su un lato;
    - le foto valgono per il prossimo ologramma entro 30 minuti; il confronto delle misure vale un'ora;
    - il confronto non vede le copie e gli spostamenti fatti in `mostra_ologramma`, solo quello che esce da Blender;
    - niente rifiuto se il cervello non guarda l'oggetto vero: c'è solo la riga che glielo ricorda, perché gli oggetti che Tony progetta non hanno foto.
- **Esploso con le mani: gesto cambiato il 17/11, richiesta di Tony, mai provato da lui.** Tony col ventilatore: dopo uno zoom a due pizzichi, staccando le mani i pezzi esplodevano. Il motivo: bastavano due palmi aperti, e i pizzichi che si riaprono sono proprio due palmi aperti; da lì ogni movimento cambiava la distanza. Il palmo aperto è anche il gesto che sveglia le mani.
  - **Ora** (`gesti.js`): l'esploso parte solo da due mani aperte unite al centro (centri dei palmi entro `esplodi_unite`, 2 palmi), aperte da almeno `esplodi_ms` (300 ms). Mai dopo uno zoom o un ricomponi, finché le mani non si separano oltre i 2 palmi o una esce. Partito, è come prima: allargare esplode, stringere rimonta.
  - **Prove:** `prove/gesti.mjs` 70 su 70, con 6 casi nuovi: lo zoom seguito dalle mani che si staccano, lo zoom che finisce a mani unite, il gesto vero e i palmi lontani. Sul `gesti.js` di prima i 6 casi falliscono, con 19 esplosi nel caso di Tony. `prove/ologramma-pezzi.mjs` 8 su 8 (alla fine la prova non riesce a cancellare il profilo di Chrome, che ci sta ancora scrivendo: è la pulizia, non i gesti).
  - **Scelte mie, da guardare con Tony:** i 2 palmi e i 300 ms; il blocco dopo il ricomponi; l'esploso già partito che continua finché le mani restano aperte, anche mentre le si abbassa.
  - **La sessione di Tony col ventilatore** (riga «mani accese» da 516 s): fps a posto (mediana 57, p10 54, minimo 45, detect 7 ms), ma 240 salti contro i 29–78 delle sessioni prima, 45 buchi e 15 gesti persi. Tony: «il cursore saltava». La causa dei salti (luce, distanza, sfondo) il registro non la dice.
  - **Filtro dei salti dell'indice: messo la mattina del 17/11, tolto la sera.** Per al massimo 2 fotogrammi teneva la forma di prima della mano quando la punta dell'indice si spostava di più di 0,5 palmi rispetto al palmo. Tony, la sera: «funziona peggio di prima, ogni movimento c'è uno sfarfallio da paura e salta tutto». Tolto per intero; `gesti.js` e `prove/gesti.mjs` sono tornati al commit d1098d0, con l'esploso nuovo (70 su 70).
    - **Cosa sappiamo:** la prova del filtro aveva solo una mano ferma con un balzo inventato da me, e nessuna mano normale in movimento. Rifatta la sera, con una mano che scorre piano col rumore di MediaPipe: fino a 50° di inclinazione il filtro non scatta mai. A 70° (la mano che punta verso lo schermo, col palmo che si vede accorciato) scatta su 12 fotogrammi in 10 s e raddoppia il tremolio del cursore (p99 da 0,0022 a 0,0041 dello schermo). Quindi peggiora, ma il «da paura» la prova non lo riproduce.
    - **Cosa non sappiamo:** della sessione della sera manca la riga «mani accese», che non arriva se si chiude la finestra dell'HUD con l'ologramma aperto. La sessione era di sera, quella dei 240 salti di mattina: la luce può contare quanto il codice. I salti della mattina restano senza causa.
- **Mani sotto 45 fps nelle ultime sessioni vere** (registro al 17/11): le cadute erano con gli ologrammi disegnati nell'HUD. Dal 22/11 l'HUD non li disegna più, quindi la misura va rifatta nell'uso vero con Blender (la riga «mani accese» arriva ancora alla chiusura). L'idea del Worker per MediaPipe resta scartata: sulla CPU 24–25 fps contro 60 sulla GPU (`mani-delegato.mjs`, 22/11, prova tolta con l'HUD degli ologrammi).
- **L'ologramma si muove solo quando lo muove Tony: richiesta del 16/11, costruito e provato, mai usato da lui.**
  - Non gira più da solo. `rotazione_auto`, che la scena ignorava, è stata tolta del tutto il 22/11: stato, scena, contratto e prove.
  - Un pezzo spostato con le mani, o selezionato e trascinato col mouse, resta dove lo lascia; prima tornava a posto in circa mezzo secondo.
  - Tutto torna a posto, con l'esploso chiuso, solo con due pugni chiusi tenuti mezzo secondo (`ricomponi` in `gesti.js`), o col tasto R.
  - **Scelte mie, da guardare con Tony:**
    - il gesto: due pugni, perché non si confonde con quelli che c'erano (pizzico, palmi aperti);
    - i 500 ms, e la soglia del dito piegato a 1,1;
    - le mani devono essere già sveglie: prima il palmo, poi i pugni;
    - i pezzi lanciati via restano tolti.
  - **Il rischio:** sulle foto vere un pugno ha il rapporto del pizzico a 0,27, contro la soglia di 0,25. Mentre le mani si chiudono, un pizzico di un attimo può partire prima che i pugni siano due: al più un clic che seleziona un pezzo. Sulle mani di Tony non è provato.
  - **Prove:**
    - `prove/gesti.mjs` 64 su 64;
    - `prove/mani-foto.mjs` 10 su 10: il pugno vero è un pugno; indice in su, vittoria e palmi aperti no. Il pollice in su vale come pugno, quindi due pollici in su ricompongono;
    - la scena dell'HUD che provavano `ologramma-pezzi.mjs` e `ologramma-hud.mjs` è stata tolta il 22/11: in Blender lo provano `blender-vivo.mjs` (presa, spostamento, ricomponi).
- **Blender per gli ologrammi: costruito e provato, mai usato da Tony** (16/11). Tony ha chiesto che O.S.C.A.R. faccia gli ologrammi con Blender e con le sue regole: niente primitive, mesh da vertici e curve, dettagli veri, almeno 45 fps. Lo strumento è `costruisci_in_blender`: come funziona e la gabbia stanno in **Come è fatto**, sotto `mac/`.
  - **Il confronto che ha convinto Tony** (16/11): la ventola del turbofan di prova, a forme semplici, accanto alla stessa fatta in Blender.
    - Com'è fatta: pale NACA svergolate da 30° a 62°, raccordi da 14 mm, code di rondine con 0,4 mm di gioco, ogiva cava con nervature.
    - I numeri: 290 mila triangoli. Con le mani, 78 s: fps mediana 51, p10 47, minimo 29.
    - File e script di quella prova stanno nella cartella Blender storica, sotto Documenti.
  - **Col cervello vero** (O.S.C.A.R. di prova in una cartella vuota, «fammi vedere in 3D le AirPods Pro con la custodia», un giro):
    - due ricerche, poi il primo script (4 KB) a 212 s;
    - prima vista a 248 s, fine a 458 s;
    - 15 pezzi, di cui 6 da Blender per 9.280 triangoli.

    La prima versione aveva gli assi sbagliati e lo stelo aperto: il cervello l'ha visto nella foto e ha rifatto il pezzo. La causa era `V()`, che aveva passato agli attrezzi convertendo due volte. Ora la descrizione e `aiuti.py` lo dicono, e `trasforma` gira i pezzi con i gradi di `mostra_ologramma`. **Dopo questa correzione il cervello non è stato riprovato.**
  - **Blender sempre, senza chiederlo: richiesta di Tony del 16/11.** Dopo il primo riavvio, a «fammi un turbofan» il cervello aveva usato 61 forme native, ed era passato a Blender solo dopo che Tony l'aveva trovato grezzo. Ora la regola è un meccanismo: `mostra_ologramma` e `modifica_ologramma` rifiutano le forme native, tranne i cavi e i pezzi con `calcolo: true` per gli sforzi (vedi `mac/LEGGIMI-mac.md`).
  - **Prova della guardia col cervello vero** (O.S.C.A.R. di prova, «fammi vedere in 3D un trapano avvitatore a batteria», un giro, senza nominare Blender): tre ricerche, poi 28 pezzi tutti da Blender, nessuna forma nativa. Il trapano si riconosce.
    - I tempi: primo script (10,7 KB) a 399 s, prima vista a 538 s, fine a 551 s. Quasi tutto è il cervello che pensa e scrive lo script; Blender ci mette 2,4 s.
    - Errori: due chiamate col nome nudo `costruisci_in_blender`, rifiutate da Claude Code, e un esploso a 5,5 oltre il massimo di 5.
    - Quanto aspetta Tony con Blender: 4–9 minuti in due prove, contro i 49–262 s dell'11/11 a forme native (domande diverse).
  - **Scelte mie, da guardare con Tony:**
    - la guardia sta nello strumento e non nel server: le prove del server e le demo usano ancora le forme native;
    - i cavi restano nativi, perché i flussi disegnati esistono solo sulla forma «cavo»;
    - le primitive sono rifiutate anche in bmesh (`bmesh.ops.create_*`);
    - i file vanno in `Documents/OSCAR-Blender`, si tengono le ultime 5 versioni per modello, e Blender ha al massimo 90 s;
    - niente reticoli di alleggerimento se l'oggetto vero non li ha: la ventola non ne ha;
    - le facce piane si possono chiudere con un n-gono piano: la regola dei quadrilateri serve a evitare artefatti di luce, e su una faccia piatta non ce ne sono.
  - **Mai provati:** con la voce vera di Tony, e su un Mac senza Blender (lo strumento lo dice).
- **Meteo a schermo intero: costruita e provata, mai usata da Tony** (12/11). «Che tempo fa?» fa chiamare `mostra_meteo`, che apre la vista: al centro un globo 3D col radar vero, vento e pressione, profilo termico, avvisi, condizioni per spostarsi e timeline di 12 ore. Si comanda con mani, mouse e tasti.
  - **Windy tolto, scelta mia sulla richiesta di Tony:** l'API di Windy costa 990 € l'anno, e la chiave gratuita restituisce dati mescolati apposta (la sua pagina dei prezzi, letta il 12/11). Al suo posto Open-Meteo, gratuito e senza chiave, coi quarti d'ora. «Al minuto» non lo dà gratis nessuno: il fondo è il quarto d'ora. Quella che Tony aveva incollato come chiave di RainViewer era l'elenco delle mappe: RainViewer non vuole chiavi.
  - **RainViewer gratuito, misurato il 12/11:** solo le ultime 2 ore (13 mappe, una ogni 10 minuti), nessuna previsione del radar (il nowcast è vuoto), zoom fino a 7 (all'8 risponde «Zoom Level Not Supported»), un solo schema di colori. È riflettività, non Doppler: dove piove e quanto, non la velocità del vento.
  - **Col cervello vero** (cartella vuota, tre domande, due giri): prima voce in 1,2–1,9 s, vista aperta in 1,5–1,7 s, fine in 4,5–5,8 s; Open-Meteo risponde in 0,15–0,2 s. Avevo previsto la vista a 2,5–4 s: lo strumento parte subito dopo le tre parole. Nel primo giro le risposte erano di 4–5 frasi, e alla terza domanda, senza città, lo strumento non veniva richiamato; con la persona ristretta, 3–4 frasi e lo strumento sempre.
  - **Globo al posto del radar piatto: richiesta di Tony del 12/11, mai visto da lui.** Una sfera scura con i continenti a esagoni ciano, il radar di RainViewer proiettato sulla curva, l'atmosfera, sei anelli che girano, il luogo che pulsa in verde acqua, le linee del vento e le città vicine. All'apertura il mondo gira, poi la camera scende sul luogo e si inclina: atterra a 150 km fra 4,2 e 4,9 s dopo l'apertura (tre corse headless).
    - **Costo** (`prove/grafica-banco.mjs` con un modulo ponte, stato «angolo», 12/11): 2,66 ms a fotogramma per il nucleo da solo, 2,85 col globo da vicino e 2,80 col globo intero. Avevo previsto fino a 1,5 ms in più: sono 0,2.
    - **Con le mani** (headless, foto di prova, 12/11, alternando radar piatto e globo):
      - fps medi uguali entro 1–2: radar piatto 53,9 e 56,9, globo 52,0 e 56,0;
      - in tutte e due il thread principale è occupato al 75–80% da MediaPipe; il globo ci aggiunge 0,03 ms a fotogramma;
      - il p10 balla da 40 a 60 da una corsa all'altra. Col globo 2 giri su 10 sono finiti sotto 45 (cinque corse), col radar piatto nessuno su 4 (due corse). Spegnere il globo nella stessa pagina non lo alza: la causa non si è trovata, e il numero vero arriva dalla riga «mani accese» dell'uso di Tony;
      - minimo 34–41 nel primo giro, quando si decodificano le 13 mappe.
    - **Memoria:** la texture del radar è una sola e cambia immagine. Dopo 8 s di giro del radar (circa 14 cambi di mappa) e una riapertura, le texture restano 17 e le geometrie 19 (`prove/meteo-hud.mjs`).
    - **Scelte mie, da guardare con Tony:**
      - three.js e non Globe.gl, che sarebbe una dipendenza nuova; il globo disegna nel renderer del nucleo come l'ologramma, quindi niente secondo contesto WebGL;
      - l'inclinazione: 55° sotto i 1.500 km di raggio. La curva si vede scendendo: a 1.500 km il bordo della Terra con l'atmosfera sta nel terzo alto del riquadro (foto del banco); a 150 km no, perché servirebbero oltre 70° e il radar diventerebbe una striscia. A 66° in cima usciva un moiré;
      - da vicino gli esagoni di terra si spengono al 22%: alla stessa luce del radar, la pioggia non si leggeva più;
      - il vento è quello del luogo, uguale su tutta la zona e accelerato: Open-Meteo dà un punto, non un campo, e un campo vorrebbe una griglia di richieste in più;
      - le città si scelgono per grandezza e vicinanza, non solo per grandezza: prima Zurigo, a 220 km da Milano, passava davanti a Como e Bergamo. Non sono scritte nel codice, vengono dalle 6.025 di `mappa.json`.
  - **`mappa.json` aveva perso isole e laghi fino al 12/11:** Douglas-Peucker in `prove/meteo-mappa.mjs` riduceva a niente ogni anello chiuso, e restavano 24 coste aperte, senza Sicilia, Sardegna, Regno Unito, Giappone o Australia. Ora ci sono 1.421 terre e 465 laghi, presi da `ne_50m_land` e `ne_50m_lakes`; il file pesa 592 KB invece di 349. Capri a 1:50 milioni non c'è, Ischia sì.
  - **Mani, mai provate da Tony:** pizzico e trascina sul globo lo gira, altrove scorre il tempo; due pizzichi fanno lo zoom del globo; un pizzico breve, o una presa tenuta ferma e lasciata, sceglie l'ora sulla timeline, rimette il globo sul luogo o torna ad adesso; una presa lanciata chiude la vista. Alla chiusura il registro riceve «[meteo] mani accese …», come per l'ologramma.
  - **Senza città vale l'ultima chiesta** (`runtime/meteo.json`): O.S.C.A.R. non sa dove abita Tony, e per leggere la posizione del Mac servirebbe un’integrazione nell’aiutante.
  - **Scelte mie, da guardare con Tony:**
    - la scala delle condizioni: vale il fattore peggiore, con la visibilità sui 10 km del METAR, le raffiche da 20 a 62 km/h, la pioggia fino a 8 mm/h, il temporale al 10% e neve o gelo al 40%;
    - le soglie degli avvisi: Met Office per pressione e pioggia, Beaufort per le raffiche, OMM per la nebbia;
    - il raggio alla partenza, 150 km.
  - **Mai provati:** la vista e il globo sullo schermo di Tony e sul secondo monitor, un temporale vero (gli avvisi rossi si sono visti solo su dati costruiti) e i suoni dell'entrata, che sono quelli del report.
- **Nome e avvio.** Il nome visualizzato è O.S.C.A.R. e si pronuncia Oscar. Il launcher risolve il progetto dalla propria posizione. Le impostazioni nuove usano il prefisso `OSCAR_`.
- **Opus 5.5 al posto di Sonnet 5.5: scelta di Tony del 27/11.** Gli effort restano: low per la voce, high col `[[pensa]]`. Misurato prima di cambiare (`prove/latenza.mjs` a low, in fila, dal secondo turno): Opus prima parola 2,1 s di mediana e 2,5 di massimo, Sonnet 0,7 e 0,8. Avevo previsto 1,8–2,5 s: giusto. Il prezzo è circa 1,4 s in più prima di ogni risposta, sopra al secondo di `say`. La prima domanda dopo il cambio rilegge la conversazione senza cache (Opus dopo Haiku, il 22/11: 4,6 s su una domanda banale). Acceso il 27/11 alle 19:36, riprendendo la conversazione di prima.
- **Effort low per la voce e high col `[[pensa]]`: scelta di Tony del 12/11, allora con Sonnet 5.5.** Prima aveva chiesto max: con `prove/latenza.mjs` (8 domande brevi, una dopo l'altra), dalla seconda domanda in poi:
  - max: mediana 8,4 s, massimo 21,4 s («Raccontami una battuta»), da 400 a 2.800 token in uscita anche su «quanto fa 17 per 23»;
  - high, due giri: mediana 0,8 e 1,0 s, massimo 2,1 e 1,9 s;
  - low, due giri: mediana 0,7 e 0,6 s, massimo 0,9 e 0,7 s;
  - Opus 5.5 a medium, la scelta del 5/11: mediana 2,3 s, massimo 3,4 s.
  - **Come funziona:** ogni turno parte a low (`OSCAR_EFFORT`). Per un ologramma nuovo, una ricerca a più passaggi, un report, un confronto con numeri o un calcolo degli sforzi, il cervello dice la frase breve e chiude con `[[pensa]]`. Il server rilancia allora `[pensa]` a high (`OSCAR_EFFORT_PENSA`) nella stessa risposta all'HUD, una volta sola e mai dopo un'interruzione. La domanda dopo torna a low. Anche la memoria gira a high: nessuno aspetta.
  - **Perché non si alza a metà turno:** misurato il 12/11, l'effort si fissa all'inizio del turno, e un `apply_flag_settings` mandato mentre il turno usa uno strumento conta solo dal turno dopo. Fra un turno e l'altro invece vale (114 token a low, 2.414 a max, 55 di nuovo a low) e non costa la cache: la cache letta è cresciuta da 14.535 a 16.857 token su otto turni con tre cambi.
  - **Prova col cervello vero** (cartella vuota, `brain.mjs` vero, un giro): `[[pensa]]` giusto 8 volte su 8. È arrivato sull'ologramma e sulla ricerca col report, non su ora, meteo, frigorifero, partita del Milan e bitcoin. Sui compiti pesanti la prima voce è arrivata a 1,0 s; il secondo tempo a high ha fatto un report di 6 blocchi in 28,9 s. Il secondo tempo dell'ologramma non è provato, perché mancava il server degli ologrammi.
  - **Haiku 5.5, misurato il 22/11** sullo stesso banco e in fila: prima parola 0,6 s di mediana, come Sonnet 5.5 a low (0,6 s). Haiku finisce solo prima (0,8–1,5 s contro 1,2–2,6). Cambiare modello a metà conversazione funziona (`set_model` nel processo acceso), ma il modello nuovo rilegge tutto senza cache: Opus dopo Haiku 4,6 s alla prima parola su una domanda banale. Niente cambiato.
  - **Da guardare nell'uso vero:** a low, dopo una ricerca, le risposte escono di 4–6 frasi, sopra la regola di 1–3. Su una ricerca veloce la prima voce («Guardo subito.») arriva a 1,3–2,6 s, la risposta a 14–25 s.
- **Filtro dell'ascolto: solo il nome o la finestra di 15 s, scelta di Tony del 12/11, mai provata con la voce vera.** Prima passavano senza nome anche le frasi che cominciavano con un comando («dimmi», «fammi», «puoi»…, dal 1/11), i saluti e, con l'ologramma aperto, i suoi verbi (esplod…, togli…). Ora in `addressed` di `oscar.js` restano due vie: il nome, oppure una frase cominciata entro 15 s (`FINESTRA_MS`) dalla fine della voce di O.S.C.A.R., anche di una parola sola. Si conta dall'inizio della frase (`fraseDa`), non dalla fine.
  - Con l'ologramma aperto i comandi vogliono il nome, o la finestra.
  - Nel registro dell'11/11, 20 domande in conversazione su 26 erano arrivate entro 9 s dalla fine della voce, e 6 tra 15 e 20 s: con la finestra nuova, quelle 6 avrebbero voluto il nome. La misura è grossolana, perché lo stato arriva al registro ogni 5 s.
  - **Un «sì» detto entro 1,2 s dalla fine della voce si perde:** `isEcho` prende per eco ogni frase senza parole di almeno tre lettere in quel tempo. Protegge dall'eco degli altoparlanti; mai misurato quante risposte vere costi.
- **Persona riscritta il 12/11 sulle nove incoerenze segnalate da Tony: provata col cervello vero solo in una cartella vuota, senza voce né HUD.**
  - lunghezza: da una a tre frasi di norma, fino a otto se Tony chiede di spiegare; una conferma è una frase sola, con cosa, a chi e quanto;
  - ricerca: i fatti veloci con WebSearch e WebFetch, senza pannello e dopo tre parole («Guardo subito.»); il browser per le ricerche da vedere, i siti da usare, o quando WebSearch non basta;
  - ascolto: il server mette prima della frase la riga `[sentito: …]` (col nome, o senza nome nella finestra), presa dal perché dell'HUD (`addressed` in `oscar.js`); senza nome, nel dubbio `[ignora]`. Nella prova la TV («Dimmi la verità, sei stato tu…») e «Giulia, mi passi il sale?» sono finite in `[ignora]`, 2 su 2 sia a max sia a high;
  - nomi interi per gli strumenti MCP; i segnali in una sezione sola; una vista grande alla volta, come fa già il codice; una schermata nuova solo quando lo schermo cambia; i freni estesi a nomi dei file, titoli, notifiche, testo nelle immagini e voci della TV;
  - peso: la persona è passata da 11.871 a 13.491 B, la sezione ologrammi da 4.662 a 3.100 B. Nella prova il contesto di un turno era di 29–76 mila token, quindi la sezione ologrammi ne vale circa il 2–3%, ed è in cache: la lentezza veniva dall'effort, non dal prompt.
- **Colore dei pezzi degli ologrammi: costruito e provato, mai usato da Tony** (11/11). Ogni pezzo può avere `colore` («#e53935» o «#e53»), in mostra e in cambia. Vale in ologramma e solido; raggi X, densità e sforzi restano come prima. Col cervello vero, «la molecola d'acqua con l'ossigeno rosso e gli idrogeni bianchi» è uscita al primo colpo, con la prima vista a 16 s.
  - Dal 22/11 il colore si vede in Blender, in solido e ai raggi X, senza il limite del bagliore dell'HUD.
  - Il tappo della sezione resta ciano anche sui pezzi colorati.
  - I tre strumenti degli ologrammi pesano 9.076 B, 65 B sotto il tetto di `prove/ologramma-server.mjs`: il prossimo campo lo supera.
- **Ricerca sui pezzi degli ologrammi: costruita e provata, usata da Tony una volta** (11/11). Tony ha chiesto che a ogni ologramma O.S.C.A.R. cerchi come è fatto ogni pezzo e di che materiale. Il 10/11 il MacBook Air fatto per lui aveva 37 pezzi su 37 con materiale «non detto».
  - **Cosa c'è:** ogni pezzo può avere `materiale_vero` e `fattura` (come è fabbricato e montato), che si vedono nella scheda del pezzo. `materiale` resta la chiave del calcolo.
  - Il cervello ha WebSearch e WebFetch, che non aprono il pannello e non chiudono l'ologramma. Dal 12/11 la persona li usa anche per i fatti veloci; le ricerche da vedere restano nel browser. La risposta dello strumento ha una riga «Materiali: …» che elenca cosa manca.
  - **Attesa** (O.S.C.A.R. di prova, «Fammi vedere un MacBook Air in 3D.», un campione per corsa): la prima vista arriva a 80 s col codice vecchio, a 109, 139, 155 e 262 s con la ricerca. La voce più grossa è il pensiero in silenzio dopo le ricerche (39–125 s).
  - **Quanto copre sul banco:** in ogni corsa tutti i pezzi hanno `materiale_vero`; la fattura c'è su 11–17 pezzi, su 30–122 pezzi in tutto. Il cervello cambia molto da una corsa all'altra: 47 pezzi e il giro mirato, oppure 122 pezzi senza giro mirato.
  - **Uso vero** (11/11, 15:46, Burj Khalifa, Torre Eiffel e Mole Antonelliana): due WebSearch insieme, prima vista 49 s dopo la domanda, nessun errore del nome nudo. Ma solo 7 pezzi su 24 con `materiale_vero` e 1 con la fattura, e nessun giro mirato, anche se la risposta dello strumento elencava i pezzi senza. Il giro mirato è saltato in 2 corse su 5: la regola della persona non basta. La proposta di farglielo chiedere dal server, come per la memoria, Tony l'ha rimandata («no, per ora», 11/11).
  - **La fonte per pezzo è stata tolta** (11/11, scelta di Tony): controllate a mano, ne reggevano 2 su 5 (una pagina sull'M2 usata per l'M4), e una fonte sbagliata fa fidare di un dato non controllato. Il prezzo: la scheda non distingue più un dato cercato da uno indovinato. Se Tony chiede da dove viene un dato, la persona dice di nominare la pagina vera o di dire che è una stima. Un `fonte` che arriva ancora si ignora.
- **Mani con le regole di Tony: costruite e provate, usate da Tony quattro volte** (11/11). Delle 12 regole scritte da O.S.C.A.R. il 10/11, nessuna misurata, cinque c'erano già (1U, filtro, isteresi del pizzico, buco breve, niente doppi lanci). Le altre sono in `gesti.js`: il contratto dice come, e perché alcune sono cambiate o non fatte.
  - **Fasi:** le mani partono a riposo e si accendono mostrando il palmo aperto per 0,3 s nel 70% centrale dell'immagine. La barra dice «mani: mostra il palmo», poi «mani pronte». Tornano a riposo dopo 4 s senza gesti né palmo. Se a Tony non piace: `innesco_ms: 0` in `PREDEFINITI` di `public/ologramma/gesti.js`.
  - **Soglie nuove, mai provate sulle sue mani:**
    - mappa a S: al centro metà velocità, ai bordi il doppio;
    - zona morta di 3 px su 480;
    - zona attiva del 70%;
    - profilo oltre 75°: niente innesco né esplodi, il pizzico resta;
    - un buco fino a 170 ms non interrompe il gesto.
  - **Non fatte:** pizzico al 10–15% di 1U, scheletro ricostruito, previsione dalla velocità. Al loro posto si conta: la riga «mani accese» porta anche tremolio in px, inneschi, pizzichi con la distanza minima pollice-indice in U, buchi, salti e profilo (`grep 'mani accese' runtime/server.log`).
  - **L'uso vero** (registro al 12/11): quattro sessioni da 342 a 390 s con le mani accese e da 119 a 303 s con le mani in vista. La prima è quella da 358 s dell'11/11.
    - fps: p10 da 50 a 62, minimo da 33 a 46, quindi sopra i 45;
    - tremolio grezzo da 3,2 a 6,6 px. La zona morta (3 px) lavora sul punto filtrato, mentre il tremolio confronta il grezzo col filtrato: i due numeri non si confrontano direttamente, e se il cursore trema lo si vede guardandolo;
    - 267 pizzichi, uno solo di profilo, con il minimo pollice-indice mediano fra 0,07 e 0,09 U: un pizzico al 10% di 1U sarebbe a filo in tutte e quattro;
    - 30 inneschi, 28 scaduti dopo 4 s senza gesti né palmo: non si sa se Tony le stava ancora usando;
    - un lancio solo in 267 pizzichi, e nessuna presa sparita mentre la mano correva. O Tony non lancia, o non tiene fermo il pizzico per i 350 ms della presa, o 1 m/s è troppo per lui. La meteo si chiude lanciandola: è la prova;
    - salti: 147 nella prima sessione, da 41 a 50 nelle altre. Gesti persi: da 6 a 17 a sessione, circa 2,5 al minuto di mani in vista.

    Per alzare `assente_ms` servirebbe la durata dei buchi, che la riga non conta. Per `riposo_ms` serve sapere da Tony se le mani si spengono mentre le sta ancora usando.
  - **Banco su foto vere** (`prove/mani-foto.mjs`): due pizzichi veri a 0,08 e 0,10 U. Il pugno ha rapporto 0,27 contro la soglia 0,25: un falso pizzico è possibile.
  - HUD headless con due mani, due giri: p10 59 e 58 fps.
- **HUD in stile JARVIS: costruito e fotografato, mai visto da Tony** (10/11). Al posto dell'umanoide c'è la sfera-cervello di `public/nucleo.js` dentro gli anelli. Le montagne sono state tolte e lo sfondo è nero. Dal 27/11 la sfera è la goccia del restyling fisico (in cima a **Aperto**).
  - **Costo** (`prove/grafica-banco.mjs`, GPU libera): 2,76–3,00 ms a fotogramma in ogni stato, contro i 4,15 dell'umanoide. Il margine per le mani cresce invece di calare.
  - **Mani col nucleo nuovo** (`prove/ologramma-hud.mjs`, headless sulla GPU dell'M2, turbofan con le quote e due mani, due giri il 10/11): fotogrammi contati per secondo con mediana 60 e p10 60. Nella misura mandata alla chiusura il minimo è stato 32, 42 e 43. È sempre con l'ascolto spento e la foto al posto della fotocamera, e la traccia del compositore non è stata rifatta.
  - **Sforzi:** il rosso parte da fs 1, dove il materiale snerva, come dice il contratto. Prima il rosso pieno partiva già da fs 1,25. Sopra fs 1 la scala va dal blu al viola al magenta.
  - **Quote in mm:** le ha il pezzo scelto, e senza pezzo scelto l'ingombro del modello. Un cilindro è quotato sulla scatola che lo contiene, quindi le linee di riferimento possono partire da angoli vuoti. Va guardato con Tony.
  - **La scheda dell'ascolto mostra tutto quello che il microfono sente**, anche le frasi di altri nella stanza. Restano solo sullo schermo, mai nei registri. Se a Tony non va, si spegne nascondendo `#ascolto`.
  - **Micro-dati:** quelli ai bordi e a raggiera sono numeri veri. Le coordinate e gli esadecimali che giravano negli anelli erano decorazione: tolti il 27/11.
  - **Mai provati:**
    - la scheda dell'ascolto con la voce vera di Tony, cioè con le parole parziali del riconoscitore locale;
    - l'HUD sul suo schermo, che ha accanto un secondo monitor 1920×1080;
    - i colori delle anomalie in un caso vero.
- **Ologrammi: usati da Tony per la prima volta il 10/11** (AirPods Pro e MacBook Air, stilizzati). Cosa è vero e cosa no, e come si parlano i pezzi, sta nel contratto `public/ologramma/LEGGIMI-ologramma.md`. Tony non ha file CAD: i suoi oggetti veri fatti a occhio li ha bocciati 3 volte su 3, mentre gli sono piaciuti un modello di Sketchfab con vista esplosa ed etichette e un turbofan fatto di primitive.
  - **Mani, la regola di Tony:** si accendono solo se l'HUD resta sopra 45 fps sul suo M2. Registro al 12/11: otto sessioni con la fotocamera vera, 2.187 s di mani accese in tutto, con il p10 sempre fra 48 e 62: la regola regge. I minimi stanno fra 43 e 47, tranne 18 (la sessione da 47 s, al 10/11) e 33 (quella da 358 s, l'11/11), mai spiegati. Una sessione da 342 s ha la mediana a 85, oltre i 60 Hz dello schermo del Mac: forse l'HUD era sul monitor esterno, non verificato.
    - Dopo il 12/11 non regge più sempre: vedi «Mani sotto 45 fps» in cima a **Aperto**.
    - La misura vera arriva da sola. Quando l'ologramma si chiude, dopo almeno 10 s di mani accese, `runtime/server.log` riceve una riga «[ologramma] mani accese N s: fps mediana …, p10 …, minimo …, detect … ms» (`grep 'mani accese' runtime/server.log`).
    - Se il p10 vero sta sotto 45, le mani si spengono di base cambiando `maniVolute` in `public/oscar.js`.
    - La riga non arriva se Tony chiude la finestra dell'HUD con l'ologramma aperto.
  - **A batteria sotto il 20%** il Risparmio energetico di Chrome limita ogni pagina a 30 fps, HUD compreso (misurato l'8/11). Una riga «mani accese» con mediana 30 viene da lì. Spegnerlo nel profilo dell'HUD costa batteria: lo decide Tony.
  - **Mai provati:**
    - le soglie dei gesti sulle mani di Tony: le ha usate, ma nessuna è stata rifatta con lui (filtro con beta 5, palmo 90 mm, presa 350 ms, lancio da circa 1 m/s);
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
  - **Comandi a voce:** dal 12/11 vogliono il nome («O.S.C.A.R., esplodilo»), salvo nei 15 s dopo che O.S.C.A.R. ha parlato.

Restano decisioni di Tony, non lavoro sul codice:
- **Regole di Anatomy per gli ologrammi** (10/11, scelta di Tony). In `oscar-persona.md`, sotto «Costruisci come è fatto l'oggetto vero», ci sono le regole di mestiere di Anatomy (github.com/wheresryan22/anatomy):
  - prima i numeri veri;
  - pezzi a gruppi, come l'oggetto montato, 40–80 in tutto;
  - niente che fluttua o si compenetra;
  - due sguardi, da lontano e da vicino;
  - si costruisce a passate: 15–25 pezzi con `mostra_ologramma`, poi i dettagli con `aggiungi`.

  La prova col cervello vero (O.S.C.A.R. di prova isolato, un campione per lato) ha dato:
  - motore: da 39 a 48 pezzi, finito in 106 s invece di 104;
  - drone: da 26 a 56 pezzi, finito in 105 s invece di 43.

  Più dettaglio, ma esplosi più confusi: pezzi in tutte le direzioni ed etichette sovrapposte. Si consigliava di toglierle, Tony le ha tenute. Se l'attesa o gli esplosi pesano, si tolgono quelle sei righe. Le foto della prova non sono nella repository.
- **A batteria il Mac va in stop, e l'agenda con lui.** L'orologio gira solo con O.S.C.A.R. acceso e il Mac sveglio. A batteria lo schermo si spegne dopo 10 minuti senza tocchi e il Mac va in stop circa 5 secondi dopo (`pmset -g custom` e `pmset -g log` del 1/11); a corrente non va mai in stop. Parlare a O.S.C.A.R. non conta come tocco. Non è misurato se l'HUD acceso basta a tenerlo sveglio.
  - Oggi `ricorda`, a batteria, dice al cervello di avvisare Tony.
  - Il rimedio sarebbe `caffeinate -i` finché un compito è vicino, al costo di un po' di batteria: lo decide Tony.
- **Memoria provata una volta** (5/11, cervello vero). Detto di passaggio «L'evocazione l'ho già visto», entro 13 secondi dalla chiusura dell'HUD finto O.S.C.A.R. ha cominciato a fare memoria e ha salvato un ricordo sui gusti horror di Tony; prima, il 1/11, la stessa frase non era stata salvata. Dopo il riavvio ha ripreso la conversazione e sapeva l'ora esatta della domanda. Dopo `/api/reset` sapeva ancora che L'evocazione era già visto, dalla memoria. Il ricordo di prova è stato tolto: la memoria vera è com'era.
  - Le 184 domande del 1/11 non sono mai state rilette: lì ci sono persone e gusti che O.S.C.A.R. non ha salvato. Se Tony vuole, si può fargliele rileggere una volta.
- **Orologio provato una volta** (5/11, HUD headless e muto, cervello vero). «Ricordami tra due minuti di bere»: `ricorda` è stato chiamato al primo colpo, il server è stato riavviato in mezzo, il compito è arrivato alle 04:20:20 esatte e O.S.C.A.R. ha parlato per primo. «Che ore sono a Tokyo?»: risposta giusta in un secondo, senza browser. Mai provato con la voce vera e l'HUD a schermo intero.
- **Mai provate:** le prestazioni dell'HUD nelle sessioni lunghe.
- **Report a schermo intero: provato una volta con una ricerca vera** (1/11). Alla domanda «fammi una ricerca sullo stato della realtà virtuale… mettimela a schermo» il cervello ha chiamato `mostra_report` da solo dopo 54 s. Il report aveva 10 blocchi e 9 fonti (IDC, Wikimedia, due video YouTube), e video e immagine si sono caricati.
  - **Fluidità:** in quella prova, con la voce e il browser attivi, l'entrata ha avuto scatti fino a 284 ms. Riaprendo un report di prova a riposo, 24 aperture su 26 sono state pulite (circa 50 fotogrammi al secondo, il limite della grafica WebGL). I due blocchi, di 100 e 400 ms, sono capitati subito dopo la prova vera.
  - Lampo e sfocature non ci sono più dal 27/11 (restyling fisico).

## Come è fatto
- **`server.mjs`** avvia e collega tutto:
  - HUD e API su `127.0.0.1:4321`. Le difese:
    - accetta solo l'Host `localhost:4321` o `127.0.0.1:4321`;
    - le POST richiedono `content-type: application/json` e un'origine locale, o nessuna;
    - su `/api/`, `/mediapipe/` e `/modelli/`, con ogni metodo, `sec-fetch-site` deve mancare o valere `same-origin`;
    - ogni file servito porta `x-frame-options: SAMEORIGIN` e `frame-ancestors 'self'`. Senza, un sito qualsiasi metteva l'HUD in un iframe e, con un ologramma aperto, accendeva la fotocamera (provato l'8/11);
    - un corpo JSON rotto, o che non è un oggetto, vale `{}`.
  - le variabili d'ambiente date a mano vincono su `.env`. `OSCAR_CERVELLO=<cartella>`, solo per le prove, fa vivere un O.S.C.A.R. di prova tutto lì: conversazione, `mcp.json`, ologramma e `ascolto.log`, con le cartelle dei documenti come sue sottocartelle. Così non tocca la memoria vera né i file di Tony.
  - un Chrome per Google con il suo profilo (`runtime/browser-profile`, CDP 9333), aperto sullo schermo dell'HUD, che lo copre (la posizione la manda l'HUD e sta in `runtime/schermo-hud.json`);
  - Playwright MCP 0.0.83 sulla porta 8931, agganciato a quel Chrome, perché un browser lanciato da Playwright verrebbe chiuso alla fine di ogni risposta. Le schede nuove il server le chiude e ne apre l'indirizzo nella pagina principale;
  - lo screencast CDP mandato all'HUD come MJPEG su `/api/screen`;
  - l'HUD stesso, un Chrome `--app` a schermo intero con il profilo `runtime/hud-profile`.
- **`brain.mjs`** è il cervello: un solo `claude -p` in stream-json, sempre acceso. Il modello è Opus 5.5 (`claude-opus-5-5`, dal 27/11; prima Sonnet 5.5), scelto con `OSCAR_MODEL`; l'effort è `low` per la voce (`OSCAR_EFFORT`) e `high` per il secondo tempo dei compiti annunciati con `[[pensa]]` e per la memoria (`OSCAR_EFFORT_PENSA`). `brain.mjs` lo cambia prima del turno con `apply_flag_settings`, solo se è diverso da quello in uso. Senza `--effort` il cervello prenderebbe l'effort delle impostazioni di Claude Code di Tony (`modelSettings` in `~/.claude/settings.json`), che servono a programmare.
  - **Cosa può fare** (flag in `server.mjs`): `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch` e `WebFetch`, ma non `Bash`. WebSearch e WebFetch servono ai fatti veloci e alla ricerca sui pezzi degli ologrammi; vanno anche in `--allowedTools`, se no sono negati in silenzio. I file sono solo quelli delle cartelle dei documenti (`--add-dir`), e come MCP ha solo `playwright` e `mac`. Non ci sono domande di permesso: è approvato quello che sta dentro le cartelle, il resto è negato.
  - **Dove vive:** sulle nuove installazioni il cervello lavora in `~/Library/Application Support/O.S.C.A.R./cervello`. Le installazioni esistenti riusano la cartella originale perché Claude Code associa la memoria al percorso di lavoro.
  - **Fare memoria:** da solo salvava quasi niente (3 ricordi in 184 domande al 1/11), quindi glielo chiede il server. Dopo 3 minuti senza domande, o circa 20 secondi dopo che l'HUD si è chiuso, gli manda un messaggio `[memoria]` che non viene letto ad alta voce. Le frasi finite in `[ignora]` non contano. Con `OSCAR_APP`, chiuso l'HUD, il server aspetta che la memoria finisca prima di spegnersi, ma non oltre 5 minuti dalla chiusura.
  - **Interruzioni:** una domanda nuova interrompe quella in corso con un `control_request` di tipo interrupt; se il turno non si chiude entro 4 secondi, il processo viene ucciso e rilanciato, sempre con `--resume` (anche se era appena nato: dal 17/11). Se muore, riparte con `--resume` sulla stessa sessione, mentre `/api/reset` lo fa ripartire da zero.
  - **Inattività.** Dopo 45 secondi senza progressi l’HUD avvisa. Il turno viene interrotto dopo 180 secondi, o 420 con strumenti in corso. Dopo l’interruzione il processo riceve SIGTERM a 4 secondi e, se resiste, SIGKILL altri 2 secondi dopo. Il server non reinvia la domanda.
  - **Dopo un riavvio del server** riprende la stessa conversazione, se l'ultima risposta è di meno di 2 ore fa e la persona non è cambiata: id, ora e impronta della persona stanno in `runtime/cervello.json`, che `/api/reset` cancella. Se una conversazione ripresa muore entro 20 secondi, per esempio perché non esiste più, ne apre una nuova.
  - **Il giro di confronto:** dopo il `[pensa]`, se nella risposta il cervello ha guardato l'oggetto vero (`guarda_oggetto_vero`) e aperto un ologramma nuovo con l'HUD acceso, il server lo rilancia una volta con `CONFRONTO_TEXT`, a effort alto, nella stessa risposta (vedi **Aperto**).
  - **Marcatori nella risposta:** `[ignora]` vale solo prima che O.S.C.A.R. abbia detto qualcosa. `[[mostra]]` apre il pannello del browser, che comunque si apre da solo alla quarta azione su Google. Poi ci sono `[anim: …]`, un'animazione di Wikimedia, e `[[vedi: …]]`, le schede (vedi **Aperto**). Le GIF di GIPHY sono state tolte il 27/11.
  - **Report:** il cervello chiama lo strumento `mostra_report` di `mac/mac-mcp.mjs`, che risponde e basta. È `brain.mjs` a leggere i blocchi dalla chiamata nel flusso e a mandarli all'HUD come evento `report`. Zero blocchi lo chiudono, come `Esc` e come un `[[mostra]]` nuovo. Un report con blocchi, `[[mostra]]` e la quarta azione nel browser chiudono anche l'ologramma, nell'HUD e nel server.
- **`oscar-persona.md`** è il carattere di O.S.C.A.R., passato con `--append-system-prompt`. Il modo di ragionare è il `~/.claude/CLAUDE.md` di Tony, che Claude Code carica da solo. **Questo file non arriva a O.S.C.A.R.:** per cambiare come risponde si modifica `oscar-persona.md` e **si riavvia il server**, che lo legge una volta sola (`/api/reset` non basta). Con la persona cambiata il cervello apre una conversazione nuova: riprendendo quella vecchia, Claude Code userebbe il prompt registrato al suo primo messaggio.
- **`voice.mjs`** fa parlare O.S.C.A.R. con `say`, una frase alla volta in un WAV a 24 kHz. La voce è quella di sistema, se italiana, anche Siri, letta da `defaults`; altrimenti la migliore italiana installata. `OSCAR_MAC_VOICE` la scavalca.
- **`media.mjs`** cerca le animazioni di `[anim: …]` su Wikimedia Commons; il server le fa diventare schede.
- **`schede.mjs`** pulisce le schede `[[vedi: …]]`, tiene solo le fonti lette in quella risposta e cerca la foto in parallelo; **`rete.mjs`** è la guardia per scaricare dal web (https, indirizzi pubblici dopo il DNS e a ogni rimando, tetto ai byte), usata anche da `guarda_oggetto_vero`.
- **`orologio.mjs`** fornisce le date e **`agenda.mjs`** gestisce i promemoria.
  - **L'ora:** il server mette `[adesso: giorno, ora (fuso, UTC±n)]` davanti a ogni messaggio per il cervello, perché Claude Code gli dà solo la data. Davanti alle frasi sentite aggiunge `[sentito: …]`, il perché dell'HUD, solo da `SENTITO` in `server.mjs`.
  - **L'agenda** usa SQLite integrato in Node. Il server e il processo MCP aprono lo stesso archivio nella cartella di stato. L’importazione iniziale di `agenda.json` conserva i numeri e le scadenze.
  - **La consegna.** L’HUD verifica lo stato ogni 5 secondi. Il server assegna un solo compito alla volta e registra il tentativo prima di passarlo a Claude. Salva la risposta e attende la ricevuta dell’HUD dopo la visualizzazione o la lettura. Una prenotazione senza ricevuta scade dopo 45 secondi e viene rinnovata durante il lavoro. Alla riconsegna l’HUD riceve il risultato già salvato, oppure l’avviso di esito da verificare.
- **`salti.mjs`** salva le foto dei salti delle mani che l'HUD manda con `POST /api/mani/salto` (solo dal browser dell'HUD, JPEG in base64, al massimo 350 KB), in `<stato>/salti/<giorno>/`, e cancella i giorni più vecchi di 7, anche all'avvio. In `mani.js`, `disegnaSalto` fa la foto e `inviaSalto` la manda; `createMani` le scatta solo con `onSalto`.
- **`meteo.mjs`** scarica le previsioni di Open-Meteo per un luogo e scrive il riassunto per il cervello.
  - Una richiesta sola: adesso, 19 ore (da −6 a +12), 57 quarti d'ora (da −2 h a +12 h) e 3 giorni, con `timeformat=unixtime`. Il luogo dal nome con la geocodifica di Open-Meteo; l'ultimo resta in `runtime/meteo.json`.
  - `POST /api/meteo` solo dallo strumento `mostra_meteo` di `mac/mac-mcp.mjs`, che è un client sottile fuori dalle code di mouse e ologrammi; con `origin` risponde 403. Il server manda i dati all'HUD dentro il turno del cervello (`brain.notify`, evento `meteo`) e chiude l'ologramma.
  - `GET /api/meteo` dà all'HUD aperto gli ultimi dati, riscaricati se hanno più di 10 minuti.
  - I conti (eventi di pioggia, tendenza della pressione, avvisi, condizioni) stanno in `public/meteo/dati.js`, uguali nel server e nell'HUD.
- **`ologramma.mjs`** è lo stato unico degli ologrammi, e il server è l'unico che lo scrive. Valida i modelli del cervello, tiene modello e versione, scrive i testi per il cervello e salva in `runtime/ologramma.json` e `runtime/ologramma-campo.bin`. All'avvio del server un ologramma rimasto aperto si chiude. Il contratto fra i pezzi è `public/ologramma/LEGGIMI-ologramma.md`.
  - **Gli strumenti** `mostra_ologramma`, `modifica_ologramma` (anche titolo e descrizione) e `analizza_struttura` stanno in `mac/mac-mcp.mjs`. Sono client sottili: chiamano `POST /api/ologramma` sulla porta che `mcp.json` passa con `--porta`, perché le variabili di `.env` non arrivano ai processi figli.
  - **Blender** (`blender.mjs`, dal 22/11): apre Blender con l'ologramma e lo chiude con lui, gli manda lo stato (coi percorsi dei file controllati da `fileConsentito` in `server.mjs`), le mesh delle forme native, il campo degli sforzi e i gesti; riceve le modifiche della scheda e i pezzi lanciati via, e li passa a `ologramma.mjs`.
  - **La foto:** gli strumenti restituiscono il testo più la foto PNG che Blender fa dopo ogni versione nuova, così O.S.C.A.R. vede quello che ha fatto. Il server la aspetta 5 s dopo una modifica, 10 s dopo `mostra` o con pezzi da file, 25 s se Blender sta ancora partendo.
  - **Le altre vie:**
    - `/api/ologramma/campo?v=`: il fattore di sicurezza di ogni voxel;
    - `POST /api/blender/gesti`: i gesti delle mani dall'HUD a Blender, solo tipi noti con numeri finiti;
    - `/mediapipe/` (da `node_modules`) e `/modelli/`: il modello delle mani si scarica al primo avvio in `runtime/modelli/` e si usa solo se lo SHA-256 è giusto.
  - **Come si riconosce l'HUD:** manda `origin` o `sec-fetch-site`, e il processo MCP no. Dall'HUD passano solo chiudi (Esc), togli e rimetti, i gesti e la misura delle mani, che il server scrive nel registro.
- **`fisica/`** calcola gli sforzi in un `worker_threads`, fermato dopo 55 s:
  - `voxel-fea.mjs`: elasticità lineare statica a voxel, con multigriglia;
  - `struttura.mjs`: dal modello ai voxel, poi carichi, vincoli e risultati per pezzo;
  - `lavoratore.mjs`: l'ingresso del worker.

  Se cambia solo la lega e ν resta uguale, si rifà solo fs, senza risolvere di nuovo.
- **`public/`** è l'HUD:
  - `index.html`: la palette sta in variabili CSS.
    - Colori: `--ciano` dominante; `--arancio` e `--rosso` solo per le anomalie.
    - Caratteri: `--sottile` è Helvetica Neue, `--mono` è Menlo, tutti e due di sistema. L'HUD non chiede niente ad altri siti per disegnarsi.
    - I moduli hanno angoli a staffa (`.staffe`) al posto delle cornici piene, da un pixel e senza ombre.
    - Il moto: ogni transizione usa `--molla`/`--t-molla` (le cose con una massa) o `--lieve`/`--t-lieve` (opacità e colori), che scrive `fisica.js`. Nessuna durata scritta a mano.
  - `fisica.js` (dal 27/11): la molla dell'HUD, un oscillatore smorzato integrato in forma esatta (stabile anche con un fotogramma perso, e cambiare meta tiene la velocità). Due tipi: «corpo», al 2% in 0,21 s con un rimbalzo del 2%, e «lieve», in 0,22 s senza rimbalzo. `curvaCSS()` ne campiona la risposta in una `linear()` per CSS e animazioni. Le prove: `prove/fisica.mjs`.
  - `oscar.js`:
    - ascolto sempre acceso, decide se una frase è per O.S.C.A.R., coda audio, consegna dell'agenda;
    - **la scheda dell'ascolto** (`#ascolto`): le parole mentre arrivano e, a frase finita, cosa ne ha fatto O.S.C.A.R. Solo `textContent`, mai nei registri;
    - **i dati a raggiera** (classe `.raggio`) appesi ad `anchor().R`, con i fili SVG: stato, voce, tempo di risposta, ingresso audio, sistemi, fps. Ogni scritta è una massa su una molla agganciata al suo punto dell'anello: quando il nucleo si sposta lo segue con un filo di ritardo, e il filo si tende;
    - **ai bordi**: in alto ora e memoria, a destra gli eventi (tipi e nomi di strumenti, mai frasi), ognuno che si spegne col suo tempo di dimezzamento (25 s). 4 volte al secondo;
    - **lo spettro per il nucleo** (`S.spettro`): 64 bande da circa 94 Hz a 8 kHz, dal microfono o dalla voce quando parla. Sotto la frase dell'ascolto il livello del microfono è una riga sola;
    - **gli allarmi**: `allarme(causa, livello, testo, ms)` tiene le cause attive e ne ricava `S.allarme`.
      - 1, arancione: ascolto spento, calcolo degli sforzi fallito;
      - 2, rosso: server perso per due giri di `/api/status`, cervello in errore, un pezzo dell'ologramma con fs sotto 1.
  - `report.js`: il report a schermo intero. È una griglia 12×6; le ultime due colonne delle ultime due righe restano al nucleo, che ci scivola rimpicciolito (`S.dock` in `nucleo.js`). Dal 27/11 le schede entrano su molle in ordine di distanza dal protagonista, come un fronte d'onda: l'ultima è a posto in circa 0,54 s; le barre dei grafici salgono su una molla. Niente lampo di copie né sfocature. I suoni dell'entrata stanno in `sfx.js` (`report`), agganciati ai tempi di atterraggio che `showReport` restituisce. I blocchi in più si impilano e cambiano ogni 9 s. Il testo del cervello entra solo con `textContent`, le immagini solo da `https`, i video solo come ID di YouTube;
  - `nucleo.js` (riscritto il 27/11): la goccia e gli anelli (three.js 0.160 con bloom). Il contratto è quello di prima: `TIMING` e `createScene(canvas, S)`, che restituisce `frame`, `anchor` (con `R`, il raggio dell'anello più esterno), `assembling`, `renderer` e `strato`. Ogni forma è calcolata e ogni moto segue un'equazione:
    - la goccia: 24.000 particelle che vibrano coi modi di Rayleigh (armoniche sferiche l = 2..5, 32 oscillatori smorzati integrati sulla CPU). A riposo le muove il rumore termico, con voce e microfono lo spettro vero, pensando una spinta che la fa ruotare allungata, nel critico un rumore forte sugli l alti: trema. Dove la superficie si muove più in fretta si schiarisce;
    - dentro, le linee di campo di sette dipoli magnetici (uno al centro, sei vicino al bordo), tracciate una volta con Runge-Kutta, che ruotano con la goccia; quando pensa ci corrono le cariche;
    - gli anelli, dall'interno: contatto; spettro vero (64 bande a specchio, basse in basso); una corda chiusa con l'equazione delle onde e la tensione del cerchio (la voce la spinge dall'alto, il microfono dal basso, il pensiero con impulsi che interferiscono); una scala graduata con l'inerzia di un giroscopio; l'esterno con le tacche ogni 5°;
    - l'avvio: una nube che ruota collassa nella goccia (ogni particella un oscillatore smorzato, in forma esatta nello shader), poi un'onda d'urto disegna gli anelli. `assembling` è la frazione di particelle arrivate. Pronto in 1,45 s;
    - arancione e rosso arrivano solo con `S.allarme`.
    - Il composer usa un render target con lo stencil (serviva alla sezione dell'ologramma, che ora sta in Blender). `strato` aggancia la scena del globo della meteo prima del bloom.
  - `ologramma/`: `forme.js` e `materiali.js` (anche nel server), `geometrie.js` (nel server, per le mesh delle forme native che vanno a Blender), `gesti.js` e `mani.js` (MediaPipe 0.10.35 in locale). L'ologramma lo disegna Blender (`mac/blender/vivo.py`);
  - in `oscar.js`, con l'ologramma aperto: le mani si accendono e i gesti vanno a `POST /api/blender/gesti`; il nucleo smette di disegnarsi; M accende o spegne le mani (la scelta resta in `localStorage` `oscar-mani`); Esc chiude l'ologramma e Blender. Gesti: un pizzico con una mano ruota, con due fa lo zoom, due mani aperte unite al centro e poi allargate esplodono, un pezzo afferrato si sposta e resta dove lo lasci, lanciato si toglie, e due pugni chiusi per mezzo secondo ricompongono tutto;
  - `meteo/`: la vista meteo, caricata alla prima apertura.
    - `vista.js`: moduli, timeline, mouse, tasti e gesti. Una linea del tempo comanda tutto, da −2 h a +12 h: i moduli mostrano il tempo a quell'ora, il globo la mappa del radar di allora e il vento di quell'ora.
    - `globo.js`: il globo, con three.js nello `strato` del nucleo. Il riquadro `.m-globo` è trasparente: prende mouse e misure, e sopra ha il canvas delle scritte. Il globo resta nel riquadro con lo scissor e una sfumatura di 28 pixel.
      - Gli esagoni li calcola lo shader della sfera, su una griglia che si infittisce con lo zoom (circa 9 pixel fra uno e l'altro). Dove è terra lo dice una maschera riempita da `mappa.json`: il mondo a 2048×1024, più ±6° attorno al luogo a 1024×1024.
      - Il radar è Mercatore esatto, punto per punto, con una texture sola.
      - La vista è un punto guardato più un raggio in km, che la camera insegue. `info().radar` dà anche `camera`, `etichette` e `memoria`.
    - `radar.js`: le mattonelle di RainViewer per la vista del globo (al massimo 4×4; dal largo il mondo allo zoom 2), ricolorate a fasce di 5 dBZ col bordo acceso. Dice anche l'eco sopra il luogo e la più vicina, entro il raggio e al massimo 1.500 km. Le chiede direttamente a RainViewer (`api.` e `tilecache.rainviewer.com`): con le immagini del report sono le sole richieste dell'HUD fuori da O.S.C.A.R.
    - `mappa.json` (592 KB): terre e laghi ad anelli chiusi, confini di Natural Earth 1:50 milioni e 6.025 città coi nomi italiani, di pubblico dominio. Si rifà con `prove/meteo-mappa.mjs`.
    - Tasti: frecce il tempo (con Maiusc un'ora), 0 adesso, + e − lo zoom del globo, R ricomincia, M le mani, Esc chiude. Mouse: trascina e rotella sul globo, doppio clic lo rimette sul luogo; clic e trascina sulla timeline.
  - `sfx.js`: suoni sintetizzati, anche quelli dell'ologramma.
  - `lab-sfx.html` prova i suoni, anche quelli del report. `lab.html` prova la grafica, ma funziona solo servendo la radice della repository (per esempio `python3 -m http.server` nella radice del progetto, poi `/public/lab.html`), non da `localhost:4321`.
- **`mac/`** controlla il Mac: un server MCP su stdio senza pacchetti, più un aiutante Swift che si compila da solo in `runtime/oscar-mac` quando `helper.swift` cambia. I dettagli stanno in `mac/LEGGIMI-mac.md`.
  - **Blender** (`costruisci_in_blender`, dal 16/11): il cervello scrive uno script Python, che gira in `Blender -b` dentro una gabbia di `sandbox-exec`. La gabbia toglie rete, Apple Events e altri programmi, letture in `/Users`, `/Volumes` e nelle cartelle temporanee, e scritture fuori dalla cartella della versione.
    - `mac/blender/gabbia.py` esegue lo script ed esporta un GLB per oggetto, decimato solo nell'esportazione; poi scrive `rapporto.json` e `modello.blend`.
    - `mac/blender/aiuti.py` sono gli attrezzi già pronti per lo script, in coordinate dell'HUD: anelli, loft, `trasforma` (coi gradi di `mostra_ologramma`), tappi a quadrilateri, rivoluzioni con le punte a griglia «O», profili NACA e superellissi, offset, raccordi, Bézier, rumore.
    - I file vanno in `Documents/OSCAR-Blender/<nome>/v<n>/` (`--blender` in `mcp.json`); si tengono le ultime 5 versioni.
    - Il cervello li apre poi con `mostra_ologramma` come pezzi «file» con `centra: false`, e Blender li riprende dal `modello.blend` accanto, coi quadrilateri e i raccordi.
    - Dal 16/11 `mostra_ologramma` e `modifica_ologramma` rifiutano le forme native, tranne `cavo` e i pezzi con `calcolo: true`.
  - **L'oggetto vero** (`guarda_oggetto_vero`, dal 17/11): foto vere scaricate in https da indirizzi pubblici, mai aperte sul Mac (tipo e misure dai primi byte, al massimo 2000 px e 3,5 MB), e misure ufficiali. Lo stato è in `mac-mcp.mjs` (`vero`), nella stessa fila degli ologrammi: `ologramma()` rimette le foto dopo quella dell'HUD (`accantoAlVero`), `costruisciInBlender` aggiunge il confronto delle misure (`confrontaMisure`). Si perde se il cervello riparte.
- **`browser-fx.js`** è iniettato in ogni pagina di Google: disegna il mirino e l'animazione dei clic e tiene i link nella stessa scheda.
- **Avvio:**
  - `O.S.C.A.R.app`, nella radice della repository, lancia `avvia-app.sh`, che imposta `OSCAR_APP=1`: con l'HUD chiuso per circa 150 secondi, il server si spegne (più tardi se sta facendo memoria, al massimo dopo 5 minuti). I permessi di macOS vanno a O.S.C.A.R.app; dopo la rinomina macOS può richiederli di nuovo.
  - `avvia.command` è la via da Terminale. Il registro va nella finestra e i permessi al Terminale; chiudendo l'HUD il server resta acceso.
- **Per girare servono:** il comando `claude` nel PATH, la rete (`npx` scarica Playwright MCP, e al primo avvio il server scarica il modello delle mani) e `/usr/bin/swiftc`. Blender in `/Applications` (o `OSCAR_BLENDER`) serve solo a `costruisci_in_blender`: senza, lo strumento lo dice. `avvia-app.sh` e `avvia.command` lanciano `npm install` se manca `node_modules/@mediapipe/tasks-vision`. Le impostazioni stanno in `.env` (elenco commentato in `.env.example`).

## Provare
- **Riavviare.** Il kill colpisce solo il processo sulla porta di O.S.C.A.R., non altri `node` di Tony:
  ```bash
  lsof -ti tcp:4321 -sTCP:LISTEN | xargs kill
  ```
  poi:
  ```bash
  open ./O.S.C.A.R.app
  ```
  - Dopo circa 14 secondi, controlla `/api/status`.
  - Uscendo con SIGTERM, il server chiude i Chrome e il Playwright che ha lanciato lui. Con `kill -9` restano accesi, e il server successivo riusa il Chrome di Google che trova sulla porta 9333.
  - Se O.S.C.A.R. è in uso (`ascolto.log` si muove), avvisa Tony prima di riavviarlo.
- **Senza microfono:** apri `http://localhost:4321/?debug&wav=prova.wav`, e O.S.C.A.R. ascolta quel file invece del microfono.
  - Il file va in `public/`, l'unica cartella servita, e deve avere pause vere: 2 secondi prima della frase e 5 dopo.
  - Suona in loop finché la scheda resta aperta: chiudila subito dopo la prova.
  - Poi cancella il file: `*.wav` non è nel `.gitignore`, e una registrazione della voce di Tony non deve finire online.
  - Con `?debug` ci sono anche `window.oscarAsk('domanda')` e `window.oscarReport({ titolo, blocchi })`, che apre un report senza fare la ricerca. I blocchi hanno la forma dello strumento `mostra_report`.
- **HUD vero comandato da te, senza microfono né voce di Tony:**
  1. avvia il server con `OSCAR_NO_OPEN=1 node server.mjs`, che non apre finestre;
  2. apri l'HUD con lo stesso profilo e gli stessi flag di `openHud` in `server.mjs`, più `--remote-debugging-port=9556` e l'indirizzo `/?debug`;
  3. via CDP chiama `oscarAsk` o `oscarReport`, fotografa con `Page.captureScreenshot` e misura con `Page.startScreencast`.

  Alla fine chiudi quel Chrome tu: il server chiude solo quelli che ha aperto lui.
  - Per non far comparire la finestra di Google, prima del server avvia tu un Chrome headless con `--remote-debugging-port=9333` e un profilo temporaneo: il server lo trova sulla porta e lo usa. Sull'HUD di prova metti `--mute-audio`.
- **Molle:** `node prove/fisica.mjs` (un secondo, senza browser): forma esatta contro l'equazione, assestamento, rimbalzo, fotogramma lungo, cambio di meta, curva CSS.
- **Grafica, senza O.S.C.A.R. acceso:**
  - `node prove/grafica-banco.mjs [--modulo public/nucleo.js]` fa girare il modulo del nucleo in un Chrome headless sulla GPU, a 1470×956 punti e 2x.
    - Per 12 stati (quattro istanti dell'avvio, attesa, ascolto, pensiero, voce, i due allarmi, browser, angolo) misura:
      - una foto;
      - gli fps contati per secondo;
      - il costo vero a fotogramma.
    - Porte 4471 e 9571.
    - Il budget è il costo dell'umanoide di prima: 4,15 ms.
  - `node prove/hud-foto.mjs [--uscita <cartella>]` fa girare l'HUD vero con un server finto:
    - cervello a copione, voce e riconoscimento finti;
    - foto di avvio, casa, ascolto, pensiero, voce, allarmi, browser, report, ologramma e server perso;
    - controlla anche console e rete, che le schede «dato» del report si vedano e che nell'entrata del report nessun fotogramma superi 50 ms.
    - Porte 4481 e 9581, circa 2 minuti.
  - Con `?debug` ci sono anche:
    - `oscarParziale('frase')`: le parole parziali, per la scheda dell'ascolto;
    - `oscarAllarme(causa, livello, testo, ms)`.
- **Latenza del cervello:** `node prove/latenza.mjs <modello> [effort]`. Fa 8 domande a un `claude -p` sempre acceso con la persona di O.S.C.A.R., in una cartella vuota, e stampa il tempo alla prima parola per ogni turno, con mediana e massimo dal secondo. Consuma come 8 domande a O.S.C.A.R.
- **Memoria:** una prova con il cervello vero scrive nella memoria vera di O.S.C.A.R. Prima copia la cartella `memory/` del cervello, dopo confrontala e rimettila com'era. Per provare la chiusura dell'HUD senza HUD: `OSCAR_APP=1 OSCAR_NO_OPEN=1 node server.mjs`, un ciclo di `curl` su `/api/status?hud=1` ogni 5 secondi, la domanda con `curl` su `/api/ask`, poi si ferma il ciclo. Il registro scrive `[memoria] rileggo la conversazione` e, dopo un riavvio, `[cervello] riprendo la conversazione di prima`.
- **Agenda:** con `?debug`, `oscarAsk('ricordami tra due minuti di …')`. Il compito si può consultare con lo strumento `agenda` fino alla conferma dell’HUD. Le prove automatiche sono in `prove/agenda-consegna.mjs`.
- **Ologrammi:** le prove stanno in `prove/`, non vogliono O.S.C.A.R. acceso e vanno lanciate una alla volta, perché hanno porte fisse.
  - `node prove/ologramma-forme.mjs`, `ologramma-stato.mjs`, `struttura.mjs` (25 s), `ologramma-geometrie.mjs`, `gesti.mjs` e `fea/test-trave.mjs --mg 4 8`.
  - `node prove/mani-foto.mjs <cartella>`: MediaPipe vero sulla GPU, su foto vere di mani (porte 4491 e 9591). Le foto vanno in `runtime/modelli/` e si scaricano solo se mancano.
  - `node prove/salti.mjs [cartella] [tieni]`: le foto dei salti, circa 30 s. Prima `salti.mjs` in Node, poi MediaPipe vero con la foto di prova che gira di 40° ogni 200 ms, più la fotocamera finta di Chrome (porte 4493 e 9593). Con `tieni` le foto restano nella cartella, da guardare.
  - `node prove/ologramma-server.mjs <cartella>`: il server vero sulle porte 4422, 8932, 9334 e 4498, con un cervello finto, un Chrome headless suo e un Blender finto (`prove/blender-finto.mjs`, scelto con `OSCAR_BLENDER`). Dura circa 50 s.
  - `node prove/blender-vivo.mjs [--foto <cartella>] [--hud]`: Blender vero con `vivo.py`, senza server né cervello (porte 4440, 4436 e 9567). Modello con calcolo degli sforzi, modi, sezione, scheda, gesti e misure di fps e ritardo; con `--hud` anche l'HUD vero dietro, con le mani sulla foto di prova. Apre finestre vere per circa un minuto: non usare il Mac intanto.
  - Le prove con le mani vogliono `runtime/modelli/prova-mani.jpg`, che non è nella repository: è un'immagine di prova di MediaPipe, e si scarica con
    ```bash
    curl -sS --fail -o runtime/modelli/prova-mani.jpg https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/right_hands.jpg
    ```
  - Con `?debug` ci sono:
    - `oscarOlogramma(stato)`, che accende le mani come con un ologramma aperto, senza server né Blender;
    - `oscarSente('frase')`, che passa una frase al filtro dell'ascolto;
    - `__misure`, con gli fps per secondo e le misure delle mani;
    - `?debug&mani=immagine`, che usa la foto di prova al posto della fotocamera.
  - Uno O.S.C.A.R. di prova completo: `OSCAR_CERVELLO=<cartella> OSCAR_PORT=… OSCAR_BROWSER_PORT=… OSCAR_CDP_PORT=… OSCAR_NO_OPEN=1 node server.mjs`. Crea prima `<cartella>/Documents`: il server passa a `mac-mcp.mjs` solo le cartelle dei documenti che esistono, e senza Documents `costruisci_in_blender` risponde «manca la cartella di lavoro» (17/11, un giro perso). Gli strumenti si chiamano senza cervello con `node mac/mac-mcp.mjs --porta <porta>`. Con un ologramma aperto si apre Blender vero, a meno di `OSCAR_BLENDER`.
- **Blender:** `node prove/blender.mjs` (circa 10 s, senza O.S.C.A.R. né cervello) parla con `mac/mac-mcp.mjs` come il cervello. Controlla:
  - gli attrezzi e le coordinate dell'HUD nei file;
  - il rifiuto delle primitive e gli errori dello script;
  - la guardia di `mostra_ologramma` e `modifica_ologramma` sulle forme native;
  - le cinque versioni tenute;
  - la gabbia, via per via.

  Lavora in `runtime/prova-blender-<pid>` e alla fine la cancella.
- **L'oggetto vero:** `node prove/oggetto-vero.mjs` (circa 20 s, con la rete e Blender, senza O.S.C.A.R. né cervello). Parla con `mac/mac-mcp.mjs` come il cervello, con un finto `/api/ologramma` che manda una foto dell'HUD finta. Controlla:
  - i rifiuti: http, localhost, 127.0.0.1, ::1, rete di casa, porte, pagine, foto troppo grandi;
  - le anteprime vere di Wikimedia (jpg e png) che passano intatte;
  - le foto rimesse accanto a quella dell'HUD;
  - il confronto delle misure con Blender, anche fra due modelli e in scala.
- **Meteo:**
  - `node prove/meteo.mjs`: i conti su dati costruiti, senza rete, in un secondo. Con `--rete` anche Open-Meteo e RainViewer veri e il server vero sulla porta 4423, con lo strumento e un cervello e un Playwright finti.
  - `node prove/meteo-hud.mjs [cartella-foto]`: l'HUD vero headless sulla GPU, porte 4432 e 9563, circa 2 minuti e mezzo, con la rete. Fa le foto e prova il globo: la discesa sul luogo, le città vicine, il mondo intero, le texture che non crescono. Poi prova mouse, tasti e gesti e misura gli fps con le mani.
  - Il costo del globo si misura con `prove/grafica-banco.mjs --stati angolo`, su un modulo ponte messo per poco in `public/`. Il modulo chiama `createScene` di `nucleo.js`, crea `createGlobo` su un `div` fisso grande come il riquadro (364, 76, 742×604 punti) e gira `fetch('/meteo/mappa.json')` su `/m/meteo/mappa.json`.
  - Con `?debug`: `oscarMeteo()` apre la vista con gli ultimi dati del server (prima serve una `POST /api/meteo` senza origin, per esempio con `curl`), `oscarVistaMeteo()` dà `info()` e `gesto()`.
- **Schede, senza cervello:** `node prove/schede.mjs` (un paio di secondi): campi, fonti, foto finte, la guardia, e nel cervello l'ordine scheda-frase col testo a pezzetti e tutto insieme. Con `--rete` anche il server vero con un claude finto e la foto vera del Colosseo da Wikipedia (porte 4463, 8963, 9363). Nell'HUD le prova `prove/hud-foto.mjs`: tempi, voce che non aspetta, la riga, l'ologramma che resta aperto.
- **Schede col cervello vero:** `node prove/schede-cervello.mjs base|regola <uscita>`, poi `confronta <base.json> <regola.json>`. Uno O.S.C.A.R. di prova su una copia del codice (porte 4451, 8951, 9351), 10 domande con ricerche: consuma come 10 domande a O.S.C.A.R. per giro. `SCHEDE_N=1` ne fa una sola. A fine giro cancella copia, cartella e conversazione di prova.
- **Interruzioni del cervello:** `node prove/cervello-interruzioni.mjs` (circa 15 s, senza server né modello). Un claude finto non chiude mai il turno; tre domande ravvicinate lo fanno uccidere due volte, e ogni avvio deve riprendere la stessa conversazione. Poi l'impronta: stessa persona riprende, persona cambiata o file senza impronta no.
- **Voce:**
  ```bash
  curl -s -X POST localhost:4321/api/tts -H 'content-type: application/json' -d '{"text":"prova"}' -o /tmp/prova.wav
  ```

## Regole del progetto
- **Dipendenze:** in `package.json` ci sono solo three.js e `@mediapipe/tasks-vision`, fissata alla 0.10.35 perché dalla 1.0 manda statistiche a Google ogni 60 s. Node con moduli ES, nessuna build. Commenti e testi sono in italiano.
- **Commit:** in italiano. Nel titolo, `Area: cosa cambia per Tony`; nel corpo, il perché. Dopo ogni lavoro si fa commit e push su `main` della repository privata configurata come `origin`: Tony vuole tutto online per non perdere niente.
- **Fine lavoro:** prima di chiudere aggiorna la sezione **Aperto**. Togli ciò che è risolto e aggiungi ciò che resta da decidere a Tony.
- **Segreti:** `.env` e `runtime/` non vanno mai online, e una chiave non si ripete mai in chat.
- **Colori dell'HUD** (scelta di Tony del 10/11):
  - ciano dominante;
  - arancione e rosso solo per le anomalie (`S.allarme`, `.attenzione`, `.cede`, la scala degli sforzi), mai per decorare.
  - Eccezione (scelta di Tony dell'11/11): il `colore` di un pezzo dell'ologramma è il colore dell'oggetto, anche rosso o arancione, e vale solo nei modi ologramma e solido.
  - Eccezione della meteo (12/11): nel radar l'arancione parte da 38 dBZ (circa 8 mm/h con Marshall-Palmer, il «very heavy» del Met Office) e il rosso da 50 dBZ (circa 50 mm/h, «violent»), le stesse soglie degli avvisi, che sono riquadri arancioni o rossi. Il verde acqua (`--acqua`) segna il luogo e l'ora attuale.
  - Il globo (scelta di Tony del 12/11): mare `#020b14`, atmosfera blu elettrico `#00a8ff`, terre a esagoni `#00f0ff`. Sono decorazione della famiglia del ciano; nel radar valgono le soglie di sopra.
  - Un colore nuovo con un significato va scritto qui.

## Lezioni da non ripetere
- **Registri e crediti prima del codice.** La voce che saltava tra ElevenLabs e il Mac dipendeva dai crediti finiti: le frasi corte passavano, quelle lunghe no.
- **Nome vocale.** Il filtro accetta «Oscar» e la sigla puntata. Le varianti del riconoscitore si verificano con la prova HUD prima di aggiungere alias.
- **Un Chrome dimenticato continua ad ascoltare.** Un HUD di prova lasciato aperto ascolta e scrive nel registro, quindi chiudi sempre i Chrome di prova.
- **La cache di Chrome nasconde le modifiche** quando servi i file con `python3 -m http.server`. Disattivala con il comando CDP `Network.setCacheDisabled`.
- **Shader:** un NaN produce riquadri neri. Limita sempre la base di `pow` e fai i quadrati a mano. Passa i colori come uniform lineari: quelli scritti in sRGB nello shader escono grigi.
- **Voci di Siri:** non si chiamano con `say -v`. Si usano come voce di sistema, con `say` senza `-v`, e O.S.C.A.R. legge la scelta da `defaults read com.apple.Accessibility SpokenContentDefaultVoiceSelectionsByLanguage`.
- **Strumenti che chiudono le app** (`chiudi_app`): prima di provarli controlla quali istanze sono aperte. Un agente ha chiuso il Chrome personale di Tony, e `chiudi_app` risparmia solo i Chrome di O.S.C.A.R.
- **Non toccare i `chrome-headless-shell` in `~/.cache/hyperframes`:** sono di un altro strumento di Tony.
- **Il pannello del browser di Claude, se è nascosto, non fa avanzare le animazioni:** le schermate restano vecchie e le promesse `finished` non si risolvono. Per misurare un'animazione dell'HUD:
  - usa un Chrome headless tuo, con profilo in una cartella temporanea e una porta diversa da 9333;
  - rallentala con il comando CDP `Animation.setPlaybackRate`.
  - Quel comando rallenta anche il tempo passato a `requestAnimationFrame`. Non mescolarlo con `performance.now()`: la scrittura a macchina delle note restava vuota proprio per questo.
- **La latenza di un modello si misura in fila e su più turni.** Il 5/11 avevo previsto Opus 5.5 a `xhigh` tra 3 e 8 secondi, e a `low` vicino a Sonnet. Una prima misura con quattro processi in parallelo dava Opus quasi pari a Sonnet e `low` come il più lento: era rumore. Le misure una dopo l'altra, su 8 turni, hanno mostrato altro: Opus ha un fondo di circa 2 secondi a qualunque effort, e `xhigh` aggiunge pause fino a 10 secondi nei turni in cui pensa di più (più token in uscita).
- **L'effort si fissa all'inizio del turno.** Il 12/11, alzarlo a max quando il turno chiamava uno strumento non ha cambiato niente (173 token dopo lo strumento, come a low); lo stesso cambio fra due turni è passato da 114 a 2.414 token. Un effort deciso dagli strumenti usati va quindi chiesto prima del turno: da qui il `[[pensa]]`.
- **Un effort alto si misura prima di sceglierlo.** Il 12/11 avevo previsto Sonnet 5.5 a max con la prima parola in 2–4 s; misurata, 8,4 s di mediana e 21 s di massimo, perché a max pensa da 400 a 2.800 token anche su domande da una riga, dove a high ne usa 12–270. Il prezzo di un effort si legge nei token in uscita di `prove/latenza.mjs`, non nel nome del livello.
- **Douglas-Peucker su un anello chiuso lo cancella.** Il primo e l'ultimo punto coincidono, la corda è lunga zero e ogni distanza dalla retta vale 0. Fino al 12/11 `mappa.json` aveva 24 coste invece di 1.428, e nessuno se n'era accorto, perché il radar piatto mostrava solo la terraferma attorno al luogo. Su una corda nulla conta la distanza dal punto. Dopo aver rifatto un dato, si contano i pezzi.
- **Una camera spostata di centinaia di km ha la verticale ruotata.** Inclinare la camera di τ rispetto al punto guardato la sposta di d·sin τ, e la sua verticale gira dell'angolo al centro della Terra (6–7° a 150 km di raggio): l'inclinazione vera è minore. A 66° l'orizzonte non entrava lo stesso. Prima di scegliere un angolo, si fa il conto dell'orizzonte dal punto dove sta davvero la camera.
- **Un CLAUDE.md scritto a memoria sbaglia.** La prima versione di questo file, scritta da un riassunto, aveva una ventina di errori o mancanze contro il codice. Ogni affermazione nuova va controllata sul codice prima del commit.
- **Gli fps non si misurano con la mediana degli intervalli di `requestAnimationFrame`.** Con le mani diceva 59,9, mentre i fotogrammi contati in ogni secondo erano 51–55.
  - Si usa la traccia del compositore (DrawFrame contro DroppedFrame), oppure si contano i fotogrammi in ogni secondo intero, come fa ora `__misure`.
  - Servono almeno due giri, perché il carico di fondo cambia: sullo stesso codice il p10 con le mani è stato 30, poi 59,5, poi 59,9.
- **A batteria sotto il 20% Chrome dimezza gli fps:** il Risparmio energetico porta ogni pagina a 30.
  - Il flag `--disable-features=BatterySaverModeAvailable` non basta.
  - Serve la preferenza `performance_tuning.battery_saver_mode.state = 0` nel `Local State` del profilo.
- **Un profilo Chrome nuovo con l'HUD scarica il modello vocale italiano**, e intanto le misure sbagliano. Nelle prove di prestazioni il riconoscimento va spento.
- **three.js: un `Box3` vuoto vale ±Infinity.** Un NaN finito nella camera ci resta per sempre, perché un lerp da NaN dà NaN: l'ingombro si controlla prima di usarlo.
- **Un limite scritto senza misurarlo era falso.** Il commento di `TRIANGOLI_MAX` prometteva 45 fps con 2 milioni di triangoli; misurati con le mani, erano 33. Lo stesso per un minimo trovato su poche sequenze: «due lanci ad almeno 667 ms» era il minimo delle prove, e una scansione più larga ne ha trovati a 567.
- **Un numero preso da un altro contesto non è il «prima».** L'11/11 l'attesa con la ricerca (109–262 s) era stata confrontata con i circa 50 s di una domanda vera del 10/11, fatta a metà conversazione. Sullo stesso banco il codice vecchio dava 80 s. Prima e dopo si misurano con lo stesso banco, la stessa domanda e lo stesso avvio.
- **Strumenti col nome nudo confondono il cervello.** Con WebSearch e WebFetch, che hanno il nome nudo, il cervello ha chiamato `mostra_ologramma` senza `mcp__mac__` 3 volte su 3, e mai prima. Riceveva «No such tool available» e riscriveva il modello: da 22 a 56 s persi. Ora la prima riga della sezione Ologrammi della persona scrive i nomi interi: nessun errore in due corse, una di prova e una vera. È successo di nuovo il 16/11 con `costruisci_in_blender` (due chiamate perse), nonostante il nome intero nella persona: ora anche le descrizioni degli strumenti e le istruzioni di `mac-mcp.mjs` scrivono i nomi interi. Non riprovato.
- **Un filtro che scarta dati si prova prima sui dati normali, dove non deve cambiare niente.** Il 17/11 il filtro dei salti dell'indice è stato provato solo sul difetto che avevo costruito io (una mano ferma con un balzo) e dava 0 contro 0,051: perfetto. Sulle mani vere di Tony, la sera stessa, era peggio di prima. La prova giusta sono mani che si muovono, inclinate e col rumore vero, col filtro e senza; e il «prima» vero viene dalla riga «mani accese», non dalla mia sequenza.
- **Una prova che ricopia una formula del codice mente quando la formula cambia.** Gli 80,5 ms di ritardo del cursore dell'11/11 venivano dalla mappa lineare ricopiata nella prova, contro la mappa a S del codice; il ritardo vero era 23,5 ms. Ora l'atteso si calcola con `mappa()` importata da `gesti.js`.
- **Un criterio largo nasconde gli errori sistematici.** L'errore di volume del cavo era −0,6%, cioè 10σ, e passava la soglia dell'1%. L'ha preso solo il controllo «errore ≤ 4σ».
- **Cercando i processi di una prova per argomento si trova anche la shell che l'ha lanciata**, perché nei suoi argomenti ci sono la cartella e le porte. Vanno esclusi tutti gli antenati, non solo il genitore. Il 17/11 non è bastato: con la cartella scritta nel comando della shell di Claude, `prove/ologramma-server.mjs` dava 123 su 124, e il resto era quella shell. Senza la cartella (presa da `os.tmpdir()`) dava 124 su 124.
- **Prima di una prova col cervello vero: `claude auth status` e una domanda secca a `claude -p`, con `env -i HOME="$HOME" USER="$USER" PATH=…`.** La shell di una sessione dell'app eredita le sue variabili (`ANTHROPIC_BASE_URL`, `CLAUDE_CODE_*`), quindi un O.S.C.A.R. di prova si lancia con `env -i`, ma **con `USER`**: senza, la CLI non trova la credenziale nel portachiavi, dice `loggedIn: false` e il cervello risponde «Ho perso il filo» in 0,1 s (provato il 22/11). O.S.C.A.R.app, avviato dal Finder, ha `USER`. Il 17/11 sera lo stesso sintomo era stato preso per una login scaduta: quasi certamente era questo. Una login scaduta davvero si rifà con `claude auth login`, nel terminale di Tony.
- **Il prompt di sistema si congela al primo messaggio.** Con `--resume` Claude Code riusa il prompt registrato all'inizio della conversazione, persona compresa (22/11). Per provare una persona nuova serve una conversazione nuova; il server lo fa da solo con l'impronta.
- **La latenza della voce si misura su tutta la catena.** Il 22/11 avevo previsto Haiku più svelto di Sonnet alla prima parola: erano uguali, 0,6 s. Il tempo stava altrove: 0,7–0,8 s di attesa dopo la frase, e `say` che costava 0,8–1,4 s a frase. Prima di cambiare un pezzo per la velocità, si misurano tutti.
- **Un agente fermato dal limite di utilizzo lascia accesi i suoi O.S.C.A.R. di prova**, con i loro Chrome e Playwright. È successo due volte, per tre ore e per tre ore e mezza. Alla ripresa si cercano con `lsof` sulle porte di prova e con `ps` sui profili della scratchpad.
- **In Chrome headless `--window-size` non è la pagina.** Con 1470×956 la pagina è alta 813 punti: il 12/11 una prova delle mani convertiva le coordinate con 956 e il pizzico sulla timeline finiva sopra. Lo schermo di Tony si impone con `Emulation.setDeviceMetricsOverride` (`prove/meteo-hud.mjs`) o ridimensionando la finestra (`prove/ologramma-hud.mjs`), e si controlla `innerHeight`.
- **Due messaggi con lo stesso nome si confondono.** Il 22/11 il gesto delle mani `{tipo:'stato'}` e il messaggio che porta il modello a Blender si chiamavano uguali: il Blender finto della prova si è fermato, e il server l'ha preso per chiuso da Tony. Ora il modello viaggia come `{tipo:'ologramma'}`. In un canale, i tipi dei messaggi vanno controllati tutti insieme, non uno per volta.
- **In Blender 5.2 i piani di taglio scritti da Python non tagliano.** `region_3d.clip_planes` e `use_clip_planes` cambiano, ma il disegno resta intero (provato il 22/11 su un cubo). Tagliano solo dopo aver acceso il taglio a riquadro di Blender (`view3d.clip_border`), e allora si possono sostituire i suoi piani. In 5.2 il modo che colora i vertici si chiama `VERTEX`, non `ATTRIBUTE`.
- **Una prova di regressione si lancia prima sul codice vecchio, e deve fallire.** Il 17/11 la prova della rivoluzione chiusa sull'asse chiamava `oggetto(..., 0)`, cioè senza il raccordo che produce il NaN, e passava anche sul codice rotto. Si scrive con gli argomenti dell'uso vero, compresi i default.
- **In Chrome `gl.finish()` non aspetta la GPU.** Il 10/11 dava 0,1 ms a fotogramma per l'umanoide col bagliore a 2205×1434. Il costo vero si misura con n fotogrammi di fila e un solo `readPixels` alla fine, che deve restituire pixel veri: 4,15 ms, con tre giri uguali entro l'1%.
- **L'eco si filtra su tutta la risposta, e storpiata.** Il 27/11 sera O.S.C.A.R. si fermava da solo mentre parlava (tre «fermato a voce» in due minuti). Il filtro ricordava le ultime 4 frasi per 6 s, ma il riconoscitore, mentre la voce va avanti senza pause, trascrive il discorso dall'inizio, e storpia («fermato» → «fermati»). Il primo stop era un «mi basta così» di Tony; poi O.S.C.A.R., spiegando perché si era fermato, ha citato «aspetta» e «basta» e si è fermato di nuovo, a catena. Opus, con risposte più lunghe, lo fa uscire più spesso. Ora `echoWords` tiene tutta la risposta in corso e `dettaDaLui` scarta anche le parole a una lettera da una detta da lui (dalle 4 lettere in su). Il prezzo: un «basta» di Tony mentre O.S.C.A.R. dice «pasta» non lo ferma; «stop», il nome ed Esc sì. `prove/hud-foto.mjs` lo prova, e falliva sul codice di prima. Il primo «basta» di Tony, che rispondeva a «o ti basta così?», resta uno stop: è ambiguo davvero.
- **Una soglia di latenza si sceglie sopra il rumore del banco.** Il 27/11 la prova delle schede chiedeva la prima parola entro 0,1 s, ma la stessa domanda fatta due volte varia di ±0,4 s: con 10 coppie la soglia non poteva distinguere niente, ed è fallita (+0,19 s) senza un effetto vero (+0,01 s a coppie). Prima si misura il rumore, poi si confronta a coppie con abbastanza domande.
- **Una classe CSS con un nome comune, usata in due posti, si pesta.** Dal 10/11 al 27/11 le schede «dato» del report non si sono mai viste: avevano la classe `dato`, la stessa delle scritte attorno al nucleo, e la regola che col report spegne le scritte (con `position: fixed` in più) spegneva anche loro. Le foto la mostravano come un buco nella griglia, e nessuno l'aveva contato. Una prova ora conta le schede.
- **Un sistema senza richiamo per un suo modo deriva.** La corda dell'HUD (27/11) senza la tensione del cerchio: la spinta della voce ha la media positiva, e l'allargamento uniforme cresceva senza fine. Prima di tarare una forza, si simula a parte il sistema per qualche secondo e si guarda il massimo.
- **Un Chrome nascosto non disegna** (27/11, Chrome 158). Nascosta l'app o ridotta la finestra nel Dock, la pagina diventa «hidden» anche con `--disable-backgrounding-occluded-windows`, che vale solo per le finestre coperte: `requestAnimationFrame` si ferma e lo screencast scende a 0–1 fotogrammi al secondo. Si fermano anche i clic di Playwright, che aspettano i fotogrammi. Le altre vie:
  - `open -j -g`: Chrome si mostra e si attiva lo stesso;
  - fuori dallo schermo (`--window-position` o CDP): Chrome riporta la finestra dentro uno schermo;
  - headless: Google risponde «traffico insolito» alla prima ricerca.

  Una finestra che deve disegnare senza farsi vedere si mette dietro uno schermo intero.
