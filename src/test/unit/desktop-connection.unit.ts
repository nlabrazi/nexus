import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { NexusCore } from '../../core';
import { DesktopNode, normalizeWsUrl, resolveDesktopConfig } from '../../desktop';
import { CoreErrorPayload } from '../../protocol/types';

suite('Desktop Node connection to Nexus Core over authenticated WebSocket', () => {
  const testDir = join(tmpdir(), 'nexus-desktop-conn-test');
  const validToken = 'super-secret-core-token-42';

  test('beforeEach setup test dir', () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  test('normalizeWsUrl transforms various URL formats into valid WebSocket URLs', () => {
    assert.equal(normalizeWsUrl('http://127.0.0.1:4040'), 'ws://127.0.0.1:4040/ws');
    assert.equal(normalizeWsUrl('http://127.0.0.1:4040/'), 'ws://127.0.0.1:4040/ws');
    assert.equal(normalizeWsUrl('https://core.nexus.dev'), 'wss://core.nexus.dev/ws');
    assert.equal(normalizeWsUrl('127.0.0.1:4040'), 'ws://127.0.0.1:4040/ws');
    assert.equal(normalizeWsUrl('ws://127.0.0.1:4040/custom'), 'ws://127.0.0.1:4040/custom');
    assert.equal(normalizeWsUrl('wss://secure.example.com/ws/'), 'wss://secure.example.com/ws');
  });

  test('resolveDesktopConfig parses core CLI option and environment variable', () => {
    const configFromCli = resolveDesktopConfig(
      {
        project: testDir,
        core: 'ws://vps.example.com:4040',
        authToken: 'my-token',
      },
      {},
      testDir
    );
    assert.equal(configFromCli.coreUrl, 'ws://vps.example.com:4040');
    assert.equal(configFromCli.authToken, 'my-token');

    const configFromEnv = resolveDesktopConfig(
      { project: testDir },
      {
        NEXUS_CORE_URL: 'http://core.local:3000',
        NEXUS_AUTH_TOKEN: 'env-token-xyz',
      },
      testDir
    );
    assert.equal(configFromEnv.coreUrl, 'http://core.local:3000');
    assert.equal(configFromEnv.authToken, 'env-token-xyz');
  });

  test('DesktopNode connects to NexusCore and performs authenticated hello handshake', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    await core.start();
    const server = core.getServer();
    const address = server?.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const coreUrl = `http://127.0.0.1:${port}`;

    const nodeConfig = resolveDesktopConfig(
      {
        project: testDir,
        name: 'Test Project',
        nodeId: 'desktop-node-ws-1',
        nodeName: 'desktop-station-1',
        core: coreUrl,
        authToken: validToken,
      },
      {},
      testDir
    );

    const desktop = new DesktopNode(nodeConfig);
    const initialStatus = await desktop.start();
    assert.equal(initialStatus.nodeId, 'desktop-node-ws-1');

    const client = desktop.getCoreClient();
    assert.ok(client);

    // Wait for connection to be fully established and welcomed
    const welcome = await client.waitForConnection(3000);
    assert.equal(welcome.nodeId, 'desktop-node-ws-1');
    assert.ok(welcome.sessionId);

    // Verify DesktopNode status reflects Core connection
    const status = await desktop.getStatus();
    assert.ok(status.coreConnection);
    assert.equal(status.coreConnection?.status, 'connected');
    assert.equal(status.coreConnection?.sessionId, welcome.sessionId);
    assert.equal(status.coreConnection?.url, `ws://127.0.0.1:${port}/ws`);

    // Verify Core presence reflects node is online
    const corePresence = core.getPresenceManager();
    assert.equal(corePresence.isNodeOnline('desktop-node-ws-1'), true);
    const onlineNodes = corePresence.getOnlineNodes();
    assert.equal(onlineNodes.length, 1);
    assert.equal(onlineNodes[0].nodeId, 'desktop-node-ws-1');

    // Clean disconnect
    await desktop.stop();
    assert.equal(client.getStatus(), 'disconnected');

    // Wait for Core to receive socket close and mark node offline
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!corePresence.isNodeOnline('desktop-node-ws-1')) {
          clearInterval(check);
          resolve();
        }
      }, 10);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 1000);
    });

    assert.equal(corePresence.isNodeOnline('desktop-node-ws-1'), false);

    await core.stop();
  });

  test('DesktopNode handles authentication rejection from Core', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    await core.start();
    const server = core.getServer();
    const address = server?.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const coreUrl = `http://127.0.0.1:${port}`;

    const desktop = new DesktopNode({
      nodeId: 'desktop-node-bad-auth',
      nodeName: 'desktop-station-bad',
      authToken: 'INVALID-TOKEN',
      projects: [{ id: 'p1', name: 'P1', path: testDir }],
      defaultBackend: 'codex',
    });

    await desktop.start();

    let errorReceived: CoreErrorPayload | undefined;
    const client = await desktop.connectToCore(coreUrl, 'INVALID-TOKEN', {
      reconnect: false,
    });

    client.on('core:error', (err) => {
      errorReceived = err;
    });

    // Wait for error emission or timeout
    await new Promise<void>((resolve) => {
      client.once('core:error', () => resolve());
      setTimeout(resolve, 1500);
    });

    assert.ok(errorReceived);
    assert.equal(errorReceived?.code, 'UNAUTHENTICATED');
    assert.equal(client.getStatus(), 'disconnected');

    await desktop.stop();
    await core.stop();
  });

  test('DesktopCoreClient sends heartbeats and receives heartbeat_ack', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
      heartbeatIntervalMs: 50,
      heartbeatTimeoutMs: 200,
    });

    await core.start();
    const server = core.getServer();
    const address = server?.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const coreUrl = `http://127.0.0.1:${port}`;

    const desktop = new DesktopNode({
      nodeId: 'desktop-hb-node',
      nodeName: 'desktop-station-hb',
      authToken: validToken,
      projects: [{ id: 'p1', name: 'P1', path: testDir }],
      defaultBackend: 'codex',
    });

    await desktop.start();
    const client = await desktop.connectToCore(coreUrl, validToken);
    await client.waitForConnection(3000);

    let ackCount = 0;
    client.on('heartbeat_ack', () => {
      ackCount++;
    });

    // Wait for at least one heartbeat cycle (heartbeat interval is 50ms)
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (ackCount >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 1000);
    });

    assert.ok(ackCount >= 1, `Expected at least 1 heartbeat ack, got ${ackCount}`);

    await desktop.stop();
    await core.stop();
  });

  test('DesktopCoreClient reconnects with backoff when connection is broken', async () => {
    const core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
    });

    await core.start();
    const server = core.getServer();
    const address = server?.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    const coreUrl = `http://127.0.0.1:${port}`;

    const desktop = new DesktopNode({
      nodeId: 'desktop-reconnect-node',
      nodeName: 'desktop-station-reconnect',
      authToken: validToken,
      projects: [{ id: 'p1', name: 'P1', path: testDir }],
      defaultBackend: 'codex',
    });

    await desktop.start();

    let reconnectAttempts = 0;
    const client = await desktop.connectToCore(coreUrl, validToken, {
      reconnect: true,
      initialDelayMs: 50,
      backoffFactor: 1.2,
      maxDelayMs: 500,
    });

    client.on('reconnecting', () => {
      reconnectAttempts++;
    });

    await client.waitForConnection(3000);
    assert.equal(client.isConnected(), true);

    // Stop Core to simulate network drop
    await core.stop();

    // Wait for client to detect closure and attempt reconnect
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (reconnectAttempts >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 1000);
    });

    assert.ok(
      reconnectAttempts >= 1,
      `Expected at least 1 reconnect attempt, got ${reconnectAttempts}`
    );
    assert.equal(client.getStatus(), 'reconnecting');

    // Clean disconnect on client
    desktop.disconnectFromCore();
    assert.equal(client.getStatus(), 'disconnected');

    await desktop.stop();
  });

  test('afterAll cleanup test dir', () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
