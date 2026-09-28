import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTyping } from '../../telegram/activity';
import { TelegramClient } from '../../telegram/client';
import { deferred, flush } from './helpers';

test('typing calls the Telegram endpoint with a bounded cancellable request', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /sendChatAction$/);
    assert.deepEqual(JSON.parse(init.body as string), { chat_id: 20, action: 'typing' });
    assert.ok(init.signal);
    return new Response(JSON.stringify({ ok: true, result: true }));
  });
  await new TelegramClient('fake').sendChatAction(20, new AbortController().signal);
});

test('typing renews while working and stops on cancellation or a superseded operation', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let count = 0;
  let current = true;
  let activeSignal: AbortSignal | undefined;
  const client = {
    sendChatAction: async (_chat: number, signal: AbortSignal) => {
      count++;
      activeSignal = signal;
    },
  };
  const controller = new AbortController();
  startTyping(client, 20, controller.signal, () => current);
  await flush();
  assert.equal(count, 1);
  t.mock.timers.tick(4000);
  await flush();
  assert.equal(count, 2);
  current = false;
  t.mock.timers.tick(4000);
  assert.ok(activeSignal?.aborted);
  assert.equal(count, 2);
  current = true;
  startTyping(client, 20, controller.signal, () => current);
  controller.abort();
  t.mock.timers.tick(8000);
  assert.equal(count, 3);
});

test('typing failure is non-blocking and slow feedback never creates overlapping requests', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const pending = deferred<void>();
  let count = 0;
  const stop = startTyping(
    {
      sendChatAction: () => {
        count++;
        return pending.promise;
      },
    },
    20,
    new AbortController().signal,
    () => true
  );
  t.mock.timers.tick(12000);
  assert.equal(count, 1);
  pending.reject(new Error('private transport error'));
  await flush();
  stop();
  t.mock.timers.tick(8000);
  assert.equal(count, 1);
});
