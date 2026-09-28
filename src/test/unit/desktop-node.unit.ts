import * as assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { BrainModel } from '../../conversational/model';
import { DesktopNode, loadConfigFile, resolveDesktopConfig, runCli } from '../../desktop';

suite('Desktop Node configuration and lifecycle', () => {
  const testDir = join(tmpdir(), 'nexus-desktop-unit-test');
  const isolatedRegistry = join(testDir, 'isolated-registry.json');
  const originalRegistryEnv = process.env.NEXUS_PROJECTS_REGISTRY;

  test('beforeEach setup test dir', () => {
    process.env.NEXUS_PROJECTS_REGISTRY = isolatedRegistry;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    execSync(
      'git init -b staging && git config user.name "Test" && git config user.email "test@example.com" && git commit --allow-empty -m "initial"',
      { cwd: testDir }
    );
  });

  test('resolveDesktopConfig resolves project from CLI options', () => {
    const config = resolveDesktopConfig(
      {
        project: testDir,
        name: 'Mon Super Projet',
        backend: 'antigravity',
        nodeId: 'test-node-123',
        nodeName: 'station-fixe',
      },
      {},
      testDir
    );

    assert.equal(config.nodeId, 'test-node-123');
    assert.equal(config.nodeName, 'station-fixe');
    assert.equal(config.defaultBackend, 'antigravity');
    assert.equal(config.projects.length, 1);
    assert.equal(config.projects[0].name, 'Mon Super Projet');
    assert.equal(config.projects[0].path, testDir);
  });

  test('resolveDesktopConfig resolves project and settings from environment variables', () => {
    const config = resolveDesktopConfig(
      {},
      {
        NEXUS_PROJECT_PATH: testDir,
        NEXUS_PROJECT_NAME: 'Env Project',
        NEXUS_NODE_ID: 'env-node-456',
        NEXUS_NODE_NAME: 'env-host',
        NEXUS_DEFAULT_BACKEND: 'brain',
        NEXUS_PROJECTS_REGISTRY: isolatedRegistry,
      },
      testDir
    );

    assert.equal(config.nodeId, 'env-node-456');
    assert.equal(config.nodeName, 'env-host');
    assert.equal(config.defaultBackend, 'brain');
    assert.equal(config.projects.length, 1);
    assert.equal(config.projects[0].name, 'Env Project');
    assert.equal(config.projects[0].path, testDir);
  });

  test('resolveDesktopConfig loads JSON configuration file', () => {
    const configFile = join(testDir, 'desktop-config.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        nodeId: 'file-node-789',
        nodeName: 'file-host',
        defaultBackend: 'codex',
        projects: [
          {
            id: 'proj-1',
            name: 'Projet Config',
            path: testDir,
          },
        ],
      })
    );

    const config = resolveDesktopConfig({ config: configFile }, {}, testDir);

    assert.equal(config.nodeId, 'file-node-789');
    assert.equal(config.nodeName, 'file-host');
    assert.equal(config.projects.length, 1);
    assert.equal(config.projects[0].id, 'proj-1');
    assert.equal(config.projects[0].name, 'Projet Config');
  });

  test('resolveDesktopConfig rejects missing project', () => {
    assert.throws(() => {
      resolveDesktopConfig({}, { NEXUS_PROJECTS_REGISTRY: isolatedRegistry });
    }, /Aucun projet configuré/);
  });

  test('resolveDesktopConfig rejects non-existent project directory', () => {
    assert.throws(() => {
      resolveDesktopConfig({ project: '/chemin/absolument/invalide/12345' }, {});
    }, /Le chemin du projet n'existe pas/);
  });

  test('resolveDesktopConfig rejects invalid backend', () => {
    assert.throws(() => {
      resolveDesktopConfig({ project: testDir, backend: 'invalid-agent' }, {});
    }, /Backend inconnu/);
  });

  test('loadConfigFile rejects invalid JSON or missing file', () => {
    assert.throws(() => {
      loadConfigFile('/inexistent/file.json');
    }, /Fichier de configuration introuvable/);

    const badFile = join(testDir, 'bad.json');
    writeFileSync(badFile, '{ bad json');
    assert.throws(() => {
      loadConfigFile(badFile);
    }, /Impossible de lire le fichier de configuration/);
  });

  test('DesktopNode starts, validates workspace, and reports status', async () => {
    const config = resolveDesktopConfig({
      project: testDir,
      name: 'Nexus Core Testing',
      nodeId: 'test-node-status',
      nodeName: 'test-host',
      backend: 'codex',
    });

    const node = new DesktopNode(config);
    assert.equal(node.getState(), 'draining');

    const status = await node.start();
    assert.equal(status.state, 'idle');
    assert.equal(status.nodeId, 'test-node-status');
    assert.equal(status.nodeName, 'test-host');
    assert.equal(status.activeProject.name, 'Nexus Core Testing');
    assert.equal(status.activeProject.path, testDir);
    assert.equal(status.activeProject.currentBranch, 'staging');
    assert.equal(status.capabilities.workspaceGuard, true);
    assert.deepEqual(status.capabilities.backends, ['codex', 'antigravity', 'brain']);

    await node.stop();
    assert.equal(node.getState(), 'draining');
  });

  test('DesktopNode generates valid protocol payloads', async () => {
    const config = resolveDesktopConfig({
      project: testDir,
      name: 'Nexus Protocol Payload',
      nodeId: 'node-payload-test',
      nodeName: 'payload-host',
      authToken: 'secret-token-123',
    });

    const node = new DesktopNode(config);
    await node.start();

    const hello = node.createHelloPayload();
    assert.equal(hello.nodeId, 'node-payload-test');
    assert.equal(hello.nodeName, 'payload-host');
    assert.equal(hello.version, '0.4.2');
    assert.equal(hello.authToken, 'secret-token-123');
    assert.equal(hello.projects.length, 1);
    assert.equal(hello.projects[0].name, 'Nexus Protocol Payload');

    const heartbeat = node.createHeartbeatPayload();
    assert.equal(heartbeat.nodeId, 'node-payload-test');
    assert.equal(heartbeat.state, 'idle');
    assert.ok(heartbeat.timestamp > 0);

    const nodeStatus = node.createStatusPayload();
    assert.equal(nodeStatus.nodeId, 'node-payload-test');
    assert.equal(nodeStatus.state, 'idle');
    assert.equal(nodeStatus.activeProject?.name, 'Nexus Protocol Payload');

    await node.stop();
  });

  test('DesktopNode manages multiple projects and active project switching', async () => {
    const subProj1 = join(testDir, 'sub1');
    const subProj2 = join(testDir, 'sub2');
    mkdirSync(subProj1, { recursive: true });
    mkdirSync(subProj2, { recursive: true });

    const node = new DesktopNode({
      nodeId: 'multi-node',
      nodeName: 'multi-host',
      projects: [
        { id: 'sub1', name: 'Sous Projet 1', path: subProj1 },
        { id: 'sub2', name: 'Sous Projet 2', path: subProj2 },
      ],
    });

    await node.start();
    assert.equal(node.getProjects().length, 2);
    assert.equal(node.getActiveProject().id, 'sub1');

    node.setActiveProject('sub2');
    assert.equal(node.getActiveProject().id, 'sub2');

    assert.throws(() => {
      node.setActiveProject('nonexistent');
    }, /Projet inconnu/);

    await node.stop();
  });

  test('DesktopNode executes Brain conversation with injected mock model', async () => {
    const mockBrainModel: BrainModel = {
      decide: async () => ({
        action: 'reply',
        text: 'Réponse autonome du Brain Desktop',
      }),
    };

    const node = new DesktopNode(
      {
        nodeId: 'brain-node',
        nodeName: 'brain-host',
        projects: [{ id: 'cwd', name: 'cwd', path: testDir }],
      },
      {
        brainModel: mockBrainModel,
      }
    );

    await node.start();

    const response = await node.executeBrain('Bonjour', new AbortController().signal);
    assert.equal(response, 'Réponse autonome du Brain Desktop');
    assert.equal(node.getState(), 'idle');

    // Also test executeTask with 'brain'
    const taskResult = await node.executeTask('brain', 'Autre message');
    assert.equal(taskResult.text, 'Réponse autonome du Brain Desktop');
    assert.equal(taskResult.projectId, 'cwd');

    await node.stop();
  });

  test('DesktopNode prevents concurrent task execution when busy', async () => {
    let resolveTurn!: () => void;
    const pendingPromise = new Promise<void>((r) => {
      resolveTurn = r;
    });

    const mockBrainModel: BrainModel = {
      decide: async () => {
        await pendingPromise;
        return { action: 'reply', text: 'Fin tâche' };
      },
    };

    const node = new DesktopNode(
      {
        nodeId: 'busy-test',
        projects: [{ id: 'p', name: 'p', path: testDir }],
      },
      {
        brainModel: mockBrainModel,
      }
    );

    await node.start();

    const firstTask = node.executeBrain('Tâche 1', new AbortController().signal);
    assert.equal(node.getState(), 'busy');

    await assert.rejects(
      node.executeBrain('Tâche 2', new AbortController().signal),
      /occupé par une autre tâche/
    );

    resolveTurn();
    await firstTask;
    assert.equal(node.getState(), 'idle');

    await node.stop();
  });

  test('DesktopNode rejects execution when stopped', async () => {
    const node = new DesktopNode({
      nodeId: 'stop-node',
      projects: [{ id: 'p', name: 'p', path: testDir }],
    });

    await assert.rejects(node.executeTask('brain', 'Test'), /DesktopNode non démarré/);
  });

  test('CLI entrypoint handles --help and --version', async () => {
    const helpCode = await runCli(['--help']);
    assert.equal(helpCode, 0);

    const versionCode = await runCli(['--version']);
    assert.equal(versionCode, 0);
  });

  test('CLI entrypoint handles status command with valid project', async () => {
    const statusCode = await runCli(['status', '--project', testDir]);
    assert.equal(statusCode, 0);
  });

  test('CLI entrypoint handles memory command', async () => {
    const memoryCode = await runCli(['memory', 'show', '--project', testDir]);
    assert.equal(memoryCode, 0);

    const addCode = await runCli([
      'memory',
      'add',
      'TestDec',
      'Corps de la décision',
      '--project',
      testDir,
    ]);
    assert.equal(addCode, 0);

    const clearCode = await runCli(['memory', 'clear', '--project', testDir]);
    assert.equal(clearCode, 0);
  });

  test('CLI entrypoint reports error with invalid arguments', async () => {
    const badCode = await runCli(['--invalid-flag-1234']);
    assert.equal(badCode, 1);
  });

  test('afterAll cleanup test dir', () => {
    if (originalRegistryEnv !== undefined) {
      process.env.NEXUS_PROJECTS_REGISTRY = originalRegistryEnv;
    } else {
      delete process.env.NEXUS_PROJECTS_REGISTRY;
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
