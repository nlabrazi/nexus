import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDiagnostics } from '../../diagnostics/status';
import { TelegramService } from '../../telegram/service';
import { context, FakeTelegram, flush } from './helpers';

test('diagnostics distinguish configuration, running processes and unknown remote agents', () => {
  const options = { telegram: 'non configuré', logsAvailable: false };
  const report = formatDiagnostics(
    {
      workspaceCount: 0,
      brain: { provider: 'ollama', model: 'local' },
      codex: { processRunning: false, pendingApprovals: 0 },
    },
    options
  );
  assert.match(report, /Codex : arrêté/);
  assert.match(report, /disponibilité non vérifiée/);
  assert.match(report, /TTS : indisponible/);
  assert.match(report, /Dernière erreur locale : aucune/);
  const remote = formatDiagnostics(
    {
      workspaceCount: 0,
      core: { uptimeSeconds: 1, onlineNodes: 1, totalNodes: 1, activeTasks: 0, nodes: [] },
      codex: { processRunning: true, pendingApprovals: 0 },
    },
    options
  );
  assert.match(remote, /Codex : état distant non vérifié/);
});

test('Telegram diagnostics respect pairing and deliver the compact report', async (t) => {
  const client = new FakeTelegram();
  let calls = 0;
  const service = new TelegramService(context(), client, {
    getStatus: async () => {
      calls++;
      return { workspaceCount: 0 };
    },
  });
  const polling = service.start();
  t.after(async () => {
    await service.stop();
    await polling;
  });
  client.push({
    update_id: 1,
    message: { text: '/diagnostics', from: { id: 99 }, chat: { id: 20, type: 'private' } },
  });
  await flush();
  assert.equal(calls, 0);
  client.push({
    update_id: 2,
    message: { text: '/diagnostics', from: { id: 10 }, chat: { id: 20, type: 'private' } },
  });
  await flush();
  assert.equal(calls, 1);
  assert.ok(
    client.messages.some(
      (message) => message.includes('Nexus : ON') && message.includes('Logs persistants')
    )
  );
});
