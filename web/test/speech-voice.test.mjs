import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseSpeechVoice } from '../app/utils/speech-voice.mjs';
import { splitNativeSpeechText } from '../app/utils/speech-text.mjs';

test('automatic French voice prefers France over Quebec and online quality within that locale', () => {
  const voices = [
    { voiceURI: 'ca', lang: 'fr-CA', localService: true },
    { voiceURI: 'fr-local', lang: 'fr-FR', localService: true },
    { voiceURI: 'fr-online', lang: 'fr-FR', localService: false },
  ];
  assert.equal(chooseSpeechVoice(voices, ''), 2);
  assert.equal(chooseSpeechVoice(voices, 'removed'), 2);
  assert.equal(chooseSpeechVoice(voices, 'fr-local'), 1);
  assert.equal(chooseSpeechVoice(voices, 'ca'), 0);
  assert.equal(chooseSpeechVoice(voices.slice(0, 2), ''), 1);
  assert.equal(chooseSpeechVoice([{ lang: 'en-US' }], ''), -1);
});

test('native playback keeps adjacent sentences in one passage without changing text', () => {
  const text = 'Bonjour. Je suis Nexus. Voici une réponse fluide, avec des pauses naturelles.';
  assert.deepEqual(splitNativeSpeechText(text), [text]);
  const long = `${text} `.repeat(45).trim();
  const chunks = splitNativeSpeechText(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
  assert.equal(chunks.join(' '), long);
});
