import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { ModelMenu, ModelSelection } from '../../codex/types';
import { ApprovalRequest } from '../../telegram/approvals';
import { RemoteSessionAction, TelegramService } from '../../telegram/service';
import { TelegramUpdate } from '../../telegram/types';
import { context, deferred, FakeTelegram, flush } from './helpers';

const message = (id: number, text: string): TelegramUpdate => ({
  update_id: id,
  message: { text, from: { id: 10 }, chat: { id: 20, type: 'private' } },
});

const catalog = (): ModelMenu => ({
  context: 'workspace-session',
  selected: { model: 'gemini-2.5-pro', effort: 'medium' },
  models: [
    {
      id: 'gemini-2.5-pro',
      model: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      description: 'Advanced reasoning model',
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' },
        { reasoningEffort: 'medium', description: 'Balanced' },
        { reasoningEffort: 'high', description: 'Deep reasoning' },
      ],
    },
    {
      id: 'gemini-2.5-flash',
      model: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      description: 'High-speed model',
      isDefault: false,
      defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast' }],
    },
  ],
});

suite('Telegram Antigravity & Multi-Backend Integration', () => {
  test('/backend toggles between Codex and Antigravity and rejects invalid syntax', async (t) => {
    const client = new FakeTelegram();
    const savedContext = context();
    let currentBackend: 'codex' | 'antigravity' = 'codex';

    const service = new TelegramService(savedContext, client, {
      getActiveBackend: () => currentBackend,
      setActiveBackend: (backend: 'codex' | 'antigravity') => {
        currentBackend = backend;
      },
    });
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // Initial backend query
    client.push(message(1, '/backend'));
    await flush();
    assert.match(client.messages[0], /Backend actif : 🤖 Codex/);
    assert.match(client.messages[0], /\/backend antigravity pour basculer/);

    // Switch to antigravity
    client.push(message(2, '/backend antigravity'));
    await flush();
    assert.equal(currentBackend, 'antigravity');
    assert.match(client.messages[1], /Backend actif défini sur : ✨ Gemini Antigravity/);

    // Query again
    client.push(message(3, '/backend'));
    await flush();
    assert.match(client.messages[2], /Backend actif : ✨ Gemini Antigravity/);
    assert.match(client.messages[2], /\/backend codex pour basculer/);

    // Aliases: agy and gemini
    client.push(message(4, '/backend codex'));
    await flush();
    assert.equal(currentBackend, 'codex');

    client.push(message(5, '/backend agy'));
    await flush();
    assert.equal(currentBackend, 'antigravity');

    client.push(message(6, '/backend codex'));
    await flush();

    client.push(message(7, '/backend gemini'));
    await flush();
    assert.equal(currentBackend, 'antigravity');

    // Invalid arguments
    client.push(message(8, '/backend invalid-backend'));
    client.push(message(9, '/backend codex extra'));
    await flush();
    assert.match(client.messages[7], /Usage : \/backend \[codex\|antigravity\]/);
    assert.match(client.messages[8], /Usage : \/backend \[codex\|antigravity\]/);
  });

  test('runs Antigravity prompt via /antigravity, /agy, and /gemini with working indicators and file summaries', async (t) => {
    const client = new FakeTelegram();
    const calls: string[] = [];
    const service = new TelegramService(
      context(),
      client,
      undefined, // codex prompt
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async (prompt) => {
        calls.push(prompt);
        return { text: `Processed: ${prompt}`, fileSummary: '📄 Modified: index.ts' };
      }
    );

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // Test /antigravity
    client.push(message(1, '/antigravity build feature'));
    await flush();
    assert.equal(calls[0], 'build feature');
    assert.match(client.messages[0], /⏳ Gemini Antigravity is working.../);
    assert.match(client.messages[1], /Processed: build feature/);
    assert.match(client.messages[2], /Modified: index\.ts/);

    // Test /agy
    client.push(message(2, '/agy review changes'));
    await flush();
    assert.equal(calls[1], 'review changes');
    assert.match(client.messages[4], /Processed: review changes/);

    // Test /gemini
    client.push(message(3, '/gemini explain architecture'));
    await flush();
    assert.equal(calls[2], 'explain architecture');
    assert.match(client.messages[7], /Processed: explain architecture/);

    // Test empty prompt
    client.push(message(4, '/antigravity'));
    client.push(message(5, '/agy   '));
    await flush();
    assert.match(client.messages[9], /Usage: \/antigravity <instruction>/);
    assert.match(client.messages[10], /Usage: \/agy <instruction>/);
  });

  test('reports unavailable Antigravity and blocks concurrent prompts', async (t) => {
    const client = new FakeTelegram();
    const pending = deferred<string>();

    const service = new TelegramService(
      context(),
      client,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => pending.promise
    );

    const polling = service.start();
    t.after(async () => {
      pending.resolve('done');
      service.stop();
      await polling;
    });

    client.push(message(1, '/antigravity first prompt'));
    await flush();
    client.push(message(2, '/antigravity second prompt'));
    await flush();

    assert.ok(client.messages.includes('An Antigravity turn is already running.'));

    // Test unavailable service
    const emptyService = new TelegramService(context(), client);
    const emptyPolling = emptyService.start();
    t.after(async () => {
      emptyService.stop();
      await emptyPolling;
    });

    client.push(message(3, '/antigravity test unavailable'));
    await flush();
    assert.ok(client.messages.includes('Gemini Antigravity is unavailable.'));
  });

  test('/new and /resume route to Antigravity when it is the active backend', async (t) => {
    const client = new FakeTelegram();
    const codexSessions: RemoteSessionAction[] = [];
    const agySessions: RemoteSessionAction[] = [];

    const service = new TelegramService(
      context(),
      client,
      undefined,
      undefined,
      async (action) => {
        codexSessions.push(action);
        return 'codex-session-id';
      },
      undefined,
      undefined,
      undefined,
      undefined,
      async (action) => {
        agySessions.push(action);
        return 'agy-session-id';
      }
    );

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // With Codex default backend
    client.push(message(1, '/new'));
    client.push(message(2, '/resume c-123'));
    await flush();

    assert.equal(codexSessions.length, 2);
    assert.equal(agySessions.length, 0);
    assert.match(client.messages[0], /Session Codex créée/);
    assert.match(client.messages[1], /Session Codex reprise/);

    // Switch to Antigravity
    client.push(message(3, '/backend antigravity'));
    await flush();

    client.push(message(4, '/new'));
    client.push(message(5, '/resume agy-456'));
    await flush();

    assert.equal(agySessions.length, 2);
    assert.deepEqual(agySessions, [{ type: 'new' }, { type: 'resume', sessionId: 'agy-456' }]);
    assert.match(client.messages[3], /Session Antigravity créée/);
    assert.match(client.messages[3], /ID session : agy-session-id/);
    assert.match(client.messages[4], /Session Antigravity reprise/);
    assert.match(client.messages[4], /ID session : agy-session-id/);
  });

  test('interactive /model opens Antigravity models and selects model + effort when Antigravity is active', async (t) => {
    const client = new FakeTelegram();
    const selected: { selection: ModelSelection; context: string }[] = [];
    const savedContext = context();

    const service = new TelegramService(
      savedContext,
      client,
      undefined,
      () => ({ workspaceCount: 0 }),
      undefined,
      undefined,
      undefined,
      undefined, // codex models
      undefined, // onRemoteAntigravityPrompt
      undefined, // onAntigravitySessionAction
      {
        list: async () => catalog(),
        select: async (selection, ctx) => {
          selected.push({ selection, context: ctx });
        },
      }, // antigravityModelControls
      undefined,
      () => 'antigravity' // activeBackend is Antigravity
    );

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    let updateId = 0;
    const send = async (text: string) => {
      client.push(message(++updateId, text));
      await flush();
    };
    const click = async (action: string, index: number) => {
      const sent = client.approvals[client.approvals.length - 1];
      const button = sent.keyboard.inline_keyboard
        .flat()
        .find((b) => b.callback_data.endsWith(`:${action}:${index}`));
      assert.ok(button, `Missing button for ${action}:${index}`);
      const event: TelegramUpdate = {
        update_id: ++updateId,
        callback_query: {
          id: `click-${updateId}`,
          from: { id: 10 },
          data: button.callback_data,
          message: { message_id: sent.messageId, chat: { id: 20, type: 'private' } },
        },
      };
      client.push(event);
      await flush();
    };

    await send('/model');
    assert.match(client.approvals[0].text, /✨ Nexus — modèles Antigravity/);
    assert.match(client.approvals[0].keyboard.inline_keyboard[0][0].text, /Gemini 2\.5 Pro/);

    // Pick first model (Gemini 2.5 Pro)
    await click('pick', 0);
    assert.match(client.approvals[0].text, /Gemini 2\.5 Pro — raisonnement/);

    // Pick reasoning effort: high (index 2)
    await click('effort', 2);

    assert.equal(selected.length, 1);
    assert.deepEqual(selected[0], {
      selection: { model: 'gemini-2.5-pro', effort: 'high' },
      context: 'workspace-session',
    });

    assert.match(client.closed.at(-1)!.text, /Modèle choisi : Gemini 2\.5 Pro/);
    assert.match(client.closed.at(-1)!.text, /Raisonnement : high/);
    assert.match(client.closed.at(-1)!.text, /Appliqué à la prochaine demande \/antigravity/);
  });

  test('/stop stops both Codex and Antigravity and reports correct idle messages based on backend', async (t) => {
    const client = new FakeTelegram();
    let codexStopped = 0;
    let agyStopped = 0;
    let backend: 'codex' | 'antigravity' = 'codex';

    const service = new TelegramService(
      context(),
      client,
      undefined,
      undefined,
      undefined,
      () => {
        codexStopped++;
        return false;
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        agyStopped++;
        return false;
      },
      () => backend,
      (b) => {
        backend = b;
      }
    );

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // Idle stop with Codex backend
    client.push(message(1, '/stop'));
    await flush();
    assert.equal(codexStopped, 1);
    assert.equal(agyStopped, 1);
    assert.match(client.messages[0], /⚪ Aucune requête Codex en cours\./);

    // Switch to Antigravity and test idle stop
    client.push(message(2, '/backend antigravity'));
    await flush();

    client.push(message(3, '/stop'));
    await flush();
    assert.equal(codexStopped, 2);
    assert.equal(agyStopped, 2);
    assert.match(client.messages[2], /⚪ Aucune requête Antigravity en cours\./);
  });

  test('Antigravity approval buttons prompt and handle accept callback via Telegram', async (t) => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client);
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    const request: ApprovalRequest = {
      agentName: 'Antigravity',
      kind: 'command',
      threadId: 'thread-agy',
      turnId: 'turn-1',
      itemId: 'run_command',
      details: 'Commande : rm -rf /tmp/test\nWorkspace : /project',
      expiresAt: Date.now() + 60_000,
    };

    const resultPromise = service.requestApproval(request, new AbortController().signal);
    await flush();

    // Verify Telegram received the approval prompt with Antigravity branding
    assert.equal(client.approvals.length, 1);
    assert.match(client.approvals[0].text, /🔐 Antigravity — commande/);
    assert.match(client.approvals[0].text, /rm -rf \/tmp\/test/);
    assert.deepEqual(
      client.approvals[0].keyboard.inline_keyboard[0].map((b) => b.text),
      ['Autoriser une fois', 'Refuser']
    );

    // Simulate clicking accept button
    const acceptData = client.approvals[0].keyboard.inline_keyboard[0][0].callback_data;
    const event: TelegramUpdate = {
      update_id: 10,
      callback_query: {
        id: 'cb-1',
        from: { id: 10 },
        data: acceptData,
        message: { message_id: client.approvals[0].messageId, chat: { id: 20, type: 'private' } },
      },
    };
    client.push(event);
    await flush();

    const decision = await resultPromise;
    assert.equal(decision, 'accept');
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /✅ Autorisation ponctuelle transmise à Antigravity\./);
  });

  test('Antigravity approval buttons handle decline callback via Telegram', async (t) => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client);
    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    const request: ApprovalRequest = {
      agentName: 'Antigravity',
      kind: 'fileChange',
      threadId: 'thread-agy',
      turnId: 'turn-2',
      itemId: 'write_to_file',
      details: 'Fichier : /project/index.ts',
      expiresAt: Date.now() + 60_000,
    };

    const resultPromise = service.requestApproval(request, new AbortController().signal);
    await flush();

    // Verify Telegram received the fileChange prompt
    assert.equal(client.approvals.length, 1);
    assert.match(client.approvals[0].text, /🔐 Antigravity — modification de fichier/);
    assert.match(client.approvals[0].text, /\/project\/index\.ts/);

    // Simulate clicking decline button
    const declineData = client.approvals[0].keyboard.inline_keyboard[0][1].callback_data;
    const event: TelegramUpdate = {
      update_id: 20,
      callback_query: {
        id: 'cb-2',
        from: { id: 10 },
        data: declineData,
        message: { message_id: client.approvals[0].messageId, chat: { id: 20, type: 'private' } },
      },
    };
    client.push(event);
    await flush();

    const decision = await resultPromise;
    assert.equal(decision, 'decline');
    assert.equal(client.closed.length, 1);
    assert.match(client.closed[0].text, /⛔ Approbation refusée\./);
  });

  test('/status displays Antigravity pending approvals count and waiting indicator', async (t) => {
    const client = new FakeTelegram();
    let pendingApprovals = 1;

    const service = new TelegramService(
      context(),
      client,
      undefined,
      () => ({
        workspaceCount: 1,
        antigravity: {
          processRunning: true,
          turn: { startedAt: 1000, id: 'turn-123' },
          pendingApprovals,
          sessionId: 'session-123',
          workspacePath: '/project',
          model: 'gemini-2.5-pro',
        },
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => 'antigravity'
    );

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // With 1 pending approval
    client.push(message(1, '/status'));
    await flush();
    assert.match(client.messages[0], /🟠 Turn Antigravity : en attente d’approbation/);
    assert.match(client.messages[0], /🔐 Approbations en attente : 1/);

    // With 0 pending approvals
    pendingApprovals = 0;
    client.push(message(2, '/status'));
    await flush();
    assert.match(client.messages[1], /⏳ Turn Antigravity : en cours/);
    assert.doesNotMatch(client.messages[1], /🔐 Approbations en attente/);
  });
});
