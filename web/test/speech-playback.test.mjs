import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeechPlayback } from '../app/utils/speech-playback.mjs';

function setup() {
  const utterances = [];
  const states = [];
  const errors = [];
  const pending = new Map();
  let timerId = 0;
  let cancellations = 0;
  const engine = { cancel() { cancellations++; }, getVoices: () => [], speak: (u) => utterances.push(u) };
  const timers = { setTimeout(fn) { pending.set(++timerId, fn); return timerId; }, clearTimeout(id) { pending.delete(id); } };
  const player = createSpeechPlayback(engine, (text) => ({ text }), { onState: (...args) => states.push(args), onError: (error) => errors.push(error) }, timers);
  return { player, utterances, states, errors, pending, engine, cancellations: () => cancellations };
}

test('late events from a replaced or cancelled utterance cannot reset the active playback', () => {
  const f = setup();
  f.player.speak('Bonjour', 'first');
  const old = f.utterances[0];
  f.player.speak('Deuxième réponse', 'second');
  old.onend(); old.onerror(); old.onstart();
  assert.deepEqual(f.states.at(-1), [true, 'second']);
  assert.equal(f.errors.length, 0);
  f.player.stop();
  f.utterances[1].onstart();
  assert.deepEqual(f.states.at(-1), [false, null]);
  assert.equal(f.pending.size, 0);
});

test('long answers are played sequentially with bounded utterances', () => {
  const f = setup();
  f.player.speak('Une phrase à écouter. '.repeat(40), 'long');
  assert.equal(f.utterances.length, 1);
  let i = 0;
  while (i < f.utterances.length) {
    assert.ok(f.utterances[i].text.length <= 240);
    f.utterances[i].onstart(); f.utterances[i++].onend();
  }
  assert.ok(i > 1);
  assert.deepEqual(f.states.at(-1), [false, null]);
  assert.equal(f.pending.size, 0);
});

test('missing start events, engine errors and stalled playback release the UI with a text fallback', () => {
  for (const mode of ['never-starts', 'stalled', 'error', 'throws']) {
    const f = setup();
    if (mode === 'throws') f.engine.speak = () => { throw new Error('engine failed'); };
    f.player.speak('Bonjour', 'id');
    if (mode === 'stalled') f.utterances[0].onstart();
    if (mode === 'error') f.utterances[0].onerror();
    else if (mode !== 'throws') [...f.pending.values()][0]();
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.states.at(-1), [false, null]);
    assert.equal(f.pending.size, 0);
  }
});

test('voice discovery is refreshed for each new playback', () => {
  const f = setup();
  f.player.speak('Bonjour', 'first');
  assert.equal(f.utterances[0].voice, undefined);
  const voice = { lang: 'fr-FR', localService: true, voiceURI: 'local-fr' };
  f.engine.getVoices = () => [voice];
  f.player.speak('Bonjour encore', 'second');
  assert.equal(f.utterances[1].voice, voice);
});

test('selected voice and bounded speed are applied, with safe defaults for stale settings', () => {
  const f = setup();
  const voices = [{ voiceURI: 'fr', lang: 'fr-FR', localService: true }, { voiceURI: 'be', lang: 'fr-BE' }];
  f.engine.getVoices = () => voices;
  f.player.speak('Bonjour', 'id', { voiceURI: 'be', rate: 1.2 });
  assert.equal(f.utterances[0].voice, voices[1]);
  assert.equal(f.utterances[0].rate, 1.2);
  f.player.speak('Bonjour', 'id', { voiceURI: 'removed', rate: -1 });
  assert.equal(f.utterances[1].voice, voices[0]);
  assert.equal(f.utterances[1].rate, 1);
});
