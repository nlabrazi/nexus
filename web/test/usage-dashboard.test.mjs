import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotaView, formatCount } from '../app/utils/usage-dashboard.mjs';
test('dashboard preserves exhausted zero quotas and distinguishes unknown from unlimited', () => {
  const metric = { observedAt: 1000, unit: 'tokens', remaining: 0, limit: 100, resetsAt: 61000 };
  const view = quotaView(metric, 2000);
  assert.equal(view.percent, 0);
  assert.equal(view.remaining, '0 tokens');
  assert.equal(view.reset, 'dans 59 s');
  assert.equal(quotaView({ observedAt: 1000, unit: 'tokens' }, 2000).remaining, 'Non communiqué');
  assert.equal(formatCount(undefined), '—');
});
test('expired or old readings never masquerade as current available quota', () => {
  assert.equal(quotaView({ observedAt: 1000, remaining: 50, limit: 100, resetsAt: 2000 }, 2000).remaining, 'À actualiser');
  assert.equal(quotaView({ observedAt: 1000, remaining: 50, limit: 100 }, 302000).percent, undefined);
});
