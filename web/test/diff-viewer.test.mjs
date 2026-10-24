import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, summarizeDiff } from '../app/utils/diff-viewer.mjs';

const SAMPLE_DIFF = `diff --git a/src/conversational/routed-model.ts b/src/conversational/routed-model.ts
index 547d8d1..8f67978 100644
--- a/src/conversational/routed-model.ts
+++ b/src/conversational/routed-model.ts
@@ -11,5 +11,5 @@ export const CLOUD_DEFAULTS
   { provider: 'cerebras', model: 'gpt-oss-120b' },
   { provider: 'groq', model: 'openai/gpt-oss-120b' },
-  { provider: 'gemini', model: 'gemini-3.8-flash' },
+  { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
   { provider: 'openrouter', model: 'openrouter/free' },
 ];
diff --git a/.env.example b/.env.example
index f07106c..2b171e1 100644
--- a/.env.example
+++ b/.env.example
@@ -29,2 +29,2 @@
-GEMINI_MODEL=gemini-3.8-flash
+GEMINI_MODEL=gemini-3.5-flash-lite
`;

test('parseUnifiedDiff returns empty array for empty or invalid input', () => {
  assert.deepEqual(parseUnifiedDiff(''), []);
  assert.deepEqual(parseUnifiedDiff(null), []);
  assert.deepEqual(parseUnifiedDiff(undefined), []);
  assert.deepEqual(parseUnifiedDiff('   '), []);
});

test('parseUnifiedDiff parses multi-file git diff into structured file hunks and stats', () => {
  const files = parseUnifiedDiff(SAMPLE_DIFF);
  assert.equal(files.length, 2);

  const file1 = files[0];
  assert.equal(file1.filePath, 'src/conversational/routed-model.ts');
  assert.equal(file1.additions, 1);
  assert.equal(file1.deletions, 1);
  assert.equal(file1.hunks.length, 1);
  assert.equal(file1.hunks[0].header, '@@ -11,5 +11,5 @@ export const CLOUD_DEFAULTS');

  const lines = file1.hunks[0].lines;
  assert.ok(lines.some((l) => l.type === 'del' && l.text.includes('gemini-3.8-flash')));
  assert.ok(lines.some((l) => l.type === 'add' && l.text.includes('gemini-3.5-flash-lite')));

  const file2 = files[1];
  assert.equal(file2.filePath, '.env.example');
  assert.equal(file2.additions, 1);
  assert.equal(file2.deletions, 1);
});

test('summarizeDiff calculates totals and human-readable label', () => {
  const files = parseUnifiedDiff(SAMPLE_DIFF);
  const summary = summarizeDiff(files);

  assert.equal(summary.filesCount, 2);
  assert.equal(summary.additions, 2);
  assert.equal(summary.deletions, 2);
  assert.equal(summary.label, '2 fichiers modifiés (+2, -2)');

  assert.equal(summarizeDiff([]).label, 'Aucune modification');
});
