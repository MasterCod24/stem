# STEM: appunti per chi ci lavora

STEM è l'assistente vocale di Tony sul Mac, stile JARVIS. È sempre in ascolto, parla con voce ElevenLabs o con quella del Mac, mostra un HUD a schermo intero e usa Google, le app e lo schermo al posto suo. Quello che fa, visto da Tony, sta in [LEGGIMI.md](LEGGIMI.md); qui c'è quello che serve per lavorarci.

## Ripartire da dove eravamo
1. **Cosa è stato fatto:** `git log --oneline -10`. Ogni commit dice nel titolo cosa è cambiato per Tony e nel corpo il perché.
2. **Lavoro lasciato a metà:** `git status`. File non committati vogliono dire che una sessione si è interrotta prima di chiudere.
3. **Lo stato vivo** non è scritto qui, perché invecchierebbe: si guarda.
   - `curl -s localhost:4321/api/status`: se non stampa niente, STEM è spento. Da acceso risponde `{"voice":{"provider":"eleven"|"mac","credits":…,"mac":"voce del Mac"},"browser":…,"gifs":…}`.
     - `provider` dice quale voce useranno le prossime risposte.
     - `browser` dice che Playwright è pronto, non che la finestra di Google sia aperta.
   - `tail -50 runtime/server.log` mostra server, cervello e voce. Le righe non hanno l'ora: gli avvii si separano dalle righe «STEM online». Il file si riempie solo se STEM è partito da `STEM.app`.
   - `tail -50 runtime/ascolto.log` dice di che tipo era ogni frase sentita: per STEM (nome, conversazione, comando, saluto), scartata, eco. Le frasi non ci sono mai, per privacy. Delle frasi scartate annota solo la prima parola e quella più simile a «stem». Tiene le ultime 300 righe.
4. **Cosa resta aperto:** la sezione qui sotto.

## Aperto (al 1/11/2026)
Restano decisioni di Tony, non lavoro sul codice:
- **Crediti ElevenLabs a zero fino al 19/11/2026 alle 05:19.** È il piano gratuito: 10.000 crediti al mese, e non se ne comprano altri a parte. Intanto STEM parla con la voce di sistema, oggi Siri Paolo. Se Tony passa a un piano a pagamento, STEM sceglie da solo la prima voce maschile italiana del suo account.
- **`GIPHY_API_KEY` assente:** `[gif: …]` non mostra niente, mentre le animazioni `[anim: …]` di Wikimedia funzionano.
- **Mai provati:** come suona `eleven_v4_turbo` (servono crediti) e le prestazioni dell'HUD nelle sessioni lunghe.
- **Report a schermo intero, mai provato con una ricerca vera** (aggiunto il 1/11). L'animazione è stata misurata in un Chrome headless con dati finti: il report si assembla in circa 2 s e i video di YouTube partono da localhost. Restano da vedere sull'HUD vero:
  - se il cervello chiama `mostra_report` da solo e con dati buoni (immagini con indirizzo diretto, link di YouTube veri);
  - la fluidità delle sfocature sopra la grafica WebGL.

## Come è fatto
- **`server.mjs`** avvia e collega tutto:
  - HUD e API su `127.0.0.1:4321`. Accetta solo l'Host `localhost:4321` o `127.0.0.1:4321`; le POST richiedono `content-type: application/json` e un'origine locale, o nessuna.
  - un Chrome per Google con il suo profilo (`runtime/browser-profile`, CDP 9333);
  - Playwright MCP 0.0.83 sulla porta 8931, agganciato a quel Chrome, perché un browser lanciato da Playwright verrebbe chiuso alla fine di ogni risposta. Le schede nuove il server le chiude e ne apre l'indirizzo nella pagina principale;
  - lo screencast CDP mandato all'HUD come MJPEG su `/api/screen`;
  - l'HUD stesso, un Chrome `--app` a schermo intero con il profilo `runtime/hud-profile`.
- **`brain.mjs`** è il cervello: un solo `claude -p` in stream-json, sempre acceso. Il modello è `sonnet`, scelto con `STEM_MODEL`.
  - **Cosa può fare** (flag in `server.mjs`): `Read`, `Write`, `Edit`, `Glob` e `Grep`, ma non `Bash`. I file sono solo quelli delle cartelle dei documenti (`--add-dir`), e come MCP ha solo `playwright` e `mac`. Non ci sono domande di permesso: è approvato quello che sta dentro le cartelle, il resto è negato.
  - **Dove vive:** il suo `cwd` è `~/Library/Application Support/STEM/cervello`, fuori dalla repository. La sua memoria è quella di Claude Code per quella cartella: `~/.claude/projects/-Users-tony-Library-Application-Support-STEM-cervello/memory/`. Lì STEM scrive da solo. `runtime/cervello` e `~/.claude/projects/-Users-tony-STEM-runtime-cervello` sono avanzi del vecchio `cwd`, usato fino al 1/11.
  - **Interruzioni:** una domanda nuova interrompe quella in corso con un `control_request` di tipo interrupt; se il turno non si chiude entro 4 secondi, il processo viene ucciso e rilanciato. Se muore, riparte con `--resume` sulla stessa sessione, mentre `/api/reset` lo fa ripartire da zero.
  - **Marcatori nella risposta:** `[ignora]` vale solo prima che STEM abbia detto qualcosa. `[[mostra]]` apre il pannello del browser, che comunque si apre da solo alla quarta azione su Google. Poi ci sono `[gif: …]` e `[anim: …]`.
  - **Report:** il cervello chiama lo strumento `mostra_report` di `mac/mac-mcp.mjs`, che risponde e basta. È `brain.mjs` a leggere i blocchi dalla chiamata nel flusso e a mandarli all'HUD come evento `report`. Zero blocchi lo chiudono, come `Esc` e come un `[[mostra]]` nuovo.
- **`stem-persona.md`** è il carattere di STEM, passato con `--append-system-prompt`. Il modo di ragionare è il `~/.claude/CLAUDE.md` di Tony, che Claude Code carica da solo. **Questo file non arriva a STEM:** per cambiare come risponde si modifica `stem-persona.md` e **si riavvia il server**, che lo legge una volta sola (`/api/reset` non basta).
- **`voice.mjs`** fa parlare STEM con ElevenLabs (`eleven_v4_turbo`, scelto con `ELEVENLABS_MODEL`) o con `say`. Il fornitore si decide alla prima frase di ogni risposta: ElevenLabs solo se i crediti sono almeno 400, o non ancora letti.
  - Se ElevenLabs fallisce alla prima frase, tutta la risposta passa al Mac (`x-stem-voce: mac;cambio`).
  - Se fallisce dopo aver già parlato, la frase si salta invece di cambiare voce.
  - La voce del Mac è quella di sistema, se italiana, anche Siri, letta da `defaults`. `STEM_MAC_VOICE` la scavalca.
- **`media.mjs`** cerca le immagini: `[gif: …]` su GIPHY (senza chiave non trova niente), `[anim: …]` su Wikimedia Commons.
- **`public/`** è l'HUD:
  - `stem.js`: ascolto sempre acceso, decide se una frase è per STEM, coda audio;
  - `report.js`: il report a schermo intero, ricalcato sui secondi 34–46 del video di ROSE. È una griglia 12×6; le ultime due colonne delle ultime due righe restano alla testa, che ci scivola rimpicciolita (`S.dock` in `humanoid.js`). I blocchi entrano in quattro tempi: un lampo di copie in profondità (0–0,8 s), il primo video (0,4–0,9 s), gli altri uno alla volta (fino a circa 2 s), poi partono i video. I blocchi in più si impilano e cambiano ogni 9 s. Il testo del cervello entra solo con `textContent`, le immagini solo da `https`, i video solo come ID di YouTube;
  - `humanoid.js` e `mountains.js`: grafica (three.js 0.160 con bloom);
  - `sfx.js`: suoni sintetizzati.
  - `lab-sfx.html` prova i suoni. `lab.html` prova la grafica, ma funziona solo servendo la radice della repository (per esempio `python3 -m http.server` in `~/STEM`, poi `/public/lab.html`), non da `localhost:4321`.
- **`mac/`** controlla il Mac: un server MCP su stdio senza pacchetti, più un aiutante Swift che si compila da solo in `runtime/stem-mac` quando `helper.swift` cambia. I dettagli stanno in `mac/LEGGIMI-mac.md`.
- **`browser-fx.js`** è iniettato in ogni pagina di Google: disegna il mirino e l'animazione dei clic e tiene i link nella stessa scheda.
- **Avvio:**
  - `STEM.app`, nella radice della repository, lancia `avvia-app.sh`, che imposta `STEM_APP=1`: con l'HUD chiuso per circa 150 secondi, il server si spegne. I permessi di macOS vanno a STEM.app; Accessibilità e Registrazione schermo sono stati dati il 1/11.
  - `avvia.command` è la via da Terminale. Chiede la chiave finché `.env` non ne ha una valida. Il registro va nella finestra e i permessi al Terminale; chiudendo l'HUD il server resta acceso.
- **Per girare servono:** il comando `claude` nel PATH, la rete (`npx` scarica Playwright MCP) e `/usr/bin/swiftc`. Le impostazioni stanno in `.env` (elenco commentato in `.env.example`); `ELEVENLABS_VOICE_ID`, se è pieno, blocca la scelta automatica della voce.

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
- **Voce:**
  ```bash
  curl -s -X POST localhost:4321/api/tts -H 'content-type: application/json' -d '{"text":"prova","answer":"prova-1"}' -o /tmp/prova.audio -D -
  ```
  - L'intestazione `x-stem-voce` dice chi ha parlato.
  - Cambia `answer` a ogni prova, perché il fornitore resta fisso per risposta.
  - Con ElevenLabs consuma crediti.

## Regole del progetto
- **Dipendenze:** in `package.json` c'è solo three.js. Node con moduli ES, nessuna build. Commenti e testi sono in italiano.
- **Commit:** in italiano. Nel titolo, `Area: cosa cambia per Tony`; nel corpo, il perché. Dopo ogni lavoro si fa commit e push su `main` della repository privata MasterCod24/stem: Tony vuole tutto online per non perdere niente.
- **Fine lavoro:** prima di chiudere aggiorna la sezione **Aperto**. Togli ciò che è risolto e aggiungi ciò che resta da decidere a Tony.
- **Segreti:** `.env` (con la chiave ElevenLabs) e `runtime/` non vanno mai online, e la chiave non si ripete mai in chat.

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
- **Un CLAUDE.md scritto a memoria sbaglia.** La prima versione di questo file, scritta da un riassunto, aveva una ventina di errori o mancanze contro il codice. Ogni affermazione nuova va controllata sul codice prima del commit.
