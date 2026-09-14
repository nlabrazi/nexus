import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { AntigravityClient } from '../../antigravity/client';
import { WorkspaceAntigravityModelPreferences } from '../../antigravity/model-preferences';

suite('Antigravity models and preferences', () => {
  test('persists and reloads model preferences', async () => {
    const memory = new Map<string, unknown>();
    const storage = {
      get: (key: string) => memory.get(key),
      update: async (key: string, value: unknown) => {
        memory.set(key, value);
      },
    };

    const prefs = new WorkspaceAntigravityModelPreferences(storage);
    assert.equal(prefs.load(), undefined);

    await prefs.save({ model: 'gemini-3.8-flash-high', effort: 'high' });
    assert.deepEqual(prefs.load(), { model: 'gemini-3.8-flash-high', effort: 'high' });
  });

  test('listModels invokes agy models and parses output', async t => {
    t.mock.method(childProcess, 'execFile', (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(null, `gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.1-pro-high       Gemini 3.1 Pro (High)`);
    });

    const client = new AntigravityClient();
    const models = await client.listModels();
    assert.equal(models.length, 2);
    assert.equal(models[0].model, 'gemini-3.8-flash-high');
    assert.equal(models[1].model, 'gemini-3.1-pro-high');
  });

  test('listModels handles error gracefully', async t => {
    t.mock.method(childProcess, 'execFile', (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
      cb(new Error('command failed: agy models'), '');
    });

    const client = new AntigravityClient();
    await assert.rejects(client.listModels(), {
      name: 'AntigravityError',
      code: 'protocol_error',
    });
  });
});
