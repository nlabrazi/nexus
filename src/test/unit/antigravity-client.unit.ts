import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { AntigravityClient } from '../../antigravity/client';
import { flush } from './helpers';
import { FakeAntigravityProcess } from './antigravity-process';

suite('Antigravity client lifecycle and turn execution', () => {
  test('starts process and captures conversation ID from init event', async t => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient({ binaryPath: 'agy', sandbox: true });
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace', conversationId: 'uuid-123' });
    assert.equal(convId, 'uuid-123');
    assert.equal(client.getStatus().processRunning, true);
    assert.equal(spawned?.args.includes('--add-dir'), true);
    assert.equal(spawned?.args.includes('/workspace'), true);
    assert.equal(spawned?.args.includes('--conversation'), true);
    assert.equal(spawned?.args.includes('uuid-123'), true);
  });

  test('runs turn, sends prompt over stdin, tracks file changes, and receives response', async t => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient();
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const changedFiles: string[] = [];

    const turnPromise = client.runTurn(convId, 'Refactor codebase', files => {
      changedFiles.push(...files);
    });

    await flush();
    assert.equal(spawned?.written.length, 1);
    assert.equal(spawned?.written[0].event, 'user');
    assert.equal(spawned?.written[0].message.content, 'Refactor codebase');

    // Simulate tool call editing files
    spawned?.sendTool('replace_file_content', { TargetFile: '/workspace/src/app.ts' });
    spawned?.sendTool('write_to_file', { TargetFile: '/workspace/src/new.ts' });

    // Simulate response completion
    spawned?.complete('Successfully refactored app.ts and created new.ts', {
      input_tokens: 500,
      output_tokens: 150,
      thinking_tokens: 60,
      cache_read_tokens: 200,
      total_tokens: 650,
    });

    const result = await turnPromise;
    assert.equal(result, 'Successfully refactored app.ts and created new.ts');
    assert.deepEqual(changedFiles.sort(), ['/workspace/src/app.ts', '/workspace/src/new.ts'].sort());

    // Verify telemetry
    const telemetry = client.getConversationTelemetry(convId);
    assert.equal(telemetry.tokenUsage?.last.totalTokens, 650);
    assert.equal(telemetry.tokenUsage?.last.inputTokens, 500);
    assert.equal(telemetry.tokenUsage?.last.reasoningOutputTokens, 60);
  });

  test('handles turn failure when result event status is ERROR', async t => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient();
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Do something failing');

    await flush();
    spawned?.fail('Quota exceeded');

    await assert.rejects(turnPromise, {
      name: 'AntigravityError',
      code: 'turn_failed',
    });
  });

  test('handles process crash during turn with process_failed', async t => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient();
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Do crash');

    await flush();
    spawned?.emit('error', new Error('Process segfault'));

    await assert.rejects(turnPromise, {
      name: 'AntigravityError',
      code: 'process_failed',
    });
    assert.equal(client.getStatus().processRunning, false);
  });

  test('rejects turn if response is empty', async t => {
    let spawned: FakeAntigravityProcess | undefined;
    t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
      spawned = new FakeAntigravityProcess(args);
      return spawned;
    });

    const client = new AntigravityClient();
    t.after(() => client.stop());

    const convId = await client.start({ cwd: '/workspace' });
    const turnPromise = client.runTurn(convId, 'Do empty');

    await flush();
    spawned?.complete('   '); // Whitespace only

    await assert.rejects(turnPromise, {
      name: 'AntigravityError',
      code: 'empty_response',
    });
  });
});
