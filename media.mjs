// Le animazioni da mostrare nell'HUD mentre O.S.C.A.R. parla ([anim:]): Wikimedia Commons, animazioni che spiegano come
// funziona qualcosa, senza chiave, con parole in inglese. Il server le fa diventare schede (schede.mjs).
// Le GIF di GIPHY sono state tolte il 27/11: senza la chiave in .env non si erano mai viste.
const UA = { 'user-agent': 'OSCAR/1.0 (assistente personale di Tony)' };

export function createMedia({ onLog = () => {} } = {}) {
  async function commons(q) {
    const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8'
      + `&gsrsearch=${encodeURIComponent(`filemime:image/gif ${q}`)}&prop=imageinfo&iiprop=url|size&iiurlwidth=520`;
    const d = await (await fetch(u, { headers: UA, signal: AbortSignal.timeout(4000) })).json();
    const pages = Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii || ii.width < 180 || ii.height < 120) continue; // troppo piccole per lo schermo
      return { url: ii.thumburl || ii.url, w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height, title: p.title.replace(/^File:|\.gif$/gi, '') };
    }
    return null;
  }

  async function find(kind, q) {
    try { return kind === 'anim' ? (await commons(q)) : null; }
    catch (e) { onLog(`[media] ${kind} "${q}": ${e.message}`); return null; }
  }
  return { find };
}
