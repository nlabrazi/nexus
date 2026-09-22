import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('node:child_process');
import { CodexClient } from '../../codex/client';
import { TurnTimeoutRequest } from '../../codex/types';
import { AntigravityClient } from '../../antigravity/client';
import { FakeProcess } from './codex-process';
import { FakeAntigravityProcess } from './antigravity-process';
import { deferred, flush } from './helpers';

suite('Agent turn timeout continuation integration', () => {
  suite('Codex timeout continuation', () => {
    test('extends turn when turnTimeoutHandler returns true', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const child = new FakeProcess();
      t.mock.method(childProcess, 'spawn', () => child);

      const timeoutRequests: TurnTimeoutRequest[] = [];
      const client = new CodexClient(undefined, {
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (req) => {
          timeoutRequests.push(req);
          return true;
        },
      });
      t.after(() => client.stop());
      await client.start();

      const turnPromise = client.runTurn('thread', 'Do something long');
      await flush();

      // First timeout at 10s
      t.mock.timers.tick(10_000);
      await flush();

      assert.equal(timeoutRequests.length, 1);
      assert.equal(timeoutRequests[0].agentName, 'Codex');
      assert.equal(timeoutRequests[0].elapsedSeconds, 10);

      // Still running, another 5s
      t.mock.timers.tick(5_000);
      await flush();

      // Process completes successfully before second timeout
      child.complete();
      const result = await turnPromise;
      assert.equal(result, 'Done');
    });

    test('interrupts turn when turnTimeoutHandler returns false', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const child = new FakeProcess();
      t.mock.method(childProcess, 'spawn', () => child);

      const timeoutRequests: TurnTimeoutRequest[] = [];
      const client = new CodexClient(undefined, {
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (req) => {
          timeoutRequests.push(req);
          return false;
        },
      });
      t.after(() => client.stop());
      await client.start();

      const turnPromise = client.runTurn('thread', 'Do something long');
      const rejected = assert.rejects(turnPromise, {
        name: 'CodexError',
        code: 'turn_timeout',
      });
      await flush();

      t.mock.timers.tick(10_000);
      await flush();

      // Should attempt interrupt
      assert.equal(timeoutRequests.length, 1);
      // Wait for interrupt timeout
      t.mock.timers.tick(5_000);
      await rejected;
    });

    test('aborts prompt signal if turn completes while continuation prompt is pending', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const child = new FakeProcess();
      t.mock.method(childProcess, 'spawn', () => child);

      let promptSignal!: AbortSignal;
      const pendingPrompt = deferred<boolean>();
      const client = new CodexClient(undefined, {
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (_req, signal) => {
          promptSignal = signal;
          return pendingPrompt.promise;
        },
      });
      t.after(() => client.stop());
      await client.start();

      const turnPromise = client.runTurn('thread', 'Fast completion');
      await flush();

      // Trigger timeout prompt
      t.mock.timers.tick(10_000);
      await flush();

      assert.equal(promptSignal.aborted, false);

      // Child completes before user answers prompt
      child.complete();
      const result = await turnPromise;
      assert.equal(result, 'Done');
      assert.equal(promptSignal.aborted, true);
    });
  });

  suite('Antigravity timeout continuation', () => {
    test('extends turn when turnTimeoutHandler returns true', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      let spawned: FakeAntigravityProcess | undefined;
      t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
        spawned = new FakeAntigravityProcess(args);
        return spawned;
      });

      const timeoutRequests: TurnTimeoutRequest[] = [];
      const client = new AntigravityClient({
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (req) => {
          timeoutRequests.push(req);
          return true;
        },
      });
      t.after(() => client.stop());

      const convId = await client.start({ cwd: '/workspace' });
      const turnPromise = client.runTurn(convId, 'Long query');
      await flush();

      // First timeout at 10s
      t.mock.timers.tick(10_000);
      await flush();

      assert.equal(timeoutRequests.length, 1);
      assert.equal(timeoutRequests[0].agentName, 'Antigravity');
      assert.equal(timeoutRequests[0].elapsedSeconds, 10);
      assert.equal(spawned?.kills, 0);

      // Antigravity completes
      spawned?.complete('Finished after extension');
      const result = await turnPromise;
      assert.equal(result, 'Finished after extension');
    });

    test('interrupts turn when turnTimeoutHandler returns false', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      let spawned: FakeAntigravityProcess | undefined;
      t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
        spawned = new FakeAntigravityProcess(args);
        return spawned;
      });

      const timeoutRequests: TurnTimeoutRequest[] = [];
      const client = new AntigravityClient({
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (req) => {
          timeoutRequests.push(req);
          return false;
        },
      });
      t.after(() => client.stop());

      const convId = await client.start({ cwd: '/workspace' });
      const turnPromise = client.runTurn(convId, 'Doomed query');
      const rejected = assert.rejects(turnPromise, {
        name: 'AntigravityError',
        code: 'turn_timeout',
      });
      await flush();

      t.mock.timers.tick(10_000);
      await flush();

      assert.equal(timeoutRequests.length, 1);
      // Soft kill first
      assert.equal(spawned?.kills, 1);

      // Force disconnect after 5s
      t.mock.timers.tick(5_000);
      await rejected;
    });

    test('aborts prompt signal if turn completes while continuation prompt is pending', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      let spawned: FakeAntigravityProcess | undefined;
      t.mock.method(childProcess, 'spawn', (_cmd: string, args: string[]) => {
        spawned = new FakeAntigravityProcess(args);
        return spawned;
      });

      let promptSignal!: AbortSignal;
      const pendingPrompt = deferred<boolean>();
      const client = new AntigravityClient({
        turnTimeoutMs: 10_000,
        turnTimeoutHandler: async (_req, signal) => {
          promptSignal = signal;
          return pendingPrompt.promise;
        },
      });
      t.after(() => client.stop());

      const convId = await client.start({ cwd: '/workspace' });
      const turnPromise = client.runTurn(convId, 'Fast completion');
      await flush();

      t.mock.timers.tick(10_000);
      await flush();

      assert.equal(promptSignal.aborted, false);

      spawned?.complete('Antigravity finished');
      const result = await turnPromise;
      assert.equal(result, 'Antigravity finished');
      assert.equal(promptSignal.aborted, true);
    });
  });
});
