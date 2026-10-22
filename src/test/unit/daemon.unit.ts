import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NexusDaemonServer } from '../../daemon/daemon-server';
import { AuthGuard } from '../../security/auth';
import { JailGuard } from '../../security/jail';
import { NexusRuntime } from '../../runtime/nexus-runtime';
import { WorkspaceGuard } from '../../workspace/guard';

suite('NexusDaemonServer unified secure daemon', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-daemon-test-'));
  const projectDir = join(sandbox, 'test-project');
  const outsideDir = join(sandbox, 'outside-secret');

  test('setup test sandbox', () => {
    const { mkdirSync } = require('node:fs');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
    writeFileSync(join(outsideDir, 'secret.txt'), 'confidential');
  });

  const jail = new JailGuard({ allowedRoots: [projectDir] });
  const auth = new AuthGuard(['valid-token-123']);
  const port = 4199;

  let daemon: NexusDaemonServer;

  test('starts daemon server', async () => {
    const workspaceGuard = new WorkspaceGuard(() => ({
      trusted: true,
      folders: [{ scheme: 'file', path: projectDir }],
      dirtyDocuments: [],
      protectedBranches: ['main', 'master'],
    }));

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => projectDir,
      defaultBackend: 'codex',
    });

    daemon = new NexusDaemonServer({
      port,
      host: '127.0.0.1',
      jail,
      auth,
      runtime,
      initialProject: projectDir,
    });

    await daemon.start();
  });

  test('GET /health is public and returns 200 without token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { status: string; daemon: string };
    assert.equal(data.status, 'ok');
    assert.equal(data.daemon, 'nexus-daemon');
  });

  test('GET /status rejects unauthenticated request with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(res.status, 401);
  });

  test('GET /status succeeds with Bearer token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data);
  });

  test('GET /api/nodes returns the local daemon presence and active project', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/nodes`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    });
    assert.equal(res.status, 200);
    const nodes = (await res.json()) as Array<{
      nodeId: string;
      activeProject: { path: string };
      online: boolean;
    }>;
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].nodeId, 'local-daemon');
    assert.equal(nodes[0].activeProject.path, projectDir);
    assert.equal(nodes[0].online, true);
  });

  test('GET /api/filesystem blocks path traversal outside the jail with 403', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/filesystem?path=${encodeURIComponent(outsideDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      }
    );
    assert.equal(res.status, 403);
    const err = (await res.json()) as { code: string; error: string };
    assert.equal(err.code, 'SECURITY_VIOLATION');
    assert.match(err.error, /Violation de confinement/);
  });

  test('POST /api/projects/switch blocks switching to a path outside the jail', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/projects/switch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: outsideDir }),
    });
    assert.equal(res.status, 403);
    const err = (await res.json()) as { code: string; error: string };
    assert.equal(err.code, 'SECURITY_VIOLATION');
  });

  test('GET /api/filesystem returns DirectoryListing schema for valid directory', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/filesystem?path=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      }
    );
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      path: string;
      parent: string | null;
      home: string;
      roots: Array<{ name: string; path: string }>;
      directories: Array<{ name: string; path: string; hidden: boolean }>;
      entries: Array<{ name: string; path: string; isDirectory: boolean }>;
    };
    assert.equal(data.path, projectDir);
    assert.ok(Array.isArray(data.roots));
    assert.ok(Array.isArray(data.directories));
    assert.ok(Array.isArray(data.entries));
  });

  test('POST /api/filesystem/open switches project and returns project metadata', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/filesystem/open`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: projectDir }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { id: string; name: string; path: string };
    assert.equal(data.path, projectDir);
    assert.equal(data.id, projectDir);
  });

  test('GET /api/tasks returns the task list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    });
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
  });

  test('GET /api/approvals returns list with pending status', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    });
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
  });

  test('GET /api/sessions returns persistent sessions list', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { Authorization: 'Bearer valid-token-123' },
    });
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
  });

  test('POST and GET /api/persona and /api/projects/memory persist persona, project preferences and memory coherently', async () => {
    const postRes = await fetch(`http://127.0.0.1:${port}/api/persona`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath: projectDir,
        persona: 'Développeur Senior TypeScript',
        projectPreferences: 'Toujours utiliser Biome et Node test runner',
        projectMemory: 'Architecture unifiée autour de NexusDaemonServer.',
      }),
    });
    assert.equal(postRes.status, 200);
    const postData = (await postRes.json()) as {
      status: string;
      persona: string;
      projectPreferences: string;
      projectMemory: string;
    };
    assert.equal(postData.status, 'ok');
    assert.equal(postData.persona, 'Développeur Senior TypeScript');
    assert.equal(postData.projectPreferences, 'Toujours utiliser Biome et Node test runner');
    assert.match(postData.projectMemory, /NexusDaemonServer/);

    const getRes = await fetch(
      `http://127.0.0.1:${port}/api/persona?path=${encodeURIComponent(projectDir)}`,
      {
        headers: { Authorization: 'Bearer valid-token-123' },
      }
    );
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as {
      persona: string;
      projectPreferences: string;
      projectMemory: string;
    };
    assert.equal(getData.persona, 'Développeur Senior TypeScript');
    assert.equal(getData.projectPreferences, 'Toujours utiliser Biome et Node test runner');
    assert.match(getData.projectMemory, /NexusDaemonServer/);

    const memRes = await fetch(`http://127.0.0.1:${port}/api/projects/memory`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectPath: projectDir,
        preferences: 'Directive mise à jour via /api/projects/memory',
        memory: 'Mémoire mise à jour via /api/projects/memory',
      }),
    });
    assert.equal(memRes.status, 200);
    const memData = (await memRes.json()) as {
      projectPreferences: string;
      memory: string;
    };
    assert.equal(memData.projectPreferences, 'Directive mise à jour via /api/projects/memory');
    assert.match(memData.memory, /Mémoire mise à jour via \/api\/projects\/memory/);
  });

  test('POST /api/voice/config and /api/voice/Status manage Fish Audio configuration with URL normalization', async () => {
    const cfgRes = await fetch(`http://127.0.0.1:${port}/api/voice/config`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ttsProvider: 'fish',
        referenceId: 'https://fish.audio/m/802e3bc2b27e49c2995d23ef70e6ac89/',
        model: 's2.1-pro',
      }),
    });
    assert.equal(cfgRes.status, 200);
    const cfgData = (await cfgRes.json()) as {
      tts: {
        provider: string;
        referenceId: string;
        model: string;
        backupProvider: string;
      };
    };
    assert.equal(cfgData.tts.provider, 'fish');
    assert.equal(cfgData.tts.referenceId, '802e3bc2b27e49c2995d23ef70e6ac89');
    assert.equal(cfgData.tts.model, 's2.1-pro');
    assert.equal(cfgData.tts.backupProvider, 'system');

    const synthWithoutKey = await fetch(`http://127.0.0.1:${port}/api/voice/synthesize`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Bonjour Nexus' }),
    });
    assert.equal(synthWithoutKey.status, 503);
  });

  test('stops daemon server and cleans up', async () => {
    await daemon.stop();
    rmSync(sandbox, { recursive: true, force: true });
  });
});
