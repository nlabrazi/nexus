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

test('interaction feedback distinguishes sending from server receipt and hides internal event text', async () => {
  const { getInteractionMessage } = await import('../app/utils/assistant-state.mjs');
  assert.equal(getInteractionMessage(undefined, 'brain'), 'Envoi de votre demande…');
  assert.equal(getInteractionMessage({ status: 'pending' }, 'brain'), 'Demande reçue…');
  assert.equal(getInteractionMessage({ status: 'running', stage: 'inspecting', progressMessage: 'Internal event with private path' }, 'brain'), 'Analyse du projet…');
  assert.equal(getInteractionMessage({ status: 'running', stage: 'executing' }, 'codex'), 'Votre agent travaille…');
});
