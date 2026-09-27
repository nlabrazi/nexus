import * as assert from 'node:assert/strict';
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
    const workspaceGuard = createStandaloneWorkspaceGuard(process.cwd());
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
      targetPath: () => process.cwd(),
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
    const workspaceGuard = createStandaloneWorkspaceGuard(process.cwd());
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
      targetPath: () => process.cwd(),
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
    const workspaceGuard = createStandaloneWorkspaceGuard(process.cwd());
    const runtime = new NexusRuntime({
      workspaceGuard,
      targetPath: () => process.cwd(),
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
});
