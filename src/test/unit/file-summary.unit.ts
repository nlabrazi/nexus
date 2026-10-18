import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('node:child_process');
import { CodexService } from '../../codex/service';
import { formatFileSummary } from '../../runtime/file-summary';
import { FakeProcess } from './codex-process';
import { flush } from './helpers';

suite('File summaries', () => {
  test('omits empty summaries and keeps literal paths, relative paths and emoji intact', () => {
    assert.equal(formatFileSummary([], '/project'), undefined);
    const summary = formatFileSummary(
      ['/project/src/[demo]*.ts', '/elsewhere/file', 'emoji😀.ts', 'line\nbreak'],
      '/project'
    )!;
    assert.ok(summary.includes('• src/\\[demo\\]\\*.ts'));
    assert.ok(summary.includes('• /elsewhere/file'));
    assert.ok(summary.includes('emoji😀.ts'));
    assert.ok(summary.includes('line\\\\nbreak'));
  });

  test('deduplicates paths and bounds large summaries without breaking surrogate pairs', () => {
    const files = Array.from({ length: 15 }, (_, i) => `${i}-${'😀'.repeat(200)}.ts`);
    const summary = formatFileSummary([...files, files[0]], '/project')!;
    assert.match(summary, /\(15\)/);
    assert.match(summary, /et 5 autre/);
    assert.doesNotMatch(summary, /[\uD800-\uDFFF]/u);
  });

  test('tracks only completed changes in the active turn and clears them for the next prompt', async (t) => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const service = new CodexService();
    t.after(() => service.stop());
    let files: readonly string[] = [];
    const pending = service.sendPrompt('edit', '/project', (paths) => {
      files = paths;
    });
    await flush();
    const event = (
      id: string,
      status: string,
      path: string,
      method = 'item/completed',
      turnId = 'turn'
    ) =>
      child.receive({
        method,
        params: {
          threadId: 'thread',
          turnId,
          item: { id, type: 'fileChange', status, changes: [{ path }] },
        },
      });
    event('proposal', 'inProgress', 'proposal.ts', 'item/started');
    event('declined', 'declined', 'declined.ts');
    event('failed', 'failed', 'failed.ts');
    event('old', 'completed', 'old.ts', 'item/completed', 'other-turn');
    event('edit', 'completed', 'done.ts');
    event('edit', 'completed', 'done.ts');
    event('again', 'completed', 'done.ts');
    child.complete();
    assert.equal(await pending, 'Done');
    assert.deepEqual(files, ['done.ts']);
    const next = service.sendPrompt('just answer', '/project', (paths) => {
      files = paths;
    });
    await flush();
    child.complete();
    await next;
    assert.deepEqual(files, []);
  });

  test('accepts authoritative terminal items and does not emit a success summary on failure', async (t) => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const service = new CodexService();
    t.after(() => service.stop());
    let files: readonly string[] = [];
    const pending = service.sendPrompt('edit', '/project', (paths) => {
      files = paths;
    });
    await flush();
    child.receive({
      method: 'turn/completed',
      params: {
        threadId: 'thread',
        turn: {
          id: 'turn',
          status: 'completed',
          items: [
            {
              id: 'edit',
              type: 'fileChange',
              status: 'completed',
              changes: [{ path: 'terminal.ts' }],
            },
            { id: 'answer', type: 'agentMessage', text: 'Done', phase: 'final_answer' },
          ],
        },
      },
    });
    await pending;
    assert.deepEqual(files, ['terminal.ts']);
    const failed = service.sendPrompt('edit again', '/project', () =>
      assert.fail('no success summary')
    );
    const rejected = assert.rejects(failed, { code: 'turn_failed' });
    await flush();
    child.receive({
      method: 'turn/completed',
      params: { threadId: 'thread', turn: { id: 'turn', status: 'failed' } },
    });
    await rejected;
  });
});
