# STEM

![STEM](public/icona.png)

Assistente vocale stile JARVIS: ragiona col tuo `~/.claude/CLAUDE.md`, parla con voce ElevenLabs e naviga su Google mostrandoti ogni clic.

## Avvio
- **App STEM:** doppio clic su `STEM.app` (o cercala con Spotlight; trascinala nel Dock per averla sempre a portata). Si apre l'HUD a schermo intero. Se STEM è già acceso, riapre solo l'HUD. Quando chiudi l'HUD (Cmd+Q), STEM si spegne da solo entro un paio di minuti.
- **Da Terminale:** `./avvia.command`, utile anche la prima volta per inserire la chiave ElevenLabs. Ctrl-C o chiudere la finestra spegne tutto.
- La prima volta: `npm install` lo fanno da soli entrambi; serve Google Chrome e Claude Code col tuo login.

## Uso
- **Parlare:** tieni premuta la barra spaziatrice o il tasto del mouse, oppure di' «Stem» seguito dalla domanda ("Stem, che tempo fa a Roma?"). Se dici solo «Stem», ti aspetta per 8 secondi. Spazio mentre parla lo interrompe; `Esc` annulla tutto.
- **In attesa** l'anello attorno alla testa si muove quando parli: se non si muove, STEM non ti sente (permesso del microfono o microfono sbagliato).
- **Browser:** quando STEM naviga, la pagina compare dentro l'HUD, a destra, e la testa si sposta a sinistra. Vedi il mirino che vola dove clicca, l'aggancio e l'onda d'urto del clic, la cornice sui campi in cui scrive. Lavora sempre in una sola pagina dello stesso Chrome (profilo separato in `runtime/browser-profile`). La finestra vera di quel Chrome sta dietro all'HUD: scorri tra le scrivanie per usarla, per esempio per accedere a Google. Non usarci account delicati (banca, email di lavoro): quel Chrome è comandabile da altri programmi del Mac tramite la porta di debug 9333.
- **Privacy:** l'ascolto continuo di «Stem» usa il riconoscimento vocale locale di Chrome, quindi l'audio della stanza non esce dal Mac. Al primo avvio Chrome scarica il modello italiano (circa 30 secondi, l'HUD mostra "Installo…"). Il push-to-talk usa il riconoscimento di Google, più preciso, perché lo avvii tu. In `runtime/ascolto.log` STEM annota solo se ha riconosciuto «Stem» e, quando no, la prima parola sentita: serve a capire come il riconoscitore scrive il tuo «Stem».
- **File del Mac:** STEM legge, cerca, crea e modifica file in Scrivania, Documenti, Download, Immagini, Filmati, Musica e iCloud Drive (anche PDF e immagini). Prima di modificare un file esistente ti dice cosa cambia e aspetta il tuo sì. Il resto del Mac gli è chiuso: file nascosti (`.ssh`, `.config`…), Libreria (portachiavi, cookie) e la cartella di STEM. Non ha il Terminale, quindi non cancella né sposta file. La prima volta che tocca Scrivania, Documenti o Download, macOS ti chiede il permesso per "STEM": rispondi Consenti. Le cartelle si cambiano in `FILE_DIRS` dentro `server.mjs`.
- **Coscienza:** il carattere (voce, tono, freni) sta in `stem-persona.md`; il modo di ragionare è il tuo CLAUDE.md, riletto a ogni domanda.
- **Voce:** la chiave ElevenLabs va in `.env` (mai nella repository). Senza chiave, o finiti i caratteri del mese, usa la voce di sistema italiana.
- **Nuova conversazione:** riavvia STEM.

## Come funziona
`server.mjs` fa girare Claude Code in modalità headless (usa il tuo login, nessuna chiave Anthropic), con il solo strumento browser: Playwright, collegato via CDP a un Chrome dedicato che resta aperto. Lo stesso Chrome manda la pagina all'HUD come video (screencast), e `browser-fx.js`, caricato in ogni pagina, disegna l'animazione dei clic. Ogni frase che Claude scrive diventa audio ElevenLabs mentre lui continua a lavorare. Il server accetta comandi solo dall'HUD, non da altre pagine web.

Prove senza microfono: apri `http://localhost:4321/?debug&wav=file.wav` e «Stem» ascolta il file invece del microfono.

Modello 3D della testa: "Infinite, 3D Head Scan" di Lee Perry-Smith, licenza CC BY 3.0 (`public/models/LeePerrySmith_License.txt`).
