import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { SpeechError } from '../../speech/errors';
import { TelegramClient } from '../../telegram/client';
import { TelegramService, TelegramServiceOptions } from '../../telegram/service';
import { TelegramUpdate, TelegramVoiceFile } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

type TranscribeVoice = NonNullable<TelegramServiceOptions['transcribeVoice']>;

const voice = (id: number): TelegramUpdate => ({
  update_id: id,
  message: {
    from: { id: 10 },
    chat: { id: 20, type: 'private' },
    voice: {
      file_id: `voice-${id}`,
      file_unique_id: `unique-${id}`,
      duration: 5,
      mime_type: 'audio/ogg',
    },
  },
});

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

const audio = (): TelegramVoiceFile => ({
  data: Buffer.from('recorded voice'),
  fileName: 'voice.oga',
  mimeType: 'audio/ogg',
});
const hasTranscript = (text: string) => text.startsWith('🎙 Transcription :');
const isCleared = (file: TelegramVoiceFile) => file.data.every((byte) => byte === 0);

suite('Telegram local voice transcription', () => {
  test('passes intact downloaded audio and its signal to STT and returns literal text without invoking agents', async (t) => {
    const client = new FakeTelegram();
    const sent = t.mock.method(client as TelegramClient, 'sendMessage');
    const file = audio();
    const download = t.mock.method(client, 'downloadVoice', async () => file);
    const pending = deferred<string>();
    const transcribe = t.mock.fn<TranscribeVoice>(() => pending.promise);
    const codex = t.mock.fn(async () => 'Unexpected Codex response');
    const antigravity = t.mock.fn(async () => 'Unexpected Antigravity response');
    const service = new TelegramService(context(), client, {
      transcribeVoice: transcribe,
      onRemotePrompt: codex,
      onRemoteAntigravityPrompt: antigravity,
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      pending.resolve('');
      await polling;
    });

    client.push(voice(1), voice(1));
    await flush();

    assert.equal(download.mock.callCount(), 1);
    assert.equal(transcribe.mock.callCount(), 1);
    assert.equal(transcribe.mock.calls[0].arguments[0], file);
    assert.equal(transcribe.mock.calls[0].arguments[1], download.mock.calls[0].arguments[1]);
    assert.equal(file.data.toString(), 'recorded voice');
    assert.deepEqual(client.messages, [
      '⏳ Téléchargement du message vocal…',
      '⏳ Transcription locale du message vocal…',
    ]);

    const text = '/codex **bonjour** <tag> & `code` 😀\n/stop\n/agy bonjour';
    pending.resolve(text);
    await flush();

    assert.equal(client.messages.at(-1), `🎙 Transcription :\n\n${text}`);
    assert.notEqual(sent.mock.calls.at(-1)!.arguments[2], 'markdown');
    assert.equal(codex.mock.callCount(), 0);
    assert.equal(antigravity.mock.callCount(), 0);
    assert.equal(isCleared(file), true);
  });

  for (const error of [
    new SpeechError('empty_transcript'),
    new SpeechError('unavailable'),
    new SpeechError('timeout'),
    new Error('secret path /private/SECRET and private transcript'),
  ]) {
    test(`clears audio, reports safe ${error instanceof SpeechError ? error.code : 'unexpected error'}, and permits retry`, async (t) => {
      const client = new FakeTelegram();
      const files: TelegramVoiceFile[] = [];
      t.mock.method(client, 'downloadVoice', async () => {
        const file = audio();
        files.push(file);
        return file;
      });
      const transcribe = t.mock.fn<TranscribeVoice>(async () => {
        throw error;
      });
      const service = new TelegramService(context(), client, { transcribeVoice: transcribe });
      const polling = service.start();
      t.after(async () => {
        service.stop();
        await polling;
      });

      client.push(voice(1));
      await flush();

      assert.equal(transcribe.mock.callCount(), 1);
      assert.equal(isCleared(files[0]), true);
      assert.equal(client.messages.some(hasTranscript), false);
      assert.ok(client.messages.at(-1)!.startsWith('❌'));
      if (error instanceof SpeechError) {
        assert.equal(client.messages.at(-1), `❌ ${error.message}`);
      }
      assert.equal(
        client.messages.some((text) => /SECRET|private transcript/.test(text)),
        false
      );

      transcribe.mock.mockImplementation(async () => 'Deuxième essai');
      client.push(voice(2));
      await flush();

      assert.equal(transcribe.mock.callCount(), 2);
      assert.equal(client.messages.at(-1), '🎙 Transcription :\n\nDeuxième essai');
      assert.equal(files.every(isCleared), true);
    });
  }

  test('keeps polling and excludes concurrent agent or voice work during STT; only an authorized stop cancels it', async (t) => {
    const client = new FakeTelegram();
    const file = audio();
    t.mock.method(client, 'downloadVoice', async () => file);
    const pending = deferred<string>();
    const transcribe = t.mock.fn<TranscribeVoice>(() => pending.promise);
    const codex = t.mock.fn(async () => 'Unexpected');
    const antigravity = t.mock.fn(async () => 'Unexpected');
    const service = new TelegramService(context(), client, {
      transcribeVoice: transcribe,
      onRemotePrompt: codex,
      onRemoteAntigravityPrompt: antigravity,
      getStatus: () => ({ workspaceCount: 1 }),
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      pending.resolve('Late');
      await polling;
    });
    client.push(voice(1));
    await flush();
    const signal = transcribe.mock.calls[0].arguments[1];

    client.push(
      voice(2),
      message(3, '/codex wait'),
      message(4, '/agy wait'),
      message(5, '/ping'),
      message(6, '/status')
    );
    await flush();
    assert.equal(transcribe.mock.callCount(), 1);
    assert.equal(codex.mock.callCount(), 0);
    assert.equal(antigravity.mock.callCount(), 0);
    assert.ok(client.messages.includes('pong'));
    assert.ok(client.messages.some((text) => text.includes('Nexus — statut')));
    assert.ok(client.messages.some((text) => text.includes('Une requête est déjà en cours')));

    const unauthorized = message(7, '/stop');
    unauthorized.message!.from!.id = 99;
    client.push(unauthorized);
    await flush();
    assert.equal(signal.aborted, false);
    client.push(message(8, '/stop'));
    await flush();
    assert.equal(signal.aborted, true);
    assert.equal(client.messages.at(-1), '⏹ Traitement du message vocal annulé.');

    pending.resolve('This must not be delivered');
    await flush();
    assert.equal(isCleared(file), true);
    assert.equal(client.messages.some(hasTranscript), false);
    assert.equal(
      client.messages.some((text) => text.startsWith('❌')),
      false
    );
  });

  test('stop while the transcription progress message is pending prevents STT and clears the downloaded audio', async (t) => {
    const client = new FakeTelegram();
    const file = audio();
    t.mock.method(client, 'downloadVoice', async () => file);
    const delivery = deferred<void>();
    t.mock.method(client, 'sendMessage', async (_chat: number, text: string) => {
      client.messages.push(text);
      if (text === '⏳ Transcription locale du message vocal…') {
        await delivery.promise;
      }
    });
    const transcribe = t.mock.fn<TranscribeVoice>(async () => 'Unexpected');
    const service = new TelegramService(context(), client, { transcribeVoice: transcribe });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      delivery.resolve();
      await polling;
    });

    client.push(voice(1));
    await flush();
    assert.ok(client.messages.includes('⏳ Transcription locale du message vocal…'));
    client.push(message(2, '/stop'));
    await flush();
    delivery.resolve();
    await flush();

    assert.equal(transcribe.mock.callCount(), 0);
    assert.equal(isCleared(file), true);
    assert.equal(client.messages.at(-1), '⏹ Traitement du message vocal annulé.');
  });

  test('a late cancelled transcript cannot release a newer agent request or send a reply', async (t) => {
    const client = new FakeTelegram();
    const old = deferred<string>();
    const transcribe = t.mock.fn<TranscribeVoice>(() => old.promise);
    const next = deferred<string>();
    const codex = t.mock.fn(() => next.promise);
    const service = new TelegramService(context(), client, {
      transcribeVoice: transcribe,
      onRemotePrompt: codex,
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      old.resolve('Old');
      next.resolve('New');
      await polling;
    });

    client.push(voice(1));
    await flush();
    client.push(message(2, '/stop'), message(3, '/codex next'));
    await flush();
    old.resolve('Old');
    await flush();
    client.push(message(4, '/codex duplicate'), voice(5));
    await flush();

    assert.equal(codex.mock.callCount(), 1);
    assert.equal(transcribe.mock.callCount(), 1);
    assert.equal(client.messages.some(hasTranscript), false);
    next.resolve('New');
    await flush();
    assert.equal(client.messages.at(-1), 'New');
  });

  for (const action of ['restart', 're-pair'] as const) {
    test(`${action} cancels STT, suppresses old results, and permits a fresh voice`, async (t) => {
      const client = new FakeTelegram();
      const sent = t.mock.method(client as TelegramClient, 'sendMessage');
      const file = audio();
      const download = t.mock.method(client, 'downloadVoice', async () => file);
      const pending = deferred<string>();
      const transcribe = t.mock.fn<TranscribeVoice>(() => pending.promise);
      const service = new TelegramService(context(), client, { transcribeVoice: transcribe });
      let polling = service.start();
      t.after(async () => {
        service.stop();
        pending.resolve('Old');
        await polling;
      });
      client.push(voice(1));
      await flush();
      const signal = transcribe.mock.calls[0].arguments[1];
      if (action === 'restart') {
        service.stop();
        await polling;
        polling = service.start();
      } else {
        const pairing = message(2, `/pair ${service.createPairingCode()}`);
        pairing.message!.from!.id = 30;
        pairing.message!.chat.id = 40;
        client.push(pairing);
        await flush();
      }
      assert.equal(signal.aborted, true);
      pending.resolve('Old');
      await flush();
      assert.equal(client.messages.some(hasTranscript), false);
      assert.equal(isCleared(file), true);

      download.mock.mockImplementation(async () => audio());
      transcribe.mock.mockImplementation(async () => 'Fresh');
      const fresh = voice(3);
      if (action === 're-pair') {
        fresh.message!.from!.id = 30;
        fresh.message!.chat.id = 40;
      }
      client.push(fresh);
      await flush();

      assert.equal(transcribe.mock.callCount(), 2);
      assert.equal(client.messages.at(-1), '🎙 Transcription :\n\nFresh');
      assert.equal(client.messages.filter(hasTranscript).length, 1);
      assert.equal(sent.mock.calls.at(-1)!.arguments[0], action === 're-pair' ? 40 : 20);
    });
  }
});
