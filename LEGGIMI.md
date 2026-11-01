# STEM

![STEM](public/icona.png)

Assistente vocale stile JARVIS per il Mac: ragiona col tuo `~/.claude/CLAUDE.md`, ascolta sempre, parla con voce ElevenLabs, naviga su Google, usa le app e lo schermo al posto tuo.

## Avvio
- **App STEM:** doppio clic su `STEM.app` (o Spotlight, o trascinala nel Dock). Si apre l'HUD a schermo intero: il busto si assembla dalle particelle, poi si svelano le montagne. Se STEM è già acceso, riapre solo l'HUD. Quando chiudi l'HUD (Cmd+Q), STEM si spegne da solo entro un paio di minuti.
- **Da Terminale:** `./avvia.command`, utile anche la prima volta per inserire la chiave ElevenLabs. Ctrl-C o chiudere la finestra spegne tutto.

## Parlare con STEM
- **Sempre in ascolto**, senza tasti: STEM capisce da solo quando parli con lui. Una frase è per lui se:
  - contiene il suo nome (anche storpiato dal riconoscitore);
  - arriva entro 25 secondi dalla sua ultima risposta, cioè siete in conversazione;
  - comincia con un comando ("apri…", "cerca…", "dimmi…", "puoi…").

  Se una frase non era per lui, il cervello risponde `[ignora]` e tace.
- **Più rapido:** il cervello è un processo Claude Code sempre acceso, quindi la prima frase arriva in circa 2 secondi. Se fai una pausa a metà di una richiesta, STEM parte già e, se poi continui, riparte con la frase completa.
- **Interromperlo:** mentre parla di' "stop", "basta" o "aspetta", oppure chiamalo per nome. `Esc` lo zittisce.
- **Privacy:** l'ascolto usa il riconoscimento vocale locale di Chrome: l'audio della stanza non esce dal Mac. In `runtime/ascolto.log` STEM annota solo se una frase era per lui e la prima parola di quelle scartate, per capire come il riconoscitore ti sente.

## Cosa fa
- **Browser:** lavora su Google in un Chrome suo, sempre nella stessa pagina. Il pannello compare nell'HUD **solo per i compiti complessi** (ricerche lunghe, creazioni); le cose banali le fa in silenzio e ti dice il risultato.
- **GIF ed esempi:** quando spiega, mostra accanto alla testa animazioni da Wikimedia Commons (per esempio un motore a quattro tempi); per le GIF simpatiche serve una chiave gratuita GIPHY in `.env` (`GIPHY_API_KEY`, da developers.giphy.com).
- **Il Mac:** apre e chiude app, guarda lo schermo, clicca, scrive e usa la tastiera (strumenti in `mac/`). Per le azioni normali procede da solo; prima di inviare, cancellare, comprare, pubblicare, cambiare impostazioni o installare chiede il tuo sì. Non scrive mai nei campi password. Serve il permesso in Impostazioni di Sistema → Privacy e sicurezza: **Accessibilità** e **Registrazione schermo e audio di sistema** per l'app che lo avvia (STEM o il Terminale).
- **File:** legge, crea e modifica in Scrivania, Documenti, Download, Immagini, Filmati, Musica e iCloud Drive; il resto del Mac (file nascosti, Libreria, cartella di STEM) gli è chiuso.

## La voce
- ElevenLabs con il modello `eleven_v4_turbo` (il più espressivo e veloce, mezzo credito a carattere). Ogni risposta usa **una sola voce** dall'inizio alla fine.
- Quando i crediti finiscono STEM passa alla voce del Mac per tutta la risposta, e torna a ElevenLabs da solo quando si rinnovano. Con il piano gratuito (10.000 caratteri al mese) bastano poche decine di risposte.
- La voce del Mac migliore è **Luca (Avanzata)**: Impostazioni di Sistema → Accessibilità → Contenuti letti → Voce di sistema → Gestisci voci → Italiano.

## Come funziona
- `server.mjs`: avvio, finestre, pannello del browser (screencast), voce e cervello.
- `brain.mjs`: un processo Claude Code sempre acceso (stream-json), interrotto quando arriva una domanda nuova.
- `voice.mjs`: ElevenLabs o Mac, uno per risposta.
- `media.mjs`: GIF e animazioni.
- `public/`: l'HUD (`humanoid.js` per la grafica, `sfx.js` per i suoni sintetizzati, `stem.js` per ascolto e logica).
- `mac/`: controllo del Mac (server MCP + aiutante Swift).
- `stem-persona.md`: il carattere. STEM ha una memoria sua, separata dalla repository.

Prove senza microfono: `http://localhost:4321/?debug&wav=file.wav` fa ascoltare un file a STEM.
