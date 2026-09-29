import * as assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { test } from 'node:test';
import { NexusCore } from '../../core';
import { DesktopNode, resolveDesktopConfig } from '../../desktop';
import { browseDirectory } from '../../desktop/filesystem';
import { createNexusMessage, parseNexusMessage } from '../../protocol/messages';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-folders-'));
  const initial = join(directory, 'initial');
  const sibling = join(directory, 'other', 'initial');
  mkdirSync(initial);
  mkdirSync(sibling, { recursive: true });
  mkdirSync(join(directory, '.hidden'));
  writeFileSync(join(directory, 'file.txt'), 'Not a directory');
  const core = new NexusCore({ port: 0, host: '127.0.0.1', authTokens: ['folder-test-token'] });
  await core.start();
  const address = core.getServer()!.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const desktop = new DesktopNode(
    resolveDesktopConfig(
      { project: initial, core: url, authToken: 'folder-test-token', nodeId: 'folder-pc' },
      {},
      initial
    ),
    { brainModel: { decide: async () => ({ action: 'reply', text: 'ok' }) } }
  );
  t.after(async () => {
    await desktop.stop();
    await core.stop();
    rmSync(directory, { recursive: true, force: true });
  });
  await desktop.start();
  await desktop.getCoreClient()!.waitForConnection(3000);
  const headers = { Authorization: 'Bearer folder-test-token', 'Content-Type': 'application/json' };
  const open = (path: string) =>
    fetch(`${url}/api/filesystem/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ path, nodeId: 'folder-pc' }),
    });
  return { directory, initial, sibling, core, desktop, url, headers, open };
}

test('browse PC directories outside registered projects, ascend to root and follow directory links', async (t) => {
  const { directory, initial, url, headers } = await setup(t);
  if (process.platform !== 'win32') symlinkSync(initial, join(directory, 'linked-folder'));
  const response = await fetch(
    `${url}/api/filesystem?path=${encodeURIComponent(directory)}&nodeId=folder-pc`,
    { headers }
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = (await response.json()) as Awaited<ReturnType<typeof browseDirectory>>;
  assert.equal(data.path, directory);
  assert.ok(data.directories.some((entry) => entry.name === '.hidden' && entry.hidden));
  assert.ok(!data.directories.some((entry) => entry.name === 'file.txt'));
  if (process.platform !== 'win32')
    assert.ok(data.directories.some((entry) => entry.name === 'linked-folder'));
  assert.equal((await browseDirectory(parse(directory).root)).parent, null);
  await assert.rejects(browseDirectory('relative/path'), /absolu/);
});

test('opening an unregistered folder is acknowledged by Desktop and routed as a project, including duplicate names', async (t) => {
  const { desktop, core, initial, sibling, open } = await setup(t);
  const result = await open(sibling);
  assert.equal(result.status, 200);
  const project = (await result.json()) as { id: string; path: string };
  assert.equal(project.path, sibling);
  assert.equal(desktop.getActiveProject().path, sibling);
  assert.equal(core.resolveProject(project.id)?.path, sibling);
  assert.equal(core.getStatus().nodes[0].activeProject?.path, sibling);
  assert.equal(core.getProjectsWithStatus().filter((project) => project.isActive).length, 1);
  assert.notEqual(project.id, desktop.getProject(initial)?.id);
  const back = await open(initial);
  assert.equal(back.status, 200);
  assert.equal(desktop.getActiveProject().path, initial);
});

test('unauthenticated requests, files, absent paths and busy nodes cannot change the working folder', async (t) => {
  const { directory, initial, sibling, desktop, url, open, headers } = await setup(t);
  assert.equal((await fetch(`${url}/api/filesystem`)).status, 401);
  assert.equal(
    (
      await fetch(`${url}/api/filesystem/open`, {
        method: 'POST',
        body: JSON.stringify({ path: sibling }),
      })
    ).status,
    401
  );
  for (const path of [join(directory, 'missing'), join(directory, 'file.txt')])
    assert.equal((await open(path)).status, 400);
  assert.equal(
    (await fetch(`${url}/api/filesystem/open`, { method: 'POST', headers, body: '{' })).status,
    400
  );
  (desktop as unknown as { state: string }).state = 'busy';
  const busy = await open(sibling);
  assert.equal(busy.status, 400);
  assert.match(await busy.text(), /fin de la tâche/);
  assert.equal(desktop.getActiveProject().path, initial);
});

test('filesystem responses must come from the requested PC and pending requests time out or stop', async (t) => {
  const { core, initial } = await setup(t);
  const connection = core.getNodeConnection('folder-pc')!;
  let requestId = '';
  t.mock.method(connection, 'send', (raw: string) => {
    const message = parseNexusMessage(raw);
    if (message.type === 'node:filesystem:get') requestId = message.payload.requestId;
  });
  const pending = core.requestNodeFilesystem('browse', initial, 'folder-pc', 40);
  await core.processMessage(
    createNexusMessage('node:filesystem:result', { requestId, error: 'wrong node' }),
    'another-pc'
  );
  await assert.rejects(pending, /ne répond pas/);
  const stopping = core.requestNodeFilesystem('browse', initial, 'folder-pc');
  const rejected = assert.rejects(stopping, /arrêté/);
  await core.stop();
  await rejected;
});
