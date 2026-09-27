import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string, userId = 10): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: userId }, chat: { id: 20, type: 'private' } },
});

suite('Telegram Brain spike', () => {
  test('routes only explicit authorized /brain messages and preserves direct Codex', async (t) => {
    const client = new FakeTelegram();
    const prompts: string[] = [];
    const service = new TelegramService(context(), client, {
      onBrainPrompt: async (text) => {
        prompts.push(text);
        return 'Réponse Nexus';
      },
      onRemotePrompt: async () => 'Réponse Codex',
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(
      message(1, '/brain Bonjour', 99),
      message(2, 'Texte ordinaire'),
      message(3, '/brain')
    );
    await flush();
    assert.equal(prompts.length, 0);
    assert.ok(client.messages.includes('Usage : /brain <message>'));
    client.push(message(4, '/brain Bonjour'));
    await flush();
    assert.deepEqual(prompts, ['Bonjour']);
    assert.ok(client.messages.includes('Réponse Nexus'));
    client.push(message(5, '/codex Bonjour'));
    await flush();
    assert.ok(client.messages.includes('Réponse Codex'));
  });

  test('polling handles inspection approval while the Brain turn is waiting', async (t) => {
    const client = new FakeTelegram();
    const service: TelegramService = new TelegramService(context(), client, {
      onBrainPrompt: async (_text, signal) => {
        const decision = await service.requestApproval(
          {
            kind: 'inspection',
            agentName: 'Nexus Brain',
            details: 'Projet nexus : inspecter les sessions',
            expiresAt: Date.now() + 60000,
          },
          signal
        );
        return decision === 'accept' ? 'Synthèse après inspection' : 'Inspection refusée';
      },
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(message(1, '/brain Inspecte les sessions'));
    await flush();
    assert.match(client.approvals[0].text, /inspection en lecture seule/);
    client.push({
      update_id: 2,
      callback_query: {
        id: 'click',
        from: { id: 10 },
        data: client.approvals[0].keyboard.inline_keyboard[0][0].callback_data,
        message: { message_id: 1, chat: { id: 20, type: 'private' } },
      },
    });
    await flush();
    assert.ok(client.messages.includes('Synthèse après inspection'));
  });

  test('/stop aborts Brain and suppresses late replies without releasing a newer turn', async (t) => {
    const client = new FakeTelegram();
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const service = new TelegramService(context(), client, {
      onBrainPrompt: async (_text, signal) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      },
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(message(1, '/brain Premier'));
    await flush();
    client.push(message(2, '/stop'));
    await flush();
    assert.equal(signals[0].aborted, true);
    client.push(message(3, '/brain Deuxième'));
    await flush();
    first.resolve('Ancienne réponse');
    await flush();
    client.push(message(4, '/brain Troisième'));
    await flush();
    assert.equal(signals.length, 2);
    assert.equal(client.messages.includes('Ancienne réponse'), false);
    second.resolve('Nouvelle réponse');
    await flush();
    assert.ok(client.messages.includes('Nouvelle réponse'));
  });

  test('re-pairing aborts a pending Brain turn', async (t) => {
    const client = new FakeTelegram();
    const pending = deferred<string>();
    let signal!: AbortSignal;
    const service = new TelegramService(context(), client, {
      onBrainPrompt: async (_text, value) => {
        signal = value;
        return pending.promise;
      },
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(message(1, '/brain Bonjour'));
    await flush();
    client.push(message(2, `/pair ${service.createPairingCode()}`));
    await flush();
    assert.equal(signal.aborted, true);
    pending.resolve('Ancien utilisateur');
    await flush();
    assert.equal(client.messages.includes('Ancien utilisateur'), false);
  });
});
