export const NOME = 'oscar';
export const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');

export function isName(w) {
  const a = norm(w), b = NOME; // distanza di modifica ≤ 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
// La sigla puntata e «Oscar» hanno la stessa forma normalizzata.
export const unisciSigla = (text) => text.replace(/\bo[.\s]+s[.\s]+c[.\s]+a[.\s]+r\b\.?/gi, 'Oscar');
