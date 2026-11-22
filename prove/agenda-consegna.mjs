// node --test prove/agenda-consegna.mjs — archivio temporaneo e HUD controllato, nessun servizio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { apriAgenda, ATTESA_RICEVUTA } from '../agenda.mjs';
import { mostraPromemoria } from '../public/promemoria.js';

function archivio(t, precedente) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-agenda-'));
  const aperti = [];
  if (precedente) fs.writeFileSync(path.join(dir, 'agenda.json'), JSON.stringify(precedente));
  t.after(() => {
    for (const db of aperti) db.chiudi();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    const db = apriAgenda(dir);
    aperti.push(db);
    return db;
  };
}

test('migrazione ripetibile con scadenze e ID precedenti, anche ad agenda vuota', (t) => {
  const compito = { id: 5, cosa: 'Chiamare', quando: 1729, creato: 1200 };
  const apri = archivio(t, { compiti: [compito], prossimo: 19 });
  const a = apri();
  assert.deepEqual({ ...a.list()[0] }, compito);
  assert.equal(a.disponibili(1728), 0);
  assert.equal(a.disponibili(1729), 1);
  a.remove([5]);
  const b = apri();
  assert.deepEqual(b.list(), []);
  assert.equal(b.add('Nuovo', 2300), 19);
  assert.equal(archivio(t, { compiti: [], prossimo: 41 })().add('Altra agenda', 2500), 41);
});

test('due HUD, aggiunta MCP durante la consegna e ricevute tardive o duplicate', (t) => {
  const apri = archivio(t), a = apri(), b = apri();
  const id = a.add('Prima', 0);
  const ora = Date.now(), prima = a.prendi(ora);
  assert.equal(prima.risposta, null);
  assert.equal(b.prendi(ora), null);
  const altra = b.add('Seconda', 0);
  assert.equal(a.salva(prima, 'Risultato del lavoro'), 1);
  const riletta = b.prendi(Date.now() + ATTESA_RICEVUTA + 1);
  assert.equal(riletta.id, id);
  assert.equal(riletta.risposta, 'Risultato del lavoro');
  assert.notEqual(prima.gettone, riletta.gettone);
  assert.equal(a.conferma(id, prima.gettone), 0);
  assert.equal(a.salva(prima, 'Risposta vecchia'), 0);
  assert.equal(a.conferma(altra, riletta.gettone), 0);
  assert.equal(b.conferma(id, riletta.gettone), 1);
  assert.equal(b.conferma(id, riletta.gettone), 0);
  assert.deepEqual(a.list().map((v) => v.id), [altra]);
});

test('riavvio prima del risultato, interruzione e cancellazione esplicita', (t) => {
  const apri = archivio(t), a = apri();
  a.add('Controllare il documento', 1);
  const prima = a.prendi(1);
  const b = apri(), ripresa = b.prendi(1 + ATTESA_RICEVUTA + 1);
  assert.equal(ripresa.cosa, prima.cosa);
  assert.match(ripresa.risposta, /da verificare/);
  b.rilascia(ripresa);
  const altro = a.prendi();
  assert.equal(altro.risposta, ripresa.risposta);
  b.remove([altro.id]);
  assert.equal(a.salva(altro, 'Esito tardivo'), 0);
  assert.equal(a.prendi(), null);
});

function hud(t, nascosto = false) {
  const elementi = { strong: {}, p: {}, button: {} };
  const box = { dataset: {}, querySelector: (tag) => elementi[tag] };
  const frame = [], audio = [], ricevute = [];
  const originale = Object.fromEntries(['document', 'requestAnimationFrame', 'fetch'].map((k) => [k, globalThis[k]]));
  t.after(() => {
    for (const [k, v] of Object.entries(originale)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  });
  globalThis.document = { hidden: nascosto, getElementById: () => box };
  globalThis.requestAnimationFrame = (fn) => frame.push(fn);
  globalThis.fetch = async (url, opzioni) => { ricevute.push([url, JSON.parse(opzioni.body)]); };
  const voce = { id: 9, gettone: 'tentativo', cosa: 'Originale', risposta: 'Risultato', rileggi: true };
  let attuale = true;
  mostraPromemoria(voce, () => attuale, (testo, fine) => audio.push({ testo, fine }));
  return { elementi, audio, ricevute, disegna: () => { while (frame.length) frame.shift()(); }, interrompi: () => { attuale = false; } };
}

test('ricevuta solo dopo il disegno, anche se la voce fallisce', (t) => {
  const h = hud(t);
  assert.equal(h.elementi.strong.textContent, 'Originale');
  assert.equal(h.elementi.p.textContent, 'Risultato');
  assert.equal(h.ricevute.length, 0);
  h.disegna();
  for (const a of h.audio) a.fine();
  assert.deepEqual(h.ricevute, [['/api/agenda/conferma', { id: 9, gettone: 'tentativo' }]]);
});

test('HUD nascosto: serve la fine di tutta la lettura', (t) => {
  const h = hud(t, true);
  h.disegna();
  assert.deepEqual(h.audio.map((a) => a.testo), ['Promemoria. Originale', 'Risultato']);
  h.audio[0].fine();
  assert.equal(h.ricevute.length, 0);
  h.audio[1].fine();
  assert.equal(h.ricevute.length, 1);
});

test('interruzione prima del disegno o della fine audio: nessuna ricevuta', (t) => {
  const h = hud(t);
  h.interrompi();
  h.disegna();
  for (const a of h.audio) a.fine();
  assert.equal(h.ricevute.length, 0);
});
