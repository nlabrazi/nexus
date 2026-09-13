import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { CodexClient } from '../../codex/client';
import { ApprovalDecision, RpcMessage } from '../../codex/types';
import { deferred, flush } from './helpers';

class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: RpcMessage[] = [];

  constructor() {
    super();
    this.stdin.on('data', chunk => {
      const message = JSON.parse(chunk.toString()) as RpcMessage;
      this.written.push(message);
      if (message.method === 'initialize') {
        this.receive({ id: message.id, result: {} });
      } else if (message.method === 'turn/start') {
        this.receive({ id: message.id, result: { turn: { id: 'turn' } } });
      }
    });
  }

  receive(message: RpcMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  approve(id: string): void {
    this.receive({ id, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'thread', turnId: 'turn', itemId: 'item', command: 'npm test',
    } });
  }

  complete(): void {
    this.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', delta: 'Done' } });
    this.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  }

  kill(): boolean { return true; }
}

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
    const firstFailure = assert.rejects(firstTurn, /exited/);
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
    const failure = assert.rejects(turn, /turn timeout/);
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
