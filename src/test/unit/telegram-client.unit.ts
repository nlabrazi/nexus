import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramClient } from '../../telegram/client';

suite('Telegram approval HTTP API', () => {
  test('subscribes to callbacks and sends/removes inline buttons with API acknowledgements', async t => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ ok: true, result: input.includes('getUpdates') ? [] : { message_id: 42 } }));
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

  test('HTTP 200 with ok:false is an error, as is a missing message ID', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: false })));
    const client = new TelegramClient('fake-token');
    await assert.rejects(client.sendApprovalMessage(20, 'details', { inline_keyboard: [] }));
    await assert.rejects(client.getUpdates(0));
    await assert.rejects(client.answerCallbackQuery('id', 'text'));
    await assert.rejects(client.closeApprovalMessage(20, 1, 'text'));
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    await assert.rejects(client.sendApprovalMessage(20, 'details', { inline_keyboard: [] }), /message ID/);
  });
});
