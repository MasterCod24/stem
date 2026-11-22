# O.S.C.A.R. — controllo del Mac

`mac-mcp.mjs` è un server MCP su stdio (JSON-RPC, un messaggio per riga, senza pacchetti npm). Le azioni native le fa
`runtime/oscar-mac`, compilato da solo con `/usr/bin/swiftc` da `helper.swift` quando manca o è più vecchio del sorgente
(circa 4 s, una volta sola).

Si aggancia a `claude -p` così:

```json
{ "mcpServers": { "mac": { "command": "node", "args": ["/percorso/del/progetto/mac/mac-mcp.mjs", "--porta", "4321"] } } }
```

con `--allowedTools mcp__mac` (gli strumenti diventano `mcp__mac__<nome>`). `--porta` è la porta di `server.mjs`, che serve
agli strumenti degli ologrammi: `server.mjs` la scrive da solo in `mcp.json`, perché `.env` non arriva ai processi figli.
Senza `--porta` vale 4321; una porta non valida non ripiega sulla 4321, così una prova non finisce sul O.S.C.A.R. vero.

## Strumenti

| nome | cosa fa |
|---|---|
| `schermo` | fotografa lo schermo principale (al massimo 1440 px e circa 1,15 Mpx, così il modello non la riduce ancora); regione facoltativa per ingrandire |
| `clic`, `muovi`, `trascina`, `scorri` | mouse; coordinate in **pixel dell'ultima schermata** (la conversione in punti è in `runtime/schermo-ultimo.json`, quindi vale anche tra una domanda e l'altra) |
| `scrivi` | testo Unicode; `app` facoltativo = scrive solo se davanti c'è quell'app |
| `tasti` | `cmd+s`, `cmd+shift+4`, `return`, `esc`, `tab`, frecce…; segue la disposizione di tastiera attuale (italiana) |
| `apri_app`, `chiudi_app` | nome approssimato, in italiano o in inglese («calcolatrice», «chat gpt»); chiusura sempre gentile, come cmd+Q |
| `app_aperte`, `app_installate` | elenchi |
| `permessi` | stato dei permessi, quale app li riceve; `apri` apre il pannello delle Impostazioni |
| `mostra_report` | il report a schermo intero nell'HUD; lo strumento risponde e basta, i blocchi li legge `brain.mjs` dalla chiamata |
| `ricorda` | segna un compito in `runtime/agenda.sqlite` con `tra_minuti` oppure `alle` («18:00», o «2026-11-07T08:30»); a batteria aggiunge l'avviso che il Mac può andare in stop |
| `agenda` | elenca i compiti; `togli` li cancella per numero. All'ora giusta li consegna `server.mjs` (vedi `agenda.mjs`) |
| `mostra_ologramma` | apre nell'HUD un ologramma 3D fatto di pezzi con misure in mm (forme, materiali, carichi e vincoli come in `public/ologramma/LEGGIMI-ologramma.md`); ogni pezzo può portare `materiale_vero` e `fattura` da una ricerca, e la risposta elenca i pezzi a cui mancano; `colore` («#e53935») colora il pezzo nei modi ologramma e solido |
| `modifica_ologramma` | cambia pezzi, vista, carichi, vincoli, titolo e descrizione; `chiudi` lo chiude; senza campi dice com'è adesso |
| `analizza_struttura` | calcola gli sforzi e aspetta il risultato fino a 60 s |
| `guarda_oggetto_vero` | prima di costruire un oggetto che esiste: scarica 1–3 foto vere (`fuori`, `dentro`) e fissa le misure ufficiali. Solo https verso indirizzi pubblici; le foto non si aprono sul Mac: tipo e misure dai primi byte, al massimo 2000 px per lato e 3,5 MB, se no l'errore dice di prendere l'anteprima. `mostra_ologramma` le rimette dopo la foto dell'HUD («fuori» alla prima vista, «dentro» con `modo` raggi-x o una sezione); `costruisci_in_blender` confronta l'ingombro con le misure, lato per lato dal più lungo |
| `costruisci_in_blender` | esegue uno script Python del cervello in Blender, in background e dentro una gabbia di `sandbox-exec`, con gli attrezzi di `blender/aiuti.py` già pronti; esporta un GLB per oggetto in `Documents/OSCAR-Blender/<nome>/v<n>/` e risponde con percorsi, triangoli, quadrilateri e ingombri. Rifiuta `bpy.ops.mesh.primitive_*` e `bmesh.ops.create_*` (regola di Tony del 16/11) |

I tre strumenti degli ologrammi sono client sottili: mandano `POST /api/ologramma` a `server.mjs`, che tiene lo stato,
valida e scrive il testo, e restituiscono quel testo più la foto PNG che l'HUD ha scattato, se c'è. Gli errori del server
arrivano al cervello così come sono. Hanno una coda loro, così un calcolo di un minuto non ferma mouse e tastiera, e «stop»
annulla anche la loro attesa.

`mostra_ologramma` e `modifica_ologramma` (in «aggiungi», e in «cambia» quando cambia la forma) rifiutano i pezzi con una
forma nativa, tranne `file`, `cavo` e quelli con `calcolo: true`: dal 16/11 gli ologrammi si fanno in Blender, e le forme
native restano per i flussi dei cavi e per gli sforzi. Era una riga della persona, e alla prima domanda il cervello l'ha
saltata: un turbofan di 61 forme native.

`costruisci_in_blender` sta nella stessa coda. Lo script del cervello è Python libero, quindi Blender (`-b --factory-startup`,
`gabbia.py`) parte dentro una gabbia scritta al momento:
- niente rete, nemmeno localhost;
- niente Apple Events e nessun altro programma;
- nessuna lettura in `/Users`, `/Volumes` e nelle cartelle temporanee, tranne la cartella della versione e `mac/blender/`;
- scritture solo nella cartella della versione, con `TMPDIR` dentro.

`prove/blender.mjs` controlla ognuna di queste vie (circa 10 s). Le versioni tenute sono le ultime 5; dopo 90 s Blender si ferma.
La cartella arriva da `mcp.json` (`--blender`), perché sta sotto Documenti del O.S.C.A.R. vero o di quello di prova, e l'HUD apre
i file solo da lì. Lo stesso GLB può fare più pezzi «file» con rotazioni diverse: le 18 pale di una ventola sono un file solo.

## Permessi

Servono **Accessibilità** (mouse e tastiera) e **Registrazione schermo e audio di sistema** (schermo), in
Impostazioni di Sistema → Privacy e sicurezza. Li riceve l'app da cui parte O.S.C.A.R., non `oscar-mac`: «O.S.C.A.R.» se lo avvii da
O.S.C.A.R.app, «Terminale» se da `avvia.command`. Lo strumento `permessi` dice quale app è, e se manca qualcosa ogni strumento
risponde con il pannello da aprire invece di fallire in silenzio. Ricompilare l'aiutante non fa perdere i permessi.

## Limiti voluti

- Mai nei campi password: `scrivi` e `tasti` (caratteri e cmd+v) rifiutano se l'inserimento sicuro della tastiera è
  attivo o se il campo selezionato è `AXSecureTextField`.
- Niente tastiera in terminali, Script Editor e gestori di password (elenco `NO_TYPING` in `mac-mcp.mjs`): è la stessa
  regola «Niente Terminale» di `server.mjs`, e impedisce che una pagina web faccia digitare comandi a O.S.C.A.R.
- Niente AppleScript come strumento, niente stringhe passate alla shell: solo `execFile` con argomenti separati.
- `chiudi_app` non tocca i Chrome di O.S.C.A.R. (profilo dentro `runtime/`). Tutti gli altri, compreso il Chrome di Tony, li chiude se glielo chiedi.

## Prova a mano

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"permessi","arguments":{}}}' | node mac/mac-mcp.mjs
```

Con `"name":"ricorda","arguments":{"cosa":"Prova","tra_minuti":2}` il compito finisce in `runtime/agenda.sqlite`, e un O.S.C.A.R. acceso lo dirà davvero: toglilo dopo, con `agenda` e `togli`.
