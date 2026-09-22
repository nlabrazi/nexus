import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { CodexService } from '../../codex/service';
import { WorkspaceError, WorkspaceValidator } from '../../workspace/guard';
import { FakeProcess } from './codex-process';
import { deferred, flush } from './helpers';

function setup(t: TestContext, validate: WorkspaceValidator) {
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const service = new CodexService(undefined, validate);
  t.after(() => {
    service.stop();
    child.emit('exit', 0);
  });
  const calls = (method: string) => child.written.filter((message) => message.method === method);
  return { child, spawn, service, calls };
}
const identity = (branch = 'feature/one') => ({
  root: '/project',
  git: { directory: '/project/.git', branch },
});

suite('Codex workspace safety integration', () => {
  test('branch operations exclude prompts and session changes, including after /stop', async (t) => {
    const { service, spawn } = setup(t, async () => identity());
    const pending = deferred<string>();
    const operation = service.withWorkspaceOperation(() => pending.promise);
    await assert.rejects(service.newSession('/project'), /changement de branche/);
    await assert.rejects(service.sendPrompt('hello', '/project'), /already running/);
    await assert.rejects(
      service.withWorkspaceOperation(async () => 'other'),
      /opération Git ou Codex/
    );
    assert.equal(service.cancelCurrentWork(), false);
    await assert.rejects(service.startSession('/project'), /changement de branche/);
    assert.equal(spawn.mock.callCount(), 0);
    pending.resolve('staging');
    assert.equal(await operation, 'staging');
    await assert.rejects(
      service.withWorkspaceOperation(async () => {
        throw new Error('Git refused');
      }),
      /Git refused/
    );
    assert.equal(await service.startSession('/project'), 'thread');
  });

  test('session startup and prompt preflight prevent switching before the first await completes', async (t) => {
    const pending = deferred<void>();
    const { service } = setup(t, async () => {
      await pending.promise;
      return identity();
    });
    const session = service.startSession('/project');
    await assert.rejects(
      service.withWorkspaceOperation(async () => 'staging'),
      /opération Git ou Codex/
    );
    pending.resolve();
    await session;
    const turn = service.sendPrompt('hello');
    const failure = assert.rejects(turn, /annulée/);
    await assert.rejects(
      service.withWorkspaceOperation(async () => 'staging'),
      /opération Git ou Codex/
    );
    service.cancelCurrentWork();
    await failure;
  });

  test('all entry points validate before spawning and release their reservation after refusal', async (t) => {
    let blocked = true;
    const { service, spawn } = setup(t, async () => {
      if (blocked) {
        throw new WorkspaceError('unsaved_documents', 'Save first');
      }
      return identity();
    });
    for (const action of [
      () => service.startSession('/project'),
      () => service.newSession('/project'),
      () => service.resumeSession('/project', 'saved'),
      () => service.sendPrompt('hello', '/project'),
    ]) {
      await assert.rejects(action(), { code: 'unsaved_documents' });
      assert.equal(service.getStatus().sessionChanging, false);
      assert.equal(service.isTurnRunning(), false);
    }
    assert.equal(spawn.mock.callCount(), 0);
    blocked = false;
    assert.equal(await service.startSession('/project'), 'thread');
  });

  test('branch changes block reuse until explicit resume or new, without replaying a prompt', async (t) => {
    let branch = 'feature/one';
    const { service, calls } = setup(t, async () => identity(branch));
    await service.startSession('/project');
    branch = 'feature/two';
    await assert.rejects(service.startSession('/project'), { code: 'workspace_changed' });
    await assert.rejects(service.sendPrompt('hello'), { code: 'workspace_changed' });
    assert.equal(calls('turn/start').length, 0);
    assert.equal(service.getStatus().sessionBranch, 'feature/one');
    await service.resumeSession('/project', 'thread');
    assert.equal(service.getStatus().sessionBranch, branch);
    branch = 'feature/three';
    assert.equal(await service.newSession('/project'), 'thread-2');
    assert.equal(service.getStatus().sessionBranch, branch);
  });

  test('a context change during session creation preserves the previous selection', async (t) => {
    let branch = 'feature/one';
    const { service, child, calls } = setup(t, async () => identity(branch));
    await service.startSession('/project');
    child.blockedMethods.add('thread/start');
    const pending = service.newSession('/project');
    const failure = assert.rejects(pending, { code: 'workspace_changed' });
    await flush();
    branch = 'feature/two';
    child.receive({
      id: calls('thread/start')[1].id,
      result: { thread: { id: 'other', cwd: '/project' } },
    });
    await failure;
    assert.equal(service.getCurrentSessionId(), 'thread');
    assert.equal(service.getStatus().sessionBranch, 'feature/one');
    assert.equal(calls('turn/start').length, 0);
  });

  test('a newly dirty editor blocks the last check before turn/start', async (t) => {
    let checks = 0;
    const { service, calls } = setup(t, async () => {
      if (++checks === 3) {
        throw new WorkspaceError('unsaved_documents', 'Save first');
      }
      return identity();
    });
    await assert.rejects(service.sendPrompt('hello', '/project'), { code: 'unsaved_documents' });
    assert.equal(calls('thread/start').length, 1);
    assert.equal(calls('turn/start').length, 0);
    assert.equal(service.isTurnRunning(), false);
  });

  test('validation holds the reservation and stopping it prevents a late spawn', async (t) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, spawn } = setup(t, async () => {
      await barrier;
      return identity();
    });
    const pending = service.sendPrompt('hello', '/project');
    const failure = assert.rejects(pending, /annulée/);
    await assert.rejects(service.newSession('/project'), /turn Codex est en cours/);
    await assert.rejects(service.sendPrompt('second', '/project'), /already running/);
    service.stop();
    release();
    await failure;
    assert.equal(spawn.mock.callCount(), 0);
  });

  test('uses the canonical workspace for RPCs and removes Git routing from the child environment', async (t) => {
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = '/foreign/.git';
    t.after(() => {
      if (previous === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previous;
      }
    });
    const { service, spawn, calls } = setup(t, async () => identity());
    await service.startSession('/alias');
    assert.equal((calls('thread/start')[0].params as { cwd: string }).cwd, '/project');
    const args = spawn.mock.calls[0].arguments as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv },
    ];
    assert.equal(args[2].env.GIT_DIR, undefined);
    assert.equal(args[2].env.PATH, process.env.PATH);
    assert.equal(process.env.GIT_DIR, '/foreign/.git');
  });
});
