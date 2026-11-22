// Ora e date per il cervello e per gli strumenti dell'agenda.
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
