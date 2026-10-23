import assert from 'node:assert/strict';
import { test } from 'node:test';
import { triggerHaptic } from '../app/utils/haptics.mjs';

test('triggerHaptic resolves cleanly without throwing in non-native / browser environments', async () => {
  await assert.doesNotReject(() => triggerHaptic('press'));
  await assert.doesNotReject(() => triggerHaptic('release'));
  await assert.doesNotReject(() => triggerHaptic('success'));
  await assert.doesNotReject(() => triggerHaptic('cancel'));
  await assert.doesNotReject(() => triggerHaptic('light'));
  await assert.doesNotReject(() => triggerHaptic('heavy'));
  await assert.doesNotReject(() => triggerHaptic('medium'));
});
