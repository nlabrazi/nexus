import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatHandoffPrompt,
  resolveHandoffBackend,
} from '../app/utils/handoff.mjs';

test('formatHandoffPrompt prefixes proposal with actionable directive for coding agent', () => {
  const proposal = 'Créer une fonction calculateScore() avec tests unitaires';
  const formatted = formatHandoffPrompt(proposal);
  assert.equal(
    formatted,
    'Mets en œuvre la proposition suivante conçue avec Brain :\n\nCréer une fonction calculateScore() avec tests unitaires'
  );

  // Avoid duplicate prefix
  assert.equal(
    formatHandoffPrompt(formatted),
    formatted
  );

  // Handles empty or whitespace-only text
  assert.equal(formatHandoffPrompt(''), '');
  assert.equal(formatHandoffPrompt(null), '');
});

test('resolveHandoffBackend switches from brain to lastCodingBackend or fallback', () => {
  assert.equal(resolveHandoffBackend('brain', 'antigravity'), 'antigravity');
  assert.equal(resolveHandoffBackend('brain', 'claude'), 'claude');
  assert.equal(resolveHandoffBackend('brain', undefined, 'codex'), 'codex');
  assert.equal(resolveHandoffBackend('antigravity', 'codex'), 'antigravity');
});
