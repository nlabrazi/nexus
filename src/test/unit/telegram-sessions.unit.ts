import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { RemoteSessionAction, TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

suite('Telegram session commands', () => {
  test('/new and /resume dispatch explicit actions and return the selected ID', async (t) => {
    const client = new FakeTelegram();
    const actions: RemoteSessionAction[] = [];
    const service = new TelegramService(context(), client, undefined, undefined, async (action) => {
      actions.push(action);
      return action.type === 'new' ? 'fresh-id' : action.sessionId;
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(message(1, '/new'));
    await flush();
    client.push(message(2, ' /resume saved-id '));
    await flush();
    assert.deepEqual(actions, [{ type: 'new' }, { type: 'resume', sessionId: 'saved-id' }]);
    assert.match(client.messages[0], /créée.*\nID session : fresh-id/);
    assert.match(client.messages[1], /reprise.*\nID session : saved-id/);
  });

  test('pending session changes reject duplicate commands and prompts while /status keeps working', async (t) => {
    const client = new FakeTelegram();
    const selected = deferred<string>();
    let actions = 0;
    let prompts = 0;
    const service = new TelegramService(
      context(),
      client,
      async () => {
        prompts++;
        return 'Unexpected';
      },
      () => ({
        workspaceCount: 0,
        codex: { processRunning: true, pendingApprovals: 0, sessionChanging: true },
      }),
      async () => {
        actions++;
        return selected.promise;
      }
    );
    const polling = service.start();
    t.after(async () => {
      selected.resolve('fresh');
      service.stop();
      await polling;
    });
    client.push(
      message(1, '/new'),
      message(2, '/new'),
      message(3, '/resume saved'),
      message(4, '/codex hello'),
      message(5, '/status')
    );
    await flush();
    assert.equal(actions, 1);
    assert.equal(prompts, 0);
    assert.match(client.messages.at(-1)!, /Gestion de session : en cours/);
    selected.resolve('fresh');
    await flush();
    assert.match(client.messages.at(-1)!, /ID session : fresh/);
  });

  test('session changes are refused while a remote prompt is still running', async (t) => {
    const client = new FakeTelegram();
    const completed = deferred<string>();
    let actions = 0;
    const service = new TelegramService(
      context(),
      client,
      () => completed.promise,
      undefined,
      async () => {
        actions++;
        return 'Unexpected';
      }
    );
    const polling = service.start();
    t.after(async () => {
      completed.resolve('Done');
      service.stop();
      await polling;
    });
    client.push(message(1, '/codex hello'), message(2, '/new'), message(3, '/resume saved'));
    await flush();
    assert.equal(actions, 0);
    assert.equal(client.messages.filter((text) => text.includes('Attendez sa fin')).length, 2);
  });

  test('invalid arguments and unauthorized messages cannot change a session', async (t) => {
    const client = new FakeTelegram();
    let actions = 0;
    const service = new TelegramService(context(), client, undefined, undefined, async () => {
      actions++;
      return 'Unexpected';
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    const wrongUser = message(1, '/new');
    wrongUser.message!.from!.id = 99;
    const wrongChat = message(2, '/resume saved');
    wrongChat.message!.chat.id = 99;
    const group = message(3, '/new');
    group.message!.chat.type = 'group';
    client.push(
      wrongUser,
      wrongChat,
      group,
      message(4, '/new extra'),
      message(5, '/resume'),
      message(6, '/resume a b')
    );
    await flush();
    assert.equal(actions, 0);
    assert.deepEqual(client.messages, [
      'Usage : /new',
      'Usage : /resume <id>',
      'Usage : /resume <id>',
    ]);
  });

  test('a failed operation reports its error and releases the Telegram command lock', async (t) => {
    const client = new FakeTelegram();
    let actions = 0;
    const service = new TelegramService(context(), client, undefined, undefined, async () => {
      if (++actions === 1) {
        throw new Error('Session not found');
      }
      return 'fresh';
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });
    client.push(message(1, '/resume missing'));
    await flush();
    client.push(message(2, '/new'));
    await flush();
    assert.match(client.messages[0], /Session not found/);
    assert.match(client.messages[1], /ID session : fresh/);
  });
});
