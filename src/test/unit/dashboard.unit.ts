import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { NexusRuntime } from '../../runtime/nexus-runtime';
import { createStandaloneWorkspaceGuard } from '../../runtime/workspace';

test('Codex dashboard exposes remaining percentages and reset dates without inventing hours or tokens', async (t) => {
  const runtime = new NexusRuntime({
    workspaceGuard: createStandaloneWorkspaceGuard('/mock'),
    brainModel: { decide: async () => ({ action: 'reply', text: 'ok' }) },
  });
  t.after(() => runtime.stop());
  t.mock.method(runtime.getCodexService(), 'refreshStatus', async () => {});
  t.mock.method(runtime.getCodexService(), 'getStatus', () => ({
    processRunning: true,
    pendingApprovals: 0,
    model: 'configured',
    reroutedModel: 'effective',
    rateLimitsUpdatedAt: 5000,
    rateLimits: [
      {
        limitName: 'Codex',
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 123456 },
        secondary: { usedPercent: 100, windowDurationMins: 10080 },
      },
    ],
  }));
  const data = await runtime.getDashboard();
  assert.equal(data.agents[0].model, 'effective');
  assert.equal(data.agents[0].limits[0].remaining, 75);
  assert.equal(data.agents[0].limits[0].resetsAt, 123456000);
  assert.equal(data.agents[0].limits[0].observedAt, 5000);
  assert.equal(data.agents[0].limits[1].remaining, 0);
  assert.equal(data.agents[0].totalTokens, undefined);
  assert.deepEqual(data.agents[1].limits, []);
});
