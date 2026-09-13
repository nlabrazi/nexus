import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import childProcess = require('child_process');
import { CodexService } from '../../codex/service';
import { TelegramService } from '../../telegram/service';
import { formatFileSummary } from '../../telegram/file-summary';
import { formatTelegramResponse } from '../../telegram/formatting';
import { FakeProcess } from './codex-process';
import { context, FakeTelegram, flush } from './helpers';

suite('File summaries', () => {
  test('omits empty summaries and keeps literal paths, relative paths and emoji intact', () => {
    assert.equal(formatFileSummary([], '/project'), undefined);
    const summary = formatFileSummary(['/project/src/[demo]*.ts', '/elsewhere/file', 'emoji😀.ts', 'line\nbreak'], '/project')!;
    const rendered = formatTelegramResponse(summary);
    assert.equal(rendered.length, 1);
    assert.match(rendered[0].text, /• src\/\[demo\]\*\.ts/);
    assert.match(rendered[0].text, /• \/elsewhere\/file/);
    assert.match(rendered[0].text, /emoji😀\.ts/);
    assert.match(rendered[0].text, /line\\nbreak/);
    assert.deepEqual(rendered[0].entities?.map(entity => entity.type), ['bold']);
  });

  test('deduplicates paths and bounds large summaries without breaking surrogate pairs', () => {
    const files = Array.from({ length: 15 }, (_, i) => `${i}-${'😀'.repeat(200)}.ts`);
    const summary = formatFileSummary([...files, files[0]], '/project')!;
    const rendered = formatTelegramResponse(summary);
    assert.equal(rendered.length, 1);
    assert.match(rendered[0].text, /\(15\)/);
    assert.match(rendered[0].text, /et 5 autre/);
    assert.doesNotMatch(rendered[0].text, /[\uD800-\uDFFF]/u);
    assert.ok(rendered[0].text.length < 4000);
  });

  test('tracks only completed changes in the active turn and clears them for the next prompt', async t => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const service = new CodexService();
    t.after(() => service.stop());
    let files: readonly string[] = [];
    const pending = service.sendPrompt('edit', '/project', paths => { files = paths; });
    await flush();
    const event = (id: string, status: string, path: string, method = 'item/completed', turnId = 'turn') => child.receive({
      method, params: { threadId: 'thread', turnId, item: { id, type: 'fileChange', status, changes: [{ path }] } },
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
    const next = service.sendPrompt('just answer', '/project', paths => { files = paths; });
    await flush();
    child.complete();
    await next;
    assert.deepEqual(files, []);
  });

  test('accepts authoritative terminal items and does not emit a success summary on failure', async t => {
    const child = new FakeProcess();
    t.mock.method(childProcess, 'spawn', () => child);
    const service = new CodexService();
    t.after(() => service.stop());
    let files: readonly string[] = [];
    const pending = service.sendPrompt('edit', '/project', paths => { files = paths; });
    await flush();
    child.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed', items: [
      { id: 'edit', type: 'fileChange', status: 'completed', changes: [{ path: 'terminal.ts' }] },
      { id: 'answer', type: 'agentMessage', text: 'Done', phase: 'final_answer' },
    ] } } });
    await pending;
    assert.deepEqual(files, ['terminal.ts']);
    const failed = service.sendPrompt('edit again', '/project', () => assert.fail('no success summary'));
    const rejected = assert.rejects(failed, { code: 'turn_failed' });
    await flush();
    child.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'failed' } } });
    await rejected;
  });

  test('Telegram delivers the answer followed by a separate formatted summary', async t => {
    const client = new FakeTelegram();
    const service = new TelegramService(context(), client, async () => ({ text: 'Done', fileSummary: '📄 **Fichiers**\n• demo.ts' }));
    const polling = service.start();
    t.after(async () => { service.stop(); await polling; });
    client.push({ update_id: 1, message: { text: '/codex edit', from: { id: 10 }, chat: { id: 20, type: 'private' } } });
    await flush();
    assert.deepEqual(client.messages.slice(1), ['Done', '📄 **Fichiers**\n• demo.ts']);
  });
});
