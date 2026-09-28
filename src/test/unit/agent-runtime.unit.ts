import { RoutedBrainModel } from '../../conversational/routed-model';
import { OllamaBrainModel } from '../../conversational/ollama-model';
import * as assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import {
  NexusRuntime,
  createStandaloneWorkspaceGuard,
  MemoryStorage,
  RuntimeApprovalRequest,
} from '../../runtime';
import { BrainModel } from '../../conversational/model';

suite('NexusRuntime isolated agent runtime', () => {
  const mockPath = '/home/user/project';
  const testDir = join(tmpdir(), 'nexus-agent-runtime-unit-test');

  test('beforeEach setup test dir', () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    execSync(
      'git init -b staging && git config user.name "Test" && git config user.email "test@example.com" && git commit --allow-empty -m "initial"',
      { cwd: testDir }
    );
  });

  test('initializes with standalone workspace guard and memory storage', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(mockPath, {
      protectedBranches: ['main', 'master'],
      trusted: true,
    });

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => mockPath,
      defaultBackend: 'codex',
    });

    assert.equal(runtime.getActiveBackend(), 'codex');
    runtime.setActiveBackend('antigravity');
    assert.equal(runtime.getActiveBackend(), 'antigravity');

    assert.equal(runtime.resolveTargetPath(), mockPath);
    assert.ok(runtime.getCodexService());
    assert.ok(runtime.getAntigravityService());
    assert.ok(runtime.getBrainService());
    assert.equal(runtime.getWorkspaceGuard(), workspaceGuard);

    runtime.stop();
  });

  test('MemoryStorage stores, retrieves, and clears key-value pairs', async () => {
    const storage = new MemoryStorage();
    assert.equal(storage.get('nonexistent'), undefined);

    await storage.update('test.key', { count: 42 });
    assert.deepEqual(storage.get('test.key'), { count: 42 });

    await storage.update('test.key', undefined);
    assert.equal(storage.get('test.key'), undefined);

    await storage.update('key1', 'val1');
    await storage.update('key2', 'val2');
    storage.clear();
    assert.equal(storage.get('key1'), undefined);
    assert.equal(storage.get('key2'), undefined);
  });

  test('executes brain conversation with mock model', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(mockPath);

    const mockBrainModel: BrainModel = {
      decide: async () => ({
        action: 'reply',
        text: 'Brain response from isolated runtime',
      }),
    };

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => mockPath,
      brainModel: mockBrainModel,
    });

    const reply = await runtime.executeBrain('Que puis-je faire ?', new AbortController().signal);

    assert.equal(reply, 'Brain response from isolated runtime');

    // Also verify executeTask('brain', ...) delegates to Brain
    const taskResult = await runtime.executeTask('brain', 'Autre question');
    assert.equal(taskResult.text, 'Brain response from isolated runtime');

    runtime.stop();
  });

  test('reports status snapshot without requiring VS Code window', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(mockPath);

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => mockPath,
      defaultBackend: 'codex',
    });

    const status = await runtime.getStatus();
    assert.equal(status.activeBackend, 'codex');
    assert.equal(status.workspace?.name, 'project');
    assert.equal(status.workspace?.path, mockPath);
    assert.equal(status.workspaceCount, 1);
    assert.ok(status.codex !== undefined);
    assert.ok(status.antigravity !== undefined);

    runtime.stop();
  });

  test('cancels current work across both agent backends', () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(mockPath);

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => mockPath,
    });

    // When nothing is running, cancelCurrentWork returns false
    const cancelled = runtime.cancelCurrentWork();
    assert.equal(cancelled, false);

    runtime.stop();
  });

  test('createStandaloneWorkspaceGuard creates trusted guard with default protected branches', () => {
    const guard = createStandaloneWorkspaceGuard('/custom/path');
    assert.equal(guard.targetPath(), '/custom/path');
  });

  test('resolves targetPath following precedence: explicit > supplier > guard', () => {
    const workspaceGuard = createStandaloneWorkspaceGuard('/guard/path');
    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => '/supplier/path',
    });

    assert.equal(runtime.resolveTargetPath('/explicit/path'), '/explicit/path');
    assert.equal(runtime.resolveTargetPath(), '/supplier/path');

    const runtimeNoSupplier = new NexusRuntime({
      workspaceGuard,
    });
    assert.equal(runtimeNoSupplier.resolveTargetPath(), '/guard/path');

    runtime.stop();
    runtimeNoSupplier.stop();
  });

  test('bridges Brain inspection requests to runtime approval handler', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(testDir);
    const approvalRequests: RuntimeApprovalRequest[] = [];

    let calls = 0;
    const mockBrainModel: BrainModel = {
      decide: async () => {
        if (calls++ === 0) {
          return { action: 'inspect_project', text: 'Puis-je analyser la structure ?' };
        }
        return { action: 'reply', text: 'Inspection réussie.' };
      },
    };

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => testDir,
      brainModel: mockBrainModel,
      requestApproval: async (req) => {
        approvalRequests.push(req);
        return 'accept';
      },
    });

    const reply = await runtime.executeBrain('Inspecte le projet', new AbortController().signal);
    assert.equal(reply, 'Inspection réussie.');
    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0].kind, 'inspection');
    assert.equal(approvalRequests[0].agentName, 'Nexus Brain');
    assert.match(approvalRequests[0].details, /Puis-je analyser la structure \?/);

    runtime.stop();
  });

  test('handles Brain inspection refusal when approval handler declines', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(testDir);
    const approvalRequests: RuntimeApprovalRequest[] = [];

    let calls = 0;
    const mockBrainModel: BrainModel = {
      decide: async (messages) => {
        if (calls++ === 0) {
          return { action: 'inspect_project', text: 'Puis-je analyser la structure ?' };
        }
        assert.match(messages.at(-1)!.text, /non autorisée/);
        return { action: 'reply', text: 'Inspection refusée, conversation simple.' };
      },
    };

    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => testDir,
      brainModel: mockBrainModel,
      requestApproval: async (req) => {
        approvalRequests.push(req);
        return 'decline';
      },
    });

    const reply = await runtime.executeBrain('Inspecte le projet', new AbortController().signal);
    assert.equal(reply, 'Inspection refusée, conversation simple.');
    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0].kind, 'inspection');

    runtime.stop();
  });

  test('handles branch list action using standalone workspace guard', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard(testDir);
    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => testDir,
    });

    const listResult = await runtime.handleBranchAction({ type: 'list' });
    assert.match(listResult, /Branches disponibles/);
    assert.match(listResult, /staging/);

    runtime.stop();
  });

  test('getStatus handles targetPath resolution failure gracefully', async () => {
    const workspaceGuard = createStandaloneWorkspaceGuard('/nonexistent');
    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => {
        throw new Error('No workspace configured');
      },
    });

    const status = await runtime.getStatus();
    assert.equal(status.workspace, undefined);
    assert.equal(status.workspaceCount, 0);

    runtime.stop();
  });

  test('listModels and selectModel support brain backend', async () => {
    let configuredModel = 'llama3.2:3b';
    const mockBrainModel: BrainModel & { getModel: () => string; setModel: (m: string) => void } = {
      getModel: () => configuredModel,
      setModel: (m: string) => {
        configuredModel = m;
      },
      decide: async () => ({ action: 'reply', text: 'ok' }),
    };

    const workspaceGuard = createStandaloneWorkspaceGuard(testDir);
    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => testDir,
      brainModel: mockBrainModel,
    });

    const menu = await runtime.listModels('brain');
    assert.ok(menu.models.length > 0);
    assert.equal(menu.selected?.model, 'llama3.2:3b');

    await runtime.selectModel('brain', { model: 'qwen3.6:27b', effort: '' });
    assert.equal(configuredModel, 'qwen3.6:27b');

    runtime.stop();
  });

  test('afterAll cleanup test dir', () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

suite('NexusRuntime cloud Brain integration', () => {
  test('exposes provider selections and executes Brain through the selected cloud adapter', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [] }));
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ action: 'reply', text: 'Réponse cloud' }) } },
          ],
        })
      );
    });
    const runtime = new NexusRuntime({
      workspaceGuard: createStandaloneWorkspaceGuard('/mock/project'),
      targetPath: () => '/mock/project',
      brainModel: new RoutedBrainModel({
        env: { GROQ_API_KEY: 'test-key' },
        ollama: new OllamaBrainModel({ host: 'http://local.test', model: 'local' }),
      }),
    });
    t.after(() => runtime.stop());
    const menu = await runtime.listModels('brain');
    const groq = menu.models.find((m) => m.model.startsWith('groq:'))!;
    assert.ok(groq);
    await runtime.selectModel('brain', { model: groq.model, effort: '' }, menu.context);
    assert.equal((await runtime.listModels('brain')).selected?.model, groq.model);
    assert.equal((await runtime.getStatus()).brain?.provider, 'groq');
    const result = await runtime.executeTask('brain', 'Bonjour');
    assert.equal(result.text, 'Réponse cloud');
  });
});
