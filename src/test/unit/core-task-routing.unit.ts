import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { BrainModel } from '../../conversational/model';
import { NexusCore, NodePresenceManager, RemoteTask, TaskRouter } from '../../core';
import { WebSocketServerConnection } from '../../core/ws-connection';
import { DesktopNode, resolveDesktopConfig } from '../../desktop';
import { NexusProtocolError } from '../../protocol/errors';
import { parseNexusMessage } from '../../protocol/messages';
import { NodeHelloPayload, TaskCompletedPayload, TaskStartPayload } from '../../protocol/types';

suite('Nexus Core remote task routing, results, and cancellation', () => {
  const testDir = join(tmpdir(), 'nexus-task-routing-test');
  const validToken = 'test-token-task-router-42';

  test('beforeEach setup test dir', () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  suite('TaskRouter unit tests', () => {
    const mockHello: NodeHelloPayload = {
      nodeId: 'node-alpha',
      nodeName: 'alpha-station',
      version: '0.4.1',
      authToken: validToken,
      capabilities: {
        backends: ['codex', 'antigravity', 'brain'],
        workspaceGuard: true,
      },
      projects: [
        {
          id: 'proj-nexus',
          name: 'Nexus Project',
          path: '/code/nexus',
          currentBranch: 'staging',
        },
      ],
    };

    test('rejects task submission when no node is connected', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      const router = new TaskRouter(presence, () => undefined);

      await assert.rejects(
        router.submitTask({
          backend: 'codex',
          prompt: 'Do something',
        }),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'NODE_OFFLINE'
      );
    });

    test('rejects task submission when node is busy', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);
      presence.updateStatus({
        nodeId: 'node-alpha',
        state: 'busy',
        activeTaskId: 'task-existing',
      });

      const fakeConn = {
        isOpen: () => true,
        send: () => {},
      } as unknown as WebSocketServerConnection;
      const router = new TaskRouter(presence, () => fakeConn);

      await assert.rejects(
        router.submitTask({
          backend: 'brain',
          prompt: 'Hello',
        }),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'NODE_BUSY'
      );
    });

    test('rejects task submission when node is draining', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);
      presence.updateStatus({
        nodeId: 'node-alpha',
        state: 'draining',
      });

      const fakeConn = {
        isOpen: () => true,
        send: () => {},
      } as unknown as WebSocketServerConnection;
      const router = new TaskRouter(presence, () => fakeConn);

      await assert.rejects(
        router.submitTask({
          backend: 'brain',
          prompt: 'Hello',
        }),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'NODE_OFFLINE'
      );
    });

    test('submits task and dispatches task:start message over connection', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);

      let sentRaw = '';
      const fakeConn = {
        isOpen: () => true,
        send: (raw: string) => {
          sentRaw = raw;
        },
      } as unknown as WebSocketServerConnection;

      const router = new TaskRouter(presence, () => fakeConn);
      let startedEmitted: RemoteTask | undefined;
      router.on('task:started', (t) => {
        startedEmitted = t;
      });

      const task = await router.submitTask({
        backend: 'codex',
        prompt: 'Refactor code',
        projectId: 'proj-nexus',
      });

      assert.equal(task.backend, 'codex');
      assert.equal(task.nodeId, 'node-alpha');
      assert.equal(task.status, 'pending');
      assert.ok(startedEmitted);
      assert.equal(startedEmitted.taskId, task.taskId);

      const parsed = parseNexusMessage(sentRaw);
      assert.equal(parsed.type, 'task:start');
      const startPayload = parsed.payload as TaskStartPayload;
      assert.equal(startPayload.taskId, task.taskId);
      assert.equal(startPayload.prompt, 'Refactor code');
    });

    test('records progress, completion, and resets node state', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);

      const fakeConn = {
        isOpen: () => true,
        send: () => {},
      } as unknown as WebSocketServerConnection;
      const router = new TaskRouter(presence, () => fakeConn);

      const task = await router.submitTask({
        backend: 'brain',
        prompt: 'Synthesize plan',
      });

      // Node should be marked busy
      assert.equal(presence.getNode('node-alpha')?.state, 'busy');

      let progressEmitted: RemoteTask | undefined;
      router.on('task:progress', (t) => {
        progressEmitted = t;
      });

      router.recordProgress({
        taskId: task.taskId,
        stage: 'executing',
        message: 'Thinking...',
      });

      assert.equal(task.status, 'running');
      assert.equal(task.stage, 'executing');
      assert.equal(task.progressMessage, 'Thinking...');
      assert.ok(progressEmitted);

      // Record completion
      let completedEmitted: RemoteTask | undefined;
      router.on('task:completed', (t) => {
        completedEmitted = t;
      });

      router.recordCompleted({
        taskId: task.taskId,
        text: 'Plan synthesized successfully.',
      });

      assert.equal(task.status, 'completed');
      assert.equal(task.result?.text, 'Plan synthesized successfully.');
      assert.ok(completedEmitted);

      // Node state should be reset to idle
      assert.equal(presence.getNode('node-alpha')?.state, 'idle');
    });

    test('waitForTask handles timeout and cancels task', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);

      let cancelSent = false;
      const fakeConn = {
        isOpen: () => true,
        send: (raw: string) => {
          const msg = parseNexusMessage(raw);
          if (msg.type === 'task:cancel') {
            cancelSent = true;
          }
        },
      } as unknown as WebSocketServerConnection;

      const router = new TaskRouter(presence, () => fakeConn, {
        defaultTaskTimeoutMs: 50,
      });

      const task = await router.submitTask({
        backend: 'brain',
        prompt: 'Long operation',
      });

      await assert.rejects(
        router.waitForTask(task.taskId, 50),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'TASK_TIMEOUT'
      );

      assert.equal(cancelSent, true);
    });

    test('handleNodeDisconnected marks in-flight tasks as failed with NODE_OFFLINE', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);

      const fakeConn = {
        isOpen: () => true,
        send: () => {},
      } as unknown as WebSocketServerConnection;
      const router = new TaskRouter(presence, () => fakeConn);

      const task = await router.submitTask({
        backend: 'codex',
        prompt: 'Work in progress',
      });

      router.recordProgress({
        taskId: task.taskId,
        stage: 'executing',
      });
      assert.equal(task.status, 'running');

      router.handleNodeDisconnected('node-alpha');

      assert.equal(task.status, 'failed');
      assert.equal(task.error?.code, 'NODE_OFFLINE');
    });

    test('filters listTasks by backend and projectId', async () => {
      const presence = new NodePresenceManager({ authTokens: [validToken] });
      presence.registerNode(mockHello);

      const fakeConn = {
        isOpen: () => true,
        send: () => {},
      } as unknown as WebSocketServerConnection;
      const router = new TaskRouter(presence, () => fakeConn);

      const t1 = await router.submitTask({
        backend: 'brain',
        prompt: 'Task Brain 1',
        projectId: 'proj-1',
      });
      router.recordCompleted({ taskId: t1.taskId, text: 'done' });

      const t2 = await router.submitTask({
        backend: 'codex',
        prompt: 'Task Codex 1',
        projectId: 'proj-1',
      });
      router.recordCompleted({ taskId: t2.taskId, text: 'done' });

      const t3 = await router.submitTask({
        backend: 'brain',
        prompt: 'Task Brain 2',
        projectId: 'proj-2',
      });
      router.recordCompleted({ taskId: t3.taskId, text: 'done' });

      const brainTasks = router.listTasks({ backend: 'brain' });
      assert.equal(brainTasks.length, 2);
      assert.ok(brainTasks.every((t) => t.backend === 'brain'));

      const proj1Tasks = router.listTasks({ projectId: 'proj-1' });
      assert.equal(proj1Tasks.length, 2);

      const brainProj2 = router.listTasks({ backend: 'brain', projectId: 'proj-2' });
      assert.equal(brainProj2.length, 1);
      assert.equal(brainProj2[0]?.prompt, 'Task Brain 2');
    });
  });

  suite('End-to-End WebSocket remote task routing with DesktopNode', () => {
    test('routes brain task from Core to DesktopNode and receives completed result', async () => {
      const core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });

      await core.start();
      const server = core.getServer();
      const address = server?.address() as { port: number };
      const coreUrl = `http://127.0.0.1:${address.port}`;

      const mockBrainModel: BrainModel = {
        decide: async (messages) => {
          const lastMsg = messages[messages.length - 1]?.text ?? '';
          return {
            action: 'reply',
            text: `Réponse du Brain à : ${lastMsg}`,
          };
        },
      };

      const nodeConfig = resolveDesktopConfig(
        {
          project: testDir,
          name: 'Remote Project',
          nodeId: 'desktop-e2e-node',
          core: coreUrl,
          authToken: validToken,
        },
        {},
        testDir
      );

      const desktop = new DesktopNode(nodeConfig, {
        brainModel: mockBrainModel,
      });

      await desktop.start();

      const client = desktop.getCoreClient();
      assert.ok(client);
      await client.waitForConnection(3000);

      // Execute task via Core
      const result = await core.executeTask(
        {
          backend: 'brain',
          prompt: 'Bonjour Nexus',
          nodeId: 'desktop-e2e-node',
        },
        5000
      );

      assert.equal(result.text, 'Réponse du Brain à : Bonjour Nexus');

      // Verify node state returned to idle
      const nodeStatus = await desktop.getStatus();
      assert.equal(nodeStatus.state, 'idle');
      assert.equal(nodeStatus.activeTaskId, undefined);

      await desktop.stop();
      await core.stop();
    });

    test('cancels in-flight task on DesktopNode via Core', async () => {
      const core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });

      await core.start();
      const server = core.getServer();
      const address = server?.address() as { port: number };
      const coreUrl = `http://127.0.0.1:${address.port}`;

      let turnAborted = false;
      const mockBrainModel: BrainModel = {
        decide: async (_messages, _project, _toolsAllowed, signal) => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve({ action: 'reply', text: 'Fin tardive' });
            }, 3000);

            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              turnAborted = true;
              const err = new Error('Annulé par signal');
              err.name = 'AbortError';
              reject(err);
            });
          });
        },
      };

      const nodeConfig = resolveDesktopConfig(
        {
          project: testDir,
          nodeId: 'desktop-cancel-node',
          core: coreUrl,
          authToken: validToken,
        },
        {},
        testDir
      );

      const desktop = new DesktopNode(nodeConfig, {
        brainModel: mockBrainModel,
      });

      await desktop.start();
      const client = desktop.getCoreClient();
      assert.ok(client);
      await client.waitForConnection(3000);

      // Submit task asynchronously
      const task = await core.submitTask({
        backend: 'brain',
        prompt: 'Opération longue',
        nodeId: 'desktop-cancel-node',
      });

      // Wait a bit for DesktopNode to start the task
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(desktop.getState(), 'busy');

      // Cancel task via Core
      const cancelled = await core.cancelTask(task.taskId, 'Test cancellation');
      assert.equal(cancelled, true);

      // Await task failure
      await assert.rejects(
        core.getTaskRouter().waitForTask(task.taskId, 2000),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'TASK_CANCELLED'
      );

      assert.equal(turnAborted, true);
      const taskRecord = core.getTask(task.taskId);
      assert.equal(taskRecord?.status, 'cancelled');

      // Wait for desktop node to return to idle
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(desktop.getState(), 'idle');

      await desktop.stop();
      await core.stop();
    });

    test('fails in-flight task immediately if DesktopNode disconnects abruptly', async () => {
      const core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });

      await core.start();
      const server = core.getServer();
      const address = server?.address() as { port: number };
      const coreUrl = `http://127.0.0.1:${address.port}`;

      const mockBrainModel: BrainModel = {
        decide: async () => {
          return new Promise(() => {}); // never resolves
        },
      };

      const nodeConfig = resolveDesktopConfig(
        {
          project: testDir,
          nodeId: 'desktop-disconnect-node',
          core: coreUrl,
          authToken: validToken,
        },
        {},
        testDir
      );

      const desktop = new DesktopNode(nodeConfig, {
        brainModel: mockBrainModel,
      });

      await desktop.start();
      const client = desktop.getCoreClient();
      assert.ok(client);
      await client.waitForConnection(3000);

      const task = await core.submitTask({
        backend: 'brain',
        prompt: 'Infinite operation',
        nodeId: 'desktop-disconnect-node',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Abruptly disconnect desktop
      desktop.disconnectFromCore();

      // Wait for Core to detect socket closure
      await assert.rejects(
        core.getTaskRouter().waitForTask(task.taskId, 2000),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'NODE_OFFLINE'
      );

      const taskRecord = core.getTask(task.taskId);
      assert.equal(taskRecord?.status, 'failed');
      assert.equal(taskRecord?.error?.code, 'NODE_OFFLINE');

      await desktop.stop();
      await core.stop();
    });
  });

  suite('HTTP Task API endpoints', () => {
    test('POST /api/tasks (async and sync), GET /api/tasks, and cancel endpoint', async () => {
      const core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });

      await core.start();
      const server = core.getServer();
      const address = server?.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // 1. POST /api/tasks when no node is online -> 503
      const offlineRes = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: 'brain', prompt: 'Hello' }),
      });
      assert.equal(offlineRes.status, 503);

      // Connect Desktop Node
      const mockBrainModel: BrainModel = {
        decide: async (messages) => {
          const lastMsg = messages[messages.length - 1]?.text ?? '';
          return { action: 'reply', text: `HTTP reply: ${lastMsg}` };
        },
      };

      const nodeConfig = resolveDesktopConfig(
        {
          project: testDir,
          nodeId: 'desktop-http-node',
          core: baseUrl,
          authToken: validToken,
        },
        {},
        testDir
      );

      const desktop = new DesktopNode(nodeConfig, { brainModel: mockBrainModel });
      await desktop.start();
      const client = desktop.getCoreClient();
      assert.ok(client);
      await client.waitForConnection(3000);

      // 2. POST /api/tasks with wait: false -> 202 Accepted
      const asyncRes = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: 'brain',
          prompt: 'Async task test',
        }),
      });
      assert.equal(asyncRes.status, 202);
      const asyncData = (await asyncRes.json()) as RemoteTask;
      assert.ok(asyncData.taskId);
      assert.equal(asyncData.status, 'pending');

      // 3. GET /api/tasks
      const listRes = await fetch(`${baseUrl}/api/tasks`);
      assert.equal(listRes.status, 200);
      const listData = (await listRes.json()) as RemoteTask[];
      assert.ok(listData.length >= 1);
      assert.ok(listData.some((t) => t.taskId === asyncData.taskId));

      // 4. GET /api/tasks/:id
      const getRes = await fetch(`${baseUrl}/api/tasks/${asyncData.taskId}`);
      assert.equal(getRes.status, 200);
      const getData = (await getRes.json()) as RemoteTask;
      assert.equal(getData.taskId, asyncData.taskId);

      // Wait for async task to complete
      await core.getTaskRouter().waitForTask(asyncData.taskId, 3000);

      // 5. POST /api/tasks with wait: true -> 200 OK with result
      const syncRes = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend: 'brain',
          prompt: 'Sync task test',
          wait: true,
        }),
      });
      assert.equal(syncRes.status, 200);
      const syncData = (await syncRes.json()) as TaskCompletedPayload;
      assert.equal(syncData.text, 'HTTP reply: Sync task test');

      // 6. POST /api/tasks/:id/cancel
      const cancelRes = await fetch(`${baseUrl}/api/tasks/${asyncData.taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Already completed test' }),
      });
      assert.equal(cancelRes.status, 200);
      const cancelData = (await cancelRes.json()) as { taskId: string; cancelled: boolean };
      assert.equal(cancelData.taskId, asyncData.taskId);

      // 7. GET non-existent task -> 404
      const notFoundRes = await fetch(`${baseUrl}/api/tasks/unknown-task-id`);
      assert.equal(notFoundRes.status, 404);

      await desktop.stop();
      await core.stop();
    });
  });
});
