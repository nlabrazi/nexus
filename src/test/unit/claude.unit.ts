import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ClaudeCodeService } from '../../claude/service';
import { ClaudeCodeClient } from '../../claude/client';

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
    assert.equal(models[0].id, 'claude-3-7-sonnet');
    assert.equal(models[0].isDefault, true);
    assert.ok(models.some((m) => m.id === 'claude-3-5-sonnet'));
  });

  it('handles unauthenticated or missing credentials cleanly without throwing', async () => {
    const service = new ClaudeCodeService();
    const result = await service.sendPrompt('ping test', process.cwd());
    assert.ok(result);
    // Since user is not logged in, should return friendly instructions
    assert.ok(
      result.includes("Claude Code n'est pas authentifié") ||
        result.includes('Not logged in') ||
        result.includes('claude login')
    );
  });
});
