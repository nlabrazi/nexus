import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NexusCore } from '../../core';
import { DesktopNode, resolveDesktopConfig } from '../../desktop';
import { createNexusMessage, parseNexusMessage } from '../../protocol/messages';
import { NexusRuntime } from '../../runtime/nexus-runtime';
import { createStandaloneWorkspaceGuard } from '../../runtime/workspace';
import { RuntimeDashboard } from '../../runtime/dashboard-types';

const snapshot: RuntimeDashboard = {
  generatedAt: 1234,
  startedAt: 1000,
  brain: { selection: 'auto', providers: [] },
  agents: [],
};
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-dashboard-'));
  const core = new NexusCore({ port: 0, host: '127.0.0.1', authTokens: ['dashboard-token'] });
  await core.start();
  const address = core.getServer()!.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const config = resolveDesktopConfig(
    { project: directory, core: url, authToken: 'dashboard-token', nodeId: 'dashboard-node' },
    {},
    directory
  );
  const desktop = new DesktopNode(config, {
    brainModel: { decide: async () => ({ action: 'reply', text: 'ok' }) },
  });
  t.after(async () => {
    await desktop.stop();
    await core.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  await desktop.start();
  await desktop.getCoreClient()!.waitForConnection(3000);
  return { core, desktop, url };
}

test('dashboard endpoint requires the Nexus token and transports a real Desktop runtime snapshot', async (t) => {
  const { core, desktop, url } = await setup(t);
  const unauthorized = await fetch(`${url}/api/dashboard`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('cache-control'), 'no-store');
  const result = await fetch(`${url}/api/dashboard`, {
    headers: { Authorization: 'Bearer dashboard-token' },
  });
  assert.equal(result.status, 200);
  const data = (await result.json()) as RuntimeDashboard;
  assert.equal(data.brain.selection, 'custom');
  assert.deepEqual(
    data.agents.map((a) => a.id),
    ['codex', 'antigravity']
  );
  assert.ok(!JSON.stringify(data).includes('dashboard-token'));
  t.mock.method(desktop.getRuntime()!, 'getDashboard', async () => {
    throw new Error('private-provider-key');
  });
  const failed = await fetch(`${url}/api/dashboard`, {
    headers: { Authorization: 'Bearer dashboard-token' },
  });
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('private-provider-key'));
  assert.ok(!JSON.stringify(core.getStatus()).includes('providers'));
});

test('dashboard replies are bound to the requested node, time out and reject when Core stops', async (t) => {
  const { core, desktop } = await setup(t);
  let requestId = '';
  const connection = core.getNodeConnection('dashboard-node')!;
  const send = connection.send.bind(connection);
  t.mock.method(connection, 'send', (raw: string) => {
    const message = parseNexusMessage(raw);
    if (message.type === 'node:dashboard:get') requestId = message.payload.requestId;
    send(raw);
  });
  let release!: (value: RuntimeDashboard) => void;
  t.mock.method(
    desktop.getRuntime()!,
    'getDashboard',
    async () =>
      new Promise<RuntimeDashboard>((resolve) => {
        release = resolve;
      })
  );
  let resolved = false;
  const pending = core.getNodeDashboard('dashboard-node').then((data) => {
    resolved = true;
    return data;
  });
  await core.processMessage(
    createNexusMessage('node:dashboard:result', { requestId, dashboard: snapshot }),
    'different-node'
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release(snapshot);
  assert.deepEqual(await pending, snapshot);
  await assert.rejects(core.getNodeDashboard('dashboard-node', 10), /Délai/);
  const stopping = core.getNodeDashboard('dashboard-node');
  const rejection = assert.rejects(stopping, /arrêté/);
  await core.stop();
  await rejection;
});

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
