import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { FakeTelegram } from './helpers';
import { TelegramContinuations, TurnTimeoutRequest } from '../../telegram/continuations';
import { TelegramCallbackQuery } from '../../telegram/types';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function timeoutRequest(overrides?: Partial<TurnTimeoutRequest>): TurnTimeoutRequest {
  return {
    agentName: 'Codex',
    elapsedSeconds: 120,
    ...overrides,
  };
}

function callback(client: FakeTelegram, index = 0, buttonIndex = 0): TelegramCallbackQuery {
  const sent = client.approvals[index];
  return {
    id: `query-${index}`,
    from: { id: 10 },
    message: {
      message_id: sent.messageId,
      chat: { id: 20, type: 'private' },
    },
    data: sent.keyboard.inline_keyboard[0][buttonIndex].callback_data,
  };
}

suite('Telegram continuation controls', () => {
  for (const action of [0, 1]) {
    test(`first click wins for ${action === 0 ? 'continue' : 'stop'}`, async () => {
      const client = new FakeTelegram();
      const continuations = new TelegramContinuations(client, () => ({
        userId: 10,
        chatId: 20,
      }));
      const result = continuations.request(timeoutRequest(), new AbortController().signal);
      await flush();

      assert.equal(client.approvals.length, 1);
      assert.match(client.approvals[0].text, /Codex — La requête a atteint 120 secondes/);
      assert.match(client.approvals[0].text, /Voulez-vous continuer \?/);
      assert.deepEqual(
        client.approvals[0].keyboard.inline_keyboard[0].map(
          (button: { text: string }) => button.text
        ),
        ['Continuer', 'Arrêter']
      );
      assert.ok(Buffer.byteLength(callback(client).data!) <= 64);

      await Promise.all([
        continuations.handleCallback(callback(client, 0, action)),
        continuations.handleCallback(callback(client, 0, 1 - action)),
      ]);

      assert.equal(await result, action === 0);
      assert.equal(client.closed.length, 1);
      assert.match(client.answers[1], /déjà traitée/);
    });
  }

  test('rejects a wrong user/chat/message, group, and forged data', async () => {
    const client = new FakeTelegram();
    const continuations = new TelegramContinuations(client, () => ({
      userId: 10,
      chatId: 20,
    }));
    const result = continuations.request(timeoutRequest(), new AbortController().signal);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await flush();

    const valid = callback(client);
    const invalid = [
      { ...valid, from: { id: 99 } },
      { ...valid, message: { ...valid.message!, chat: { id: 99, type: 'private' as const } } },
      { ...valid, message: { ...valid.message!, chat: { id: 20, type: 'group' as const } } },
      { ...valid, message: { ...valid.message!, message_id: 99 } },
      { ...valid, message: undefined },
      { ...valid, data: 'continue:fake:continue' },
      { ...valid, data: 'approval:0123456789abcdef0123456789abcdef:accept' },
    ];
    for (const query of invalid) {
      await continuations.handleCallback(query);
    }
    assert.equal(settled, false);

    await continuations.handleCallback(valid);
    assert.equal(await result, true);
  });

  test('aborts with false when signal is aborted (e.g. turn completed) and cleans up buttons', async () => {
    const client = new FakeTelegram();
    const continuations = new TelegramContinuations(client, () => ({
      userId: 10,
      chatId: 20,
    }));
    const controller = new AbortController();
    const result = continuations.request(timeoutRequest(), controller.signal);
    await flush();

    controller.abort();
    assert.equal(await result, false);
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /Requête terminée/);

    await continuations.handleCallback(callback(client));
    assert.match(client.answers[0], /déjà traitée/);
  });

  test('declines on abort and cleans up a message delivered afterwards', async () => {
    const client = new FakeTelegram();
    const delivery = deferred<void>();
    client.delivery = delivery.promise;
    const continuations = new TelegramContinuations(client, () => ({
      userId: 10,
      chatId: 20,
    }));
    const controller = new AbortController();
    const result = continuations.request(timeoutRequest(), controller.signal);
    controller.abort();
    assert.equal(await result, false);
    delivery.resolve();
    await flush();
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /Requête terminée/);
  });

  test('cancelAll cancels all pending continuation prompts', async () => {
    const client = new FakeTelegram();
    const continuations = new TelegramContinuations(client, () => ({
      userId: 10,
      chatId: 20,
    }));
    const result = continuations.request(timeoutRequest(), new AbortController().signal);
    await flush();

    continuations.cancelAll();
    assert.equal(await result, false);
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /Requête annulée/);
  });

  test('times out automatically when promptTimeoutMs elapses', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const client = new FakeTelegram();
    const continuations = new TelegramContinuations(
      client,
      () => ({ userId: 10, chatId: 20 }),
      30_000
    );
    const result = continuations.request(timeoutRequest(), new AbortController().signal);
    await flush();

    t.mock.timers.tick(30_000);
    assert.equal(await result, false);
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /Délai de réponse dépassé/);
  });

  test('refuses unavailable, pre-aborted, and undeliverable requests', async () => {
    const client = new FakeTelegram();
    const offline = new TelegramContinuations(client, () => undefined);
    assert.equal(await offline.request(timeoutRequest(), new AbortController().signal), false);

    const continuations = new TelegramContinuations(client, () => ({
      userId: 10,
      chatId: 20,
    }));
    assert.equal(await continuations.request(timeoutRequest(), AbortSignal.abort()), false);

    client.failSend = true;
    assert.equal(
      await continuations.request(timeoutRequest(), new AbortController().signal),
      false
    );
  });
});
