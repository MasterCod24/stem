// GIF e animazioni da mostrare nell'HUD mentre Nexus parla.
//   gif  → GIPHY (simpatiche; serve GIPHY_API_KEY gratuita in .env, altrimenti niente)
//   anim → Wikimedia Commons (animazioni che spiegano come funziona qualcosa; nessuna chiave, parole in inglese)
const UA = { 'user-agent': 'Nexus/1.0 (assistente personale di Tony)' };

export function createMedia({ giphyKey, onLog = () => {} }) {
  async function giphy(q) {
    if (!giphyKey) return null;
    const u = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyKey)}&q=${encodeURIComponent(q)}&limit=8&rating=pg&lang=it`;
    const { data = [] } = await (await fetch(u, { signal: AbortSignal.timeout(4000) })).json();
    const g = data[Math.floor(Math.random() * Math.min(5, data.length))];
    const img = g?.images?.downsized_medium || g?.images?.fixed_height;
    return img?.url ? { url: img.url, w: Number(img.width), h: Number(img.height), title: g.title || q } : null;
  }

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
    try { return kind === 'gif' ? (await giphy(q)) : (await commons(q)); }
    catch (e) { onLog(`[media] ${kind} "${q}": ${e.message}`); return null; }
  }
  return { find, get gifs() { return Boolean(giphyKey); } };
}
