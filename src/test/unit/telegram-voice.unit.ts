import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { TelegramVoiceDownloadError } from '../../telegram/client';
import { TelegramUpdate, TelegramVoice, TelegramVoiceFile } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const voiceMessage = (id: number, metadata: Partial<TelegramVoice> = {}): TelegramUpdate => ({
  update_id: id,
  message: {
    from: { id: 10 },
    chat: { id: 20, type: 'private' },
    voice: { file_id: 'voice-file', file_unique_id: 'unique-voice-file', duration: 5, ...metadata },
  },
});

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});
const transcribeVoice = async () => 'Bonjour';
const audio = (): TelegramVoiceFile => ({ data: Buffer.from('audio'), fileName: 'voice.oga' });

suite('Telegram voice reception', () => {
  for (const metadata of [{}, { mime_type: 'audio/ogg', file_size: 2048 }]) {
    test(`acknowledges an authorized voice ${'mime_type' in metadata ? 'with' : 'without'} optional metadata without starting an agent`, async (t) => {
      const client = new FakeTelegram();
      const send = t.mock.method(client, 'sendMessage');
      const download = t.mock.method(client, 'downloadVoice');
      const codex = t.mock.fn(async () => 'Codex response');
      const antigravity = t.mock.fn(async () => 'Antigravity response');
      const service = new TelegramService(context(), client, {
        transcribeVoice,
        onRemotePrompt: codex,
        onRemoteAntigravityPrompt: antigravity,
      });
      const polling = service.start();
      t.after(async () => {
        service.stop();
        await polling;
      });

      client.push(voiceMessage(1, metadata));
      await flush();

      assert.equal(download.mock.callCount(), 1);
      assert.equal(download.mock.calls[0].arguments[0].file_id, 'voice-file');
      assert.equal(send.mock.callCount(), 3);
      assert.equal(send.mock.calls[0].arguments[0], 20);
      assert.match(client.messages[0], /Téléchargement du message vocal/);
      assert.match(client.messages[1], /Transcription locale du message vocal/);
      assert.equal(client.messages[2], '🎙 Transcription :\n\nBonjour');
      assert.equal(codex.mock.callCount(), 0);
      assert.equal(antigravity.mock.callCount(), 0);
    });
  }

  for (const source of [
    'wrong-user',
    'wrong-chat',
    'group',
    'missing-sender',
    'unpaired',
  ] as const) {
    test(`ignores a voice from ${source}`, async (t) => {
      const client = new FakeTelegram();
      const download = t.mock.method(client, 'downloadVoice');
      const saved = context();
      const update = voiceMessage(1);
      if (source === 'wrong-user') {
        update.message!.from!.id = 11;
      }
      if (source === 'wrong-chat') {
        update.message!.chat.id = 21;
      }
      if (source === 'group') {
        update.message!.chat.type = 'group';
      }
      if (source === 'missing-sender') {
        delete update.message!.from;
      }
      if (source === 'unpaired') {
        await saved.globalState.update('nexus.telegram.allowedUserId', undefined);
        await saved.globalState.update('nexus.telegram.allowedChatId', undefined);
      }
      const codex = t.mock.fn(async () => 'Codex response');
      const antigravity = t.mock.fn(async () => 'Antigravity response');
      const service = new TelegramService(saved, client, {
        transcribeVoice,
        onRemotePrompt: codex,
        onRemoteAntigravityPrompt: antigravity,
      });
      const polling = service.start();
      t.after(async () => {
        service.stop();
        await polling;
      });

      client.push(update);
      await flush();

      assert.deepEqual(client.messages, []);
      assert.equal(download.mock.callCount(), 0);
      assert.equal(codex.mock.callCount(), 0);
      assert.equal(antigravity.mock.callCount(), 0);
      assert.equal(saved.globalState.get('nexus.telegram.updateOffset'), 2);
    });
  }

  test('acknowledges a duplicate voice only once and continues handling text prompts', async (t) => {
    const client = new FakeTelegram();
    const codex = t.mock.fn(async (prompt: string) => `Réponse : ${prompt}`);
    const service = new TelegramService(context(), client, {
      transcribeVoice,
      onRemotePrompt: codex,
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    client.push(voiceMessage(1), voiceMessage(1));
    await flush();
    client.push(message(2, '/codex bonjour'));
    await flush();

    assert.equal(client.messages.filter((text) => text.includes('🎙 Transcription :')).length, 1);
    assert.equal(codex.mock.callCount(), 1);
    assert.deepEqual(codex.mock.calls[0].arguments, ['bonjour']);
    assert.equal(client.messages.at(-1), 'Réponse : bonjour');
  });

  test('ignores other messages without text and keeps polling', async (t) => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client, { transcribeVoice });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    client.push(
      { update_id: 1, message: { from: { id: 10 }, chat: { id: 20, type: 'private' } } },
      { update_id: 2 },
      {
        update_id: 3,
        message: { text: '/ping', from: { id: 10 }, chat: { id: 20, type: 'private' } },
      }
    );
    await flush();

    assert.deepEqual(client.messages, ['pong']);
  });

  test('keeps polling during a download, refuses concurrent work, and stops without an agent backend', async (t) => {
    const client = new FakeTelegram();
    const pending = deferred<TelegramVoiceFile>();
    const download = t.mock.method(client, 'downloadVoice', () => pending.promise);
    const prompt = t.mock.fn(async () => 'Unexpected');
    const service = new TelegramService(context(), client, {
      transcribeVoice,
      onRemotePrompt: prompt,
      getStatus: () => ({ workspaceCount: 1 }),
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      pending.resolve(audio());
      await polling;
    });
    client.push(voiceMessage(1));
    await flush();
    const signal = download.mock.calls[0].arguments[1]!;
    client.push(
      voiceMessage(2),
      message(3, '/codex wait'),
      message(4, '/ping'),
      message(5, '/status')
    );
    await flush();
    assert.equal(download.mock.callCount(), 1);
    assert.equal(prompt.mock.callCount(), 0);
    assert.ok(client.messages.some((text) => text.includes('Une requête est déjà en cours')));
    assert.ok(client.messages.includes('pong'));
    assert.ok(client.messages.some((text) => text.includes('Nexus — statut')));

    const unauthorized = message(6, '/stop');
    unauthorized.message!.from!.id = 99;
    client.push(unauthorized);
    await flush();
    assert.equal(signal.aborted, false);
    client.push(message(7, '/stop'));
    await flush();
    assert.equal(signal.aborted, true);
    assert.match(client.messages.at(-1)!, /Traitement du message vocal annulé/);
    pending.resolve(audio());
    await flush();
    assert.equal(
      client.messages.some((text) => text.includes('🎙 Transcription :') || text.startsWith('❌')),
      false
    );
  });

  test('a cancelled download cannot release a newer prompt or send a late reply', async (t) => {
    const client = new FakeTelegram();
    const pending = deferred<TelegramVoiceFile>();
    t.mock.method(client, 'downloadVoice', () => pending.promise);
    const next = deferred<string>();
    const prompt = t.mock.fn(() => next.promise);
    const service = new TelegramService(context(), client, {
      transcribeVoice,
      onRemotePrompt: prompt,
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      pending.resolve(audio());
      next.resolve('Done');
      await polling;
    });
    client.push(voiceMessage(1));
    await flush();
    client.push(message(2, '/stop'), message(3, '/codex next'));
    await flush();
    pending.resolve(audio());
    await flush();
    client.push(message(4, '/codex duplicate'), voiceMessage(5));
    await flush();
    assert.equal(prompt.mock.callCount(), 1);
    assert.equal(
      client.messages.some((text) => text.includes('🎙 Transcription :')),
      false
    );
    next.resolve('Done');
    await flush();
    assert.equal(client.messages.at(-1), 'Done');
  });

  test('stop before the progress message completes prevents the download', async (t) => {
    const client = new FakeTelegram();
    const delivery = deferred<void>();
    const download = t.mock.method(client, 'downloadVoice');
    t.mock.method(client, 'sendMessage', async (_chat: number, text: string) => {
      client.messages.push(text);
      if (text.startsWith('⏳')) {
        await delivery.promise;
      }
    });
    const service = new TelegramService(context(), client, { transcribeVoice });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      delivery.resolve();
      await polling;
    });
    client.push(voiceMessage(1));
    await flush();
    client.push(message(2, '/stop'));
    await flush();
    delivery.resolve();
    await flush();
    assert.equal(download.mock.callCount(), 0);
    assert.match(client.messages.at(-1)!, /annulé/);
  });

  for (const action of ['restart', 're-pair'] as const) {
    test(`${action} cancels the old download and permits another one`, async (t) => {
      const client = new FakeTelegram();
      const pending = deferred<TelegramVoiceFile>();
      const download = t.mock.method(client, 'downloadVoice', () => pending.promise);
      const service = new TelegramService(context(), client, { transcribeVoice });
      let polling = service.start();
      t.after(async () => {
        service.stop();
        pending.resolve(audio());
        await polling;
      });
      client.push(voiceMessage(1));
      await flush();
      const signal = download.mock.calls[0].arguments[1]!;
      if (action === 'restart') {
        service.stop();
        await polling;
        polling = service.start();
      } else {
        client.push(message(2, `/pair ${service.createPairingCode()}`));
        await flush();
      }
      assert.equal(signal.aborted, true);
      pending.resolve(audio());
      await flush();
      assert.equal(
        client.messages.some((text) => text.includes('🎙 Transcription :')),
        false
      );
      download.mock.mockImplementation(async () => audio());
      client.push(voiceMessage(3));
      await flush();
      assert.equal(download.mock.callCount(), 2);
      assert.equal(client.messages.filter((text) => text.includes('🎙 Transcription :')).length, 1);
    });
  }

  for (const error of [
    new TelegramVoiceDownloadError('too_large'),
    new Error('https://api.telegram.org/file/botSECRET/path'),
  ]) {
    test(`reports a safe ${error.name} and releases the reservation for a retry`, async (t) => {
      const client = new FakeTelegram();
      const download = t.mock.method(client, 'downloadVoice', async () => {
        throw error;
      });
      const service = new TelegramService(context(), client, { transcribeVoice });
      const polling = service.start();
      t.after(async () => {
        service.stop();
        await polling;
      });
      client.push(voiceMessage(1));
      await flush();
      assert.match(
        client.messages.at(-1)!,
        error instanceof TelegramVoiceDownloadError ? /20 Mo/ : /Impossible de récupérer/
      );
      assert.equal(
        client.messages.some((text) => text.includes('SECRET')),
        false
      );
      download.mock.mockImplementation(async () => audio());
      client.push(voiceMessage(2));
      await flush();
      assert.match(client.messages.at(-1)!, /🎙 Transcription :/);
    });
  }
});
