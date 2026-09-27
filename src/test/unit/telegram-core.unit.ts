import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { NexusCore } from '../../core/nexus-core';
import { PendingApproval } from '../../core/types';
import { WebSocketServerConnection } from '../../core/ws-connection';
import { NexusProtocolError } from '../../protocol/errors';
import { createNexusMessage } from '../../protocol/messages';
import { NodeHelloPayload, TaskCompletedPayload } from '../../protocol/types';
import { createCoreTelegramService, TelegramCoreBridge } from '../../telegram/core-bridge';
import { TelegramService } from '../../telegram/service';
import { formatTelegramStatus } from '../../telegram/status';
import { TelegramUpdate } from '../../telegram/types';
import { context, FakeTelegram, flush } from './helpers';

function click(client: FakeTelegram, index = 0, button = 0): TelegramUpdate {
  return {
    update_id: 100 + index,
    callback_query: {
      id: `click-${index}`,
      from: { id: 10 },
      data: client.approvals[index].keyboard.inline_keyboard[0][button].callback_data,
      message: { message_id: client.approvals[index].messageId, chat: { id: 20, type: 'private' } },
    },
  };
}

suite('Telegram Core Bridge and routing', () => {
  const validToken = 'test-token-telegram-bridge';

  const mockHello: NodeHelloPayload = {
    nodeId: 'desktop-node-telegram',
    nodeName: 'station-telegram',
    version: '0.4.1',
    authToken: validToken,
    capabilities: {
      backends: ['codex', 'antigravity', 'brain'],
      workspaceGuard: true,
    },
    projects: [
      {
        id: 'proj-nexus',
        name: 'Nexus Core',
        path: '/home/user/nexus',
        currentBranch: 'staging',
      },
    ],
  };

  test('routes codex, antigravity, and brain prompts to core.executeTask', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const bridge = new TelegramCoreBridge(core, { defaultBackend: 'codex' });
    const serviceOptions = bridge.createServiceOptions();

    // Mock executeTask on core
    const executedTasks: { backend: string; prompt: string; projectId?: string }[] = [];
    (core as unknown as { executeTask: typeof core.executeTask }).executeTask = async (opts) => {
      executedTasks.push({ backend: opts.backend, prompt: opts.prompt, projectId: opts.projectId });
      return {
        taskId: 'mock-task-1',
        text: `Completed ${opts.backend} task: ${opts.prompt}`,
        fileSummary: '1 file modified',
      } as TaskCompletedPayload;
    };

    // 1. Codex prompt
    const codexRes = await serviceOptions.onRemotePrompt?.('Refactor backend');
    assert.deepEqual(codexRes, {
      text: 'Completed codex task: Refactor backend',
      fileSummary: '1 file modified',
    });
    assert.equal(executedTasks[0].backend, 'codex');
    assert.equal(executedTasks[0].prompt, 'Refactor backend');

    // 2. Antigravity prompt
    const agyRes = await serviceOptions.onRemoteAntigravityPrompt?.('Design agent architecture');
    assert.deepEqual(agyRes, {
      text: 'Completed antigravity task: Design agent architecture',
      fileSummary: '1 file modified',
    });
    assert.equal(executedTasks[1].backend, 'antigravity');

    // 3. Brain prompt
    const brainRes = await serviceOptions.onBrainPrompt?.(
      'Explique le statut',
      new AbortController().signal
    );
    assert.equal(brainRes, 'Completed brain task: Explique le statut');
    assert.equal(executedTasks[2].backend, 'brain');
  });

  test('translates protocol errors into user-friendly messages', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const bridge = new TelegramCoreBridge(core);
    const serviceOptions = bridge.createServiceOptions();

    // 1. NODE_OFFLINE
    (core as unknown as { executeTask: typeof core.executeTask }).executeTask = async () => {
      throw new NexusProtocolError('NODE_OFFLINE', 'Aucun nœud en ligne');
    };
    await assert.rejects(
      async () => serviceOptions.onRemotePrompt?.('test'),
      /Aucun Desktop Node connecté à Nexus Core/
    );

    // 2. NODE_BUSY
    (core as unknown as { executeTask: typeof core.executeTask }).executeTask = async () => {
      throw new NexusProtocolError('NODE_BUSY', 'Nœud occupé');
    };
    await assert.rejects(
      async () => serviceOptions.onRemotePrompt?.('test'),
      /Le Desktop Node est déjà occupé par une autre tâche/
    );

    // 3. TASK_CANCELLED
    (core as unknown as { executeTask: typeof core.executeTask }).executeTask = async () => {
      throw new NexusProtocolError('TASK_CANCELLED', 'Annulé');
    };
    await assert.rejects(async () => serviceOptions.onRemotePrompt?.('test'), /Tâche annulée/);
  });

  test('cancels active task on onStop', () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const bridge = new TelegramCoreBridge(core);
    const serviceOptions = bridge.createServiceOptions();

    // No running task
    assert.equal(serviceOptions.onStop?.(), false);

    // Running task in core
    let cancelledId: string | undefined;
    let cancelReason: string | undefined;
    (core as unknown as { listTasks: typeof core.listTasks }).listTasks = () => [
      {
        taskId: 'running-task-42',
        backend: 'codex',
        status: 'running',
        prompt: 'test',
        nodeId: 'node-1',
        createdAt: Date.now(),
        startedAt: Date.now(),
      },
    ];
    (core as unknown as { cancelTask: typeof core.cancelTask }).cancelTask = async (id, reason) => {
      cancelledId = id;
      cancelReason = reason;
      return true;
    };

    assert.equal(serviceOptions.onStop?.(), true);
    assert.equal(cancelledId, 'running-task-42');
    assert.ok(cancelReason?.includes('Telegram /stop'));
  });

  test('getStatus returns snapshot and formats Core status', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    // Register node via processMessage
    await core.processMessage(createNexusMessage('node:hello', mockHello));

    const bridge = new TelegramCoreBridge(core, { defaultBackend: 'codex' });
    const serviceOptions = bridge.createServiceOptions();

    const snapshot = await serviceOptions.getStatus?.();
    assert.ok(snapshot);
    assert.equal(snapshot?.activeBackend, 'codex');
    assert.equal(snapshot?.workspace?.name, 'Nexus Core');
    assert.equal(snapshot?.workspace?.path, '/home/user/nexus');
    assert.equal(snapshot?.core?.onlineNodes, 1);
    assert.equal(snapshot?.core?.totalNodes, 1);
    assert.equal(snapshot?.codex?.processRunning, true);
    assert.equal(snapshot?.codex?.sessionBranch, 'staging');
    assert.equal(snapshot?.codex?.pendingApprovals, 0);

    const formatted = formatTelegramStatus(snapshot!, false);
    assert.ok(formatted.includes('Nexus Core : en ligne'));
    assert.ok(formatted.includes('1/1 nœud(s) connecté(s)'));
    assert.ok(formatted.includes('Backend actif : 🤖 Codex'));
  });

  test('branch actions list projects and current branches', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const bridge = new TelegramCoreBridge(core);
    const serviceOptions = bridge.createServiceOptions();

    // With no nodes connected
    await assert.rejects(
      async () => serviceOptions.onBranchAction?.({ type: 'list' }),
      /Aucun Desktop Node connecté/
    );

    // With connected node
    await core.processMessage(createNexusMessage('node:hello', mockHello));

    const branchesList = await serviceOptions.onBranchAction?.({ type: 'list' });
    assert.ok(branchesList?.includes('Nexus Core'));
    assert.ok(branchesList?.includes('branche staging'));

    const switchMsg = await serviceOptions.onBranchAction?.({ type: 'switch', name: 'main' });
    assert.ok(switchMsg?.includes('non supporté à distance'));
  });

  test('relays scoped approval request from Core to Telegram and handles accept click', async (t) => {
    const client = new FakeTelegram();
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    // Provide mock connection to approval relay so decide sends message without error
    const dummyConn = {
      isOpen: () => true,
      send: () => {},
      close: () => {},
    } as unknown as WebSocketServerConnection;
    (
      core as unknown as { nodeWsConnections: Map<string, WebSocketServerConnection> }
    ).nodeWsConnections.set(mockHello.nodeId, dummyConn);

    const bridge = new TelegramCoreBridge(core);
    const service = new TelegramService(context(), client, bridge.createServiceOptions());
    bridge.attachTelegramService(service);

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    // Core receives an approval:request from node
    await core.processMessage(
      createNexusMessage('approval:request', {
        approvalId: 'appr-bridge-accept',
        taskId: 'task-bridge-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'npm run test:unit',
        expiresAt: Date.now() + 60_000,
      })
    );

    await flush();

    // Verify Telegram sent approval inline keyboard
    assert.equal(client.approvals.length, 1);
    assert.ok(client.approvals[0].text.includes('npm run test:unit'));
    assert.equal(client.approvals[0].keyboard.inline_keyboard[0][0].text, 'Autoriser une fois');
    assert.equal(client.approvals[0].keyboard.inline_keyboard[0][1].text, 'Refuser');

    // Simulate user clicking "Autoriser" (button index 0)
    client.push(click(client, 0, 0));
    await flush();

    // Verify Core approval status updated to 'approved'
    const approval = core.getApproval('appr-bridge-accept');
    assert.ok(approval);
    assert.equal(approval?.status, 'approved');
    assert.equal(approval?.decision, 'accept');
    assert.equal(approval?.decidedBy, 'telegram');
  });

  test('relays scoped approval request from Core to Telegram and handles decline click', async (t) => {
    const client = new FakeTelegram();
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const dummyConn = {
      isOpen: () => true,
      send: () => {},
      close: () => {},
    } as unknown as WebSocketServerConnection;
    (
      core as unknown as { nodeWsConnections: Map<string, WebSocketServerConnection> }
    ).nodeWsConnections.set(mockHello.nodeId, dummyConn);

    const bridge = new TelegramCoreBridge(core);
    const service = new TelegramService(context(), client, bridge.createServiceOptions());
    bridge.attachTelegramService(service);

    const polling = service.start();
    t.after(async () => {
      service.stop();
      await polling;
    });

    await core.processMessage(
      createNexusMessage('approval:request', {
        approvalId: 'appr-bridge-decline',
        taskId: 'task-bridge-2',
        agentName: 'Antigravity',
        kind: 'fileChange',
        details: 'delete src/secret.ts',
        expiresAt: Date.now() + 60_000,
      })
    );

    await flush();
    assert.equal(client.approvals.length, 1);

    // Simulate user clicking "Refuser" (button index 1)
    client.push(click(client, 0, 1));
    await flush();

    const approval = core.getApproval('appr-bridge-decline');
    assert.ok(approval);
    assert.equal(approval?.status, 'declined');
    assert.equal(approval?.decision, 'decline');
  });

  test('aborts Telegram approval request when Core emits approval:cancelled', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const bridge = new TelegramCoreBridge(core);
    let abortSignalled = false;
    const service = {
      requestApproval: async (_req: unknown, signal: AbortSignal) => {
        signal.addEventListener('abort', () => {
          abortSignalled = true;
        });
        return new Promise<never>(() => {});
      },
    } as unknown as TelegramService;
    bridge.attachTelegramService(service);

    const dummyApproval: PendingApproval = {
      approvalId: 'appr-cancel-test',
      taskId: 'task-cancel-test',
      nodeId: 'node-test',
      agentName: 'Codex',
      kind: 'command',
      details: 'sleep 100',
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
      status: 'pending',
    };

    core.emit('approval:request', dummyApproval);
    await flush();

    // Cancel approval in core
    dummyApproval.status = 'cancelled';
    core.emit('approval:cancelled', dummyApproval);
    await flush();

    assert.equal(abortSignalled, true);
  });

  test('createCoreTelegramService factory creates service, bridge and client', () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    const { service, bridge, client } = createCoreTelegramService(
      core,
      'fake-bot-token-12345:ABCDE',
      {
        projectId: 'proj-nexus',
        defaultBackend: 'antigravity',
      }
    );

    assert.ok(service instanceof TelegramService);
    assert.ok(bridge instanceof TelegramCoreBridge);
    assert.ok(client);
    assert.equal(typeof client.sendMessage, 'function');
  });
});
