import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import fsPromises = require('node:fs/promises');
import { DEFAULT_PROTECTED_BRANCHES, WorkspaceContext, WorkspaceGuard } from '../../workspace/guard';
import { workspaceEnvironment } from '../../workspace/environment';

const execute = promisify(execFile);

async function setup(t: TestContext, repository = true) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'nexus-workspace-')));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'project with spaces');
  await mkdir(root);
  if (!repository) {
    // Isolate non-repository fixtures from any .git marker owned by the temp
    // directory's host (including sandbox sentinel directories).
    const original = fsPromises.lstat;
    const marker = join(await realpath(tmpdir()), '.git');
    t.mock.method(fsPromises, 'lstat', async (path: Parameters<typeof original>[0]) => {
      if (path === marker) { throw Object.assign(new Error('absent in fixture'), { code: 'ENOENT' }); }
      return original(path);
    });
  }
  const git = (cwd: string, ...args: string[]) => execute('git', [
    '-c', 'user.name=Nexus tests', '-c', 'user.email=nexus@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(temp, 'no-hooks')}`,
    '-C', cwd, ...args,
  ], { env: { ...workspaceEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temp, 'no-config'), LC_ALL: 'C' } });
  if (repository) { await git(root, 'init', '-b', 'feature/test'); }
  const context: WorkspaceContext = {
    trusted: true, folders: [{ scheme: 'file', path: root }], dirtyDocuments: [],
    protectedBranches: DEFAULT_PROTECTED_BRANCHES,
  };
  const guard = new WorkspaceGuard(() => context);
  const commit = async (text = 'base') => {
    await writeFile(join(root, 'example.txt'), text);
    await git(root, 'add', 'example.txt');
    await git(root, 'commit', '-m', text);
  };
  return { root, temp, git, guard, context, commit };
}

suite('Workspace and Git preflight', () => {
  test('lists protected and remote branches and switches from master to staging', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'branch', '-m', 'master');
    await git(root, 'branch', 'staging');
    await git(root, 'remote', 'add', 'origin', root);
    await git(root, 'update-ref', 'refs/remotes/origin/staging', 'HEAD');
    await git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/staging');
    await assert.rejects(guard.validate(root), { code: 'protected_branch' });
    assert.deepEqual(await guard.listBranches(root), [
      { name: 'master', localName: 'master', remote: false, current: true, protected: true },
      { name: 'staging', localName: 'staging', remote: false, current: false, protected: false },
      { name: 'origin/staging', localName: 'staging', remote: true, current: false, protected: false },
    ]);
    assert.equal(await guard.switchBranch(root, 'staging'), 'staging');
    assert.equal((await guard.validate(root)).git?.branch, 'staging');
    await assert.rejects(guard.switchBranch(root, 'master'), { code: 'protected_branch' });
    await assert.rejects(guard.switchBranch(root, 'origin/staging'), { code: 'branch_exists' });
  });

  test('creates a local tracking branch from an explicit remote selection', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'remote', 'add', 'origin', root);
    await git(root, 'update-ref', 'refs/remotes/origin/staging', 'HEAD');
    await git(root, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    await assert.rejects(guard.switchBranch(root, 'origin/master'), { code: 'protected_branch' });
    assert.equal(await guard.switchBranch(root, 'origin/staging'), 'staging');
    assert.equal((await git(root, 'rev-parse', '--abbrev-ref', '@{upstream}')).stdout.trim(), 'origin/staging');
  });

  test('switching preserves saved changes, staged files and untracked files by refusing dirty worktrees', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'branch', 'staging');
    await writeFile(join(root, 'example.txt'), 'keep me');
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'dirty_worktree' });
    await git(root, 'add', 'example.txt');
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'dirty_worktree' });
    assert.equal(await readFile(join(root, 'example.txt'), 'utf8'), 'keep me');
    await git(root, 'commit', '-m', 'saved');
    await writeFile(join(root, 'new.txt'), 'untracked');
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'dirty_worktree' });
    assert.equal(await readFile(join(root, 'new.txt'), 'utf8'), 'untracked');
    assert.equal((await guard.validate(root)).git?.branch, 'feature/test');
  });

  test('branch management retains workspace, editor and Git operation checks', async t => {
    const { root, guard, context, git, commit } = await setup(t);
    await commit();
    await git(root, 'branch', 'staging');
    context.trusted = false;
    await assert.rejects(guard.listBranches(root), { code: 'untrusted' });
    context.trusted = true;
    context.dirtyDocuments.push({ scheme: 'file', path: join(root, 'example.txt') });
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'unsaved_documents' });
    context.dirtyDocuments = [];
    await writeFile(join(root, '.git', 'MERGE_HEAD'), 'pending');
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'git_operation' });
  });

  test('switching does not overwrite an ignored local file tracked on the target branch', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'switch', '-c', 'staging');
    await writeFile(join(root, 'local.txt'), 'tracked on staging');
    await git(root, 'add', 'local.txt');
    await git(root, 'commit', '-m', 'track file');
    await git(root, 'switch', 'feature/test');
    await writeFile(join(root, '.gitignore'), 'local.txt\n');
    await git(root, 'add', '.gitignore');
    await git(root, 'commit', '-m', 'ignore local file');
    await writeFile(join(root, 'local.txt'), 'private local contents');
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'switch_failed' });
    assert.equal(await readFile(join(root, 'local.txt'), 'utf8'), 'private local contents');
    assert.equal((await guard.validate(root)).git?.branch, 'feature/test');
  });

  test('unknown names, Git revision syntax and options cannot select a branch', async t => {
    const { root, guard, commit } = await setup(t);
    await commit();
    for (const name of ['missing', '-', '--detach', '@{-1}', 'HEAD~1', 'feature/test; touch injected']) {
      await assert.rejects(guard.switchBranch(root, name), { code: 'unknown_branch' });
    }
    assert.equal((await guard.validate(root)).git?.branch, 'feature/test');
  });

  test('Git refusal for a branch checked out in another worktree leaves the current branch intact', async t => {
    const { root, temp, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'worktree', 'add', '-b', 'staging', join(temp, 'linked'));
    await assert.rejects(guard.switchBranch(root, 'staging'), { code: 'switch_failed' });
    assert.equal((await guard.validate(root)).git?.branch, 'feature/test');
  });

  test('branch listing reports non-Git projects clearly', async t => {
    const { root, guard } = await setup(t, false);
    await assert.rejects(guard.listBranches(root), { code: 'no_repository' });
  });

  test('accepts the repository root, including saved uncommitted and untracked files', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await writeFile(join(root, 'example.txt'), 'saved modification');
    await writeFile(join(root, 'new.txt'), 'untracked');
    const before = await readFile(join(root, '.git', 'index'));
    assert.deepEqual(await guard.validate(root), {
      root, git: { directory: join(root, '.git'), branch: 'feature/test' },
    });
    assert.deepEqual(await readFile(join(root, '.git', 'index')), before, 'preflight must not refresh or rewrite the index');
    assert.match((await git(root, 'status', '--porcelain')).stdout, /example.txt/);
  });

  test('allows an existing non-Git project without inventing a repository root', async t => {
    const { root, guard } = await setup(t, false);
    assert.deepEqual(await guard.validate(root), { root });
  });

  test('rejects missing, ambiguous, untrusted and virtual workspaces before invoking Git', async t => {
    const { root, context } = await setup(t, false);
    let calls = 0;
    const guard = new WorkspaceGuard(() => context, async () => { calls++; return ''; });
    context.folders = [];
    await assert.rejects(guard.validate(root), { code: 'ambiguous_workspace' });
    context.folders = [{ scheme: 'file', path: root }, { scheme: 'file', path: '/other' }];
    await assert.rejects(guard.validate(root), { code: 'ambiguous_workspace' });
    context.folders = [{ scheme: 'file', path: root }];
    context.trusted = false;
    await assert.rejects(guard.validate(root), { code: 'untrusted' });
    context.trusted = true;
    context.folders[0].scheme = 'vscode-remote';
    await assert.rejects(guard.validate(root), { code: 'unsupported_workspace' });
    assert.equal(calls, 0);
  });

  test('rejects a missing directory, a file and a mismatched target', async t => {
    const { root, temp, context, guard } = await setup(t);
    await assert.rejects(guard.validate(join(temp, 'missing')), { code: 'workspace_missing' });
    await writeFile(join(root, 'file'), 'text');
    await assert.rejects(guard.validate(join(root, 'file')), { code: 'workspace_missing' });
    await assert.rejects(guard.validate(temp), { code: 'wrong_workspace' });
    context.folders[0].path = join(root, 'file');
    await assert.rejects(guard.validate(root), { code: 'wrong_workspace' });
  });

  test('rejects a Git subdirectory and a bare repository', async t => {
    const { root, temp, context, guard, git } = await setup(t);
    const subdirectory = join(root, 'src');
    await mkdir(subdirectory);
    context.folders[0].path = subdirectory;
    await assert.rejects(guard.validate(subdirectory), { code: 'invalid_root' });
    const bare = join(temp, 'bare.git');
    await git(temp, 'init', '--bare', bare);
    context.folders[0].path = bare;
    await assert.rejects(guard.validate(bare), { code: 'invalid_root' });
  });

  test('resolves a symlinked root and catches unsaved files through either path', async t => {
    const { root, temp, context, guard } = await setup(t);
    const alias = join(temp, 'alias');
    await symlink(root, alias, 'junction');
    context.folders[0].path = alias;
    assert.equal((await guard.validate(alias)).root, root);
    context.dirtyDocuments = [{ scheme: 'file', path: join(alias, 'not-saved-yet.ts') }];
    await assert.rejects(guard.validate(alias), { code: 'unsaved_documents' });
    context.dirtyDocuments = [{ scheme: 'file', path: join(root, 'not-saved-yet.ts') }];
    await assert.rejects(guard.validate(alias), { code: 'unsaved_documents' });
  });

  test('blocks unsaved project documents and untitled buffers, but allows unrelated editors', async t => {
    const { root, temp, context, guard } = await setup(t);
    context.dirtyDocuments = [{ scheme: 'untitled', path: 'Untitled-1' }];
    await assert.rejects(guard.validate(root), { code: 'unsaved_documents' });
    context.dirtyDocuments = [{ scheme: 'file', path: join(root, 'example.ipynb') }];
    await assert.rejects(guard.validate(root), { code: 'unsaved_documents' });
    context.dirtyDocuments = [{ scheme: 'file', path: join(temp, 'unrelated.ts') }];
    await guard.validate(root);
  });

  for (const branch of ['main', 'master']) {
    test(`protects ${branch} by default and respects the configured list`, async t => {
      const { root, context, guard, git } = await setup(t);
      await git(root, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`);
      await assert.rejects(guard.validate(root), { code: 'protected_branch' });
      context.protectedBranches = [];
      assert.equal((await guard.validate(root)).git?.branch, branch);
    });
  }

  test('rejects detached HEAD', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit();
    await git(root, 'checkout', '--detach');
    await assert.rejects(guard.validate(root), { code: 'detached_head' });
  });

  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer', 'BISECT_LOG', 'index.lock']) {
    test(`blocks an existing ${marker} without modifying it`, async t => {
      const { root, guard } = await setup(t);
      const path = join(root, '.git', marker);
      await writeFile(path, 'pending operation');
      await assert.rejects(guard.validate(root), { code: 'git_operation' });
      assert.equal(await readFile(path, 'utf8'), 'pending operation');
    });
  }

  test('detects an unmerged index even without a merge marker', async t => {
    const { root, guard, git, commit } = await setup(t);
    await commit('base');
    await git(root, 'branch', 'feature/other');
    await commit('first');
    await git(root, 'switch', 'feature/other');
    await commit('second');
    await assert.rejects(git(root, 'merge', 'feature/test'));
    await unlink(join(root, '.git', 'MERGE_HEAD'));
    await assert.rejects(guard.validate(root), { code: 'git_conflicts' });
  });

  test('uses the linked worktree Git directory for operation checks', async t => {
    const { root, temp, context, guard, git, commit } = await setup(t);
    await commit();
    const worktree = join(temp, 'linked-worktree');
    await git(root, 'worktree', 'add', '-b', 'feature/linked', worktree);
    context.folders[0].path = worktree;
    await writeFile(join(root, '.git', 'MERGE_HEAD'), 'main worktree operation');
    const identity = await guard.validate(worktree);
    assert.equal(identity.root, worktree);
    assert.equal(identity.git?.branch, 'feature/linked');
    assert.notEqual(identity.git?.directory, join(worktree, '.git'));
    await writeFile(join(identity.git!.directory, 'MERGE_HEAD'), 'linked operation');
    await assert.rejects(guard.validate(worktree), { code: 'git_operation' });
  });

  test('does not mistake a broken .git file for a non-Git project', async t => {
    const { root, guard } = await setup(t, false);
    await writeFile(join(root, '.git'), 'gitdir: /a/missing/repository\n');
    await assert.rejects(guard.validate(root), { code: 'git_unavailable' });
  });

  test('Git absent or timing out blocks the action with an actionable error', async t => {
    const { root, context } = await setup(t, false);
    for (const failure of [Object.assign(new Error('missing'), { code: 'ENOENT' }), Object.assign(new Error('timeout'), { killed: true })]) {
      const guard = new WorkspaceGuard(() => context, async () => { throw failure; });
      await assert.rejects(guard.validate(root), { code: 'git_unavailable' });
    }
  });

  test('inherited Git routing variables cannot select another repository', async t => {
    const { root, temp, guard, git } = await setup(t);
    const foreign = join(temp, 'foreign');
    await mkdir(foreign);
    await git(foreign, 'init', '-b', 'main');
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = join(foreign, '.git');
    t.after(() => { if (previous === undefined) { delete process.env.GIT_DIR; } else { process.env.GIT_DIR = previous; } });
    assert.equal((await guard.validate(root)).git?.branch, 'feature/test');
    assert.equal(process.env.GIT_DIR, join(foreign, '.git'), 'the parent environment must remain unchanged');
  });

  test('rechecks editor state when it changes while Git is being queried', async t => {
    const { root, context } = await setup(t, false);
    const guard = new WorkspaceGuard(() => context, async () => {
      context.dirtyDocuments.push({ scheme: 'file', path: join(root, 'example.ts') });
      throw Object.assign(new Error('not a repository'), { code: 128, stderr: 'fatal: not a git repository' });
    });
    await assert.rejects(guard.validate(root), { code: 'unsaved_documents' });
  });
});
