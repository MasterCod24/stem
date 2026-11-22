// La ricevuta parte dall'HUD che ha mostrato il testo o ne ha terminato la lettura.
export function mostraPromemoria(voce, attuale, parla) {
  const box = document.getElementById('promemoria');
  box.querySelector('strong').textContent = voce.cosa;
  box.querySelector('p').textContent = voce.risposta;
  box.dataset.gettone = voce.gettone;
  box.hidden = false;
  let inviata = false;
  function conferma() {
    if (inviata || box.dataset.gettone !== voce.gettone) return;
    inviata = true;
    fetch('/api/agenda/conferma', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: voce.id, gettone: voce.gettone }), keepalive: true }).catch(() => {});
    // Se la ricevuta non arriva, il server conserva testo ed esito per la prossima consegna.
  }
  box.querySelector('button').onclick = () => { conferma(); box.hidden = true; };
  // Tra i due frame Chrome ha avuto occasione di dipingere la scheda. Una scheda nascosta
  // o una risposta superata prima del disegno non sono una consegna.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!document.hidden && !box.hidden && attuale()) conferma();
  }));
  if (voce.rileggi || document.hidden) {
    const parti = voce.risposta.match(/.{1,1800}(?:\s|$)|.{1,1800}/gs) ?? [];
    const frasi = [`Promemoria. ${voce.cosa}`, ...parti];
    let rimaste = frasi.length;
    for (const frase of frasi) parla(frase, () => {
      if (--rimaste === 0 && attuale()) conferma();
    });
  }
}
