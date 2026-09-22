import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('node:child_process');
import { AntigravityApprovals, isGuardRailTool } from '../../antigravity/approvals';
import { AntigravityClient } from '../../antigravity/client';
import { AntigravityApprovalRequest, ApprovalDecision } from '../../antigravity/types';
import { FakeAntigravityProcess } from './antigravity-process';
import { deferred, flush } from './helpers';

suite('Antigravity approvals logic', () => {
  test('identifies guard-rail tools correctly', () => {
    assert.equal(isGuardRailTool('run_command'), true);
    assert.equal(isGuardRailTool('command'), true);
    assert.equal(isGuardRailTool('write_to_file'), true);
    assert.equal(isGuardRailTool('replace_file_content'), true);
    assert.equal(isGuardRailTool('multi_replace_file_content'), true);
    assert.equal(isGuardRailTool('ask_permission'), true);
    assert.equal(isGuardRailTool('view_file'), false);
    assert.equal(isGuardRailTool('list_dir'), false);
    assert.equal(isGuardRailTool('search_web'), false);
    assert.equal(isGuardRailTool('read_url_content'), false);
  });

  test('auto-approves when no handler is provided or tool is not guard-rail', async () => {
    const approvals = new AntigravityApprovals();
    approvals.beginTurn('conv-1');

    const decision1 = await approvals.requestToolApproval('conv-1', 1, 'run_command', {
      CommandLine: 'ls',
    });
    assert.equal(decision1, 'accept');

    const handled = new AntigravityApprovals(async () => 'decline');
    handled.beginTurn('conv-1');

    const decision2 = await handled.requestToolApproval('conv-1', 1, 'view_file', {
      AbsolutePath: '/foo',
    });
    assert.equal(decision2, 'accept');
  });

  test('forwards request to handler and resolves with decision', async () => {
    const requests: AntigravityApprovalRequest[] = [];
    const approvals = new AntigravityApprovals(async (req) => {
      requests.push(req);
      return 'accept';
    });

    approvals.beginTurn('conv-1');
    const decision = await approvals.requestToolApproval('conv-1', 2, 'run_command', {
      CommandLine: 'cat /etc/passwd',
    });

    assert.equal(decision, 'accept');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].agentName, 'Antigravity');
    assert.equal(requests[0].kind, 'command');
    assert.equal(requests[0].threadId, 'conv-1');
    assert.equal(requests[0].turnId, '2');
    assert.equal(requests[0].itemId, 'run_command');
    assert.match(requests[0].details, /cat \/etc\/passwd/);
  });

  test('settles with decline when handler returns decline', async () => {
    const approvals = new AntigravityApprovals(async () => 'decline');
    approvals.beginTurn('conv-1');

    const decision = await approvals.requestToolApproval('conv-1', 1, 'write_to_file', {
      TargetFile: '/tmp/test.txt',
    });
    assert.equal(decision, 'decline');
  });

  test('auto-declines on timeout and manages pending count', async () => {
    let resolvePending!: (decision: ApprovalDecision) => void;
    const pending = new Promise<ApprovalDecision>((r) => {
      resolvePending = r;
    });
    const approvals = new AntigravityApprovals(async () => pending, 50);

    approvals.beginTurn('conv-1');
    const decisionPromise = approvals.requestToolApproval('conv-1', 1, 'run_command', {
      CommandLine: 'sleep 10',
    });

    assert.equal(approvals.getPendingCount(), 1);

    // Wait for timeout (50ms)
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(await decisionPromise, 'decline');
    assert.equal(approvals.getPendingCount(), 0);

    // Resolving afterwards has no effect
    resolvePending('accept');
  });

  test('cancelAll declines all pending approvals', async () => {
    const pending = deferred<ApprovalDecision>();
    const approvals = new AntigravityApprovals(async () => pending.promise);

    approvals.beginTurn('conv-1');
    const decisionPromise = approvals.requestToolApproval('conv-1', 1, 'run_command');

    assert.equal(approvals.getPendingCount(), 1);
    approvals.cancelAll();

    assert.equal(await decisionPromise, 'decline');
    assert.equal(approvals.getPendingCount(), 0);
  });

  test('handles explicit approval_request events', async () => {
    const requests: AntigravityApprovalRequest[] = [];
    const approvals = new AntigravityApprovals(async (req) => {
      requests.push(req);
      return 'accept';
    });

    approvals.beginTurn('conv-1');
    const decision = await approvals.handleApprovalEvent({
      conversation_id: 'conv-1',
      approval_request: {
        id: 'req-42',
        kind: 'command',
        details: 'Restart service',
        turnId: '5',
      },
    });

    assert.equal(decision, 'accept');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].itemId, 'req-42');
    assert.equal(requests[0].details, 'Restart service');
  });
});

suite('Antigravity client turn approval integration', () => {
  test('turn proceeds when guard-rail tool is approved', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const requests: AntigravityApprovalRequest[] = [];
    const client = new AntigravityClient({}, async (req) => {
      requests.push(req);
      return 'accept';
    });
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Run echo');

    await flush();

    // Tool ACTIVE event should trigger approval
    spawned?.sendToolActive('run_command', { CommandLine: 'echo 42' });
    await flush();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].agentName, 'Antigravity');
    assert.equal(requests[0].kind, 'command');
    assert.match(requests[0].details, /echo 42/);

    // Tool finishes and turn completes
    spawned?.sendToolDone('run_command', { CommandLine: 'echo 42' }, '42\n');
    spawned?.complete('Echoed 42');

    const result = await turnPromise;
    assert.equal(result, 'Echoed 42');
    assert.equal(client.getStatus().pendingApprovals, 0);
  });

  test('turn aborts with approval_declined when guard-rail tool is rejected', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient({}, async () => 'decline');
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Delete database');
    const rejected = assert.rejects(turnPromise, {
      name: 'AntigravityError',
      code: 'approval_declined',
    });

    await flush();

    spawned?.sendToolActive('run_command', { CommandLine: 'rm -rf /' });
    await rejected;

    assert.equal(spawned?.kills, 1);
  });

  test('non-guard-rail tools do not trigger approval handler', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    let calls = 0;
    const client = new AntigravityClient({}, async () => {
      calls++;
      return 'decline';
    });
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Read file');

    await flush();

    spawned?.sendTool('view_file', { AbsolutePath: '/workspace/src/app.ts' }, 'content');
    spawned?.complete('File read');

    const result = await turnPromise;
    assert.equal(result, 'File read');
    assert.equal(calls, 0);
  });

  test('dangerouslySkipPermissions bypasses approval handler', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    let calls = 0;
    const client = new AntigravityClient({ dangerouslySkipPermissions: true }, async () => {
      calls++;
      return 'decline';
    });
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Execute command');

    await flush();

    spawned?.sendTool('run_command', { CommandLine: 'rm -rf /' }, 'done');
    spawned?.complete('Done');

    const result = await turnPromise;
    assert.equal(result, 'Done');
    assert.equal(calls, 0);
  });
});
