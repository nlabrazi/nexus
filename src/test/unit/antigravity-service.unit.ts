import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('node:child_process');
import { AntigravityService } from '../../antigravity/service';
import { WorkspaceAntigravityModelPreferences } from '../../antigravity/model-preferences';
import { WorkspaceAntigravitySessionPersistence } from '../../antigravity/persistence';
import { flush } from './helpers';
import { FakeAntigravityProcess } from './antigravity-process';

suite('Antigravity service lifecycle and session management', () => {
  test('startSession creates a new session and persists it', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const memory = new Map<string, unknown>();
    const storage = {
      get: (k: string) => memory.get(k),
      update: async (k: string, v: unknown) => {
        memory.set(k, v);
      },
    };
    const persistence = new WorkspaceAntigravitySessionPersistence(storage);

    const service = new AntigravityService(
      async (root) => ({ root, git: { directory: `${root}/.git`, branch: 'main' } }),
      persistence
    );
    t.after(() => service.stop());

    const id = await service.startSession('/workspace');
    assert.equal(id, 'test-conversation-uuid');
    assert.equal(service.getCurrentSessionId(), 'test-conversation-uuid');
    assert.equal(service.isSessionActive(), true);

    const saved = persistence.load();
    assert.equal(saved?.id, 'test-conversation-uuid');
    assert.equal(saved?.workspace.root, '/workspace');
    assert.equal(saved?.workspace.git?.branch, 'main');
  });

  test('newSession forces a new conversation and updates persistence', async (t) => {
    let counter = 0;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      counter++;
      const p = new FakeAntigravityProcess(args);
      p.conversationId = `conversation-${counter}`;
      return p;
    });

    const memory = new Map<string, unknown>();
    const storage = {
      get: (k: string) => memory.get(k),
      update: async (k: string, v: unknown) => {
        memory.set(k, v);
      },
    };
    const persistence = new WorkspaceAntigravitySessionPersistence(storage);

    const service = new AntigravityService(async (root) => ({ root }), persistence);
    t.after(() => service.stop());

    const id1 = await service.startSession('/workspace');
    assert.equal(id1, 'conversation-1');

    const id2 = await service.newSession('/workspace');
    assert.equal(id2, 'conversation-2');
    assert.equal(persistence.load()?.id, 'conversation-2');
  });

  test('sendPrompt executes a prompt through the active session and updates status', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const service = new AntigravityService();
    t.after(() => service.stop());

    const promptPromise = service.sendPrompt('Analyze this project', '/workspace');
    await flush();

    assert.equal(service.isTurnRunning(), true);
    spawned?.complete('Project analysis complete', {
      input_tokens: 300,
      output_tokens: 100,
      thinking_tokens: 40,
      cache_read_tokens: 150,
      total_tokens: 400,
    });

    const reply = await promptPromise;
    assert.equal(reply, 'Project analysis complete');
    assert.equal(service.isTurnRunning(), false);

    const status = service.getStatus();
    assert.equal(status.tokenUsage?.last.totalTokens, 400);
  });

  test('cancelCurrentWork cancels active prompt execution', async (t) => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const service = new AntigravityService();
    t.after(() => service.stop());

    const promptPromise = service.sendPrompt('Long task', '/workspace');
    await flush();

    assert.equal(service.isTurnRunning(), true);
    const cancelled = service.cancelCurrentWork();
    assert.equal(cancelled, true);
    assert.equal(service.isTurnRunning(), false);

    await assert.rejects(promptPromise);
  });

  test('selectModel saves valid model preference from catalog', async (t) => {
    t.mock.method(
      childProcess,
      'execFile',
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void
      ) => {
        cb(
          null,
          `gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.1-pro-high       Gemini 3.1 Pro (High)`
        );
      }
    );

    const memory = new Map<string, unknown>();
    const storage = {
      get: (k: string) => memory.get(k),
      update: async (k: string, v: unknown) => {
        memory.set(k, v);
      },
    };
    const modelPrefs = new WorkspaceAntigravityModelPreferences(storage);

    const service = new AntigravityService(undefined, undefined, modelPrefs);
    t.after(() => service.stop());

    const menu = await service.listModels('/workspace');
    assert.equal(menu.models.length, 2);

    await service.selectModel(
      '/workspace',
      { model: 'gemini-3.8-flash-high', effort: 'high' },
      menu.context
    );

    assert.deepEqual(modelPrefs.load(), {
      model: 'gemini-3.8-flash-high',
      effort: 'high',
    });
  });
});
