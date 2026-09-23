import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramClient } from '../../telegram/client';
import { TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const voice: TelegramUpdate = {
  update_id: 1,
  message: {
    from: { id: 10 },
    chat: { id: 20, type: 'private' },
    voice: { file_id: 'voice', file_unique_id: 'unique', duration: 1 },
  },
};

suite('Telegram acknowledgement', () => {
  test('uploads an OGG voice note using multipart sendVoice', async (t) => {
    const audio = Buffer.from('OggS audio bytes');
    const request = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(url, 'https://api.telegram.org/botFAKE/sendVoice');
      assert.equal(init.method, 'POST');
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get('chat_id'), '20');
      const file = init.body.get('voice');
      assert.ok(file instanceof File);
      assert.equal(file.name, 'acknowledgement.ogg');
      assert.equal(file.type, 'audio/ogg');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
      return new Response(JSON.stringify({ ok: true }));
    });
    await new TelegramClient('FAKE').sendAcknowledgementAudio(20, audio);
    assert.equal(request.mock.callCount(), 1);
  });

  for (const failure of ['synthesis', 'delivery']) {
    test(`continues the original instruction after ${failure} failure`, async (t) => {
      const client = new FakeTelegram();
      const send = t.mock.method(client, 'sendAcknowledgementAudio', async () => {
        throw new Error('private transport details');
      });
      const codex = t.mock.fn(async () => 'Done');
      const service = new TelegramService(context(), client, {
        transcribeVoice: async () => 'Check coverage above 70%',
        synthesizeAcknowledgement: async () => {
          if (failure === 'synthesis') throw new Error('private process details');
          return Buffer.from('OggS');
        },
        onRemotePrompt: codex,
      });
      const polling = service.start();
      t.after(async () => {
        service.stop();
        await polling;
      });
      client.push(voice);
      await flush();
      assert.equal(send.mock.callCount(), failure === 'delivery' ? 1 : 0);
      assert.deepEqual(codex.mock.calls[0].arguments, ['Check coverage above 70%']);
      assert.ok(client.messages.includes('✅ Bien compris. Je prends en charge votre demande.'));
      assert.equal(client.messages.at(-1), 'Done');
      assert.equal(
        client.messages.some((text) => text.includes('private')),
        false
      );
    });
  }

  test('stop during acknowledgement suppresses late audio and agent execution', async (t) => {
    const client = new FakeTelegram();
    const pending = deferred<Buffer>();
    const send = t.mock.method(client, 'sendAcknowledgementAudio', async () => {});
    const codex = t.mock.fn(async () => 'Done');
    let synthesisSignal: AbortSignal | undefined;
    const service = new TelegramService(context(), client, {
      transcribeVoice: async () => 'Check coverage',
      synthesizeAcknowledgement: (signal) => {
        synthesisSignal = signal;
        return pending.promise;
      },
      onRemotePrompt: codex,
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      pending.resolve(Buffer.from('OggS'));
      await polling;
    });
    client.push(voice);
    await flush();
    assert.ok(synthesisSignal);
    client.push({
      update_id: 2,
      message: { from: { id: 10 }, chat: { id: 20, type: 'private' }, text: '/stop' },
    });
    await flush();
    assert.equal(synthesisSignal.aborted, true);
    pending.resolve(Buffer.from('OggS'));
    await flush();
    assert.equal(send.mock.callCount(), 0);
    assert.equal(codex.mock.callCount(), 0);
  });
});
