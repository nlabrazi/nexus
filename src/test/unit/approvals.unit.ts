import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { CodexApprovals } from '../../codex/approvals';
import {
  ApprovalDecision,
  CodexApprovalRequest,
  RpcMessage,
  RpcServerRequest,
} from '../../codex/types';
import { TelegramApprovals } from '../../telegram/approvals';
import { TelegramCallbackQuery } from '../../telegram/types';
import { deferred, FakeTelegram, flush } from './helpers';

const serverRequest = (id: number | string = 1): RpcServerRequest => ({
  id,
  method: 'item/commandExecution/requestApproval',
  params: {
    threadId: 'thread',
    turnId: 'turn',
    itemId: 'item',
    command: 'npm test',
    cwd: '/project',
  },
});

const approvalRequest = (): CodexApprovalRequest => ({
  kind: 'command',
  threadId: 'thread',
  turnId: 'turn',
  itemId: 'item',
  details: 'Commande : npm test\nWorkspace : /project',
  expiresAt: Date.now() + 60_000,
});

function callback(client: FakeTelegram, index = 0, action = 0): TelegramCallbackQuery {
  return {
    id: 'callback',
    from: { id: 10 },
    data: client.approvals[index].keyboard.inline_keyboard[0][action].callback_data,
    message: { message_id: client.approvals[index].messageId, chat: { id: 20, type: 'private' } },
  };
}

suite('Codex approval protocol', () => {
  test('accepts once, supports string RPC IDs and ignores duplicate pending requests', async () => {
    const replies: RpcMessage[] = [];
    const decision = deferred<ApprovalDecision>();
    let calls = 0;
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => {
        calls++;
        return decision.promise;
      }
    );
    approvals.beginTurn('thread');
    approvals.setTurnId('turn');
    approvals.handleRequest(serverRequest('rpc-42'));
    approvals.handleRequest(serverRequest('rpc-42'));
    await flush();
    decision.resolve('accept');
    await flush();
    assert.equal(calls, 1);
    assert.deepEqual(replies, [{ jsonrpc: '2.0', id: 'rpc-42', result: { decision: 'accept' } }]);
  });

  test('declines without a handler, outside the active turn, or on invalid params', () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals((reply) => replies.push(reply));
    approvals.beginTurn('thread');
    approvals.handleRequest(serverRequest());
    const guarded = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => 'accept'
    );
    guarded.handleRequest(serverRequest(2));
    guarded.beginTurn('other-thread');
    guarded.handleRequest(serverRequest(3));
    guarded.beginTurn('thread');
    guarded.setTurnId('other-turn');
    guarded.handleRequest(serverRequest(4));
    guarded.handleRequest({ ...serverRequest(5), params: null });
    assert.equal(replies.length, 5);
    assert.ok(
      replies.every((reply) => (reply.result as { decision: string }).decision === 'decline')
    );
  });

  test('refuses turn/session permissions and returns an RPC error for unsupported methods', () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals((reply) => replies.push(reply));
    approvals.handleRequest({ id: 1, method: 'item/permissions/requestApproval' });
    approvals.handleRequest({ id: 2, method: 'unknown/request' });
    assert.deepEqual(replies[0].result, { permissions: {}, scope: 'turn' });
    assert.equal(replies[1].error?.code, -32601);
  });

  test('rejects accept when availableDecisions excludes it', () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => 'accept'
    );
    approvals.beginTurn('thread');
    approvals.handleRequest({
      ...serverRequest(),
      params: {
        ...(serverRequest().params as object),
        availableDecisions: ['cancel', 'acceptForSession'],
      },
    });
    assert.deepEqual(replies[0].result, { decision: 'decline' });
  });

  test('refuses requests without a reviewable action', () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => 'accept'
    );
    approvals.beginTurn('thread');
    approvals.setTurnId('turn');
    const params = { threadId: 'thread', turnId: 'turn', itemId: 'item' };
    approvals.handleRequest({ ...serverRequest(), params });
    approvals.handleRequest({ id: 2, method: 'item/fileChange/requestApproval', params });
    assert.deepEqual(
      replies.map((reply) => reply.result),
      [{ decision: 'decline' }, { decision: 'decline' }]
    );
  });

  test('an early approval cannot authorize a turn whose ID is still unknown', async () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => 'accept'
    );
    approvals.beginTurn('thread');
    approvals.handleRequest(serverRequest());
    await flush();
    assert.deepEqual(replies[0].result, { decision: 'decline' });
  });

  test('managed network approvals display the destination without requiring a command', async () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async (request) => {
        assert.match(request.details, /example.com/);
        return 'accept';
      }
    );
    approvals.beginTurn('thread');
    approvals.setTurnId('turn');
    approvals.handleRequest({
      ...serverRequest(),
      params: {
        threadId: 'thread',
        turnId: 'turn',
        itemId: 'item',
        networkApprovalContext: { host: 'example.com', protocol: 'https' },
      },
    });
    await flush();
    assert.deepEqual(replies[0].result, { decision: 'accept' });
  });

  test('shows file changes from item/started before requesting approval', async () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async (request) => {
        assert.equal(request.kind, 'fileChange');
        assert.match(request.details, /example.ts/);
        assert.match(request.details, /diff/);
        return 'accept';
      }
    );
    approvals.beginTurn('thread');
    approvals.handleNotification({
      method: 'item/started',
      params: {
        threadId: 'thread',
        turnId: 'turn',
        item: {
          id: 'item',
          type: 'fileChange',
          changes: [{ path: '/project/example.ts', diff: '+hello' }],
        },
      },
    });
    approvals.setTurnId('turn');
    approvals.handleRequest({ ...serverRequest(), method: 'item/fileChange/requestApproval' });
    await flush();
    assert.deepEqual(replies[0].result, { decision: 'accept' });
  });

  test('expires after 60 seconds and ignores late acceptance', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const replies: RpcMessage[] = [];
    const decision = deferred<ApprovalDecision>();
    let signal!: AbortSignal;
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async (_request, value) => {
        signal = value;
        return decision.promise;
      }
    );
    approvals.beginTurn('thread');
    approvals.handleRequest(serverRequest());
    await flush();
    t.mock.timers.tick(60_000);
    assert.equal(signal.aborted, true);
    decision.resolve('accept');
    await flush();
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].result, { decision: 'decline' });
  });

  test('handler exceptions fail closed', async () => {
    const replies: RpcMessage[] = [];
    const approvals = new CodexApprovals(
      (reply) => replies.push(reply),
      async () => {
        throw new Error('Offline');
      }
    );
    approvals.beginTurn('thread');
    approvals.handleRequest(serverRequest());
    await flush();
    assert.deepEqual(replies[0].result, { decision: 'decline' });
  });

  for (const reason of ['endTurn', 'processExit', 'resolved'] as const) {
    test(`invalidates a pending approval on ${reason}`, async () => {
      const replies: RpcMessage[] = [];
      const decision = deferred<ApprovalDecision>();
      let signal!: AbortSignal;
      const approvals = new CodexApprovals(
        (reply) => replies.push(reply),
        async (_request, value) => {
          signal = value;
          return decision.promise;
        }
      );
      approvals.beginTurn('thread');
      approvals.handleRequest(serverRequest());
      await flush();
      if (reason === 'resolved') {
        approvals.handleNotification({
          method: 'serverRequest/resolved',
          params: { threadId: 'thread', requestId: 1 },
        });
      } else {
        approvals.endTurn(reason === 'endTurn');
      }
      assert.equal(signal.aborted, true);
      decision.resolve('accept');
      await flush();
      assert.equal(replies.length, reason === 'endTurn' ? 1 : 0);
      if (reason === 'endTurn') {
        assert.deepEqual(replies[0].result, { decision: 'decline' });
      }
    });
  }
});

suite('Telegram approval controls', () => {
  for (const action of [0, 1]) {
    test(`first click wins for ${action === 0 ? 'accept' : 'decline'}`, async () => {
      const client = new FakeTelegram();
      const approvals = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
      const result = approvals.request(approvalRequest(), new AbortController().signal);
      await flush();
      assert.deepEqual(
        client.approvals[0].keyboard.inline_keyboard[0].map((button) => button.text),
        ['Autoriser une fois', 'Refuser']
      );
      assert.ok(Buffer.byteLength(callback(client).data!) <= 64);
      await Promise.all([
        approvals.handleCallback(callback(client, 0, action)),
        approvals.handleCallback(callback(client, 0, 1 - action)),
      ]);
      assert.equal(await result, action === 0 ? 'accept' : 'decline');
      assert.equal(client.closed.length, 1);
      assert.match(client.answers[1], /déjà traitée/);
    });
  }

  test('rejects a wrong user/chat/message, group, inline callback and forged data', async () => {
    const client = new FakeTelegram();
    const approvals = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    const result = approvals.request(approvalRequest(), new AbortController().signal);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await flush();
    const valid = callback(client);
    const invalid = [
      { ...valid, from: { id: 99 } },
      { ...valid, message: { ...valid.message!, chat: { id: 99, type: 'private' } } },
      { ...valid, message: { ...valid.message!, chat: { id: 20, type: 'group' } } },
      { ...valid, message: { ...valid.message!, message_id: 99 } },
      { ...valid, message: undefined },
      { ...valid, data: 'approval:fake:accept' },
    ];
    for (const query of invalid) {
      await approvals.handleCallback(query);
    }
    assert.equal(settled, false);
    await approvals.handleCallback(valid);
    assert.equal(await result, 'accept');
  });

  test('declines on abort and cleans up a message delivered afterwards', async () => {
    const client = new FakeTelegram();
    const delivery = deferred<void>();
    client.delivery = delivery.promise;
    const approvals = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    const controller = new AbortController();
    const result = approvals.request(approvalRequest(), controller.signal);
    controller.abort();
    assert.equal(await result, 'decline');
    delivery.resolve();
    await flush();
    assert.equal(client.closed.length, 1);
    await approvals.handleCallback(callback(client));
    assert.match(client.answers[0], /expirée ou déjà traitée/);
  });

  test('a request remains bound to the account that received it', async () => {
    const client = new FakeTelegram();
    let peer = { userId: 10, chatId: 20 };
    const approvals = new TelegramApprovals(client, () => peer);
    const result = approvals.request(approvalRequest(), new AbortController().signal);
    await flush();
    peer = { userId: 99, chatId: 20 };
    await approvals.handleCallback({ ...callback(client), from: { id: 99 } });
    assert.equal(client.closed.length, 0);
    approvals.cancelAll();
    assert.equal(await result, 'decline');
  });

  test('does not depend on successful callback acknowledgements or keyboard edits', async () => {
    const client = new FakeTelegram();
    client.failAnswer = true;
    client.failEdit = true;
    const approvals = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    const result = approvals.request(approvalRequest(), new AbortController().signal);
    await flush();
    await approvals.handleCallback(callback(client));
    assert.equal(await result, 'accept');
    await approvals.handleCallback(callback(client));
  });

  test('refuses unavailable, expired, aborted, oversized and undeliverable requests', async () => {
    const client = new FakeTelegram();
    const offline = new TelegramApprovals(client, () => undefined);
    assert.equal(await offline.request(approvalRequest(), new AbortController().signal), 'decline');
    const approvals = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    assert.equal(await approvals.request(approvalRequest(), AbortSignal.abort()), 'decline');
    assert.equal(
      await approvals.request(
        { ...approvalRequest(), expiresAt: Date.now() },
        new AbortController().signal
      ),
      'decline'
    );
    assert.equal(
      await approvals.request(
        { ...approvalRequest(), details: 'x'.repeat(4001) },
        new AbortController().signal
      ),
      'decline'
    );
    assert.equal(client.approvals.length, 0);
    client.failSend = true;
    assert.equal(
      await approvals.request(approvalRequest(), new AbortController().signal),
      'decline'
    );
  });

  test('expiration from Codex removes Telegram buttons and declines exactly once', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const client = new FakeTelegram();
    const replies: RpcMessage[] = [];
    const telegram = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    const codex = new CodexApprovals(
      (reply) => replies.push(reply),
      (request, signal) => telegram.request(request, signal)
    );
    codex.beginTurn('thread');
    codex.handleRequest(serverRequest());
    await flush();
    t.mock.timers.tick(60_000);
    await telegram.handleCallback(callback(client));
    await flush();
    assert.deepEqual(
      replies.map((reply) => reply.result),
      [{ decision: 'decline' }]
    );
    assert.match(client.closed[0].text, /expirée/);
  });

  test('checks wall-clock expiry even before the timer callback runs', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const client = new FakeTelegram();
    const telegram = new TelegramApprovals(client, () => ({ userId: 10, chatId: 20 }));
    const result = telegram.request(approvalRequest(), new AbortController().signal);
    await flush();
    t.mock.timers.setTime(61_000);
    await telegram.handleCallback(callback(client));
    assert.equal(await result, 'decline');
  });
});
