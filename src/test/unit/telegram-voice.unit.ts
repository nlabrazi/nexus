import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { TelegramUpdate, TelegramVoice } from '../../telegram/types';
import { context, FakeTelegram, flush } from './helpers';

const voiceMessage = (id: number, metadata: Partial<TelegramVoice> = {}): TelegramUpdate => ({
  update_id: id,
  message: {
    from: { id: 10 }, chat: { id: 20, type: 'private' },
    voice: { file_id: 'voice-file', file_unique_id: 'unique-voice-file', duration: 5, ...metadata },
  },
});

suite('Telegram voice detection', () => {
  for (const metadata of [{}, { mime_type: 'audio/ogg', file_size: 2048 }]) {
    test(`acknowledges an authorized voice ${'mime_type' in metadata ? 'with' : 'without'} optional metadata without starting an agent`, async t => {
      const client = new FakeTelegram();
      const send = t.mock.method(client, 'sendMessage');
      const codex = t.mock.fn(async () => 'Codex response');
      const antigravity = t.mock.fn(async () => 'Antigravity response');
      const service = new TelegramService(context(), client, {
        onRemotePrompt: codex, onRemoteAntigravityPrompt: antigravity,
      });
      const polling = service.start();
      t.after(async () => { service.stop(); await polling; });

      client.push(voiceMessage(1, metadata));
      await flush();

      assert.equal(send.mock.callCount(), 1);
      assert.equal(send.mock.calls[0].arguments[0], 20);
      assert.match(client.messages[0], /Message vocal reçu/);
      assert.match(client.messages[0], /transcription n’est pas encore disponible/);
      assert.equal(codex.mock.callCount(), 0);
      assert.equal(antigravity.mock.callCount(), 0);
    });
  }

  for (const source of ['wrong-user', 'wrong-chat', 'group', 'missing-sender', 'unpaired'] as const) {
    test(`ignores a voice from ${source}`, async t => {
      const client = new FakeTelegram();
      const saved = context();
      const update = voiceMessage(1);
      if (source === 'wrong-user') { update.message!.from!.id = 11; }
      if (source === 'wrong-chat') { update.message!.chat.id = 21; }
      if (source === 'group') { update.message!.chat.type = 'group'; }
      if (source === 'missing-sender') { delete update.message!.from; }
      if (source === 'unpaired') {
        await saved.globalState.update('nexus.telegram.allowedUserId', undefined);
        await saved.globalState.update('nexus.telegram.allowedChatId', undefined);
      }
      const codex = t.mock.fn(async () => 'Codex response');
      const antigravity = t.mock.fn(async () => 'Antigravity response');
      const service = new TelegramService(saved, client, {
        onRemotePrompt: codex, onRemoteAntigravityPrompt: antigravity,
      });
      const polling = service.start();
      t.after(async () => { service.stop(); await polling; });

      client.push(update);
      await flush();

      assert.deepEqual(client.messages, []);
      assert.equal(codex.mock.callCount(), 0);
      assert.equal(antigravity.mock.callCount(), 0);
      assert.equal(saved.globalState.get('nexus.telegram.updateOffset'), 2);
    });
  }

  test('acknowledges a duplicate voice only once and continues handling text prompts', async t => {
    const client = new FakeTelegram();
    const codex = t.mock.fn(async (prompt: string) => `Réponse : ${prompt}`);
    const service = new TelegramService(context(), client, { onRemotePrompt: codex });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });

    client.push(voiceMessage(1), voiceMessage(1), {
      update_id: 2,
      message: { text: '/codex bonjour', from: { id: 10 }, chat: { id: 20, type: 'private' } },
    });
    await flush();

    assert.equal(client.messages.filter(text => text.includes('Message vocal reçu')).length, 1);
    assert.equal(codex.mock.callCount(), 1);
    assert.deepEqual(codex.mock.calls[0].arguments, ['bonjour']);
    assert.equal(client.messages.at(-1), 'Réponse : bonjour');
  });

  test('ignores other messages without text and keeps polling', async t => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });

    client.push(
      { update_id: 1, message: { from: { id: 10 }, chat: { id: 20, type: 'private' } } },
      { update_id: 2 },
      { update_id: 3, message: { text: '/ping', from: { id: 10 }, chat: { id: 20, type: 'private' } } },
    );
    await flush();

    assert.deepEqual(client.messages, ['pong']);
  });
});
