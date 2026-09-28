import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { ApprovalRelay } from '../../core/approval-relay';
import { NexusCore } from '../../core/nexus-core';
import { PendingApproval } from '../../core/types';
import { WebSocketServerConnection } from '../../core/ws-connection';
import { NexusProtocolError } from '../../protocol/errors';
import { createNexusMessage, parseNexusMessage } from '../../protocol/messages';
import {
  ApprovalCancelledPayload,
  ApprovalDecisionPayload,
  ApprovalRequestPayload,
  NodeHelloPayload,
} from '../../protocol/types';

suite('Nexus Core ApprovalRelay and REST endpoints', () => {
  function createMockConnection() {
    const sentMessages: string[] = [];
    let open = true;
    const conn = {
      isOpen: () => open,
      send: (data: string) => {
        if (open) {
          sentMessages.push(data);
        }
      },
      close: () => {
        open = false;
      },
    } as unknown as WebSocketServerConnection;
    return { conn, sentMessages, setOpen: (val: boolean) => (open = val) };
  }

  suite('ApprovalRelay unit tests', () => {
    test('registers pending approval and emits approval:request', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      let emitted: PendingApproval | undefined;
      relay.on('approval:request', (approval) => {
        emitted = approval;
      });

      const payload: ApprovalRequestPayload = {
        approvalId: 'appr-1',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'rm -rf /tmp/test',
        expiresAt: Date.now() + 60_000,
      };

      const result = relay.registerApproval('node-alpha', payload);
      assert.equal(result.approvalId, 'appr-1');
      assert.equal(result.taskId, 'task-1');
      assert.equal(result.nodeId, 'node-alpha');
      assert.equal(result.agentName, 'Codex');
      assert.equal(result.kind, 'command');
      assert.equal(result.details, 'rm -rf /tmp/test');
      assert.equal(result.status, 'pending');

      assert.equal(emitted?.approvalId, 'appr-1');
      assert.equal(relay.getPendingCount(), 1);
      assert.equal(relay.getApproval('appr-1')?.status, 'pending');
    });

    test('rejects duplicate approval ID', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      const payload: ApprovalRequestPayload = {
        approvalId: 'appr-dup',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'echo test',
        expiresAt: Date.now() + 60_000,
      };

      relay.registerApproval('node-alpha', payload);
      assert.throws(() => {
        relay.registerApproval('node-alpha', payload);
      }, /existe déjà/);
    });

    test('approves with accept decision, emits approval:decided, and sends message to connection', () => {
      const { conn, sentMessages } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-accept',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'npm test',
        expiresAt: Date.now() + 60_000,
      });

      let decidedEvent: PendingApproval | undefined;
      relay.on('approval:decided', (appr) => {
        decidedEvent = appr;
      });

      const decided = relay.decideApproval('appr-accept', 'accept', 'telegram-user');
      assert.equal(decided.status, 'approved');
      assert.equal(decided.decision, 'accept');
      assert.equal(decided.decidedBy, 'telegram-user');
      assert.ok(decided.decidedAt);

      assert.equal(decidedEvent?.approvalId, 'appr-accept');
      assert.equal(relay.getPendingCount(), 0);

      assert.equal(sentMessages.length, 1);
      const msg = parseNexusMessage(sentMessages[0]);
      assert.equal(msg.type, 'approval:decision');
      const payload = msg.payload as ApprovalDecisionPayload;
      assert.equal(payload.approvalId, 'appr-accept');
      assert.equal(payload.taskId, 'task-1');
      assert.equal(payload.decision, 'accept');
      assert.equal(payload.decidedBy, 'telegram-user');
    });

    test('declines with decline decision', () => {
      const { conn, sentMessages } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-decline',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'fileChange',
        details: 'delete src/index.ts',
        expiresAt: Date.now() + 60_000,
      });

      const decided = relay.decideApproval('appr-decline', 'decline', 'admin');
      assert.equal(decided.status, 'declined');
      assert.equal(decided.decision, 'decline');

      assert.equal(sentMessages.length, 1);
      const msg = parseNexusMessage(sentMessages[0]);
      assert.equal(msg.type, 'approval:decision');
      const payload = msg.payload as ApprovalDecisionPayload;
      assert.equal(payload.decision, 'decline');
    });

    test('fails closed on timeout: marks timed_out and sends decline decision', async () => {
      const { conn, sentMessages } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      let timeoutEmitted = false;
      relay.on('approval:timeout', () => {
        timeoutEmitted = true;
      });

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-timeout',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'slow command',
        expiresAt: Date.now() + 50, // 50ms timeout
      });

      assert.equal(relay.getPendingCount(), 1);

      await new Promise((resolve) => setTimeout(resolve, 80));

      assert.equal(timeoutEmitted, true);
      assert.equal(relay.getPendingCount(), 0);

      const approval = relay.getApproval('appr-timeout');
      assert.equal(approval?.status, 'timed_out');
      assert.equal(approval?.decision, 'decline');

      assert.equal(sentMessages.length, 1);
      const msg = parseNexusMessage(sentMessages[0]);
      assert.equal(msg.type, 'approval:decision');
      const payload = msg.payload as ApprovalDecisionPayload;
      assert.equal(payload.approvalId, 'appr-timeout');
      assert.equal(payload.decision, 'decline');
      assert.equal(payload.decidedBy, 'timeout');
    });

    test('cancels pending approval and sends approval:cancelled message', () => {
      const { conn, sentMessages } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-cancel',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'test cancel',
        expiresAt: Date.now() + 60_000,
      });

      let cancelEmitted = false;
      relay.on('approval:cancelled', () => {
        cancelEmitted = true;
      });

      const result = relay.cancelApproval('appr-cancel', 'task_aborted');
      assert.equal(result, true);
      assert.equal(cancelEmitted, true);
      assert.equal(relay.getPendingCount(), 0);

      const approval = relay.getApproval('appr-cancel');
      assert.equal(approval?.status, 'cancelled');

      assert.equal(sentMessages.length, 1);
      const msg = parseNexusMessage(sentMessages[0]);
      assert.equal(msg.type, 'approval:cancelled');
      const payload = msg.payload as ApprovalCancelledPayload;
      assert.equal(payload.approvalId, 'appr-cancel');
      assert.equal(payload.reason, 'task_aborted');
    });

    test('cancelTaskApprovals cancels all pending approvals for a task', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-t1-a',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 1',
        expiresAt: Date.now() + 60_000,
      });
      relay.registerApproval('node-alpha', {
        approvalId: 'appr-t1-b',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 2',
        expiresAt: Date.now() + 60_000,
      });
      relay.registerApproval('node-alpha', {
        approvalId: 'appr-t2',
        taskId: 'task-2',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 3',
        expiresAt: Date.now() + 60_000,
      });

      assert.equal(relay.getPendingCount(), 3);
      relay.cancelTaskApprovals('task-1');

      assert.equal(relay.getPendingCount(), 1);
      assert.equal(relay.getApproval('appr-t1-a')?.status, 'cancelled');
      assert.equal(relay.getApproval('appr-t1-b')?.status, 'cancelled');
      assert.equal(relay.getApproval('appr-t2')?.status, 'pending');
    });

    test('handleNodeDisconnected cancels all pending approvals for that node', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-node-a',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 1',
        expiresAt: Date.now() + 60_000,
      });
      relay.registerApproval('node-beta', {
        approvalId: 'appr-node-b',
        taskId: 'task-2',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 2',
        expiresAt: Date.now() + 60_000,
      });

      relay.handleNodeDisconnected('node-alpha');
      assert.equal(relay.getApproval('appr-node-a')?.status, 'cancelled');
      assert.equal(relay.getApproval('appr-node-b')?.status, 'pending');
    });

    test('decideApproval throws on non-existent or already decided approval', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      assert.throws(
        () => relay.decideApproval('unknown-id', 'accept'),
        (err: unknown) => err instanceof NexusProtocolError && err.code === 'APPROVAL_NOT_FOUND'
      );

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-once',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd',
        expiresAt: Date.now() + 60_000,
      });

      relay.decideApproval('appr-once', 'accept');
      assert.throws(() => relay.decideApproval('appr-once', 'accept'), /déjà été traitée/);
    });

    test('listApprovals filters by status and taskId', () => {
      const { conn } = createMockConnection();
      const relay = new ApprovalRelay(() => conn);

      relay.registerApproval('node-alpha', {
        approvalId: 'appr-l1',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 1',
        expiresAt: Date.now() + 60_000,
      });
      relay.registerApproval('node-alpha', {
        approvalId: 'appr-l2',
        taskId: 'task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'cmd 2',
        expiresAt: Date.now() + 60_000,
      });

      relay.decideApproval('appr-l1', 'accept');

      const all = relay.listApprovals();
      assert.equal(all.length, 2);

      const pending = relay.listApprovals({ status: 'pending' });
      assert.equal(pending.length, 1);
      assert.equal(pending[0].approvalId, 'appr-l2');

      const approved = relay.listApprovals({ status: 'approved' });
      assert.equal(approved.length, 1);
      assert.equal(approved[0].approvalId, 'appr-l1');
    });
  });

  suite('NexusCore HTTP approval endpoints', () => {
    const validToken = 'test-token-approvals-http';
    const mockHello: NodeHelloPayload = {
      nodeId: 'desktop-node-approvals',
      nodeName: 'station-approvals',
      version: '1.0.0',
      authToken: validToken,
      capabilities: {
        backends: ['codex', 'antigravity', 'brain'],
      },
      projects: [],
    };

    test('GET /api/approvals returns list and supports status filter', async () => {
      const core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });

      await core.start();
      const address = core.getServer()?.address();
      assert.ok(address && typeof address === 'object');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Register a node via hello message
      const helloMsg = createNexusMessage('node:hello', mockHello);
      await fetch(`${baseUrl}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(helloMsg),
      });

      // Submit an approval request via message
      const apprMsg = createNexusMessage('approval:request', {
        approvalId: 'http-appr-1',
        taskId: 'http-task-1',
        agentName: 'Codex',
        kind: 'command',
        details: 'npm run build',
        expiresAt: Date.now() + 60_000,
      });
      await fetch(`${baseUrl}/api/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apprMsg),
      });

      // 1. GET /api/approvals
      const listRes = await fetch(`${baseUrl}/api/approvals`);
      assert.equal(listRes.status, 200);
      const list = (await listRes.json()) as PendingApproval[];
      assert.equal(list.length, 1);
      assert.equal(list[0].approvalId, 'http-appr-1');
      assert.equal(list[0].status, 'pending');

      // 2. GET /api/approvals/:id
      const singleRes = await fetch(`${baseUrl}/api/approvals/http-appr-1`);
      assert.equal(singleRes.status, 200);
      const single = (await singleRes.json()) as PendingApproval;
      assert.equal(single.approvalId, 'http-appr-1');

      // 3. GET /api/approvals/non-existent -> 404
      const notFoundRes = await fetch(`${baseUrl}/api/approvals/non-existent`);
      assert.equal(notFoundRes.status, 404);

      // 4. POST /api/approvals/:id/decide
      const decideRes = await fetch(`${baseUrl}/api/approvals/http-appr-1/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ decision: 'accept', decidedBy: 'admin' }),
      });
      assert.equal(decideRes.status, 200);
      const decided = (await decideRes.json()) as PendingApproval;
      assert.equal(decided.status, 'approved');
      assert.equal(decided.decision, 'accept');

      // 5. POST /api/approvals/:id/decide with invalid decision -> 400
      const invalidDecideRes = await fetch(`${baseUrl}/api/approvals/http-appr-1/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ decision: 'invalid_choice' }),
      });
      assert.equal(invalidDecideRes.status, 400);

      // 6. POST /api/approvals/:id/decide for non-existent -> 404
      const notFoundDecideRes = await fetch(`${baseUrl}/api/approvals/non-existent/decide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({ decision: 'accept' }),
      });
      assert.equal(notFoundDecideRes.status, 404);

      await core.stop();
    });
  });
});
