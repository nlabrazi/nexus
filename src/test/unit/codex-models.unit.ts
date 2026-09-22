import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { CodexClient } from '../../codex/client';
import { CodexService } from '../../codex/service';
import { WorkspaceModelPreferences } from '../../codex/model-preferences';
import { ModelSelection } from '../../codex/types';
import { FakeProcess } from './codex-process';
import { deferred, flush } from './helpers';

function setup(t: TestContext) {
  const child = new FakeProcess();
  const spawn = t.mock.method(childProcess, 'spawn', () => child);
  const client = new CodexClient();
  t.after(() => client.stop());
  const calls = (method: string) => child.written.filter((message) => message.method === method);
  return { child, client, spawn, calls };
}

suite('Codex model catalog and selection', () => {
  test('loads every catalog page, filters hidden entries and rejects cursor loops', async (t) => {
    const { child, client, calls } = setup(t);
    await client.start();
    child.blockedMethods.add('model/list');
    const models = client.listModels();
    child.receive({
      id: calls('model/list')[0].id,
      result: { data: child.models, nextCursor: 'next' },
    });
    await flush();
    assert.deepEqual(calls('model/list')[1].params, {
      limit: 100,
      includeHidden: false,
      cursor: 'next',
    });
    child.receive({
      id: calls('model/list')[1].id,
      result: {
        data: [
          { ...child.models[0], id: 'second', model: 'second' },
          { ...child.models[0], model: 'hidden', hidden: true },
        ],
        nextCursor: null,
      },
    });
    assert.deepEqual(
      (await models).map((model) => model.model),
      ['test-model', 'second']
    );
    const invalid = client.listModels();
    const failure = assert.rejects(invalid, { code: 'protocol_error' });
    child.receive({ id: calls('model/list')[2].id, result: { data: [], nextCursor: 'same' } });
    await flush();
    child.receive({ id: calls('model/list')[3].id, result: { data: [], nextCursor: 'same' } });
    await failure;
    assert.equal(calls('turn/start').length, 0);
  });

  test('rejects malformed model data and surfaces RPC failures without inventing models', async (t) => {
    const { child, client, calls } = setup(t);
    await client.start();
    child.blockedMethods.add('model/list');
    const pending = client.listModels();
    const failure = assert.rejects(pending, { code: 'protocol_error' });
    child.receive({ id: calls('model/list')[0].id, result: { data: [{ id: 'unknown' }] } });
    await failure;
    const denied = client.listModels();
    const rejected = assert.rejects(denied, { code: 'rpc_failed' });
    child.receive({
      id: calls('model/list')[1].id,
      error: { code: -32601, message: 'Unsupported' },
    });
    await rejected;
  });

  test('model choice is persisted per workspace and sent to session and turn RPCs only on explicit work', async (t) => {
    const { child, calls } = setup(t);
    const storage = new Map<string, unknown>();
    const preferences = new WorkspaceModelPreferences({
      get: (key) => storage.get(key),
      update: async (key, value) => {
        storage.set(key, value);
      },
    });
    const service = new CodexService(undefined, undefined, undefined, preferences);
    t.after(() => service.stop());
    const menu = await service.listModels('/project');
    assert.equal(service.getCurrentSessionId(), undefined);
    assert.equal(calls('thread/start').length, 0);
    const selection = { model: 'test-model', effort: 'low' };
    await service.selectModel('/project', selection, menu.context);
    assert.deepEqual(preferences.load(), selection);
    assert.deepEqual(service.getStatus().modelSelection, selection);
    assert.equal(
      service.getStatus().model,
      undefined,
      'pending choice is not an acknowledged session model'
    );
    assert.equal(calls('turn/start').length, 0);
    await service.startSession('/project');
    assert.deepEqual((calls('thread/start')[0].params as { config: unknown }).config, {
      model_reasoning_effort: 'low',
    });
    const turn = service.sendPrompt('hello');
    await flush();
    assert.equal((calls('turn/start')[0].params as { model: string }).model, 'test-model');
    assert.equal((calls('turn/start')[0].params as { effort: string }).effort, 'low');
    assert.equal(service.getStatus().model, 'test-model');
    assert.equal(service.getStatus().reasoningEffort, 'low');
    child.complete();
    await turn;
    const reloaded = new CodexService(undefined, undefined, undefined, preferences);
    t.after(() => reloaded.stop());
    assert.deepEqual(reloaded.getStatus().modelSelection, selection);
    await reloaded.resumeSession('/project', 'thread');
    assert.equal((calls('thread/resume')[0].params as { model: string }).model, 'test-model');
    assert.deepEqual((calls('thread/resume')[0].params as { config: unknown }).config, {
      model_reasoning_effort: 'low',
    });
  });

  test('rejects stale workspace/session menus, unavailable models and unsupported efforts', async (t) => {
    setup(t);
    const service = new CodexService();
    t.after(() => service.stop());
    const menu = await service.listModels('/project');
    await assert.rejects(
      service.selectModel('/other', { model: 'test-model', effort: 'low' }, menu.context),
      /contexte/
    );
    await assert.rejects(
      service.selectModel('/project', { model: 'missing', effort: 'low' }, menu.context),
      /plus disponible/
    );
    await assert.rejects(
      service.selectModel('/project', { model: 'test-model', effort: 'invented' }, menu.context),
      /plus disponible/
    );
    await service.newSession('/project');
    await assert.rejects(
      service.selectModel('/project', { model: 'test-model', effort: 'low' }, menu.context),
      /contexte/
    );
    assert.equal(service.getStatus().modelSelection, undefined);
  });

  test('a pending model save excludes turns, sessions, branch operations and duplicate selections', async (t) => {
    setup(t);
    const saved = deferred<void>();
    const service = new CodexService(undefined, undefined, undefined, {
      load: () => undefined,
      save: () => saved.promise,
    });
    t.after(() => service.stop());
    const menu = await service.listModels('/project');
    const selection: ModelSelection = { model: 'test-model', effort: 'low' };
    const pending = service.selectModel('/project', selection, menu.context);
    await flush();
    assert.equal(service.getStatus().modelChanging, true);
    await assert.rejects(service.newSession('/project'), /changement de modèle/);
    await assert.rejects(service.sendPrompt('hi', '/project'), /already running/);
    await assert.rejects(
      service.withWorkspaceOperation(async () => ''),
      /opération Git ou Codex/
    );
    await assert.rejects(
      service.selectModel('/project', selection, menu.context),
      /opération Git ou Codex/
    );
    saved.resolve();
    await pending;
    assert.equal(service.getStatus().modelChanging, undefined);
  });

  test('a failed save preserves the previous choice and releases the lock', async (t) => {
    setup(t);
    const previous = { model: 'test-model', effort: 'medium' };
    const service = new CodexService(undefined, undefined, undefined, {
      load: () => previous,
      save: async () => {
        throw new Error('Storage unavailable');
      },
    });
    t.after(() => service.stop());
    const menu = await service.listModels('/project');
    await assert.rejects(
      service.selectModel('/project', { model: 'test-model', effort: 'low' }, menu.context),
      /Storage/
    );
    assert.deepEqual(service.getStatus().modelSelection, previous);
    await service.newSession('/project');
  });

  test('cannot select during a turn or apply a menu after stopping a pending catalog read', async (t) => {
    const { child, calls } = setup(t);
    const service = new CodexService();
    t.after(() => service.stop());
    await service.startSession('/project');
    const menu = await service.listModels('/project');
    const turn = service.sendPrompt('hello');
    await assert.rejects(
      service.selectModel('/project', { model: 'test-model', effort: 'low' }, menu.context),
      /opération Git ou Codex/
    );
    await flush();
    child.complete();
    await turn;
    child.blockedMethods.add('model/list');
    const pending = service.selectModel(
      '/project',
      { model: 'test-model', effort: 'low' },
      menu.context
    );
    const failure = assert.rejects(pending, /arrêté/);
    await flush();
    const id = calls('model/list').at(-1)!.id;
    service.stop();
    child.receive({ id, result: { data: child.models, nextCursor: null } });
    await failure;
    assert.equal(service.getStatus().modelSelection, undefined);
  });
});
