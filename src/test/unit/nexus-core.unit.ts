import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  ConnectedNode,
  CoreStatusSnapshot,
  NexusCore,
  NodePresenceManager,
  NodeProjectSummary,
  NodeWelcomePayload,
  runCoreCli,
} from '../../core';
import { createNexusMessage, parseNexusMessage } from '../../protocol/messages';
import { CoreErrorPayload, NodeHelloPayload as ProtoHelloPayload } from '../../protocol/types';

suite('Nexus Core presence and central service', () => {
  const validToken = 'test-token-nexus-123';

  const mockHelloPayload: ProtoHelloPayload = {
    nodeId: 'desktop-node-alpha',
    nodeName: 'station-linux',
    version: '0.4.1',
    authToken: validToken,
    capabilities: {
      backends: ['codex', 'antigravity', 'brain'],
      workspaceGuard: true,
    },
    projects: [
      {
        id: 'proj-1',
        name: 'Nexus Core',
        path: '/home/user/code/nexus',
        currentBranch: 'staging',
      },
    ],
  };

  test('NodePresenceManager registers node with valid auth token', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
      heartbeatIntervalMs: 10_000,
      heartbeatTimeoutMs: 30_000,
    });

    let connectedEvent: ConnectedNode | undefined;
    presence.on('node:connected', (n) => {
      connectedEvent = n;
    });

    const welcome = presence.registerNode(mockHelloPayload);

    assert.equal(welcome.nodeId, 'desktop-node-alpha');
    assert.ok(welcome.sessionId);
    assert.equal(welcome.heartbeatIntervalMs, 10_000);

    assert.ok(connectedEvent);
    assert.equal(connectedEvent?.nodeId, 'desktop-node-alpha');
    assert.equal(connectedEvent?.online, true);
    assert.equal(connectedEvent?.state, 'idle');
    assert.equal(presence.isNodeOnline('desktop-node-alpha'), true);
    assert.equal(presence.getOnlineNodes().length, 1);
    assert.equal(presence.getPrimaryOnlineNode()?.nodeId, 'desktop-node-alpha');

    const projects = presence.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Nexus Core');

    presence.clear();
  });

  test('NodePresenceManager rejects node with invalid auth token', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
    });

    assert.throws(() => {
      presence.registerNode({
        ...mockHelloPayload,
        authToken: 'wrong-token',
      });
    }, /Authentification requise|Jeton d’authentification invalide/);

    assert.equal(presence.listNodes().length, 0);
    presence.clear();
  });

  test('NodePresenceManager records heartbeat and updates timestamp', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
    });

    presence.registerNode(mockHelloPayload);

    let heartbeatEvent: ConnectedNode | undefined;
    presence.on('node:heartbeat', (n) => {
      heartbeatEvent = n;
    });

    const ack = presence.recordHeartbeat({
      nodeId: 'desktop-node-alpha',
      timestamp: Date.now(),
      state: 'busy',
      activeTaskId: 'task-789',
    });

    assert.ok(ack.timestamp > 0);
    assert.ok(heartbeatEvent);
    assert.equal(heartbeatEvent?.state, 'busy');
    assert.equal(heartbeatEvent?.activeTaskId, 'task-789');

    presence.clear();
  });

  test('NodePresenceManager updates status', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
    });

    presence.registerNode(mockHelloPayload);

    let statusEvent: ConnectedNode | undefined;
    presence.on('node:status', (n) => {
      statusEvent = n;
    });

    presence.updateStatus({
      nodeId: 'desktop-node-alpha',
      state: 'idle',
      activeProject: {
        id: 'proj-2',
        name: 'Second Project',
        path: '/home/user/code/second',
      },
    });

    assert.ok(statusEvent);
    assert.equal(statusEvent?.state, 'idle');
    assert.equal(statusEvent?.activeProject?.id, 'proj-2');

    presence.clear();
  });

  test('NodePresenceManager detects offline nodes through liveness check', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
      heartbeatTimeoutMs: 5000,
    });

    presence.registerNode(mockHelloPayload);
    assert.equal(presence.isNodeOnline('desktop-node-alpha'), true);

    const offlineNodes: string[] = [];
    presence.on('node:offline', (n) => {
      offlineNodes.push(n.nodeId);
    });

    // 1 second later: still alive
    const timedOut1 = presence.checkLiveness(Date.now() + 1000);
    assert.equal(timedOut1.length, 0);
    assert.equal(presence.isNodeOnline('desktop-node-alpha'), true);

    // 10 seconds later: timed out
    const timedOut2 = presence.checkLiveness(Date.now() + 10_000);
    assert.deepEqual(timedOut2, ['desktop-node-alpha']);
    assert.equal(presence.isNodeOnline('desktop-node-alpha'), false);
    assert.deepEqual(offlineNodes, ['desktop-node-alpha']);

    // Once offline, listProjects excludes its projects
    assert.equal(presence.listProjects().length, 0);

    presence.clear();
  });

  test('NodePresenceManager handles disconnection', () => {
    const presence = new NodePresenceManager({
      authTokens: [validToken],
    });

    const welcome = presence.registerNode(mockHelloPayload);
    assert.ok(presence.getNodeBySession(welcome.sessionId));

    let disconnected = false;
    presence.on('node:disconnected', () => {
      disconnected = true;
    });

    presence.disconnectNode('desktop-node-alpha');
    assert.equal(disconnected, true);
    assert.equal(presence.isNodeOnline('desktop-node-alpha'), false);
    assert.equal(presence.getNodeBySession(welcome.sessionId), undefined);

    presence.clear();
  });

  test('NexusCore processes protocol messages directly', async () => {
    const core = new NexusCore({
      authTokens: [validToken],
    });

    // 1. Process node:hello
    const helloMsg = createNexusMessage('node:hello', mockHelloPayload, {
      traceId: 'trace-hello-1',
    });
    const welcomeMsg = await core.processMessage(helloMsg);

    assert.ok(welcomeMsg);
    assert.equal(welcomeMsg.type, 'node:welcome');
    assert.equal(welcomeMsg.traceId, 'trace-hello-1');
    const welcomePayload = welcomeMsg.payload as NodeWelcomePayload;
    assert.equal(welcomePayload.nodeId, 'desktop-node-alpha');

    // 2. Process node:heartbeat
    const heartbeatMsg = createNexusMessage(
      'node:heartbeat',
      {
        nodeId: 'desktop-node-alpha',
        timestamp: Date.now(),
        state: 'idle',
      },
      { traceId: 'trace-hb-1' }
    );
    const ackMsg = await core.processMessage(heartbeatMsg);

    assert.ok(ackMsg);
    assert.equal(ackMsg.type, 'node:heartbeat_ack');
    assert.equal(ackMsg.traceId, 'trace-hb-1');

    // 3. Process node:status
    const statusMsg = createNexusMessage('node:status', {
      nodeId: 'desktop-node-alpha',
      state: 'busy',
      activeTaskId: 'task-123',
    });
    const statusReply = await core.processMessage(statusMsg);
    assert.equal(statusReply, undefined);

    const snapshot = core.getStatus();
    assert.equal(snapshot.totalNodes, 1);
    assert.equal(snapshot.onlineNodes, 1);
    assert.equal(snapshot.nodes[0].state, 'busy');

    // 4. Invalid message generates core:error
    const invalidHello = createNexusMessage('node:hello', {
      ...mockHelloPayload,
      authToken: 'bad-token',
    });
    const errorReply = await core.processMessage(invalidHello);
    assert.ok(errorReply);
    assert.equal(errorReply.type, 'core:error');
    const errorPayload = errorReply.payload as CoreErrorPayload;
    assert.equal(errorPayload.code, 'UNAUTHENTICATED');

    await core.stop();
  });

  test('NexusCore starts HTTP server and responds to endpoints', async () => {
    const core = new NexusCore({
      port: 0, // OS assigns an ephemeral free port
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    await core.start();
    const server = core.getServer();
    assert.ok(server);
    const address = server?.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.deepEqual(healthData, { status: 'ok', version: '0.4.1' });

    // 2. GET /status
    const statusRes = await fetch(`${baseUrl}/status`);
    assert.equal(statusRes.status, 200);
    const statusData = (await statusRes.json()) as CoreStatusSnapshot;
    assert.equal(statusData.totalNodes, 0);

    // 3. POST /api/message with node:hello
    const helloMsg = createNexusMessage('node:hello', mockHelloPayload);
    const msgRes = await fetch(`${baseUrl}/api/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(helloMsg),
    });
    assert.equal(msgRes.status, 200);
    const msgReplyRaw = await msgRes.text();
    const replyMsg = parseNexusMessage(msgReplyRaw);
    assert.equal(replyMsg.type, 'node:welcome');

    // 4. GET /api/nodes
    const nodesRes = await fetch(`${baseUrl}/api/nodes`);
    assert.equal(nodesRes.status, 200);
    const nodesData = (await nodesRes.json()) as ConnectedNode[];
    assert.equal(nodesData.length, 1);
    assert.equal(nodesData[0].nodeId, 'desktop-node-alpha');

    // 5. GET /api/projects
    const projRes = await fetch(`${baseUrl}/api/projects`);
    assert.equal(projRes.status, 200);
    const projData = (await projRes.json()) as NodeProjectSummary[];
    assert.equal(projData.length, 1);
    assert.equal(projData[0].name, 'Nexus Core');

    await core.stop();
  });

  test('Core CLI handles --help and --version', async () => {
    const helpCode = await runCoreCli(['--help']);
    assert.equal(helpCode, 0);

    const versionCode = await runCoreCli(['--version']);
    assert.equal(versionCode, 0);
  });

  test('Core CLI reports error on invalid argument', async () => {
    const errCode = await runCoreCli(['--unknown-arg-xyz']);
    assert.equal(errCode, 1);
  });
});
