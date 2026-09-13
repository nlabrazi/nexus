import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { NexusStatusSnapshot } from '../../telegram/status';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text = '/status'): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

suite('Telegram /status', () => {
  test('reports no workspace/session without invoking Codex and reads fresh state each time', async t => {
    const client = new FakeTelegram();
    let promptCalls = 0;
    let snapshot: NexusStatusSnapshot = {
      workspaceCount: 0,
      codex: { processRunning: false, pendingApprovals: 0 },
    };
    const service = new TelegramService(context(), client,
      async () => { promptCalls++; return 'Unexpected'; }, () => snapshot);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });

    client.push(message(1));
    await flush();
    assert.match(client.messages[0], /Workspace ciblé : aucun/);
    assert.match(client.messages[0], /Processus Codex : arrêté/);
    assert.match(client.messages[0], /Session Codex : aucune/);
    assert.match(client.messages[0], /Turn : aucun en cours/);
    assert.equal(promptCalls, 0);

    snapshot = {
      workspace: { name: 'Nexus', path: '/project' }, workspaceCount: 1,
      codex: { processRunning: true, sessionId: 'thread', workspacePath: '/project', pendingApprovals: 0 },
    };
    client.push(message(2, ' /status '));
    await flush();
    assert.match(client.messages[1], /Workspace ciblé : Nexus\nChemin : \/project/);
    assert.match(client.messages[1], /Session Codex : active\nID session : thread/);
    assert.match(client.messages[1], /Workspace de la session : \/project/);
    assert.match(client.messages[1], /Turn : aucun en cours/);
    assert.equal(promptCalls, 0);
  });

  test('answers during a prompt and approval, with turn ID and elapsed time', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: 13_500 });
    const client = new FakeTelegram();
    const finished = deferred<string>();
    const snapshot: NexusStatusSnapshot = {
      workspace: { name: 'Nexus', path: '/project' }, workspaceCount: 1,
      codex: {
        processRunning: true, sessionId: 'thread', workspacePath: '/project',
        turn: { id: 'turn-42', startedAt: 1000 }, pendingApprovals: 1,
      },
    };
    const service = new TelegramService(context(), client, () => finished.promise, () => snapshot);
    const polling = service.start();
    t.after(async () => { finished.resolve('Done'); service.stop(); await polling; });
    client.push(message(1, '/codex run tests'));
    await flush();
    client.push(message(2));
    await flush();
    assert.match(client.messages[1], /Requête Telegram : en cours/);
    assert.match(client.messages[1], /Turn : en attente d’approbation \(12 s\)/);
    assert.match(client.messages[1], /ID turn : turn-42/);
    assert.match(client.messages[1], /Approbations en attente : 1/);

    snapshot.codex!.pendingApprovals = 0;
    client.push(message(3));
    await flush();
    assert.match(client.messages[2], /Turn : en cours \(12 s\)/);
    assert.match(client.messages[2], /Approbations en attente : 0/);
    snapshot.codex!.turn!.interrupting = true;
    client.push(message(4));
    await flush();
    assert.match(client.messages[3], /Turn : interruption en cours \(12 s\)/);
    assert.match(client.messages[3], /Requête Telegram : en cours/);
    finished.resolve('Done');
    snapshot.codex!.turn = undefined;
    await flush();
    client.push(message(5));
    await flush();
    assert.match(client.messages.at(-1)!, /Requête Telegram : aucune/);
    assert.match(client.messages.at(-1)!, /Turn : aucun en cours/);
  });

  test('does not disclose status to another user, chat, or a group', async t => {
    const client = new FakeTelegram();
    let reads = 0;
    const service = new TelegramService(context(), client, undefined, () => {
      reads++; return { workspaceCount: 0 };
    });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    const wrongUser = message(1);
    wrongUser.message!.from!.id = 99;
    const wrongChat = message(2);
    wrongChat.message!.chat.id = 99;
    const group = message(3);
    group.message!.chat.type = 'group';
    client.push(wrongUser, wrongChat, group);
    await flush();
    assert.equal(reads, 0);
    assert.equal(client.messages.length, 0);
  });

  test('shows multiple folders, session mismatch, and a stopped process without claiming an active session', async t => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client, undefined, () => ({
      workspace: { name: 'Other', path: '/other' }, workspaceCount: 2,
      codex: { processRunning: false, sessionId: 'thread', workspacePath: '/project', pendingApprovals: 0 },
    }));
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push(message(1));
    await flush();
    const status = client.messages[0];
    assert.match(status, /Dossiers ouverts : 2 \(le premier est ciblé\)/);
    assert.match(status, /Session Codex : indisponible \(processus arrêté\)/);
    assert.match(status, /ID session : thread/);
    assert.match(status, /diffère du workspace ciblé/);
    assert.doesNotMatch(status, /Session Codex : active/);
  });

  test('reports an unavailable provider without leaking its error and keeps responding', async t => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client, undefined, () => {
      throw new Error('Private internal details');
    });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push(message(1), message(2, '/ping'));
    await flush();
    assert.deepEqual(client.messages, ['Impossible de lire le statut de Nexus.', 'pong']);
  });
});
