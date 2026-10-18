import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDiagnostics } from '../../diagnostics/status';

test('diagnostics distinguish configuration, running processes and unknown remote agents', () => {
  const options = { logsAvailable: false };
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
