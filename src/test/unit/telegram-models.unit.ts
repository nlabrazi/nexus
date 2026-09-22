import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import { ModelMenu, ModelSelection } from '../../codex/types';
import { TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});
const catalog = (): ModelMenu => ({
  context: 'workspace-session',
  selected: { model: 'model-0', effort: 'low' },
  models: Array.from({ length: 8 }, (_, index) => ({
    id: `id-${index}`,
    model: `model-${index}`,
    displayName: `Model ${index}`,
    description: 'Description',
    isDefault: index === 0,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
    ],
  })),
});

function setup(
  t: TestContext,
  overrides: {
    list?: () => Promise<ModelMenu>;
    select?: () => Promise<void>;
    prompt?: () => Promise<string>;
  } = {}
) {
  const client = new FakeTelegram();
  const selected: { selection: ModelSelection; context: string }[] = [];
  const savedContext = context();
  const service = new TelegramService(
    savedContext,
    client,
    overrides.prompt,
    () => ({ workspaceCount: 0 }),
    async () => 'new-id',
    () => false,
    async () => 'switched',
    {
      list: overrides.list ?? (async () => catalog()),
      select: async (selection, context) => {
        selected.push({ selection, context });
        await overrides.select?.();
      },
    }
  );
  const polling = service.start();
  t.after(async () => {
    service.stop();
    await polling;
  });
  let update = 0;
  const send = async (text: string) => {
    client.push(message(++update, text));
    await flush();
  };
  const click = async (action: string, index: number, menuIndex = client.approvals.length - 1) => {
    const sent = client.approvals[menuIndex];
    const button = sent.keyboard.inline_keyboard
      .flat()
      .find((button) => button.callback_data.endsWith(`:${action}:${index}`));
    assert.ok(button, `Missing ${action}:${index}`);
    const event: TelegramUpdate = {
      update_id: ++update,
      callback_query: {
        id: `click-${update}`,
        from: { id: 10 },
        data: button.callback_data,
        message: { message_id: sent.messageId, chat: { id: 20, type: 'private' } },
      },
    };
    client.push(event);
    await flush();
    return event;
  };
  return { client, service, selected, savedContext, send, click, nextId: () => ++update };
}

suite('Interactive Telegram /model', () => {
  test('paginates the catalog, selects an effort and applies only the first click', async (t) => {
    const pending = deferred<void>();
    const { client, selected, send, click, nextId } = setup(t, { select: () => pending.promise });
    await send('/model');
    assert.match(client.approvals[0].text, /1\/2/);
    assert.match(client.approvals[0].keyboard.inline_keyboard[0][0].text, /✓.*☆.*Model 0/);
    await click('page', 1);
    assert.match(client.approvals[0].text, /2\/2/);
    await click('pick', 7);
    assert.match(client.approvals[0].text, /Model 7 — raisonnement/);
    assert.equal(selected.length, 0);
    const event = await click('effort', 0);
    client.push({ ...event, update_id: nextId() });
    await flush();
    assert.deepEqual(selected, [
      { selection: { model: 'model-7', effort: 'low' }, context: 'workspace-session' },
    ]);
    pending.resolve();
    await flush();
    assert.match(client.closed.at(-1)!.text, /Modèle choisi : Model 7.*\nRaisonnement : low/);
    assert.match(client.closed.at(-1)!.text, /prochaine demande/);
  });

  test('navigation and cancellation do not select a model and callback data fits Telegram limits', async (t) => {
    const data = catalog();
    data.models[0].model = 'long-model-'.repeat(30);
    const { client, selected, send, click } = setup(t, { list: async () => data });
    await send('/model');
    assert.ok(
      client.approvals[0].keyboard.inline_keyboard
        .flat()
        .every((button) => Buffer.byteLength(button.callback_data) <= 64)
    );
    await click('pick', 0);
    await click('back', 0);
    await click('cancel', 0);
    assert.equal(selected.length, 0);
    assert.match(client.closed.at(-1)!.text, /annulée/);
  });

  test('unauthorized commands and callbacks, forged indices and wrong message IDs cannot select', async (t) => {
    const { client, selected, send, nextId } = setup(t);
    for (const type of ['user', 'chat', 'group']) {
      const update = message(nextId(), '/model');
      if (type === 'user') {
        update.message!.from!.id = 99;
      }
      if (type === 'chat') {
        update.message!.chat.id = 99;
      }
      if (type === 'group') {
        update.message!.chat.type = 'group';
      }
      client.push(update);
    }
    await flush();
    assert.equal(client.approvals.length, 0);
    await send('/model');
    const callback = {
      id: 'click',
      from: { id: 10 },
      data: client.approvals[0].keyboard.inline_keyboard[0][0].callback_data,
      message: { message_id: 1, chat: { id: 20, type: 'private' } },
    };
    for (const value of [
      { ...callback, from: { id: 99 } },
      { ...callback, message: { ...callback.message, chat: { id: 99, type: 'private' } } },
      { ...callback, message: { ...callback.message, chat: { id: 20, type: 'group' } } },
      { ...callback, message: { ...callback.message, message_id: 99 } },
      { ...callback, data: callback.data.replace(':pick:0', ':pick:999') },
    ]) {
      client.push({ update_id: nextId(), callback_query: value });
      await flush();
    }
    assert.equal(selected.length, 0);
    assert.match(client.closed.at(-1)!.text, /Modèle invalide/);
  });

  test('menus expire and old buttons cannot be used after reopening', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const { client, selected, send, click } = setup(t);
    await send('/model');
    t.mock.timers.tick(120_000);
    await click('pick', 0, 0);
    assert.match(client.answers.at(-1)!, /expiré/);
    await send('/model');
    await click('pick', 0, 0);
    assert.match(client.answers.at(-1)!, /expiré/);
    assert.notEqual(
      client.approvals[0].keyboard.inline_keyboard[0][0].callback_data,
      client.approvals[1].keyboard.inline_keyboard[0][0].callback_data
    );
    assert.equal(selected.length, 0);
  });

  for (const command of ['/new', '/resume saved', '/switch staging', '/stop']) {
    test(`${command} invalidates an existing model menu`, async (t) => {
      const { client, selected, send, click } = setup(t);
      await send('/model');
      await send(command);
      await click('pick', 0, 0);
      assert.match(client.answers.at(-1)!, /expiré/);
      assert.equal(selected.length, 0);
    });
  }

  test('re-pairing and stopping invalidate a menu delivered late', async (t) => {
    const { client, service, selected, send, click } = setup(t);
    const delivery = deferred<void>();
    client.delivery = delivery.promise;
    await send('/model');
    await send(`/pair ${service.createPairingCode()}`);
    delivery.resolve();
    await flush();
    assert.match(client.closed.at(-1)!.text, /fermé/);
    await click('pick', 0, 0);
    assert.equal(selected.length, 0);
    await send('/model');
    service.stop();
    assert.match(client.closed.at(-1)!.text, /fermé/);
  });

  test('model loading leaves polling responsive and cannot publish after /stop', async (t) => {
    const pending = deferred<ModelMenu>();
    let reads = 0;
    const { client, send } = setup(t, {
      list: () => {
        reads++;
        return pending.promise;
      },
    });
    await send('/model');
    await send('/model');
    assert.equal(reads, 1);
    assert.match(client.messages.at(-1)!, /en cours de chargement/);
    await send('/ping');
    await send('/help');
    await send('/status');
    assert.ok(client.messages.includes('pong'));
    assert.ok(client.messages.some((text) => text.includes('Nexus — aide')));
    const help = client.messages.find((text) => text.includes('Nexus — aide'))!;
    assert.match(help, /`\/model`/);
    assert.match(help, /tokens et les quotas/);
    assert.ok(client.messages.some((text) => text.includes('Nexus — statut')));
    await send('/stop');
    pending.resolve(catalog());
    await flush();
    assert.equal(client.approvals.length, 0);
  });

  test('selection is refused during a running prompt', async (t) => {
    const pending = deferred<string>();
    const { client, selected, send, click } = setup(t, { prompt: () => pending.promise });
    t.after(() => pending.resolve('done'));
    await send('/model');
    await click('pick', 0);
    await send('/codex hello');
    await click('effort', 0);
    assert.equal(selected.length, 0);
    assert.match(client.closed.at(-1)!.text, /en cours/);
  });

  test('handles catalog, transport and selection failures with explicit errors', async (t) => {
    let reads = 0;
    const { client, send, click } = setup(t, {
      list: async () => {
        if (++reads === 1) {
          throw new Error('Catalog unavailable');
        }
        return reads === 2 ? { ...catalog(), models: [] } : catalog();
      },
      select: async () => {
        throw new Error('Selection unavailable');
      },
    });
    await send('/model extra');
    assert.equal(reads, 0);
    await send('/model');
    assert.match(client.messages.at(-1)!, /Catalog unavailable/);
    await send('/model');
    assert.match(client.messages.at(-1)!, /aucun modèle/);
    client.failSend = true;
    await send('/model');
    assert.match(client.messages.at(-1)!, /Offline/);
    client.failSend = false;
    await send('/model');
    await click('pick', 0);
    client.failAnswer = true;
    await click('effort', 0);
    assert.match(client.closed.at(-1)!.text, /Selection unavailable/);
  });
});
