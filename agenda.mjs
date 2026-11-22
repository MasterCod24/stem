// Il server e gli strumenti MCP sono processi distinti. L'assegnazione di un compito,
// la sua ricevuta e le modifiche dell'utente devono essere transazioni dello stesso archivio.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const ATTESA_RICEVUTA = 45_000;
const DA_VERIFICARE = "L'esito del compito è da verificare.";

export function apriAgenda(cartella) {
  fs.mkdirSync(cartella, { recursive: true });
  const db = new DatabaseSync(path.join(cartella, 'agenda.sqlite'));
  db.exec('PRAGMA busy_timeout = 5000');

  function transazione(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const valore = fn();
      db.exec('COMMIT');
      return valore;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  try {
    transazione(() => {
      const { user_version } = db.prepare('PRAGMA user_version').get();
      if (user_version === 1) return;
      if (user_version !== 0) throw new Error('Versione agenda sconosciuta.');
      db.exec(`CREATE TABLE compiti (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cosa TEXT NOT NULL, quando REAL NOT NULL, creato INTEGER NOT NULL,
        risposta TEXT, gettone TEXT, fino INTEGER NOT NULL DEFAULT 0
      )`);
      const vecchio = path.join(cartella, 'agenda.json');
      if (fs.existsSync(vecchio)) {
        const { compiti, prossimo } = JSON.parse(fs.readFileSync(vecchio, 'utf8'));
        const inserisci = db.prepare('INSERT INTO compiti(id, cosa, quando, creato) VALUES (?, ?, ?, ?)');
        for (const c of compiti) inserisci.run(c.id, c.cosa, c.quando, c.creato ?? c.quando);
        // Anche un'agenda svuotata conserva il numero successivo scelto dall'utente.
        if (Number.isSafeInteger(prossimo) && prossimo > 1) {
          db.prepare("INSERT INTO sqlite_sequence(name, seq) SELECT 'compiti', 0 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='compiti')").run();
          db.prepare("UPDATE sqlite_sequence SET seq=max(seq, ?) WHERE name='compiti'").run(prossimo - 1);
        }
      }
      db.exec('PRAGMA user_version = 1');
    });
  } catch (e) { db.close(); throw e; }

  // Un solo avviso alla volta anche con due HUD. Alla scadenza un altro HUD può leggere
  // la risposta salvata. Il gettone impedisce a una vecchia finestra di confermarla al suo posto.
  const disponibili = `quando <= ? AND NOT EXISTS (SELECT 1 FROM compiti WHERE fino > ?)`;
  const conta = db.prepare('SELECT count(*) AS n FROM compiti WHERE ' + disponibili);
  const primo = db.prepare('SELECT id, cosa, quando, risposta FROM compiti WHERE ' + disponibili + ' ORDER BY quando, id LIMIT 1');
  const prenota = db.prepare('UPDATE compiti SET gettone=?, fino=?, risposta=coalesce(risposta, ?) WHERE id=?');
  const rinnova = db.prepare('UPDATE compiti SET fino=? WHERE id=? AND gettone=?');
  const salva = db.prepare('UPDATE compiti SET risposta=?, fino=? WHERE id=? AND gettone=?');
  const rilascia = db.prepare('UPDATE compiti SET fino=0, gettone=NULL WHERE id=? AND gettone=?');
  const conferma = db.prepare('DELETE FROM compiti WHERE id=? AND gettone=?');
  return {
    list: () => db.prepare('SELECT id, cosa, quando, creato FROM compiti ORDER BY quando, id').all(),
    add: (cosa, quando) => Number(db.prepare('INSERT INTO compiti(cosa, quando, creato) VALUES (?, ?, ?)').run(cosa, quando, Date.now()).lastInsertRowid),
    remove: (ids) => transazione(() => {
      const elimina = db.prepare('DELETE FROM compiti WHERE id=?');
      return ids.reduce((n, id) => n + elimina.run(id).changes, 0);
    }),
    disponibili: (ora = Date.now()) => conta.get(ora, ora).n,
    prendi(ora = Date.now()) {
      return transazione(() => {
        const voce = primo.get(ora, ora);
        if (!voce) return null;
        const gettone = randomUUID();
        // Prima di affidare il lavoro a Claude registriamo che può già aver agito.
        // Se il processo muore qui, tornerà l'avviso originale con l'esito da verificare.
        prenota.run(gettone, ora + ATTESA_RICEVUTA, DA_VERIFICARE, voce.id);
        return { ...voce, gettone };
      });
    },
    rinnova: (v) => rinnova.run(Date.now() + ATTESA_RICEVUTA, v.id, v.gettone).changes,
    salva: (v, testo) => salva.run(testo, Date.now() + ATTESA_RICEVUTA, v.id, v.gettone).changes,
    rilascia: (v) => rilascia.run(v.id, v.gettone).changes,
    conferma: (id, gettone) => conferma.run(id, gettone).changes,
    chiudi: () => db.close(),
  };
}
