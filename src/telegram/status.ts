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
    '📍 **Nexus — statut**',
    '🟢 Telegram : connecté et appairé',
    '',
    '📁 **Projet**',
    `Workspace ciblé : ${literal(workspace?.name ?? 'aucun')}`,
  ];
  if (workspace) {
    lines.push(`Chemin : ${literal(workspace.path)}`);
  }
  if (workspaceCount > 1) {
    lines.push(`Dossiers ouverts : ${workspaceCount} (le premier est ciblé)`);
  }
  lines.push('', '🤖 **Codex**');

  if (!codex) {
    lines.push('🔴 Codex : service indisponible');
    lines.push(`Requête Telegram : ${remotePromptRunning ? 'en cours' : 'aucune'}`);
    return lines.join('\n');
  }
  lines.push(`Processus Codex : ${codex.processRunning ? 'lancé' : 'arrêté'}`);
  if (codex.sessionChanging) {
    lines.push('⏳ Gestion de session : en cours');
  }
  if (codex.sessionId) {
    const active = codex.sessionActive ?? codex.processRunning;
    const indicator = active ? '🟢' : codex.processRunning ? '🟠' : '🔴';
    lines.push(`${indicator} Session Codex : ${active ? 'active' : codex.processRunning
      ? 'à reprendre' : 'indisponible (processus arrêté)'}`);
    lines.push(`ID session : ${literal(codex.sessionId)}`);
  } else {
    lines.push('⚪ Session Codex : aucune');
  }
  if (codex.workspacePath) {
    lines.push(`Workspace de la session : ${literal(codex.workspacePath)}`);
    if (codex.workspacePath !== workspace?.path) {
      lines.push('⚠️ Le workspace de la session diffère du workspace ciblé.');
    }
  }

  lines.push('', '⚡ **Activité**');
  lines.push(`Requête Telegram : ${remotePromptRunning ? 'en cours' : 'aucune'}`);
  if (codex.turn) {
    const elapsed = Math.max(0, Math.floor((now - codex.turn.startedAt) / 1000));
    const activity = codex.pendingApprovals > 0 ? 'en attente d’approbation'
      : codex.turn.id ? 'en cours' : 'démarrage';
    lines.push(`${codex.pendingApprovals > 0 ? '🟠' : '⏳'} Turn : ${activity} (${elapsed} s)`);
    if (codex.turn.id) {
      lines.push(`ID turn : ${literal(codex.turn.id)}`);
    }
  } else {
    lines.push('⚪ Turn : aucun en cours');
  }
  lines.push(`${codex.pendingApprovals > 0 ? '🔐 ' : ''}Approbations en attente : ${codex.pendingApprovals}`);
  return lines.join('\n');
}

// Workspace names, paths and IDs are data, not Markdown supplied by Nexus.
function literal(value: string): string {
  return value.replace(/[\\`*_[\]]/g, '\\$&').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
