import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeSpeechPlayback } from '../app/utils/native-speech-playback.mjs';
import { shouldSpeakReply } from '../app/utils/voice-reply.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const spoken = [], pending = [], states = [], errors = [], timers = new Map();
  let timerId = 0, stops = 0;
  const voices = [{ voiceURI: 'en', lang: 'en-US' }, { voiceURI: 'fr', lang: 'fr-FR', localService: true }];
  const engine = {
    async stop() { stops++; }, async getSupportedVoices() { return { voices }; },
    speak(options) { spoken.push(options); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
  };
  const player = createNativeSpeechPlayback(engine, {
    onState: (...args) => states.push(args), onError: (error) => errors.push(error),
  }, { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } });
  return { player, engine, spoken, pending, states, errors, timers, voices, stops: () => stops };
}

test('Android plays the final answer in sequential chunks using the native voice index and speed', async () => {
  const f = setup();
  const done = f.player.speak('Une réponse assez longue. '.repeat(125), 'answer', { rate: 1.2 });
  await tick();
  let i = 0;
  while (i < f.pending.length) {
    assert.equal(f.spoken[i].voice, 1);
    assert.equal(f.spoken[i].lang, 'fr-FR');
    assert.equal(f.spoken[i].rate, 1.2);
    assert.ok(f.spoken[i].text.length <= 1200);
    f.pending[i++].resolve(); await tick();
  }
  await done;
  assert.ok(i > 1);
  assert.deepEqual(f.states.at(-1), [false, null]);
  assert.equal(f.timers.size, 0);
});

test('Android cancellation releases pending speak promises and ignores late failures', async () => {
  const f = setup();
  const first = f.player.speak('Ancienne réponse', 'first'); await tick();
  const second = f.player.speak('Nouvelle réponse', 'second'); await tick();
  await first;
  f.pending[0].reject(new Error('cancelled')); await tick();
  assert.deepEqual(f.states.at(-1), [true, 'second']);
  assert.equal(f.errors.length, 0);
  await f.player.stop(); await second;
  assert.deepEqual(f.states.at(-1), [false, null]);
  assert.equal(f.timers.size, 0);
});

test('rapid replacement never starts stale audio after a delayed native stop', async () => {
  const f = setup();
  let release;
  f.engine.stop = () => new Promise((resolve) => { release = resolve; });
  const first = f.player.speak('Ancien', 'first'); await tick();
  const second = f.player.speak('Actuel', 'second');
  release(); await tick();
  release(); await tick();
  await first;
  assert.deepEqual(f.spoken.map((s) => s.text), ['Actuel']);
  f.pending[0].resolve(); await second;
});

test('native failures, missing French voice and timeout stop playback with actionable feedback', async () => {
  for (const mode of ['error', 'missing-voice', 'timeout']) {
    const f = setup();
    if (mode === 'missing-voice') f.voices.splice(1);
    const done = f.player.speak('Bonjour', 'answer'); await tick();
    if (mode === 'error') f.pending[0].reject(new Error('engine failed'));
    if (mode === 'timeout') [...f.timers.values()][0]();
    await done;
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0], /paramètres Android/);
    assert.deepEqual(f.states.at(-1), [false, null]);
    assert.equal(f.timers.size, 0);
  }
});

test('voice preference is mapped to its native index with safe fallback for stale settings', async () => {
  const f = setup();
  const done = f.player.speak('Bonjour', 'answer', { voiceURI: 'en', rate: -1 }); await tick();
  assert.equal(f.spoken[0].voice, 0);
  assert.equal(f.spoken[0].lang, 'en-US');
  assert.equal(f.spoken[0].rate, 1);
  f.pending[0].resolve(); await done;
  const again = f.player.speak('Bonjour', 'answer', { voiceURI: 'removed' }); await tick();
  assert.equal(f.spoken[1].voice, 1);
  f.pending[1].resolve(); await again;
});

test('dictated requests receive audio with auto-read disabled, respecting mute and task errors', () => {
  assert.equal(shouldSpeakReply({ enabled: true, autoSpeak: false, fromVoice: true }), true);
  assert.equal(shouldSpeakReply({ enabled: true, autoSpeak: false, fromVoice: false }), false);
  assert.equal(shouldSpeakReply({ enabled: true, autoSpeak: true, fromVoice: false }), true);
  assert.equal(shouldSpeakReply({ enabled: false, autoSpeak: true, fromVoice: true }), false);
  assert.equal(shouldSpeakReply({ enabled: true, autoSpeak: true, fromVoice: true, error: true }), false);
});

test('automatic online France voice falls back to local France when the network voice fails', async () => {
  const f = setup();
  f.voices.unshift({ voiceURI: 'fr-online', lang: 'fr-FR', localService: false });
  const done = f.player.speak('Bonjour. Comment allez-vous ?', 'answer'); await tick();
  assert.equal(f.spoken[0].voice, 0);
  f.pending[0].reject(new Error('offline')); await tick();
  assert.equal(f.spoken[1].voice, 2);
  assert.equal(f.spoken[1].lang, 'fr-FR');
  f.pending[1].resolve(); await done;
  assert.equal(f.errors.length, 0);
});
