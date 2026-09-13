import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { CodexService } from '../../codex/service';
import { TelegramService } from '../../telegram/service';
import { WorkspaceError } from '../../workspace/guard';
import { FakeProcess } from './codex-process';
import { context, deferred, FakeTelegram, flush } from './helpers';
import { TelegramUpdate } from '../../telegram/types';

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id, message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

suite('End-to-end regression scenarios with simulated transports', () => {
  test('restart uses the persisted offset and never replays duplicate commands', async t => {
    const saved = context();
    const client = new FakeTelegram();
    const polls = t.mock.method(client, 'getUpdates');
    let calls = 0;
    const first = new TelegramService(saved, client, async () => { calls++; return 'Done'; });
    const oldPolling = first.start();
    client.push(message(40, '/codex first'));
    await flush();
    first.stop();
    await oldPolling;
    const second = new TelegramService(saved, client, async () => { calls++; return 'Done'; });
    const polling = second.start();
    t.after(async () => { second.stop(); await polling; });
    assert.equal(polls.mock.calls.at(-1)?.arguments[0], 41);
    // Simulate a stale response and duplicates in a received batch.
    client.push(message(40, '/codex stale'), message(41, '/codex next'), message(41, '/codex duplicate'));
    await flush();
    assert.equal(calls, 2);
    assert.equal(saved.globalState.get('nexus.telegram.updateOffset'), 42);
    assert.equal(client.messages.filter(text => /already running/.test(text)).length, 0);
  });

  test('Telegram replacement during a turn keeps the Codex lock and suppresses the old reply', async t => {
    const child = new FakeProcess();
    const spawn = t.mock.method(childProcess, 'spawn', () => child);
    const codex = new CodexService();
    const saved = context();
    const oldClient = new FakeTelegram();
    const first = new TelegramService(saved, oldClient, prompt => codex.sendPrompt(prompt, '/project'));
    const oldPolling = first.start();
    first.start();
    oldClient.push(message(1, '/codex first'));
    await flush();
    first.stop();
    await oldPolling;
    const client = new FakeTelegram();
    const second = new TelegramService(saved, client, prompt => codex.sendPrompt(prompt, '/project'));
    const polling = second.start();
    t.after(async () => { second.stop(); codex.stop(); await polling; });
    client.push(message(2, '/codex duplicate'));
    await flush();
    assert.match(client.messages.at(-1)!, /already running/);
    assert.equal(spawn.mock.callCount(), 1);
    child.complete();
    await flush();
    assert.equal(oldClient.messages.includes('Done'), false);
    client.push(message(3, '/codex next'));
    await flush();
    child.complete();
    await flush();
    assert.equal(client.messages.at(-1), 'Done');
    assert.equal(child.written.filter(item => item.method === 'thread/start').length, 1);
  });

  for (const failure of ['missing-workspace', 'missing-codex', 'crash'] as const) {
    test(`${failure} reaches Telegram and permits an explicit retry without queued prompts`, async t => {
      const child = new FakeProcess();
      let broken = true;
      const spawn = t.mock.method(childProcess, 'spawn', () => {
        if (broken && failure === 'missing-codex') { throw Object.assign(new Error('Missing'), { code: 'ENOENT' }); }
        return child;
      });
      const codex = new CodexService(undefined, async () => {
        if (broken && failure === 'missing-workspace') { throw new WorkspaceError('workspace_missing', 'Le dossier du workspace est absent.'); }
        return { root: '/project' };
      });
      const client = new FakeTelegram();
      const service = new TelegramService(context(), client, prompt => codex.sendPrompt(prompt, '/project'));
      const polling = service.start();
      t.after(async () => { service.stop(); codex.stop(); await polling; });
      client.push(message(1, '/codex first'));
      await flush();
      if (failure === 'crash') { child.emit('exit', 1); await flush(); }
      assert.match(client.messages.at(-1)!, /❌/);
      assert.match(client.messages.at(-1)!, failure === 'missing-workspace' ? /workspace est absent/ : failure === 'missing-codex' ? /introuvable/ : /perdue/);
      if (failure === 'missing-workspace') { assert.equal(spawn.mock.callCount(), 0); }
      assert.equal(codex.isTurnRunning(), false);
      broken = false;
      const next = new FakeProcess();
      if (failure === 'crash') { next.threads.set('thread', child.threads.get('thread')!); }
      spawn.mock.mockImplementation(() => next);
      client.push(message(2, '/codex retry'));
      await flush();
      next.complete();
      await flush();
      assert.equal(client.messages.at(-1), 'Done');
      assert.equal(next.written.filter(item => item.method === 'turn/start').length, 1);
    });
  }

  test('a late polling response after stop cannot execute commands in the restarted service', async t => {
    const client = new FakeTelegram();
    const oldResponse = deferred<{ ok: boolean; result: TelegramUpdate[] }>();
    const original = client.getUpdates.bind(client);
    let calls = 0;
    t.mock.method(client, 'getUpdates', (offset: number, signal?: AbortSignal) => ++calls === 1 ? oldResponse.promise : original(offset, signal));
    let prompts = 0;
    const service = new TelegramService(context(), client, async () => { prompts++; return 'Done'; });
    const first = service.start();
    service.stop();
    const second = service.start();
    t.after(async () => { service.stop(); oldResponse.resolve({ ok: true, result: [] }); await Promise.all([first, second]); });
    oldResponse.resolve({ ok: true, result: [message(1, '/codex late')] });
    await flush();
    assert.equal(prompts, 0);
    client.push(message(2, '/codex current'));
    await flush();
    assert.equal(prompts, 1);
    assert.equal(client.messages.at(-1), 'Done');
  });
});
