import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('child_process');
import { CodexClient } from '../../codex/client';
import { CodexService } from '../../codex/service';
import { FakeProcess } from './codex-process';
import { flush } from './helpers';

function setup(t: TestContext) {
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const service = new CodexService();
  t.after(() => { service.stop(); child.emit('exit', 0); });
  const calls = (method: string) => child.written.filter(message => message.method === method);
  return { child, spawn, service, calls };
}

suite('Codex session selection', () => {
  test('concurrent startup waits for one handshake and creates one session', async t => {
    const { child, spawn, service, calls } = setup(t);
    child.blockedMethods.add('initialize');
    const first = service.startSession('/project');
    const second = service.startSession('/project/.');
    await flush();
    assert.equal(spawn.mock.callCount(), 1);
    assert.equal(calls('initialize').length, 1);
    assert.equal(calls('thread/start').length, 0);
    assert.equal(service.getStatus().sessionChanging, true);
    child.receive({ id: calls('initialize')[0].id, result: {} });
    assert.deepEqual(await Promise.all([first, second]), ['thread', 'thread']);
    assert.equal(calls('thread/start').length, 1);
    assert.equal(service.getStatus().sessionChanging, false);
    assert.equal(await service.startSession('/project'), 'thread');
    assert.equal(calls('thread/start').length, 1);
  });

  test('the client itself shares initialization and can retry a failed handshake', async t => {
    const { child, spawn, calls } = setup(t);
    const client = new CodexClient();
    t.after(() => client.stop());
    child.blockedMethods.add('initialize');
    const first = client.start();
    const second = client.start();
    const failure = assert.rejects(first, /Initialization failed/);
    assert.equal(first, second);
    child.receive({ id: calls('initialize')[0].id, error: { code: -1, message: 'Initialization failed' } });
    await failure;
    assert.equal(client.getStatus().processRunning, false);
    const next = new FakeProcess();
    spawn.mock.mockImplementation(() => next);
    await client.start();
    assert.equal(spawn.mock.callCount(), 2);
    assert.equal(client.getStatus().processRunning, true);
  });

  test('new deliberately replaces the selected thread and resume restores the original without creating another', async t => {
    const { service, calls } = setup(t);
    const original = await service.startSession('/project');
    const fresh = await service.newSession('/project');
    assert.notEqual(fresh, original);
    assert.equal(service.getCurrentSessionId(), fresh);
    assert.equal(await service.resumeSession('/project', original), original);
    assert.equal(calls('thread/start').length, 2);
    assert.deepEqual(calls('thread/read')[0].params, { threadId: original, includeTurns: false });
    assert.deepEqual(calls('thread/resume')[0].params, {
      threadId: original, cwd: '/project', approvalPolicy: 'on-request',
      approvalsReviewer: 'user', sandbox: 'workspace-write',
    });
    await service.resumeSession('/project', original);
    assert.equal(calls('thread/resume').length, 1, 'already selected session must be reused');
  });

  test('new and prompts are rejected during session selection, without queued duplicates', async t => {
    const { service, child, calls } = setup(t);
    child.blockedMethods.add('thread/start');
    const first = service.newSession('/project');
    await flush();
    await assert.rejects(service.newSession('/project'), /déjà en cours/);
    await assert.rejects(service.resumeSession('/project', 'saved'), /déjà en cours/);
    await assert.rejects(service.startSession('/other'), /déjà en cours/);
    await assert.rejects(service.sendPrompt('hello', '/project'), /already running/);
    assert.equal(calls('thread/start').length, 1);
    child.receive({ id: calls('thread/start')[0].id, result: { thread: { id: 'thread', cwd: '/project' } } });
    assert.equal(await first, 'thread');
    assert.equal(calls('turn/start').length, 0);
  });

  test('a prompt reserves its session during startup and execution', async t => {
    const { service, child, calls } = setup(t);
    const turn = service.sendPrompt('hello', '/project');
    await assert.rejects(service.newSession('/project'), /turn Codex est en cours/);
    await assert.rejects(service.sendPrompt('second', '/project'), /already running/);
    await flush();
    await assert.rejects(service.resumeSession('/project', 'saved'), /turn Codex est en cours/);
    assert.equal(calls('thread/start').length, 1);
    assert.equal(calls('turn/start').length, 1);
    child.complete();
    assert.equal(await turn, 'Done');
    const next = service.sendPrompt('again', '/project');
    await flush();
    child.complete();
    await next;
    assert.equal(calls('thread/start').length, 1);
    assert.equal(calls('turn/start').length, 2);
  });

  test('foreign, missing and busy sessions are refused before resume; the old selection remains', async t => {
    const { service, child, calls } = setup(t);
    await service.startSession('/project');
    child.threads.set('foreign', { id: 'foreign', cwd: '/other' });
    child.threads.set('busy', { id: 'busy', cwd: '/project', status: { type: 'active' } });
    child.threads.set('no-cwd', { id: 'no-cwd' });
    for (const id of ['foreign', 'busy', 'no-cwd', 'missing']) {
      await assert.rejects(service.resumeSession('/project', id));
      assert.equal(service.getCurrentSessionId(), 'thread');
      assert.equal(service.isSessionActive(), true);
    }
    await assert.rejects(service.sendPrompt('hello', '/other'), /autre workspace/);
    assert.equal(calls('thread/resume').length, 0);
    assert.equal(calls('thread/start').length, 1);
    assert.equal(calls('turn/start').length, 0);
  });

  test('a failed resume preserves the old session and never falls back to creating a new one', async t => {
    const { service, child, calls } = setup(t);
    await service.startSession('/project');
    child.threads.set('saved', { id: 'saved', cwd: '/project' });
    child.blockedMethods.add('thread/resume');
    const pending = service.resumeSession('/project', 'saved');
    const failure = assert.rejects(pending, /Resume failed/);
    await flush();
    child.receive({ id: calls('thread/resume')[0].id, error: { code: -1, message: 'Resume failed' } });
    await failure;
    assert.equal(service.getCurrentSessionId(), 'thread');
    assert.equal(service.getStatus().sessionChanging, false);
    assert.equal(calls('thread/start').length, 1);
  });

  test('a remembered session is resumed on a new process, never silently recreated', async t => {
    const { service, child, spawn } = setup(t);
    await service.startSession('/project');
    child.emit('exit', 1);
    assert.equal(service.isSessionActive(), false);
    const next = new FakeProcess();
    next.threads.set('thread', { id: 'thread', cwd: '/project' });
    spawn.mock.mockImplementation(() => next);
    assert.equal(await service.startSession('/project'), 'thread');
    assert.equal(service.isSessionActive(), true);
    assert.equal(next.written.filter(message => message.method === 'thread/resume').length, 1);
    assert.equal(next.written.filter(message => message.method === 'thread/start').length, 0);
  });

  test('a lost remembered session remains unavailable even after the process is restarted', async t => {
    const { service, child, spawn } = setup(t);
    await service.startSession('/project');
    child.emit('exit', 1);
    const next = new FakeProcess();
    spawn.mock.mockImplementation(() => next);
    await assert.rejects(service.startSession('/project'), /not found/);
    assert.equal(service.getStatus().processRunning, true);
    assert.equal(service.getStatus().sessionActive, false);
    assert.equal(service.getCurrentSessionId(), 'thread');
    await assert.rejects(service.sendPrompt('hello', '/project'), /not found/);
    assert.equal(next.written.filter(message => message.method === 'thread/start').length, 0);
  });

  test('stop cancels startup and a late reply cannot restore a selection', async t => {
    const { service, child, calls } = setup(t);
    child.blockedMethods.add('thread/start');
    const pending = service.newSession('/project');
    const failure = assert.rejects(pending, /stopped/);
    await flush();
    service.stop();
    child.receive({ id: calls('thread/start')[0].id, result: { thread: { id: 'late', cwd: '/project' } } });
    await failure;
    assert.equal(service.getCurrentSessionId(), undefined);
    assert.equal(service.getStatus().sessionChanging, false);
  });

  test('invalid inputs and cancellation before startup never spawn Codex', async t => {
    const { service, spawn } = setup(t);
    await assert.rejects(service.startSession('relative'));
    await assert.rejects(service.resumeSession('/project', ' '));
    await assert.rejects(service.sendPrompt(' ', '/project'));
    const pending = service.startSession('/project');
    const cancelled = assert.rejects(pending, /annulée/);
    service.stop();
    await cancelled;
    assert.equal(spawn.mock.callCount(), 0);
  });
});
