# STEM — controllo del Mac

`mac-mcp.mjs` è un server MCP su stdio (JSON-RPC, un messaggio per riga, senza pacchetti npm). Le azioni native le fa
`runtime/stem-mac`, compilato da solo con `/usr/bin/swiftc` da `helper.swift` quando manca o è più vecchio del sorgente
(circa 4 s, una volta sola).

Si aggancia a `claude -p` così:

```json
{ "mcpServers": { "mac": { "command": "node", "args": ["/Users/tony/STEM/mac/mac-mcp.mjs", "--porta", "4321"] } } }
```

con `--allowedTools mcp__mac` (gli strumenti diventano `mcp__mac__<nome>`). `--porta` è la porta di `server.mjs`, che serve
agli strumenti degli ologrammi: `server.mjs` la scrive da solo in `mcp.json`, perché `.env` non arriva ai processi figli.
Senza `--porta` vale 4321; una porta non valida non ripiega sulla 4321, così una prova non finisce sullo STEM vero.

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
| `ricorda` | segna un compito in `runtime/agenda.json` con `tra_minuti` oppure `alle` («18:00», o «2026-11-07T08:30»); a batteria aggiunge l'avviso che il Mac può andare in stop |
| `agenda` | elenca i compiti; `togli` li cancella per numero. All'ora giusta li consegna `server.mjs` (vedi `orologio.mjs`) |
| `mostra_ologramma` | apre nell'HUD un ologramma 3D fatto di pezzi con misure in mm (forme, materiali, carichi e vincoli come in `public/ologramma/LEGGIMI-ologramma.md`); ogni pezzo può portare `materiale_vero`, `fattura` e `fonte` da una ricerca, e la risposta elenca i pezzi a cui mancano |
| `modifica_ologramma` | cambia pezzi, vista, carichi, vincoli, titolo e descrizione; `chiudi` lo chiude; senza campi dice com'è adesso |
| `analizza_struttura` | calcola gli sforzi e aspetta il risultato fino a 60 s |

I tre strumenti degli ologrammi sono client sottili: mandano `POST /api/ologramma` a `server.mjs`, che tiene lo stato,
valida e scrive il testo, e restituiscono quel testo più la foto PNG che l'HUD ha scattato, se c'è. Gli errori del server
arrivano al cervello così come sono. Hanno una coda loro, così un calcolo di un minuto non ferma mouse e tastiera, e «stop»
annulla anche la loro attesa.

## Permessi

Servono **Accessibilità** (mouse e tastiera) e **Registrazione schermo e audio di sistema** (schermo), in
Impostazioni di Sistema → Privacy e sicurezza. Li riceve l'app da cui parte STEM, non `stem-mac`: «STEM» se lo avvii da
STEM.app, «Terminale» se da `avvia.command`. Lo strumento `permessi` dice quale app è, e se manca qualcosa ogni strumento
risponde con il pannello da aprire invece di fallire in silenzio. Ricompilare l'aiutante non fa perdere i permessi.

## Limiti voluti

- Mai nei campi password: `scrivi` e `tasti` (caratteri e cmd+v) rifiutano se l'inserimento sicuro della tastiera è
  attivo o se il campo selezionato è `AXSecureTextField`.
- Niente tastiera in terminali, Script Editor e gestori di password (elenco `NO_TYPING` in `mac-mcp.mjs`): è la stessa
  regola «Niente Terminale» di `server.mjs`, e impedisce che una pagina web faccia digitare comandi a STEM.
- Niente AppleScript come strumento, niente stringhe passate alla shell: solo `execFile` con argomenti separati.
- `chiudi_app` non tocca i Chrome di STEM (profilo dentro `runtime/`). Tutti gli altri, compreso il Chrome di Tony, li chiude se glielo chiedi.

## Prova a mano

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"permessi","arguments":{}}}' | node mac/mac-mcp.mjs
```

Con `"name":"ricorda","arguments":{"cosa":"Prova","tra_minuti":2}` il compito finisce in `runtime/agenda.json`, e uno STEM acceso lo dirà davvero: toglilo dopo, con `agenda` e `togli`.
