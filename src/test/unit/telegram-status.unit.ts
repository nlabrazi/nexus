import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TelegramService } from '../../telegram/service';
import { formatTelegramStatus, NexusStatusSnapshot } from '../../telegram/status';
import { formatTelegramResponse } from '../../telegram/formatting';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text = '/status'): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

suite('Telegram /status', () => {
  test('formats real token counters, context, selected model and quotas without double-counting cache or reasoning', () => {
    const breakdown = { totalTokens: 1500, inputTokens: 1000, cachedInputTokens: 400, outputTokens: 500, reasoningOutputTokens: 100 };
    const status = formatTelegramStatus({ workspaceCount: 0, codex: {
      processRunning: true, sessionActive: true, pendingApprovals: 0,
      model: 'model_with_underscores', reasoningEffort: 'high', modelSelection: { model: 'next-model', effort: 'low' },
      tokenUsage: { total: breakdown, last: { ...breakdown, totalTokens: 500 }, modelContextWindow: 10000 },
      rateLimits: [{ limitId: 'codex', planType: 'pro', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 2000000000 },
        secondary: { usedPercent: 40, windowDurationMins: 10080 } }],
    } }, false);
    const rendered = formatTelegramResponse(status).map(chunk => chunk.text).join('');
    assert.match(rendered, /Modèle de la session : model_with_underscores/);
    assert.match(rendered, /prochain prompt : next-model \(low\)/);
    assert.match(rendered, /Total cumulé : 1\s500/);
    assert.match(rendered, /dont cache lu : 400/);
    assert.match(rendered, /dont raisonnement : 100/);
    assert.match(rendered, /500 \/ 10\s000 tokens \(≈ 95 % restant\)/);
    assert.match(rendered, /5 h : 25 % utilisé \(75 % restant\)/);
    assert.match(rendered, /7 j : 40 % utilisé/);
    assert.match(rendered, /Réinitialisation/);
    assert.doesNotMatch(rendered, /\*\*/);
  });

  test('distinguishes unknown counters, zero usage and stale snapshots', () => {
    const snapshot: NexusStatusSnapshot = { workspaceCount: 0, codex: { processRunning: false, pendingApprovals: 0 } };
    const empty = formatTelegramStatus(snapshot, false);
    assert.match(empty, /aucune mesure reçue/);
    assert.doesNotMatch(empty, /Total cumulé : 0/);
    const zero = { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
    snapshot.codex!.tokenUsage = { total: zero, last: zero, modelContextWindow: null };
    snapshot.codex!.rateLimits = [{ limitId: 'codex', primary: { usedPercent: 0 } }];
    const status = formatTelegramStatus(snapshot, false);
    assert.match(status, /Total cumulé : 0/);
    assert.match(status, /session actuellement inactive/);
    assert.match(status, /actualisation indisponible/);
    assert.match(status, /Fenêtre de contexte : non communiquée/);
  });

  test('a pending quota refresh does not block /stop or approval polling', async t => {
    const client = new FakeTelegram();
    const snapshot = deferred<NexusStatusSnapshot>();
    let stopped = 0;
    const service = new TelegramService(context(), client, undefined, () => snapshot.promise, undefined, () => { stopped++; return false; });
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push(message(1), message(2, '/stop'), message(3, '/ping'));
    await flush();
    assert.equal(stopped, 1);
    assert.ok(client.messages.includes('pong'));
    snapshot.resolve({ workspaceCount: 0 });
    await flush();
    assert.match(client.messages.at(-1)!, /Nexus — statut/);
  });

  test('a late status refresh cannot send to a stopped Telegram service', async t => {
    const client = new FakeTelegram();
    const snapshot = deferred<NexusStatusSnapshot>();
    const service = new TelegramService(context(), client, undefined, () => snapshot.promise);
    const polling = service.start();
    client.push(message(1));
    await flush();
    service.stop();
    snapshot.resolve({ workspaceCount: 0 });
    await polling;
    await flush();
    assert.equal(client.messages.length, 0);
  });

  test('a pending status remains bound to the paired user and chat that requested it', async t => {
    const client = new FakeTelegram();
    const snapshot = deferred<NexusStatusSnapshot>();
    const savedContext = context();
    const service = new TelegramService(savedContext, client, undefined, () => snapshot.promise);
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push(message(1));
    await flush();
    await savedContext.globalState.update('nexus.telegram.allowedUserId', 99);
    await savedContext.globalState.update('nexus.telegram.allowedChatId', 88);
    snapshot.resolve({ workspaceCount: 0 });
    await flush();
    assert.equal(client.messages.length, 0);
  });

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
      codex: { processRunning: true, sessionId: 'thread', workspacePath: '/project', sessionBranch: 'feature/test', pendingApprovals: 0 },
    };
    client.push(message(2, ' /status '));
    await flush();
    assert.match(client.messages[1], /Workspace ciblé : Nexus\nChemin : \/project/);
    assert.match(client.messages[1], /Session Codex : active\nID session : thread/);
    assert.match(client.messages[1], /Workspace de la session : \/project/);
    assert.match(client.messages[1], /🌿 Branche de la session : feature\/test/);
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
    assert.match(status, /Dossiers ouverts : 2 \(actions Codex bloquées : cible ambiguë\)/);
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
