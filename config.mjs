// Il launcher e il server devono scegliere la stessa porta anche con un vecchio .env.
import fs from 'node:fs';

function conNomiAttuali(valori) {
  const attuali = { ...valori };
  for (const [k, v] of Object.entries(valori)) {
    if (k.startsWith('NEXUS_')) attuali['OSCAR_' + k.slice(6)] ??= v;
  }
  return attuali;
}

export function configurazione(testo, ambiente) {
  const file = {};
  for (const riga of testo.split('\n')) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) file[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { ...conNomiAttuali(file), ...conNomiAttuali(ambiente) };
}

const file = new URL('./.env', import.meta.url);
export const env = configurazione(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', process.env);
