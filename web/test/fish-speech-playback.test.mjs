import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFishSpeechPlayback,
  normalizeFishReferenceId,
} from '../app/utils/fish-speech-playback.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ synthesizeImpl } = {}) {
  const synthesized = [];
  const audios = [];
  const fallbackSpoken = [];
  const states = [];
  const errors = [];
  const fallbacks = [];
  let fallbackStops = 0;

  const fallbackPlayer = {
    speak(text, id, options) {
      fallbackSpoken.push({ text, id, options });
      states.push([false, null]);
      return Promise.resolve();
    },
    stop() {
      fallbackStops++;
      return Promise.resolve();
    },
  };

  const player = createFishSpeechPlayback({
    synthesize: async (text, opts) => {
      synthesized.push({ text, opts });
      if (synthesizeImpl) return synthesizeImpl(text, opts, synthesized.length - 1);
      return `data:audio/mpeg;base64,chunk-${synthesized.length}`;
    },
    createAudio(src) {
      const audio = {
        src,
        paused: false,
        onended: null,
        onerror: null,
        play() {
          return Promise.resolve();
        },
        pause() {
          this.paused = true;
        },
      };
      audios.push(audio);
      return audio;
    },
    fallbackPlayer,
    callbacks: {
      onState: (...args) => states.push(args),
      onError: (err) => errors.push(err),
      onFallback: (err) => fallbacks.push(err),
    },
  });

  return {
    player,
    synthesized,
    audios,
    fallbackSpoken,
    fallbackStops: () => fallbackStops,
    states,
    errors,
    fallbacks,
  };
}

test('normalizeFishReferenceId extracts clean reference_id from raw IDs and fish.audio URLs', () => {
  assert.equal(
    normalizeFishReferenceId('802e3bc2b27e49c2995d23ef70e6ac89'),
    '802e3bc2b27e49c2995d23ef70e6ac89'
  );
  assert.equal(
    normalizeFishReferenceId('https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89/'),
    '802e3bc2b27e49c2995d23ef70e6ac89'
  );
  assert.equal(
    normalizeFishReferenceId(
      'https://fish.audio/fr/text-to-speech/802e3bc2b27e49c2995d23ef70e6ac89'
    ),
    '802e3bc2b27e49c2995d23ef70e6ac89'
  );
  assert.equal(normalizeFishReferenceId('   '), '');
});

test('Fish Audio player synthesizes and plays audio chunks with normalized reference_id', async () => {
  const f = setup();
  const done = f.player.speak('Bonjour. Nexus utilise Fish Audio.', 'msg-1', {
    provider: 'fish',
    fishEnabled: true,
    fishReferenceId: 'https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89',
    rate: 1.1,
    fishModel: 's2.1-pro',
  });
  await tick();
  assert.equal(f.synthesized.length, 1);
  assert.equal(f.synthesized[0].opts.referenceId, '802e3bc2b27e49c2995d23ef70e6ac89');
  assert.equal(f.synthesized[0].opts.rate, 1.1);
  assert.equal(f.audios.length, 1);
  f.audios[0].onended();
  await done;
  assert.equal(f.fallbackSpoken.length, 0);
  assert.deepEqual(f.states.at(-1), [false, null]);
});

test('Fish Audio failure automatically falls back to existing local/native backup speech player', async () => {
  const f = setup({
    synthesizeImpl: async () => {
      throw new Error('Fish Audio unreachable');
    },
  });
  await f.player.speak('Message lu par le moteur de secours.', 'msg-backup', {
    provider: 'fish',
    fishEnabled: true,
    fishReferenceId: '802e3bc2b27e49c2995d23ef70e6ac89',
    rate: 1,
  });
  assert.equal(f.fallbacks.length, 1);
  assert.equal(f.fallbackSpoken.length, 1);
  assert.equal(f.fallbackSpoken[0].text, 'Message lu par le moteur de secours.');
  assert.equal(f.fallbackSpoken[0].id, 'msg-backup');
  assert.equal(f.errors.length, 0);
});

test('selecting system provider bypasses Fish Audio and uses local backup directly', async () => {
  const f = setup();
  await f.player.speak('Lecture directe locale.', 'msg-local', {
    provider: 'system',
    fishEnabled: false,
  });
  assert.equal(f.synthesized.length, 0);
  assert.equal(f.fallbackSpoken.length, 1);
  assert.equal(f.fallbackSpoken[0].text, 'Lecture directe locale.');
});

