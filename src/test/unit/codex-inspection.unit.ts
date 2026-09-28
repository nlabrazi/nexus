import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('node:child_process');
import { CodexClient } from '../../codex/client';
import { CodexProjectInspector } from '../../conversational/codex-inspector';
import { FakeProcess } from './codex-process';
import { deferred, flush } from './helpers';

const workspace = { root: '/project', git: { directory: '/project/.git', branch: 'staging' } };

suite('Codex restricted inspection', () => {
  test('API-key authentication is rejected before creating a restricted session', async (t) => {
    const child = new FakeProcess();
    child.blockedMethods.add('account/read');
    t.mock.method(childProcess, 'spawn', () => child);
    const client = new CodexClient(undefined, { restrictedProfile: 'inspection' });
    t.after(() => client.stop());
    const start = client.start();
    const failure = assert.rejects(start, /connexion Codex via ChatGPT/);
    await flush();
    const id = child.written.find((message) => message.method === 'account/read')!.id;
    child.receive({ id, result: { account: { type: 'apiKey' } } });
    await failure;
    assert.equal(
      child.written.some((message) => message.method === 'thread/start'),
      false
    );
    assert.equal(child.kills, 1);
  });

  test('uses a fresh read-only session, denies approvals and stops after its result', async (t) => {
    const child = new FakeProcess();
    const spawn = t.mock.method(childProcess, 'spawn', () => child);
    const inspector = new CodexProjectInspector(async () => workspace);
    const result = inspector.inspect('Inspect sessions', workspace, new AbortController().signal);
    await flush();
    const start = child.written.find((message) => message.method === 'thread/start')!;
    assert.equal((start.params as { sandbox: string }).sandbox, 'read-only');
    assert.equal((start.params as { ephemeral: boolean }).ephemeral, true);
    const turn = child.written.find((message) => message.method === 'turn/start')!;
    assert.deepEqual((turn.params as { sandboxPolicy: unknown }).sandboxPolicy, {
      type: 'readOnly',
      networkAccess: false,
    });
    const args = spawn.mock.calls[0].arguments[1] as string[];
    assert.ok(args.includes('mcp_servers={}'));
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.ok(args.includes('hooks'));
    child.approve('forbidden');
    await flush();
    assert.deepEqual(child.written.find((message) => message.id === 'forbidden')?.result, {
      decision: 'decline',
    });
    child.complete();
    assert.equal(await result, 'Done');
    assert.equal(child.kills, 1);
  });

  for (const sandbox of [
    undefined,
    { type: 'workspaceWrite', networkAccess: false },
    { type: 'readOnly', networkAccess: true },
  ]) {
    test(`refuses unconfirmed restrictions: ${JSON.stringify(sandbox)}`, async (t) => {
      const child = new FakeProcess();
      child.blockedMethods.add('thread/start');
      t.mock.method(childProcess, 'spawn', () => child);
      const client = new CodexClient(undefined, { restrictedProfile: 'inspection' });
      t.after(() => client.stop());
      await client.start();
      const result = client.startSession('/project');
      const failure = assert.rejects(result, { code: 'protocol_error' });
      const id = child.written.find((message) => message.method === 'thread/start')!.id;
      child.receive({
        id,
        result: { thread: { id: 'thread', cwd: '/project' }, approvalPolicy: 'never', sandbox },
      });
      await failure;
      assert.equal(child.kills, 1);
      assert.equal(
        child.written.some((message) => message.method === 'turn/start'),
        false
      );
    });
  }

  test('an accepting handler cannot elevate a restricted client', async (t) => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const client = new CodexClient(async () => assert.fail('Must not ask'), {
      restrictedProfile: 'inspection',
    });
    t.after(() => client.stop());
    await client.start();
    await client.startSession('/project');
    const result = client.runTurn('thread', 'Inspect');
    await flush();
    child.approve('forbidden');
    await flush();
    assert.deepEqual(child.written.find((message) => message.id === 'forbidden')?.result, {
      decision: 'decline',
    });
    child.complete();
    await result;
  });

  test('cancelling workspace validation prevents any process launch', async (t) => {
    const child = new FakeProcess();
    const spawn = t.mock.method(childProcess, 'spawn', () => child);
    const pending = deferred<void>();
    const inspector = new CodexProjectInspector(async () => {
      await pending.promise;
      return workspace;
    });
    const controller = new AbortController();
    const result = inspector.inspect('Inspect', workspace, controller.signal);
    const failure = assert.rejects(result, { name: 'AbortError' });
    controller.abort();
    pending.resolve();
    await failure;
    assert.equal(spawn.mock.callCount(), 0);
  });

  test('cancelling a running inspection stops its process and rejects late completion', async (t) => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const inspector = new CodexProjectInspector(async () => workspace);
    const controller = new AbortController();
    const result = inspector.inspect('Inspect', workspace, controller.signal);
    const failure = assert.rejects(result);
    await flush();
    controller.abort();
    child.complete();
    await failure;
    assert.equal(child.kills, 1);
  });
});
