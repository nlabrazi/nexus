import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { CodexService } from '../../codex/service';
import { CodexError } from '../../codex/errors';
import { TelegramService } from '../../telegram/service';
import { FakeProcess } from './codex-process';
import { context, FakeTelegram, flush } from './helpers';

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const service = new CodexService();
  t.after(() => service.stop());
  const calls = (method: string) => child.written.filter((message) => message.method === method);
  return { child, spawn, service, calls };
}

function finish(child: FakeProcess, status = 'completed', turnId = 'turn') {
  child.receive({
    method: 'turn/completed',
    params: { threadId: 'thread', turn: { id: turnId, status } },
  });
}

function item(child: FakeProcess, text: string, phase?: string, id = 'answer', turnId = 'turn') {
  child.receive({
    method: 'item/completed',
    params: {
      threadId: 'thread',
      turnId,
      item: { id, type: 'agentMessage', text, phase },
    },
  });
}

suite('Codex process failures', () => {
  for (const mode of ['sync', 'async']) {
    test(`Codex absent (${mode}) releases startup and allows an explicit retry`, async (t) => {
      const { child, spawn, service } = setup(t);
      const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      child.blockedMethods.add('initialize');
      if (mode === 'sync') {
        spawn.mock.mockImplementation(() => {
          throw missing;
        });
      }
      const prompt = service.sendPrompt('hello', '/project');
      const failure = assert.rejects(prompt, { code: 'not_installed' });
      await flush();
      if (mode === 'async') {
        child.emit('error', missing);
      }
      await failure;
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.getStatus().processRunning, false);
      assert.equal(service.getCurrentSessionId(), undefined);
      const next = new FakeProcess();
      spawn.mock.mockImplementation(() => next);
      assert.equal(await service.startSession('/project'), 'thread');
      assert.equal(spawn.mock.callCount(), 2);
    });
  }

  for (const event of [
    'process error',
    'process exit',
    'stdin error',
    'stdout error',
    'stderr error',
    'stdout end',
    'stop',
  ]) {
    test(`${event} ends the prompt without waiting for exit or a timeout`, async (t) => {
      const { child, service } = setup(t);
      const prompt = service.sendPrompt('hello', '/project');
      let reported = false;
      const failure = assert
        .rejects(prompt, { code: event === 'stop' ? 'stopped' : 'process_failed' })
        .then(() => {
          reported = true;
        });
      await flush();
      if (event === 'stop') {
        service.stop();
      } else if (event === 'process exit') {
        child.emit('exit', null, 'SIGKILL');
      } else if (event === 'process error') {
        child.emit('error', new Error('crash'));
      } else if (event === 'stdout end') {
        child.stdout.emit('end');
      } else {
        child[event.split(' ')[0] as 'stdin' | 'stdout' | 'stderr'].emit(
          'error',
          new Error('broken pipe')
        );
      }
      await flush();
      assert.equal(reported, true, 'a transport error must settle the active prompt immediately');
      await failure;
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.getStatus().turn, undefined);
      assert.equal(service.getStatus().processRunning, false);
      assert.equal(service.getCurrentSessionId(), event === 'stop' ? undefined : 'thread');
    });
  }

  test('an asynchronous stdin write failure cannot leave a pending turn', async (t) => {
    const { child, service } = setup(t);
    await service.startSession('/project');
    t.mock.method(child.stdin, 'write', (...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error) => void;
      queueMicrotask(() => callback(new Error('EPIPE')));
      return true;
    });
    await assert.rejects(service.sendPrompt('hello'), { code: 'process_failed' });
    assert.equal(service.getStatus().processRunning, false);
    assert.equal(service.isTurnRunning(), false);
  });

  test('malformed stdout fails the request without throwing into the extension host', async (t) => {
    const { child, service } = setup(t);
    const prompt = service.sendPrompt('hello', '/project');
    const failure = assert.rejects(prompt, { code: 'protocol_error' });
    await flush();
    assert.doesNotThrow(() => child.stdout.write('null\n'));
    await failure;
    assert.equal(service.getStatus().processRunning, false);
    assert.equal(child.kills, 1);
  });
});

suite('Codex timeout cancellation', () => {
  test('an interrupt acknowledgement keeps the lock until the terminal notification', async (t) => {
    const { child, service, calls } = setup(t);
    child.blockedMethods.add('turn/interrupt');
    const prompt = service.sendPrompt('slow', '/project');
    const failure = assert.rejects(prompt, (error: unknown) => {
      assert.ok(error instanceof CodexError);
      assert.equal(error.code, 'turn_timeout');
      assert.match(error.message, /confirmé la fin/);
      return true;
    });
    await flush();
    t.mock.timers.tick(120_000);
    await flush();
    assert.equal(service.getStatus().turn?.interrupting, true);
    assert.deepEqual(calls('turn/interrupt')[0].params, { threadId: 'thread', turnId: 'turn' });
    child.receive({ id: calls('turn/interrupt')[0].id, result: {} });
    await flush();
    assert.equal(service.isTurnRunning(), true);
    await assert.rejects(service.sendPrompt('second'), /already running/);
    await assert.rejects(service.newSession('/project'), /turn Codex est en cours/);
    finish(child, 'interrupted');
    await failure;
    assert.equal(service.isTurnRunning(), false);
    assert.equal(service.isSessionActive(), true);
    assert.equal(child.kills, 0);
    assert.equal(calls('turn/start').length, 1);
    const next = service.sendPrompt('next');
    await flush();
    child.complete();
    assert.equal(await next, 'Done');
  });

  for (const response of ['missing', 'acknowledged', 'rejected']) {
    test(`an interrupt ${response} without confirmed completion closes the transport`, async (t) => {
      const { child, service, calls } = setup(t);
      child.blockedMethods.add('turn/interrupt');
      const prompt = service.sendPrompt('slow', '/project');
      const failure = assert.rejects(prompt, (error: unknown) => {
        assert.ok(error instanceof CodexError);
        assert.equal(error.code, 'turn_timeout');
        assert.match(error.message, /n’a pas été confirmée/);
        return true;
      });
      await flush();
      t.mock.timers.tick(120_000);
      if (response === 'acknowledged') {
        child.receive({ id: calls('turn/interrupt')[0].id, result: {} });
      }
      if (response === 'rejected') {
        child.receive({
          id: calls('turn/interrupt')[0].id,
          error: { code: -1, message: 'Cannot interrupt' },
        });
      }
      await flush();
      t.mock.timers.tick(5000);
      await failure;
      assert.equal(service.getStatus().turn, undefined);
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.getStatus().processRunning, false);
      assert.equal(service.isSessionActive(), false);
      assert.equal(service.getCurrentSessionId(), 'thread');
      assert.equal(child.kills, 1);
      assert.equal(calls('turn/start').length, 1, 'the instruction must never be replayed');
      child.complete();
      assert.equal(
        service.getStatus().turn,
        undefined,
        'late completion must not restore activity'
      );
    });
  }

  test('a late interrupt RPC timeout cannot cancel the following turn', async (t) => {
    const { child, service } = setup(t);
    child.blockedMethods.add('turn/interrupt');
    const prompt = service.sendPrompt('slow', '/project');
    const failure = assert.rejects(prompt, { code: 'turn_timeout' });
    await flush();
    t.mock.timers.tick(120_000);
    finish(child, 'interrupted');
    await failure;
    const next = service.sendPrompt('next');
    await flush();
    t.mock.timers.tick(5000);
    await flush();
    assert.equal(service.isTurnRunning(), true);
    assert.equal(service.isSessionActive(), true);
    child.complete();
    assert.equal(await next, 'Done');
  });

  for (const method of ['initialize', 'thread/start', 'thread/resume', 'turn/start']) {
    test(`${method} RPC timeout releases reservations without retrying`, async (t) => {
      const { child, service, calls } = setup(t);
      child.blockedMethods.add(method);
      child.threads.set('saved', { id: 'saved', cwd: '/project' });
      const pending =
        method === 'thread/resume'
          ? service.resumeSession('/project', 'saved')
          : service.sendPrompt('hello', '/project');
      const failure = assert.rejects(pending, { code: 'rpc_timeout' });
      await flush();
      t.mock.timers.tick(15_000);
      await failure;
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.getStatus().sessionChanging, false);
      assert.equal(service.getStatus().processRunning, false);
      assert.equal(calls(method).length, 1);
      child.receive({
        id: calls(method)[0].id,
        result: { thread: { id: 'late', cwd: '/project' }, turn: { id: 'late' } },
      });
      assert.notEqual(service.getCurrentSessionId(), 'late');
      assert.equal(service.getStatus().turn, undefined);
    });
  }
});

suite('Codex response and session errors', () => {
  for (const response of ['absent', 'commentary only', 'empty final']) {
    test(`an ${response} response is an error, with no replay`, async (t) => {
      const { child, service, calls } = setup(t);
      const prompt = service.sendPrompt('hello', '/project');
      const failure = assert.rejects(prompt, { code: 'empty_response' });
      await flush();
      if (response === 'commentary only') {
        item(child, 'Je vais vérifier.', 'commentary');
      }
      if (response === 'empty final') {
        child.receive({
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'thread',
            turnId: 'turn',
            itemId: 'answer',
            delta: 'Partial text',
          },
        });
        item(child, '   ', 'final_answer');
      }
      finish(child);
      await failure;
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.isSessionActive(), true);
      assert.equal(calls('turn/start').length, 1);
      const next = service.sendPrompt('next');
      await flush();
      child.complete();
      assert.equal(await next, 'Done');
    });
  }

  test('completed final text takes precedence over streamed commentary and partial deltas', async (t) => {
    const { child, service } = setup(t);
    const prompt = service.sendPrompt('hello', '/project');
    await flush();
    item(child, 'Je vais vérifier.', 'commentary', 'progress');
    child.receive({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread',
        turnId: 'turn',
        itemId: 'answer',
        delta: 'Partiel',
      },
    });
    item(child, 'Réponse finale complète.', 'final_answer');
    finish(child);
    assert.equal(await prompt, 'Réponse finale complète.');
  });

  test('early notifications are retained only for the acknowledged turn', async (t) => {
    const { child, service, calls } = setup(t);
    child.blockedMethods.add('turn/start');
    const prompt = service.sendPrompt('hello', '/project');
    await flush();
    item(child, 'Ancienne réponse', 'final_answer', 'old', 'old-turn');
    finish(child, 'completed', 'old-turn');
    item(child, 'Nouvelle réponse', 'final_answer', 'new', 'new-turn');
    finish(child, 'completed', 'new-turn');
    child.receive({ id: calls('turn/start')[0].id, result: { turn: { id: 'new-turn' } } });
    assert.equal(await prompt, 'Nouvelle réponse');
  });

  test('final items in turn/completed are usable when item notifications are missing', async (t) => {
    const { child, service } = setup(t);
    const prompt = service.sendPrompt('hello', '/project');
    await flush();
    child.receive({
      method: 'turn/completed',
      params: {
        threadId: 'thread',
        turn: {
          id: 'turn',
          status: 'completed',
          items: [
            {
              id: 'answer',
              type: 'agentMessage',
              text: 'Réponse récupérée',
              phase: 'final_answer',
            },
          ],
        },
      },
    });
    assert.equal(await prompt, 'Réponse récupérée');
  });

  for (const status of ['failed', 'interrupted']) {
    test(`a ${status} terminal turn cannot return a partial response as success`, async (t) => {
      const { child, service } = setup(t);
      const prompt = service.sendPrompt('hello', '/project');
      const failure = assert.rejects(prompt, {
        code: status === 'failed' ? 'turn_failed' : 'interrupted',
      });
      await flush();
      item(child, 'Partiel', 'final_answer');
      finish(child, status);
      await failure;
      assert.equal(service.isTurnRunning(), false);
      assert.equal(service.isSessionActive(), true);
    });
  }

  test('a lost session on a live process becomes inactive without creating a replacement', async (t) => {
    const { child, service, calls } = setup(t);
    await service.startSession('/project');
    child.blockedMethods.add('turn/start');
    const prompt = service.sendPrompt('hello');
    const failure = assert.rejects(prompt, { code: 'session_lost' });
    await flush();
    child.receive({
      id: calls('turn/start')[0].id,
      error: { code: -32600, message: 'thread not found: thread' },
    });
    await failure;
    assert.equal(service.isSessionActive(), false);
    assert.equal(service.getCurrentSessionId(), 'thread');
    child.threads.delete('thread');
    await assert.rejects(service.sendPrompt('again'), { code: 'session_lost' });
    assert.equal(calls('thread/start').length, 1);
    assert.equal(calls('turn/start').length, 1);
    assert.notEqual(await service.newSession('/project'), 'thread');
  });

  test('Telegram reports a missing Codex and accepts a new instruction after the error', async (t) => {
    const { child, service, spawn } = setup(t);
    child.blockedMethods.add('initialize');
    const telegram = new FakeTelegram();
    const bridge = new TelegramService(context(), telegram, (prompt) =>
      service.sendPrompt(prompt, '/project')
    );
    const polling = bridge.start();
    t.after(async () => {
      bridge.stop();
      await polling;
    });
    const send = (id: number) =>
      telegram.push({
        update_id: id,
        message: {
          text: '/codex hello',
          from: { id: 10 },
          chat: { id: 20, type: 'private' },
        },
      });
    send(1);
    await flush();
    child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await flush();
    assert.match(telegram.messages.at(-1)!, /^❌ Codex est introuvable/);
    assert.equal(spawn.mock.callCount(), 1);
    const next = new FakeProcess();
    spawn.mock.mockImplementation(() => next);
    send(2);
    await flush();
    next.complete();
    await flush();
    assert.equal(telegram.messages.at(-1), 'Done');
    assert.equal(spawn.mock.callCount(), 2);
  });
});
