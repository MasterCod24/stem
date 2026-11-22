// node --test prove/cervello-inattivo.mjs — Claude finto su stdio, limiti abbreviati.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createBrain } from '../brain.mjs';

const CLI = `#!/usr/bin/env node
const fs = require('node:fs');
const out = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: 'sessione-prova' }) + '\\n');
const evento = (type, e) => out({ type: 'stream_event', event: { type, ...e } });
const delta = (s) => evento('content_block_delta', { delta: { type: 'text_delta', text: s } });
const fine = () => out({ type: 'result', is_error: false });
let testo = '';
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.type === 'control_request') {
    if (testo === 'annullabile') { delta('Risposta vecchia. '); fine(); }
    return;
  }
  testo = m.message.content;
  fs.appendFileSync('domande', testo + '\\n');
  if (testo === 'bloccato') {
    process.on('SIGTERM', () => {});
    setInterval(() => {
      out({ type: 'keep_alive' }); evento('ping'); out({ type: 'tool_progress', elapsed_time_seconds: 99 });
    }, 40);
  } else if (testo === 'regolare') {
    for (let i = 0; i < 6; i++) setTimeout(() => delta('Avanzo. '), 150 + i * 70);
    setTimeout(fine, 600);
  } else if (testo === 'strumenti') {
    out({ type: 'assistant', message: { content: ['uno', 'due'].map(id => ({ type: 'tool_use', name: 'WebSearch', id })) } });
    setTimeout(() => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'uno' }] } }), 80);
    setTimeout(() => { delta('Finito. '); fine(); }, 750);
  } else if (testo !== 'annullabile') { delta('Pronto. '); fine(); }
});
`;

function avvia(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'oscar-turno-'));
  const vecchio = process.env.PATH;
  fs.writeFileSync(path.join(cwd, 'claude'), CLI, { mode: 0o755 });
  process.env.PATH = cwd + path.delimiter + vecchio;
  const brain = createBrain({ cwd, args: [], sessionFile: path.join(cwd, 'sessione.json'),
    avvisoMs: 100, inattivoMs: 400, strumentoMs: 1600, interruzioneMs: 100, terminaMs: 100 });
  t.after(() => { brain.kill(); process.env.PATH = vecchio; fs.rmSync(cwd, { force: true, recursive: true }); });
  return { brain, domande: () => fs.readFileSync(path.join(cwd, 'domande'), 'utf8').trim().split('\n') };
}

test('blocco con keep-alive e SIGTERM ignorato: avviso, recupero e domanda nuova una volta sola', { timeout: 6000 }, async (t) => {
  const { brain, domande } = avvia(t);
  const eventi = [], successivi = [];
  let prossima;
  const r = await brain.ask('bloccato', (ev) => {
    eventi.push(ev);
    if (ev.causa === 'inattivo') queueMicrotask(() => { prossima = brain.ask('successiva', (e) => successivi.push(e)); });
  });
  assert.equal(r.interrotto, true);
  assert.equal(eventi.filter((e) => e.t === 'attesa' && e.attiva).length, 1);
  assert.equal(eventi.filter((e) => e.t === 'error').length, 1);
  assert.equal((await prossima).interrotto, false);
  assert.deepEqual(successivi.filter((e) => e.t === 'say').map((e) => e.s), ['Pronto.']);
  assert.deepEqual(domande(), ['bloccato', 'successiva']);
  assert.equal(brain.busy, false);
});

test('la ripresa dei progressi spegne l’avviso e prolunga il turno', { timeout: 4000 }, async (t) => {
  const { brain } = avvia(t), eventi = [];
  assert.equal((await brain.ask('regolare', (e) => eventi.push(e))).interrotto, false);
  assert.deepEqual(eventi.filter((e) => e.t === 'attesa').map((e) => e.attiva), [true, false]);
  assert.ok(!eventi.some((e) => e.t === 'error'));
});

test('uno strumento ancora in corso mantiene il limite lungo dopo il risultato di un altro', { timeout: 4000 }, async (t) => {
  const { brain } = avvia(t);
  assert.equal((await brain.ask('strumenti', () => {})).interrotto, false);
});

test('stop durante l’attesa annulla il timer e scarta la voce tardiva', { timeout: 4000 }, async (t) => {
  const { brain } = avvia(t), eventi = [];
  const r = await brain.ask('annullabile', (e) => {
    eventi.push(e);
    if (e.t === 'attesa' && e.attiva) brain.stop();
  });
  assert.equal(r.interrotto, true);
  assert.ok(!eventi.some((e) => e.t === 'say' || e.t === 'error'));
  assert.equal(brain.busy, false);
});
