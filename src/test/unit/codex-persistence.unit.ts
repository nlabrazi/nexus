import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { CodexService } from '../../codex/service';
import { WorkspaceSessionPersistence } from '../../codex/persistence';
import { FakeProcess } from './codex-process';
import { deferred, flush } from './helpers';

const workspace = (branch = 'feature/test') => ({
  root: '/project',
  git: { directory: '/project/.git', branch },
});
function setup(t: TestContext) {
  let data: unknown;
  let fail = false;
  let branch = 'feature/test';
  const storage = {
    get: () => data,
    update: async (_key: string, value: unknown) => {
      if (fail) {
        throw new Error('Disk full');
      }
      data = value;
    },
  };
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const services: CodexService[] = [];
  const create = () => {
    const service = new CodexService(
      undefined,
      async () => workspace(branch),
      new WorkspaceSessionPersistence(storage)
    );
    services.push(service);
    return service;
  };
  t.after(() => {
    for (const service of services) {
      service.stop();
    }
  });
  return {
    create,
    child,
    spawn,
    storage,
    data: () => data,
    setFailure: (value: boolean) => {
      fail = value;
    },
    setBranch: (value: string) => {
      branch = value;
    },
  };
}

suite('Workspace session persistence', () => {
  test('reload restores an inactive selection without spawning; the next prompt resumes it', async (t) => {
    const { create, child, spawn, data } = setup(t);
    const first = create();
    await first.startSession('/project');
    assert.deepEqual(data(), { version: 1, id: 'thread', workspace: workspace() });
    first.stop();
    const reloaded = create();
    assert.equal(reloaded.getCurrentSessionId(), 'thread');
    assert.equal(reloaded.isSessionActive(), false);
    assert.equal(reloaded.getStatus().sessionBranch, 'feature/test');
    assert.equal(spawn.mock.callCount(), 1);
    const next = new FakeProcess();
    next.threads.set('thread', child.threads.get('thread')!);
    spawn.mock.mockImplementation(() => next);
    const prompt = reloaded.sendPrompt('hello', '/project');
    await flush();
    next.complete();
    assert.equal(await prompt, 'Done');
    assert.equal(
      next.written.some((item) => item.method === 'thread/start'),
      false
    );
    assert.equal(next.written.filter((item) => item.method === 'thread/resume').length, 1);
  });

  test('new replaces the saved selection while a failed resume preserves it', async (t) => {
    const { create, data } = setup(t);
    const service = create();
    await service.startSession('/project');
    await assert.rejects(service.resumeSession('/project', 'missing'), { code: 'session_lost' });
    assert.equal((data() as { id: string }).id, 'thread');
    await service.newSession('/project');
    assert.equal((data() as { id: string }).id, 'thread-2');
  });

  test('a branch mismatch after reload blocks before spawning; explicit resume rebinds it', async (t) => {
    const { create, spawn, child, setBranch, data } = setup(t);
    const first = create();
    await first.startSession('/project');
    first.stop();
    setBranch('feature/other');
    const reloaded = create();
    await assert.rejects(reloaded.sendPrompt('hello', '/project'), { code: 'workspace_changed' });
    assert.equal(spawn.mock.callCount(), 1);
    const next = new FakeProcess();
    next.threads.set('thread', child.threads.get('thread')!);
    spawn.mock.mockImplementation(() => next);
    await reloaded.resumeSession('/project', 'thread');
    assert.equal(
      (data() as { workspace: { git: { branch: string } } }).workspace.git.branch,
      'feature/other'
    );
  });

  test('a lost saved session is not silently replaced', async (t) => {
    const { create, spawn, data } = setup(t);
    const first = create();
    await first.startSession('/project');
    first.stop();
    const next = new FakeProcess();
    spawn.mock.mockImplementation(() => next);
    await assert.rejects(create().sendPrompt('hello', '/project'), { code: 'session_lost' });
    assert.equal(
      next.written.some((item) => item.method === 'thread/start'),
      false
    );
    assert.equal((data() as { id: string }).id, 'thread');
  });

  test('storage errors block the prompt, release its reservation and permit retry', async (t) => {
    const { create, child, setFailure, data } = setup(t);
    const service = create();
    setFailure(true);
    await assert.rejects(service.sendPrompt('hello', '/project'), /sauvegarde a échoué/);
    assert.equal(data(), undefined);
    assert.equal(service.isTurnRunning(), false);
    assert.equal(
      child.written.some((item) => item.method === 'turn/start'),
      false
    );
    setFailure(false);
    const retry = service.sendPrompt('hello', '/project');
    await flush();
    child.complete();
    await retry;
    assert.equal(child.written.filter((item) => item.method === 'thread/start').length, 1);
    assert.equal((data() as { id: string }).id, 'thread');
  });

  test('validates stored data and isolates independent workspace stores', async () => {
    for (const value of [
      undefined,
      null,
      {},
      { version: 2 },
      { version: 1, id: 'bad id', workspace: workspace() },
      { version: 1, id: 'saved', workspace: { root: 'relative' } },
      {
        version: 1,
        id: 'saved',
        workspace: { root: '/project', git: { directory: 'relative', branch: 'feature' } },
      },
    ]) {
      const store = new WorkspaceSessionPersistence({ get: () => value, update: async () => {} });
      assert.equal(store.load(), undefined);
    }
    let a: unknown;
    const storeA = new WorkspaceSessionPersistence({
      get: () => a,
      update: async (_key, value) => {
        a = value;
      },
    });
    const storeB = new WorkspaceSessionPersistence({
      get: () => undefined,
      update: async () => {},
    });
    await storeA.save({ version: 1, id: 'saved', workspace: workspace() });
    assert.equal(storeA.load()?.id, 'saved');
    assert.equal(storeB.load(), undefined);
  });

  test('stop during a save prevents the prompt but preserves the already selected session', async (t) => {
    const { create, child, storage, data } = setup(t);
    const gate = deferred<void>();
    const original = storage.update;
    t.mock.method(storage, 'update', async (key: string, value: unknown) => {
      await gate.promise;
      await original(key, value);
    });
    const service = create();
    const pending = service.sendPrompt('hello', '/project');
    const cancelled = assert.rejects(pending, /annulée/);
    await flush();
    assert.equal(service.cancelCurrentWork(), true);
    gate.resolve();
    await cancelled;
    assert.equal(
      child.written.some((item) => item.method === 'turn/start'),
      false
    );
    assert.equal(service.getCurrentSessionId(), 'thread');
    assert.equal((data() as { id: string }).id, 'thread');
  });

  test('serializes writes so the latest selection wins and recovers from failed writes', async () => {
    const gate = deferred<void>();
    let data: unknown;
    let calls = 0;
    const store = new WorkspaceSessionPersistence({
      get: () => data,
      update: async (_key, value) => {
        if (++calls === 1) {
          await gate.promise;
          throw new Error('Disk failure');
        }
        data = value;
      },
    });
    const first = store.save({ version: 1, id: 'old', workspace: workspace() });
    const failed = assert.rejects(first, /Disk failure/);
    const second = store.save({ version: 1, id: 'new', workspace: workspace() });
    await flush();
    assert.equal(calls, 1);
    gate.resolve();
    await failed;
    await second;
    assert.equal(store.load()?.id, 'new');
  });
});
