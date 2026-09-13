import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { CodexApprovals } from '../../codex/approvals';
import { CodexApprovalRequest, RpcMessage } from '../../codex/types';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const request = (): CodexApprovalRequest => ({
  kind: 'command', threadId: 'thread', turnId: 'turn', itemId: 'item',
  details: 'npm test', expiresAt: Date.now() + 60_000,
});

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id, message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

function click(client: FakeTelegram, index = 0): TelegramUpdate {
  return { update_id: 10 + index, callback_query: {
    id: 'click', from: { id: 10 },
    data: client.approvals[index].keyboard.inline_keyboard[0][0].callback_data,
    message: { message_id: index + 1, chat: { id: 20, type: 'private' } },
  } };
}

suite('Telegram polling with approvals', () => {
  test('keeps polling during /codex and rejects a second prompt before starting another session', async t => {
    const client = new FakeTelegram();
    const finished = deferred<string>();
    let promptCalls = 0;
    const service = new TelegramService(context(), client, async () => {
      promptCalls++;
      return finished.promise;
    });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push(message(1, '/codex run tests'), message(2, '/codex second prompt'));
    await flush();
    assert.equal(promptCalls, 1);
    assert.ok(client.messages.includes('A Codex turn is already running.'));

    const replies: RpcMessage[] = [];
    const codex = new CodexApprovals(reply => {
      replies.push(reply);
      finished.resolve('Tests completed');
    }, (approval, signal) => service.requestApproval(approval, signal));
    codex.beginTurn('thread');
    codex.setTurnId('turn');
    codex.handleRequest({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: {
      threadId: 'thread', turnId: 'turn', itemId: 'item', command: 'npm test',
    } });
    await flush();
    client.push(click(client));
    await flush();
    assert.deepEqual(replies.map(reply => reply.result), [{ decision: 'accept' }]);
    assert.ok(client.messages.includes('Tests completed'));
  });

  test('stopping and restarting Telegram invalidates old buttons', async t => {
    const client = new FakeTelegram();
    const savedContext = context();
    const oldService = new TelegramService(savedContext, client);
    const oldPolling = oldService.start();
    const oldApproval = oldService.requestApproval(request(), new AbortController().signal);
    await flush();
    oldService.stop();
    assert.equal(await oldApproval, 'decline');
    await oldPolling;

    const service = new TelegramService(savedContext, client);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    const nextApproval = service.requestApproval(request(), new AbortController().signal);
    let nextSettled = false;
    void nextApproval.then(() => { nextSettled = true; });
    await flush();
    assert.notEqual(client.approvals[0].keyboard.inline_keyboard[0][0].callback_data,
      client.approvals[1].keyboard.inline_keyboard[0][0].callback_data);
    client.push(click(client, 0));
    await flush();
    assert.equal(nextSettled, false);
    assert.match(client.answers[0], /expirée ou déjà traitée/);
    client.push(click(client, 1));
    await flush();
    assert.equal(await nextApproval, 'accept');
  });

  test('stopped or unpaired Telegram refuses approval', async t => {
    const client = new FakeTelegram();
    const savedContext = context();
    const service = new TelegramService(savedContext, client);
    assert.equal(await service.requestApproval(request(), new AbortController().signal), 'decline');
    await savedContext.globalState.update('nexus.telegram.allowedUserId', undefined);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    assert.equal(await service.requestApproval(request(), new AbortController().signal), 'decline');
    assert.equal(client.approvals.length, 0);
  });

  test('re-pairing cancels pending approvals', async t => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    const result = service.requestApproval(request(), new AbortController().signal);
    await flush();
    client.push(message(1, `/pair ${service.createPairingCode()}`));
    await flush();
    assert.equal(await result, 'decline');
    assert.equal(client.closed.length, 1);
  });
});
