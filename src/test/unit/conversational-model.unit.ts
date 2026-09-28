import * as assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { suite, test } from 'node:test';
import { CodexClient } from '../../codex/client';
import { CodexBrainModel } from '../../conversational/codex-model';
import { deferred, flush } from './helpers';

suite('Codex Brain model adapter', () => {
  test('uses a temporary context, developer instructions and a constrained output schema', async (t) => {
    let directory = '';
    t.mock.method(CodexClient.prototype, 'start', async () => {});
    t.mock.method(
      CodexClient.prototype,
      'startSession',
      async (cwd: string, _selection: unknown, instructions: string) => {
        directory = cwd;
        assert.match(instructions, /Nexus Brain/);
        assert.match(instructions, /consentement/);
        return { thread: { id: 'brain', cwd } };
      }
    );
    t.mock.method(
      CodexClient.prototype,
      'runTurn',
      async (
        id: string,
        prompt: string,
        _files: unknown,
        _selection: unknown,
        schema: { additionalProperties: boolean }
      ) => {
        assert.equal(id, 'brain');
        assert.equal(JSON.parse(prompt).messages[0].text, 'Bonjour');
        assert.equal(schema.additionalProperties, false);
        return JSON.stringify({ action: 'reply', text: 'Bonjour !' });
      }
    );
    const stop = t.mock.method(CodexClient.prototype, 'stop', () => {});
    const result = await new CodexBrainModel().decide(
      [{ role: 'user', text: 'Bonjour' }],
      undefined,
      true,
      new AbortController().signal
    );
    assert.deepEqual(result, { action: 'reply', text: 'Bonjour !' });
    assert.match(directory, /nexus-brain-/);
    await assert.rejects(access(directory), { code: 'ENOENT' });
    assert.equal(stop.mock.callCount(), 1);
  });

  for (const response of [
    'not json',
    '{"action":"shell","text":"run"}',
    '{"action":"reply","text":""}',
    '{"action":"reply","text":"OK","approved":true}',
  ]) {
    test(`rejects malformed or expanded model output: ${response}`, async (t) => {
      t.mock.method(CodexClient.prototype, 'start', async () => {});
      t.mock.method(CodexClient.prototype, 'startSession', async () => ({
        thread: { id: 'brain' },
      }));
      t.mock.method(CodexClient.prototype, 'runTurn', async () => response);
      const stop = t.mock.method(CodexClient.prototype, 'stop', () => {});
      await assert.rejects(
        new CodexBrainModel().decide([], undefined, false, new AbortController().signal)
      );
      assert.equal(stop.mock.callCount(), 1);
    });
  }

  test('a pre-aborted decision never launches Codex', async (t) => {
    const start = t.mock.method(CodexClient.prototype, 'start', async () =>
      assert.fail('No launch')
    );
    await assert.rejects(new CodexBrainModel().decide([], undefined, false, AbortSignal.abort()), {
      name: 'AbortError',
    });
    assert.equal(start.mock.callCount(), 0);
  });

  test('cancellation after startup prevents session creation', async (t) => {
    const starting = deferred<void>();
    const entered = deferred<void>();
    t.mock.method(CodexClient.prototype, 'start', async () => {
      entered.resolve();
      return starting.promise;
    });
    const session = t.mock.method(CodexClient.prototype, 'startSession', async () =>
      assert.fail('No session')
    );
    const stop = t.mock.method(CodexClient.prototype, 'stop', () => {});
    const controller = new AbortController();
    const result = new CodexBrainModel().decide([], undefined, false, controller.signal);
    const failure = assert.rejects(result, { name: 'AbortError' });
    await entered.promise;
    controller.abort();
    starting.resolve();
    await failure;
    await flush();
    assert.equal(session.mock.callCount(), 0);
    assert.ok(stop.mock.callCount() >= 1);
  });
});
