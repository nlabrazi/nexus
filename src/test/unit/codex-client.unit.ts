import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { CodexClient } from '../../codex/client';
import { CodexService } from '../../codex/service';
import { ApprovalDecision } from '../../codex/types';
import { deferred, flush } from './helpers';
import { FakeProcess } from './codex-process';

suite('Codex process approval lifecycle', () => {
  test('routes a server request and writes an accept-once RPC response', async t => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const client = new CodexClient(async () => 'accept');
    t.after(() => client.stop());
    await client.start();
    const turn = client.runTurn('thread', 'Run tests');
    await flush();
    child.approve('rpc-approval');
    await flush();
    assert.deepEqual(child.written.find(message => message.id === 'rpc-approval')?.result, { decision: 'accept' });
    child.complete();
    assert.equal(await turn, 'Done');
  });

  test('a process crash invalidates approval; its delayed exit cannot cancel the next process approval', async t => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    let starts = 0;
    t.mock.method(childProcess, 'spawn', () => starts++ === 0 ? first : second);
    const decisions = [deferred<ApprovalDecision>(), deferred<ApprovalDecision>()];
    const signals: AbortSignal[] = [];
    const client = new CodexClient(async (_request, signal) => {
      const index = signals.length;
      signals.push(signal);
      return decisions[index].promise;
    });
    t.after(() => client.stop());
    await client.start();
    const firstTurn = client.runTurn('thread', 'First');
    const firstFailure = assert.rejects(firstTurn, { code: 'process_failed' });
    await flush();
    first.approve('old');
    await flush();
    first.emit('error', new Error('Transport crashed'));
    assert.equal(signals[0].aborted, true);
    await client.start();
    const secondTurn = client.runTurn('thread', 'Second');
    await flush();
    second.approve('new');
    await flush();
    first.emit('exit', 1);
    await firstFailure;
    assert.equal(signals[1].aborted, false);
    decisions[0].resolve('accept');
    decisions[1].resolve('accept');
    await flush();
    assert.equal(second.written.some(message => message.id === 'old'), false);
    assert.deepEqual(second.written.find(message => message.id === 'new')?.result, { decision: 'accept' });
    second.complete();
    assert.equal(await secondTurn, 'Done');
  });

  test('the existing turn timeout cancels any outstanding approval', async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    let signal!: AbortSignal;
    const decision = deferred<ApprovalDecision>();
    const client = new CodexClient(async (_request, value) => { signal = value; return decision.promise; });
    t.after(() => client.stop());
    await client.start();
    const turn = client.runTurn('thread', 'Run tests');
    const failure = assert.rejects(turn, { code: 'turn_timeout' });
    await flush();
    t.mock.timers.tick(100_000);
    child.approve('late-approval');
    await flush();
    t.mock.timers.tick(20_000);
    await failure;
    assert.equal(signal.aborted, true);
    decision.resolve('accept');
    await flush();
    assert.deepEqual(child.written.filter(message => message.id === 'late-approval').map(message => message.result), [{ decision: 'decline' }]);
  });
});

suite('Codex status snapshots', () => {
  test('reading status is passive and follows session, turn and approval lifecycle', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const child = new FakeProcess();
    const spawn = t.mock.method(childProcess, 'spawn', () => child);
    const decision = deferred<ApprovalDecision>();
    const service = new CodexService(async () => decision.promise);
    t.after(() => service.stop());

    const initial = service.getStatus();
    assert.equal(initial.processRunning, false);
    assert.equal(initial.sessionId, undefined);
    assert.equal(initial.turn, undefined);
    assert.equal(initial.pendingApprovals, 0);
    assert.equal(spawn.mock.callCount(), 0);

    await service.startSession('/project');
    const idle = service.getStatus();
    assert.equal(idle.processRunning, true);
    assert.equal(idle.sessionId, 'thread');
    assert.equal(idle.workspacePath, '/project');
    assert.equal(idle.turn, undefined);

    child.blockedMethods.add('turn/start');
    const turn = service.sendPrompt('Run tests');
    await flush();
    const starting = service.getStatus();
    assert.deepEqual(starting.turn, { startedAt: 1000 });
    child.receive({ id: child.written.find(message => message.method === 'turn/start')!.id,
      result: { turn: { id: 'turn' } } });
    await flush();
    const running = service.getStatus();
    assert.equal(running.turn?.id, 'turn');
    assert.equal(starting.turn?.id, undefined, 'snapshots must not change retrospectively');
    child.approve('approval');
    await flush();
    assert.equal(service.getStatus().pendingApprovals, 1);
    decision.resolve('decline');
    await flush();
    assert.equal(service.getStatus().pendingApprovals, 0);
    assert.equal(service.getStatus().turn?.id, 'turn');
    child.complete();
    await turn;
    assert.equal(service.getStatus().turn, undefined);
    assert.equal(service.getStatus().sessionId, 'thread');
    service.stop();
    assert.deepEqual(service.getStatus(), initial);
  });

  test('a process exit removes live activity but preserves the known session in the status', async t => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const service = new CodexService();
    t.after(() => service.stop());
    await service.startSession('/project');
    const turn = service.sendPrompt('Run tests');
    const failure = assert.rejects(turn, { code: 'process_failed' });
    await flush();
    child.emit('exit', 1);
    await failure;
    const status = service.getStatus();
    assert.equal(status.processRunning, false);
    assert.equal(status.turn, undefined);
    assert.equal(status.pendingApprovals, 0);
    assert.equal(status.sessionId, 'thread');
    assert.equal(status.workspacePath, '/project');
  });
});
