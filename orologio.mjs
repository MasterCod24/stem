// L'orologio di Nexus: che ore sono, e l'agenda dei compiti «per dopo».
// L'agenda è runtime/agenda.json (mai online). La scrivono due processi, mai insieme:
//   mac/mac-mcp.mjs aggiunge e toglie, quando il cervello chiama «ricorda» o «agenda», cioè durante un suo turno;
//   server.mjs toglie i compiti che consegna, e consegna solo quando il cervello è fermo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime', 'agenda.json');

const ORA = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });
const GIORNO = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const DATA = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// «giovedì 5 novembre 2026, 21:40 (Europe/Rome, UTC+1)»: con il fuso il cervello sa fare anche l'ora di Tokyo
export function adesso(now = new Date()) {
  const off = -now.getTimezoneOffset(), h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  const utc = `UTC${off < 0 ? '-' : '+'}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
  return `${DATA.format(now)}, ${ORA.format(now)} (${Intl.DateTimeFormat().resolvedOptions().timeZone}, ${utc})`;
}

// «oggi alle 18:00», «domani alle 08:00», «sabato 7 novembre alle 18:00»
export function quandoIt(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 864e5); // arrotondo: i giorni del cambio d'ora durano 23 o 25 ore
  const g = diff === 0 ? 'oggi' : diff === 1 ? 'domani' : diff === -1 ? 'ieri' : GIORNO.format(d);
  return `${g} alle ${ORA.format(d)}`;
}

// «tra 2 minuti», «tra 1 ora e 30 minuti», «3 giorni fa»
export function traQuanto(ms) {
  const min = Math.round(Math.abs(ms) / 60000);
  const n = (x, uno, tanti) => `${x} ${x === 1 ? uno : tanti}`;
  let s;
  if (min < 60) s = n(min, 'minuto', 'minuti');
  else if (min < 48 * 60) s = n(Math.floor(min / 60), 'ora', 'ore') + (min % 60 ? ' e ' + n(min % 60, 'minuto', 'minuti') : '');
  else s = n(Math.round(min / 1440), 'giorno', 'giorni');
  return ms >= 0 ? `tra ${s}` : `${s} fa`;
}

// Il file: { prossimo, compiti: [{ id, cosa, quando, creato }] }, con le ore in millisecondi.
// «prossimo» non torna mai indietro: un numero già usato non indica mai un compito diverso.
function read() {
  try {
    const a = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(a.compiti)) return { prossimo: Number(a.prossimo) || 1, compiti: a.compiti };
  } catch {}
  return { prossimo: 1, compiti: [] };
}
function write(a) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(a, null, 1));
  fs.renameSync(tmp, FILE); // tutto o niente: chi legge non trova mai un file a metà
}

export const agenda = {
  list: () => read().compiti.sort((x, y) => x.quando - y.quando),
  due: (now = Date.now()) => agenda.list().filter((x) => x.quando <= now),
  add(cosa, quando) {
    const a = read();
    const id = Math.max(a.prossimo, ...a.compiti.map((x) => x.id + 1));
    a.compiti.push({ id, cosa, quando, creato: Date.now() });
    a.prossimo = id + 1;
    write(a);
    return id;
  },
  remove(ids) { // quanti ne ha tolti
    const a = read(), before = a.compiti.length;
    a.compiti = a.compiti.filter((x) => !ids.includes(x.id));
    if (a.compiti.length !== before) write(a);
    return before - a.compiti.length;
  },
};
