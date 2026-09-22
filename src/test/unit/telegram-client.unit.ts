import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramClient } from '../../telegram/client';
import { TelegramTextMessage } from '../../telegram/types';
import { flush } from './helpers';

suite('Telegram response HTTP API', () => {
  test('does not start delivery when already cancelled', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch');
    await assert.rejects(
      new TelegramClient('fake-token').sendMessage(
        20,
        'voice transcript',
        'plain',
        AbortSignal.abort()
      )
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('stops a long literal transcript between chunks when cancelled', async (t) => {
    const controller = new AbortController();
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async (_input: string, init: RequestInit) => {
        assert.equal(JSON.parse(String(init.body)).entities, undefined);
        controller.abort();
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
    );
    await assert.rejects(
      new TelegramClient('fake-token').sendMessage(
        20,
        '**literal** <tag> 😀 '.repeat(500),
        'plain',
        controller.signal
      )
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test('cancels an in-flight transcript HTTP request', async (t) => {
    const controller = new AbortController();
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async (_input: string, init: RequestInit) => {
        const signal = init.signal!;
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
    );
    const delivery = new TelegramClient('fake-token').sendMessage(
      20,
      'a'.repeat(9000),
      'plain',
      controller.signal
    );
    const rejected = assert.rejects(delivery);
    await flush();
    controller.abort();
    await rejected;
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test('sends formatted chunks in order with entities and no link previews', async (t) => {
    const calls: (TelegramTextMessage & {
      chat_id: number;
      parse_mode?: string;
      link_preview_options: unknown;
    })[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    });
    await new TelegramClient('fake-token').sendMessage(
      20,
      `**${'a'.repeat(4500)}**\n\n<fin> & 😀`,
      'markdown'
    );
    assert.equal(calls.length, 2);
    assert.equal(calls.map((call) => call.text).join(''), `${'a'.repeat(4500)}\n\n<fin> & 😀`);
    for (const call of calls) {
      assert.equal(call.chat_id, 20);
      assert.equal(call.parse_mode, undefined);
      assert.deepEqual(call.link_preview_options, { is_disabled: true });
    }
    assert.deepEqual(calls[0].entities, [{ type: 'bold', offset: 0, length: 4000 }]);
    assert.deepEqual(calls[1].entities, [{ type: 'bold', offset: 0, length: 500 }]);
  });

  test('keeps ordinary messages literal and stops sending after a transport failure', async (t) => {
    const calls: Record<string, unknown>[] = [];
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async (_input: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
    );
    const client = new TelegramClient('fake-token');
    await client.sendMessage(20, '**literal** <tag> & `code`');
    assert.equal(calls[0].text, '**literal** <tag> & `code`');
    assert.equal(calls[0].entities, undefined);
    fetchMock.mock.mockImplementation(async () => {
      throw new Error('Offline');
    });
    await assert.rejects(client.sendMessage(20, 'a'.repeat(9000), 'markdown'), /Offline/);
    assert.equal(fetchMock.mock.callCount(), 2);
  });
});

suite('Telegram approval HTTP API', () => {
  test('sends and edits model menu keyboards without changing the message identity', async (t) => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    });
    const client = new TelegramClient('fake-token');
    const first = { inline_keyboard: [[{ text: 'Model', callback_data: 'model:token:pick:0' }]] };
    const next = { inline_keyboard: [[{ text: 'Low', callback_data: 'model:token:effort:0' }]] };
    const sent = await client.sendKeyboardMessage(20, 'Models', first);
    await client.editKeyboardMessage(20, sent.message_id, 'Reasoning', next);
    assert.equal(calls[1].url.endsWith('/editMessageText'), true);
    assert.deepEqual(calls[1].body, {
      chat_id: 20,
      message_id: 42,
      text: 'Reasoning',
      reply_markup: next,
    });
  });

  test('subscribes to callbacks and sends/removes inline buttons with API acknowledgements', async (t) => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(
        JSON.stringify({ ok: true, result: input.includes('getUpdates') ? [] : { message_id: 42 } })
      );
    });
    const client = new TelegramClient('fake-token');
    await client.getUpdates(123);
    const query = new URL(calls[0].url).searchParams;
    assert.equal(query.get('offset'), '123');
    assert.deepEqual(JSON.parse(query.get('allowed_updates')!), ['message', 'callback_query']);
    const keyboard = { inline_keyboard: [[{ text: 'Refuser', callback_data: 'test' }]] };
    assert.equal((await client.sendApprovalMessage(20, '<plain text>', keyboard)).message_id, 42);
    assert.deepEqual(calls[1].body?.reply_markup, keyboard);
    assert.equal(calls[1].body?.parse_mode, undefined);
    await client.answerCallbackQuery('query-id', 'Refusé.');
    assert.deepEqual(calls[2].body, { callback_query_id: 'query-id', text: 'Refusé.' });
    await client.closeApprovalMessage(20, 42, 'Refusé.');
    assert.deepEqual(calls[3].body?.reply_markup, { inline_keyboard: [] });
  });

  test('HTTP 200 with ok:false is an error, as is a missing message ID', async (t) => {
    const fetchMock = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify({ ok: false }))
    );
    const client = new TelegramClient('fake-token');
    await assert.rejects(client.sendApprovalMessage(20, 'details', { inline_keyboard: [] }));
    await assert.rejects(client.getUpdates(0));
    await assert.rejects(client.answerCallbackQuery('id', 'text'));
    await assert.rejects(client.closeApprovalMessage(20, 1, 'text'));
    fetchMock.mock.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true, result: {} }))
    );
    await assert.rejects(
      client.sendApprovalMessage(20, 'details', { inline_keyboard: [] }),
      /message ID/
    );
  });
});
