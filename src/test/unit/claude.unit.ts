import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess = require('node:child_process');
import { ClaudeCodeService } from '../../claude/service';
import { ClaudeCodeClient } from '../../claude/client';

class FakeClaudeProcess extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin = new PassThrough();
  public killed = false;

  public kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe('Claude Code Integration', () => {
  it('instantiates client and reports available status', () => {
    const client = new ClaudeCodeClient();
    const status = client.getStatus();
    assert.equal(status.available, true);
    assert.ok(status.binaryPath);
  });

  it('lists default models for Claude Code', async () => {
    const service = new ClaudeCodeService();
    const models = await service.listModels();
    assert.ok(models.length >= 3);
    assert.equal(models[0].id, 'claude-sonnet-4-6');
    assert.equal(models[0].isDefault, true);
    assert.ok(models.some((m) => m.id === 'claude-opus-4-6'));
    assert.ok(models.some((m) => m.id === 'claude-haiku-4-5'));
  });

  it('handles unauthenticated or missing credentials cleanly without throwing', async (t) => {
    t.mock.method(childProcess, 'spawn', () => {
      const proc = new FakeClaudeProcess();
      queueMicrotask(() => {
        proc.stdout.write(
          `${JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
            },
            error: 'authentication_failed',
          })}\n`
        );
        proc.emit('close', 1);
      });
      return proc as unknown as childProcess.ChildProcessWithoutNullStreams;
    });

    const service = new ClaudeCodeService({ binaryPath: 'claude' });
    const result = await service.sendPrompt('ping test', process.cwd());
    assert.ok(result);
    assert.ok(
      result.includes("Claude Code n'est pas authentifié") ||
        result.includes('Not logged in') ||
        result.includes('claude login')
    );
  });
});
