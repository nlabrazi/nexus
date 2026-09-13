import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('child_process');
import { CodexService } from '../../codex/service';
import { TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { FakeProcess } from './codex-process';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string, user = 10, chat = 20, type = 'private'): TelegramUpdate => ({
  update_id: id, message: { text, from: { id: user }, chat: { id: chat, type } },
});
function setup(t: TestContext) {
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  let telegram!: TelegramService;
  const codex = new CodexService((request, signal) => telegram.requestApproval(request, signal));
  const client = new FakeTelegram();
  telegram = new TelegramService(context(), client, prompt => codex.sendPrompt(prompt, '/project'),
    () => ({ workspaceCount: 1, codex: codex.getStatus() }),
    action => action.type === 'new' ? codex.newSession('/project') : codex.resumeSession('/project', action.sessionId),
    () => codex.cancelCurrentWork());
  const polling = telegram.start();
  t.after(async () => { telegram.stop(); codex.stop(); await polling; });
  return { child, spawn, codex, client };
}

suite('Telegram /stop', () => {
  test('idle stop and invalid arguments never spawn or remove a selected session', async t => {
    const { client, spawn, codex, child } = setup(t);
    client.push(message(1, '/stop'), message(2, '/stop now'));
    await flush();
    assert.equal(spawn.mock.callCount(), 0);
    assert.deepEqual(client.messages, ['⚪ Aucune requête Codex en cours.', 'Usage : /stop']);
    await codex.startSession('/project');
    client.push(message(3, ' /stop '));
    await flush();
    assert.equal(codex.getCurrentSessionId(), 'thread');
    assert.equal(codex.isSessionActive(), true);
    assert.equal(child.kills, 0);
  });

  test('only the paired user in the paired private chat can stop work', async t => {
    const { client, child, codex } = setup(t);
    client.push(message(1, '/codex wait'));
    await flush();
    client.push(message(2, '/stop', 99), message(3, '/stop', 10, 99), message(4, '/stop', 10, 20, 'group'));
    await flush();
    assert.equal(child.kills, 0);
    assert.equal(codex.isTurnRunning(), true);
    client.push(message(5, '/stop'));
    await flush();
    assert.equal(child.kills, 1);
    assert.equal(codex.isTurnRunning(), false);
    assert.equal(client.messages.filter(text => text.startsWith('⏹')).length, 1);
    assert.equal(client.messages.some(text => text.startsWith('❌')), false, 'no duplicate cancellation error');
  });

  test('stops pending approvals and resumes the same session on an explicit next prompt', async t => {
    const { client, child, codex, spawn } = setup(t);
    client.push(message(1, '/codex wait'));
    await flush();
    child.approve('approval');
    await flush();
    assert.equal(client.approvals.length, 1);
    client.push(message(2, '/stop'));
    await flush();
    assert.equal(codex.getStatus().pendingApprovals, 0);
    assert.equal(client.closed.length, 1);
    assert.equal(codex.getCurrentSessionId(), 'thread');
    assert.equal(codex.isSessionActive(), false);
    const next = new FakeProcess();
    next.threads.set('thread', { id: 'thread', cwd: '/project' });
    spawn.mock.mockImplementation(() => next);
    client.push(message(3, '/codex answer'));
    await flush();
    child.complete();
    child.emit('exit', 1);
    assert.equal(codex.isTurnRunning(), true);
    next.complete();
    await flush();
    assert.equal(client.messages.at(-1), 'Done');
    assert.equal(next.written.some(item => item.method === 'thread/start'), false);
    assert.equal(next.written.filter(item => item.method === 'thread/resume').length, 1);
  });

  test('cancels session startup and ignores its late reply', async t => {
    const { client, child, codex } = setup(t);
    child.blockedMethods.add('thread/start');
    client.push(message(1, '/new'));
    await flush();
    const request = child.written.find(item => item.method === 'thread/start')!;
    client.push(message(2, '/stop'));
    await flush();
    child.receive({ id: request.id, result: { thread: { id: 'late', cwd: '/project' } } });
    await flush();
    assert.equal(codex.getCurrentSessionId(), undefined);
    assert.equal(codex.getStatus().sessionChanging, false);
    assert.equal(client.messages.length, 1);
    assert.match(client.messages[0], /Requête annulée/);
  });

  test('an old completion cannot release a newer prompt reservation or deliver stale text', async t => {
    const client = new FakeTelegram();
    const old = deferred<string>();
    const next = deferred<string>();
    let calls = 0;
    const service = new TelegramService(context(), client, () => ++calls === 1 ? old.promise : next.promise,
      undefined, undefined, () => true);
    const polling = service.start();
    t.after(async () => { service.stop(); old.resolve('Old'); next.resolve('New'); await polling; });
    client.push(message(1, '/codex old'));
    await flush();
    client.push(message(2, '/stop'), message(3, '/codex next'));
    await flush();
    old.resolve('Old');
    await flush();
    client.push(message(4, '/codex duplicate'));
    await flush();
    assert.equal(calls, 2);
    assert.equal(client.messages.includes('Old'), false);
    assert.match(client.messages.at(-1)!, /already running/);
    next.resolve('New');
    await flush();
    assert.equal(client.messages.at(-1), 'New');
  });

  test('stop before the working message is delivered prevents starting Codex', async t => {
    const client = new FakeTelegram();
    const delivery = deferred<void>();
    t.mock.method(client, 'sendMessage', async (_chat: number, text: string) => {
      client.messages.push(text);
      if (text.startsWith('⏳')) { await delivery.promise; }
    });
    let prompts = 0;
    const service = new TelegramService(context(), client, async () => { prompts++; return 'Unexpected'; },
      undefined, undefined, () => false);
    const polling = service.start();
    t.after(async () => { service.stop(); delivery.resolve(); await polling; });
    client.push(message(1, '/codex pending'));
    await flush();
    client.push(message(2, '/stop'));
    await flush();
    delivery.resolve();
    await flush();
    assert.equal(prompts, 0);
    assert.match(client.messages.at(-1)!, /Requête annulée/);
  });

  test('cancels workspace validation without spawning Codex', async t => {
    const ready = deferred<void>();
    const spawn = t.mock.method(childProcess, 'spawn', () => assert.fail('must not spawn'));
    const codex = new CodexService(undefined, async () => { await ready.promise; return { root: '/project' }; });
    t.after(() => codex.stop());
    const pending = codex.sendPrompt('wait', '/project');
    const cancelled = assert.rejects(pending, /annulée/);
    assert.equal(codex.cancelCurrentWork(), true);
    ready.resolve();
    await cancelled;
    assert.equal(spawn.mock.callCount(), 0);
    assert.equal(codex.cancelCurrentWork(), false);
  });
});
