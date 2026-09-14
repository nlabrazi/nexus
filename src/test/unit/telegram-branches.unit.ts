import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { RemoteBranchAction, TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id, message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

suite('Telegram branch commands', () => {
  test('lists and switches branches without starting Codex, reports errors and releases the lock', async t => {
    const client = new FakeTelegram();
    const actions: RemoteBranchAction[] = [];
    const service = new TelegramService(context(), client, undefined, undefined, undefined, undefined, async action => {
      actions.push(action);
      if (action.type === 'switch' && action.name === 'missing') { throw new Error('Branche inconnue'); }
      return action.type === 'list' ? 'master 🔒\nstaging' : `Branche courante : ${action.name}`;
    });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    for (const [index, text] of ['/branches', '/switch missing', ' /switch staging ', '/switch origin/feature/test'].entries()) {
      client.push(message(index + 1, text));
      await flush();
    }
    assert.deepEqual(actions, [{ type: 'list' }, { type: 'switch', name: 'missing' },
      { type: 'switch', name: 'staging' }, { type: 'switch', name: 'origin/feature/test' }]);
    assert.deepEqual(client.messages, ['master 🔒\nstaging', '❌ Branche inconnue',
      'Branche courante : staging', 'Branche courante : origin/feature/test']);
  });

  test('checks authorization and command syntax before branch access', async t => {
    const client = new FakeTelegram();
    let calls = 0;
    const service = new TelegramService(context(), client, undefined, undefined, undefined, undefined,
      async () => { calls++; return 'unexpected'; });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    const wrongUser = message(1, '/switch staging');
    wrongUser.message!.from!.id = 99;
    const wrongChat = message(2, '/branches');
    wrongChat.message!.chat.id = 99;
    const group = message(3, '/switch staging');
    group.message!.chat.type = 'group';
    client.push(wrongUser, wrongChat, group, message(4, '/switch'), message(5, '/switch a b'), message(6, '/branches extra'));
    await flush();
    assert.equal(calls, 0);
    assert.deepEqual(client.messages, ['Usage : /switch <branche>', 'Usage : /switch <branche>', 'Usage : /branches']);
  });

  test('pending switch excludes mutations while status and stop remain responsive', async t => {
    const client = new FakeTelegram();
    const pending = deferred<string>();
    let switches = 0;
    let codex = 0;
    const service = new TelegramService(context(), client, async () => { codex++; return ''; },
      () => ({ workspaceCount: 0 }), async () => { codex++; return ''; }, () => false,
      async () => { switches++; return pending.promise; });
    const polling = service.start();
    t.after(async () => { pending.resolve('staging'); service.stop(); await polling; });
    client.push(message(1, '/switch staging'), message(2, '/stop'), message(3, '/switch other'),
      message(4, '/new'), message(5, '/codex hello'), message(6, '/status'));
    await flush();
    assert.equal(switches, 1);
    assert.equal(codex, 0);
    assert.ok(client.messages.some(text => text.includes('Aucune requête Codex')));
    assert.ok(client.messages.some(text => text.includes('Nexus')));
    pending.resolve('Branche courante : staging');
    await flush();
    assert.equal(client.messages.at(-1), 'Branche courante : staging');
  });

  test('a running prompt blocks switching', async t => {
    const client = new FakeTelegram();
    const pending = deferred<string>();
    let switches = 0;
    const service = new TelegramService(context(), client, () => pending.promise, undefined, undefined, undefined,
      async () => { switches++; return ''; });
    const polling = service.start();
    t.after(async () => { pending.resolve('done'); service.stop(); await polling; });
    client.push(message(1, '/codex hello'), message(2, '/switch staging'));
    await flush();
    assert.equal(switches, 0);
    assert.match(client.messages.at(-1)!, /Attendez sa fin/);
  });
});
