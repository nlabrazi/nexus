import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AnyNexusMessage,
  ApprovalCancelledPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
  ApprovalKind,
  ApprovalRequestPayload,
  CoreErrorPayload,
  NEXUS_PROTOCOL_VERSION,
  NexusProtocolError,
  NodeHeartbeatAckPayload,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeStatusPayload,
  NodeWelcomePayload,
  TaskBackend,
  TaskCancelPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskProgressPayload,
  TaskStartPayload,
  approvalNotFoundError,
  approvalTimeoutError,
  createNexusMessage,
  invalidMessageError,
  isNexusMessage,
  isNexusMessageType,
  nodeBusyError,
  nodeOfflineError,
  parseNexusMessage,
  protocolVersionMismatchError,
  serializeNexusMessage,
  taskNotFoundError,
  unauthenticatedError,
  unauthorizedError,
} from '../../protocol';

suite('Nexus protocol message envelopes and validation', () => {
  test('creates a standard message envelope with default version, id and timestamp', () => {
    const payload: TaskStartPayload = {
      taskId: 'task-123',
      backend: 'codex',
      prompt: 'Refactor types',
    };
    const msg = createNexusMessage('task:start', payload);

    assert.equal(msg.v, NEXUS_PROTOCOL_VERSION);
    assert.equal(typeof msg.id, 'string');
    assert.ok(msg.id.length > 0);
    assert.equal(msg.type, 'task:start');
    assert.ok(msg.timestamp > 0);
    assert.deepEqual(msg.payload, payload);
    assert.equal(msg.traceId, undefined);
  });

  test('respects custom id, traceId, and timestamp in envelope creation', () => {
    const payload: TaskCancelPayload = { taskId: 'task-999', reason: 'User requested' };
    const customTimestamp = 1700000000000;
    const msg = createNexusMessage('task:cancel', payload, {
      id: 'custom-id-1',
      traceId: 'trace-abc-123',
      timestamp: customTimestamp,
    });

    assert.equal(msg.id, 'custom-id-1');
    assert.equal(msg.traceId, 'trace-abc-123');
    assert.equal(msg.timestamp, customTimestamp);
    assert.deepEqual(msg.payload, payload);
  });

  test('serializes and parses roundtrip correctly', () => {
    const payload: TaskProgressPayload = {
      taskId: 'task-456',
      stage: 'executing',
      message: 'Running build',
      activeTool: 'run_command',
    };
    const message = createNexusMessage('task:progress', payload, { traceId: 'trace-1' });

    const json = serializeNexusMessage(message);
    assert.equal(typeof json, 'string');

    const parsed = parseNexusMessage(json);
    assert.deepEqual(parsed, message);
    assert.ok(isNexusMessageType(parsed, 'task:progress'));
    assert.equal(parsed.payload.stage, 'executing');
  });

  test('parses directly from an unparsed object', () => {
    const raw = {
      v: 1,
      id: 'test-id',
      type: 'node:heartbeat',
      timestamp: Date.now(),
      payload: {
        nodeId: 'desktop-node-1',
        timestamp: Date.now(),
        state: 'idle',
      },
    };
    const parsed = parseNexusMessage(raw);
    assert.equal(parsed.id, 'test-id');
    assert.equal(parsed.type, 'node:heartbeat');
    assert.ok(isNexusMessageType(parsed, 'node:heartbeat'));
    assert.equal(parsed.payload.state, 'idle');
  });
});

suite('Nexus protocol node lifecycle messages', () => {
  test('validates node:hello with capabilities and projects', () => {
    const hello: NodeHelloPayload = {
      nodeId: 'node-desktop-1',
      nodeName: 'Linux Workstation',
      version: '1.0.0',
      authToken: 'secret-token-xyz',
      capabilities: {
        backends: ['codex', 'antigravity', 'brain'],
        speech: { stt: true, tts: false },
        workspaceGuard: true,
      },
      projects: [
        {
          id: 'proj-nexus',
          name: 'nexus',
          path: '/home/user/code/nexus',
          currentBranch: 'staging',
        },
      ],
    };

    const msg = createNexusMessage('node:hello', hello);
    assert.ok(isNexusMessage(msg));
    assert.deepEqual(parseNexusMessage(serializeNexusMessage(msg)), msg);
  });

  test('rejects node:hello with invalid backends or empty fields', () => {
    assert.throws(
      () =>
        createNexusMessage('node:hello', {
          nodeId: '',
          nodeName: 'Test',
          version: '1.0.0',
          authToken: 'token',
          capabilities: { backends: ['codex'] },
          projects: [],
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );

    assert.throws(
      () =>
        createNexusMessage('node:hello', {
          nodeId: 'node-1',
          nodeName: 'Test',
          version: '1.0.0',
          authToken: 'token',
          capabilities: { backends: ['invalid-agent' as unknown as TaskBackend] },
          projects: [],
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });

  test('validates node:welcome, node:heartbeat and node:heartbeat_ack', () => {
    const welcome: NodeWelcomePayload = {
      nodeId: 'node-desktop-1',
      sessionId: 'session-core-123',
      heartbeatIntervalMs: 15000,
    };
    const welcomeMsg = createNexusMessage('node:welcome', welcome);
    assert.ok(isNexusMessage(welcomeMsg));

    const heartbeat: NodeHeartbeatPayload = {
      nodeId: 'node-desktop-1',
      timestamp: Date.now(),
      state: 'busy',
      activeTaskId: 'task-100',
    };
    const hbMsg = createNexusMessage('node:heartbeat', heartbeat);
    assert.ok(isNexusMessage(hbMsg));

    const ack: NodeHeartbeatAckPayload = { timestamp: Date.now() };
    const ackMsg = createNexusMessage('node:heartbeat_ack', ack);
    assert.ok(isNexusMessage(ackMsg));
  });

  test('validates node:status with optional activeProject', () => {
    const status: NodeStatusPayload = {
      nodeId: 'node-desktop-1',
      state: 'idle',
      activeProject: {
        id: 'proj-nexus',
        name: 'nexus',
        path: '/home/user/code/nexus',
      },
    };
    const msg = createNexusMessage('node:status', status);
    assert.ok(isNexusMessage(msg));
  });
});

suite('Nexus protocol task execution messages', () => {
  test('validates task:start, task:completed, and task:failed', () => {
    const start: TaskStartPayload = {
      taskId: 'task-abc',
      backend: 'brain',
      prompt: 'Check git status and summarize next actions',
      projectId: 'proj-nexus',
      sessionId: 'session-prev',
    };
    const startMsg = createNexusMessage('task:start', start);
    assert.ok(isNexusMessage(startMsg));

    const completed: TaskCompletedPayload = {
      taskId: 'task-abc',
      text: 'Summary: everything clean.',
      fileSummary: '1 file reviewed',
      filesChanged: ['src/protocol/types.ts'],
      usage: { inputTokens: 120, outputTokens: 45 },
    };
    const completedMsg = createNexusMessage('task:completed', completed);
    assert.ok(isNexusMessage(completedMsg));

    const failed: TaskFailedPayload = {
      taskId: 'task-abc',
      error: {
        code: 'TASK_EXECUTION_FAILED',
        message: 'Compilation error',
        details: { exitCode: 1 },
      },
    };
    const failedMsg = createNexusMessage('task:failed', failed);
    assert.ok(isNexusMessage(failedMsg));
  });

  test('rejects task:start with invalid backend', () => {
    assert.throws(
      () =>
        createNexusMessage('task:start', {
          taskId: 'task-1',
          backend: 'unknown-llm' as unknown as TaskBackend,
          prompt: 'Do work',
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });
});

suite('Nexus protocol scoped approvals messages', () => {
  test('validates approval:request, approval:decision, and approval:cancelled', () => {
    const request: ApprovalRequestPayload = {
      approvalId: 'appr-001',
      taskId: 'task-abc',
      agentName: 'Antigravity',
      kind: 'command',
      details: 'run_command: npm test',
      expiresAt: Date.now() + 60000,
    };
    const reqMsg = createNexusMessage('approval:request', request);
    assert.ok(isNexusMessage(reqMsg));

    const decision: ApprovalDecisionPayload = {
      approvalId: 'appr-001',
      taskId: 'task-abc',
      decision: 'accept',
      decidedBy: 'telegram:999999',
    };
    const decMsg = createNexusMessage('approval:decision', decision);
    assert.ok(isNexusMessage(decMsg));

    const cancelled: ApprovalCancelledPayload = {
      approvalId: 'appr-001',
      taskId: 'task-abc',
      reason: 'timeout',
    };
    const canMsg = createNexusMessage('approval:cancelled', cancelled);
    assert.ok(isNexusMessage(canMsg));
  });

  test('rejects approval:request with invalid kind or negative expiresAt', () => {
    assert.throws(
      () =>
        createNexusMessage('approval:request', {
          approvalId: 'appr-1',
          taskId: 'task-1',
          agentName: 'Codex',
          kind: 'dangerousAction' as unknown as ApprovalKind,
          details: 'rm -rf /',
          expiresAt: Date.now() + 10000,
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );

    assert.throws(
      () =>
        createNexusMessage('approval:request', {
          approvalId: 'appr-1',
          taskId: 'task-1',
          agentName: 'Codex',
          kind: 'command',
          details: 'ls',
          expiresAt: -1,
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });

  test('rejects approval:decision with invalid decision value', () => {
    assert.throws(
      () =>
        createNexusMessage('approval:decision', {
          approvalId: 'appr-1',
          taskId: 'task-1',
          decision: 'maybe' as unknown as ApprovalDecision,
        }),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });
});

suite('Nexus protocol error handling and edge cases', () => {
  test('validates core:error message payload', () => {
    const errorPayload: CoreErrorPayload = {
      code: 'NODE_OFFLINE',
      message: 'Node disconnected unexpectedly',
      targetMessageId: 'msg-origin-123',
      details: { attempts: 3 },
    };
    const msg = createNexusMessage('core:error', errorPayload);
    assert.ok(isNexusMessage(msg));
  });

  test('rejects parsing invalid JSON string', () => {
    assert.throws(
      () => parseNexusMessage('not a json string'),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });

  test('rejects non-object structures', () => {
    for (const invalid of [null, undefined, 42, 'string', true, []]) {
      assert.throws(
        () => parseNexusMessage(invalid),
        (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
      );
    }
  });

  test('rejects protocol version mismatch', () => {
    const wrongVersion = {
      v: 2,
      id: 'id-1',
      type: 'task:cancel',
      timestamp: Date.now(),
      payload: { taskId: 't-1' },
    };
    assert.throws(
      () => parseNexusMessage(wrongVersion),
      (err) => err instanceof NexusProtocolError && err.code === 'PROTOCOL_VERSION_MISMATCH'
    );
  });

  test('rejects unknown message type', () => {
    const unknownType = {
      v: 1,
      id: 'id-1',
      type: 'unknown:type',
      timestamp: Date.now(),
      payload: {},
    };
    assert.throws(
      () => parseNexusMessage(unknownType),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });

  test('isNexusMessage returns false on invalid messages without throwing', () => {
    assert.equal(isNexusMessage(null), false);
    assert.equal(isNexusMessage({}), false);
    assert.equal(isNexusMessage({ v: 2, id: '1', type: 'task:cancel', timestamp: 1 }), false);
    assert.equal(isNexusMessage({ v: 1, id: '', type: 'task:cancel', timestamp: 1 }), false);
    assert.equal(isNexusMessage({ v: 1, id: '1', type: 'unknown', timestamp: 1 }), false);
    assert.equal(isNexusMessage({ v: 1, id: '1', type: 'task:cancel', timestamp: -10 }), false);
  });

  test('serializeNexusMessage rejects invalid message structures', () => {
    assert.throws(
      () => serializeNexusMessage({ v: 99 } as unknown as AnyNexusMessage),
      (err) => err instanceof NexusProtocolError && err.code === 'INVALID_MESSAGE'
    );
  });

  test('error helper functions return correctly configured NexusProtocolError instances', () => {
    const unauth = unauthenticatedError();
    assert.equal(unauth.code, 'UNAUTHENTICATED');
    assert.equal(unauth.name, 'NexusProtocolError');

    const unperm = unauthorizedError();
    assert.equal(unperm.code, 'UNAUTHORIZED');

    const offline = nodeOfflineError('desktop-1');
    assert.equal(offline.code, 'NODE_OFFLINE');
    assert.ok(offline.message.includes('desktop-1'));

    const busy = nodeBusyError();
    assert.equal(busy.code, 'NODE_BUSY');

    const notFound = taskNotFoundError('t-404');
    assert.equal(notFound.code, 'TASK_NOT_FOUND');
    assert.deepEqual(notFound.details, { taskId: 't-404' });

    const timeout = approvalTimeoutError('appr-99');
    assert.equal(timeout.code, 'APPROVAL_TIMEOUT');

    const apprNotFound = approvalNotFoundError('appr-88');
    assert.equal(apprNotFound.code, 'APPROVAL_NOT_FOUND');

    const mismatch = protocolVersionMismatchError(3, 1);
    assert.equal(mismatch.code, 'PROTOCOL_VERSION_MISMATCH');

    const customInvalid = invalidMessageError('Bad field', { field: 'name' });
    assert.equal(customInvalid.code, 'INVALID_MESSAGE');
    assert.deepEqual(customInvalid.details, { field: 'name' });
  });
});
