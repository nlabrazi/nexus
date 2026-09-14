import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('child_process');
import { CodexService } from '../../codex/service';
import { FakeProcess } from './codex-process';
import { flush } from './helpers';

const breakdown = { totalTokens: 1500, inputTokens: 1000, cachedInputTokens: 400, outputTokens: 500, reasoningOutputTokens: 100 };
const usage = { total: breakdown, last: breakdown, modelContextWindow: 10000 };
function setup(t: TestContext) {
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const service = new CodexService();
  t.after(() => service.stop());
  return { child, service, spawn };
}

suite('Codex usage telemetry', () => {
  test('captures cumulative usage without double-counting and isolates session snapshots', async t => {
    const { child, service } = setup(t);
    await service.startSession('/project');
    const event = { method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: usage } };
    child.receive(event);
    const first = service.getStatus();
    child.receive(event);
    assert.deepEqual(service.getStatus().tokenUsage, usage);
    assert.equal(first.tokenUsage!.total.totalTokens, 1500);
    first.tokenUsage!.total.totalTokens = 0;
    assert.equal(service.getStatus().tokenUsage!.total.totalTokens, 1500);
    child.receive({ ...event, params: { ...event.params, threadId: 'other', tokenUsage: { ...usage, total: { ...breakdown, totalTokens: 9999 } } } });
    assert.equal(service.getStatus().tokenUsage!.total.totalTokens, 1500);
    child.receive({ ...event, params: { ...event.params, tokenUsage: { ...usage, total: { ...breakdown, totalTokens: -1 } } } });
    assert.equal(service.getStatus().tokenUsage!.total.totalTokens, 1500);
    await service.newSession('/project');
    assert.equal(service.getStatus().tokenUsage, undefined);
    await service.resumeSession('/project', 'thread');
    assert.deepEqual(service.getStatus().tokenUsage, usage);
    child.emit('exit', 0);
    assert.equal(service.getStatus().processRunning, false);
    assert.deepEqual(service.getStatus().tokenUsage, usage);
  });

  test('receives usage before the turn acknowledgement and after completion', async t => {
    const { child, service } = setup(t);
    await service.startSession('/project');
    child.blockedMethods.add('turn/start');
    const turn = service.sendPrompt('hello');
    await flush();
    child.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: usage } });
    assert.deepEqual(service.getStatus().tokenUsage, usage);
    child.receive({ id: child.written.find(message => message.method === 'turn/start')!.id, result: { turn: { id: 'turn' } } });
    await flush();
    child.complete();
    await turn;
    child.receive({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread', turnId: 'turn', tokenUsage: { ...usage, total: { ...breakdown, totalTokens: 1600 } } } });
    assert.equal(service.getStatus().tokenUsage!.total.totalTokens, 1600);
  });

  test('captures the actual configuration returned by start/resume', async t => {
    const { child, service } = setup(t);
    child.blockedMethods.add('thread/start');
    const pending = service.startSession('/project');
    await flush();
    child.receive({ id: child.written.find(message => message.method === 'thread/start')!.id, result: {
      thread: { id: 'thread', cwd: '/project' }, model: 'server-model', modelProvider: 'openai', reasoningEffort: 'high',
      serviceTier: 'fast', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' },
    } });
    await pending;
    const status = service.getStatus();
    assert.equal(status.model, 'server-model');
    assert.equal(status.reasoningEffort, 'high');
    assert.equal(status.sandbox, 'workspaceWrite');
    assert.equal(status.approvalPolicy, 'on-request');
    child.receive({ method: 'model/rerouted', params: { threadId: 'unrelated', turnId: 'turn', toModel: 'other-model' } });
    assert.equal(service.getStatus().reroutedModel, undefined);
    child.receive({ method: 'model/rerouted', params: { threadId: 'thread', turnId: 'turn', toModel: 'fallback-model' } });
    assert.equal(service.getStatus().reroutedModel, 'fallback-model');
  });

  test('status never spawns Codex, refreshes quotas only when connected, and keeps newer notifications', async t => {
    const { child, service, spawn } = setup(t);
    await service.refreshStatus();
    assert.equal(spawn.mock.callCount(), 0);
    await service.startSession('/project');
    await service.refreshStatus();
    assert.equal(service.getStatus().rateLimits![0].primary!.usedPercent, 25);
    child.blockedMethods.add('account/rateLimits/read');
    const pending = service.refreshStatus();
    const duplicate = service.refreshStatus();
    const reads = child.written.filter(message => message.method === 'account/rateLimits/read');
    assert.equal(reads.length, 2);
    child.receive({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 40 } } } });
    child.receive({ id: reads[1].id, result: { rateLimits: { limitId: 'codex', primary: { usedPercent: 30 } } } });
    await Promise.all([pending, duplicate]);
    assert.equal(service.getStatus().rateLimits![0].primary!.usedPercent, 40);
    const denied = service.refreshStatus();
    child.receive({ id: child.written.at(-1)!.id, error: { code: -32601, message: 'Account not supported' } });
    await denied;
    assert.equal(service.getStatus().rateLimitsUnavailable, true);
    assert.equal(service.getStatus().rateLimits![0].primary!.usedPercent, 40);
  });

  test('a quota timeout is nonfatal and cannot prevent subsequent prompts', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { child, service } = setup(t);
    await service.startSession('/project');
    child.blockedMethods.add('account/rateLimits/read');
    const pending = service.refreshStatus();
    t.mock.timers.tick(3000);
    await pending;
    assert.equal(service.getStatus().rateLimitsUnavailable, true);
    assert.equal(service.getStatus().sessionActive, true);
    const turn = service.sendPrompt('hello');
    await flush();
    child.complete();
    await turn;
  });

  test('quota buckets remain distinct and account changes invalidate an in-flight snapshot', async t => {
    const { child, service } = setup(t);
    await service.startSession('/project');
    child.blockedMethods.add('account/rateLimits/read');
    const pending = service.refreshStatus();
    child.receive({ id: child.written.at(-1)!.id, result: { rateLimitsByLimitId: {
      codex: { limitId: 'codex', primary: { usedPercent: 10 } },
      additional: { limitId: 'additional', primary: { usedPercent: 60 } },
    } } });
    await pending;
    child.receive({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'additional', primary: { usedPercent: 80 } } } });
    assert.deepEqual(service.getStatus().rateLimits!.map(limit => limit.primary!.usedPercent), [10, 80]);
    const refresh = service.refreshStatus();
    const id = child.written.at(-1)!.id;
    child.receive({ method: 'account/updated', params: { authMode: 'apikey' } });
    child.receive({ id, result: { rateLimits: { limitId: 'codex', primary: { usedPercent: 20 } } } });
    await refresh;
    assert.equal(service.getStatus().rateLimits, undefined);
  });
});
