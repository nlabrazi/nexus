import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAssistantState } from '../app/utils/assistant-state.mjs';

test('a disconnected or unavailable node is offline even with stale task and playback data', () => {
  assert.equal(getAssistantState({ online: false, sending: true, speaking: true, failed: true }), 'OFFLINE');
});

test('brain and coding work have distinct states and take priority over prior errors', () => {
  assert.equal(getAssistantState({ online: true, sending: true, backend: 'brain', failed: true }), 'THINKING');
  for (const backend of ['codex', 'antigravity']) {
    assert.equal(getAssistantState({ online: true, sending: true, backend }), 'CODING');
    assert.equal(getAssistantState({ online: true, busy: true, backend }), 'CODING');
  }
  assert.equal(getAssistantState({ online: true, busy: true }), 'THINKING');
});

test('speech, task failure and idle return to understandable states', () => {
  assert.equal(getAssistantState({ online: true, speaking: true }), 'SPEAKING');
  assert.equal(getAssistantState({ online: true, failed: true }), 'ERROR');
  assert.equal(getAssistantState({ online: true }), 'READY');
});
