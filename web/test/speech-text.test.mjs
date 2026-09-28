import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanTextForSpeech, splitSpeechText } from '../app/utils/speech-text.mjs';

test('spoken text omits code, addresses and markdown while preserving useful prose', () => {
  const input = '# Résultat\nLa commande `npm run build` a échoué.\n```sh\nrm -rf dossier\n```\nConsultez [le guide](https://example.com/private).\n- Corrigez les erreurs\n- Relancez les tests';
  const spoken = cleanTextForSpeech(input);
  assert.match(spoken, /La compilation a échoué/);
  assert.match(spoken, /Consultez le guide/);
  assert.match(spoken, /Corrigez les erreurs\. Relancez les tests\./);
  assert.doesNotMatch(spoken, /npm|rm -rf|https|```|#/);
  assert.ok(input.includes('npm run build'));
});

test('unfinished code blocks and tables are omitted and lengthy responses are bounded', () => {
  assert.doesNotMatch(cleanTextForSpeech('Texte.\n```ts\nsecretCommand()'), /secretCommand/);
  assert.doesNotMatch(cleanTextForSpeech('| Champ | Valeur |\n| --- | --- |\n| port | 4040 |'), /4040/);
  const spoken = cleanTextForSpeech('Une longue réponse. '.repeat(1000));
  assert.ok(spoken.length <= 6000);
  assert.match(spoken, /suite est disponible à l’écran/);
});

test('speech chunks preserve sentence pauses and bound unbroken technical strings', () => {
  assert.deepEqual(splitSpeechText('Bonjour. Comment allez-vous ?'), ['Bonjour.', 'Comment allez-vous ?']);
  assert.ok(splitSpeechText('a'.repeat(1000)).every((part) => part.length <= 240));
  assert.deepEqual(splitSpeechText('   '), []);
});
