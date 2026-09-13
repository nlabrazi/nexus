import type { CodexServiceStatus } from '../codex/types';

export interface NexusStatusSnapshot {
  workspace?: { name: string; path: string };
  workspaceCount: number;
  codex?: CodexServiceStatus;
}

export function formatTelegramStatus(
  snapshot: NexusStatusSnapshot,
  remotePromptRunning: boolean,
  now = Date.now()
): string {
  const { workspace, workspaceCount, codex } = snapshot;
  const lines = [
    '📍 Nexus — statut',
    `Workspace ciblé : ${workspace?.name ?? 'aucun'}`,
  ];
  if (workspace) {
    lines.push(`Chemin : ${workspace.path}`);
  }
  if (workspaceCount > 1) {
    lines.push(`Dossiers ouverts : ${workspaceCount} (le premier est ciblé)`);
  }
  lines.push('Telegram : connecté et appairé');
  lines.push(`Requête Telegram : ${remotePromptRunning ? 'en cours' : 'aucune'}`);

  if (!codex) {
    lines.push('Codex : service indisponible');
    return lines.join('\n');
  }
  lines.push(`Processus Codex : ${codex.processRunning ? 'lancé' : 'arrêté'}`);
  if (codex.sessionId) {
    lines.push(`Session Codex : ${codex.processRunning ? 'active' : 'indisponible (processus arrêté)'}`);
    lines.push(`ID session : ${codex.sessionId}`);
  } else {
    lines.push('Session Codex : aucune');
  }
  if (codex.workspacePath) {
    lines.push(`Workspace de la session : ${codex.workspacePath}`);
    if (codex.workspacePath !== workspace?.path) {
      lines.push('⚠️ Le workspace de la session diffère du workspace ciblé.');
    }
  }

  if (codex.turn) {
    const elapsed = Math.max(0, Math.floor((now - codex.turn.startedAt) / 1000));
    const activity = codex.pendingApprovals > 0 ? 'en attente d’approbation'
      : codex.turn.id ? 'en cours' : 'démarrage';
    lines.push(`Turn : ${activity} (${elapsed} s)`);
    if (codex.turn.id) {
      lines.push(`ID turn : ${codex.turn.id}`);
    }
  } else {
    lines.push('Turn : aucun en cours');
  }
  lines.push(`Approbations en attente : ${codex.pendingApprovals}`);
  return lines.join('\n');
}
