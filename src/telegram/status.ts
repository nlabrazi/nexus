import type { AntigravityServiceStatus } from '../antigravity/types';
import type { CodexServiceStatus } from '../codex/types';

export type AgentBackendType = 'codex' | 'antigravity';

export interface NexusStatusSnapshot {
  workspace?: { name: string; path: string };
  workspaceCount: number;
  activeBackend?: AgentBackendType;
  codex?: CodexServiceStatus;
  antigravity?: AntigravityServiceStatus;
}

export function formatTelegramStatus(
  snapshot: NexusStatusSnapshot,
  remotePromptRunning: boolean,
  now = Date.now()
): string {
  const { workspace, workspaceCount, activeBackend, codex, antigravity } = snapshot;
  const lines = ['📍 **Nexus — statut**', '🟢 Telegram : connecté et appairé'];

  if (activeBackend) {
    lines.push(
      `Backend actif : ${activeBackend === 'antigravity' ? '✨ Gemini Antigravity' : '🤖 Codex'}`
    );
  }

  lines.push('', '📁 **Projet**', `Workspace ciblé : ${literal(workspace?.name ?? 'aucun')}`);
  if (workspace) {
    lines.push(`Chemin : ${literal(workspace.path)}`);
  }
  if (workspaceCount > 1) {
    const agentLabel = activeBackend === 'antigravity' ? 'Antigravity' : 'Codex';
    lines.push(
      `Dossiers ouverts : ${workspaceCount} (actions ${agentLabel} bloquées : cible ambiguë)`
    );
  }

  // Section Codex
  if (codex !== undefined) {
    lines.push('', '🤖 **Codex**');
    formatCodexSection(lines, codex, workspace, remotePromptRunning, now);
  } else if (!antigravity) {
    lines.push('', '🤖 **Codex**');
    lines.push('🔴 Codex : service indisponible');
    lines.push(`Requête Telegram : ${remotePromptRunning ? 'en cours' : 'aucune'}`);
  }

  // Section Gemini Antigravity
  if (antigravity !== undefined) {
    lines.push('', '✨ **Gemini Antigravity**');
    formatAntigravitySection(lines, antigravity, workspace, remotePromptRunning, now);
  }

  return lines.join('\n');
}

function formatCodexSection(
  lines: string[],
  codex: CodexServiceStatus,
  workspace: { name: string; path: string } | undefined,
  remotePromptRunning: boolean,
  now: number
): void {
  lines.push(`Processus Codex : ${codex.processRunning ? 'lancé' : 'arrêté'}`);
  if (codex.modelChanging) {
    lines.push('⏳ Changement de modèle : en cours');
  }
  if (codex.branchChanging) {
    lines.push('⏳ Changement de branche : en cours');
  }
  if (codex.sessionChanging) {
    lines.push('⏳ Gestion de session : en cours');
  }
  if (codex.sessionId) {
    const active = codex.sessionActive ?? codex.processRunning;
    const indicator = active ? '🟢' : codex.processRunning ? '🟠' : '🔴';
    lines.push(
      `${indicator} Session Codex : ${
        active ? 'active' : codex.processRunning ? 'à reprendre' : 'indisponible (processus arrêté)'
      }`
    );
    lines.push(`ID session : ${literal(codex.sessionId)}`);
    if (codex.sessionBranch) {
      lines.push(`🌿 Branche de la session : ${literal(codex.sessionBranch)}`);
    }
  } else {
    lines.push('⚪ Session Codex : aucune');
  }
  if (codex.workspacePath) {
    lines.push(`Workspace de la session : ${literal(codex.workspacePath)}`);
    if (codex.workspacePath !== workspace?.path) {
      lines.push('⚠️ Le workspace de la session diffère du workspace ciblé.');
    }
  }

  lines.push('', '🧠 **Modèle et configuration**');
  lines.push(`Modèle de la session : ${literal(codex.model ?? 'indisponible')}`);
  lines.push(`Effort de raisonnement : ${literal(codex.reasoningEffort ?? 'non communiqué')}`);
  if (codex.modelProvider) {
    lines.push(`Fournisseur : ${literal(codex.modelProvider)}`);
  }
  if (codex.serviceTier) {
    lines.push(`Service : ${literal(codex.serviceTier)}`);
  }
  if (codex.modelSelection) {
    lines.push(
      `Choix pour le prochain prompt : ${literal(codex.modelSelection.model)} (${literal(
        codex.modelSelection.effort
      )})`
    );
  }
  if (codex.reroutedModel) {
    lines.push(`Dernière redirection signalée : ${literal(codex.reroutedModel)}`);
  }
  if (codex.sandbox) {
    lines.push(`Sandbox : ${literal(codex.sandbox)}`);
  }
  if (codex.approvalPolicy) {
    lines.push(`Approbations : ${literal(codex.approvalPolicy)}`);
  }

  lines.push('', '📊 **Tokens de la session**');
  const usage = codex.tokenUsage;
  if (usage) {
    lines.push(
      `Total cumulé : ${number(usage.total.totalTokens)}`,
      `Entrée : ${number(usage.total.inputTokens)} · dont cache lu : ${number(
        usage.total.cachedInputTokens
      )}`,
      `Sortie : ${number(usage.total.outputTokens)} · dont raisonnement : ${number(
        usage.total.reasoningOutputTokens
      )}`
    );
    if (usage.total.cacheWriteInputTokens !== undefined) {
      lines.push(`Cache écrit : ${number(usage.total.cacheWriteInputTokens)}`);
    }
    lines.push(`Dernier appel : ${number(usage.last.totalTokens)} tokens`);
    if (usage.modelContextWindow && usage.modelContextWindow > 0) {
      const remaining = Math.max(
        0,
        Math.round((1 - usage.last.totalTokens / usage.modelContextWindow) * 100)
      );
      lines.push(
        `Contexte, dernière mesure : ${number(usage.last.totalTokens)} / ${number(
          usage.modelContextWindow
        )} tokens (≈ ${remaining} % restant)`
      );
    } else {
      lines.push('Fenêtre de contexte : non communiquée');
    }
    if (codex.tokenUsageUpdatedAt !== undefined) {
      lines.push(`Mesure reçue : ${date(codex.tokenUsageUpdatedAt)}`);
    }
    if (!codex.sessionActive) {
      lines.push('Dernière mesure connue ; session actuellement inactive.');
    }
  } else {
    lines.push('Indisponibles : aucune mesure reçue pour cette session.');
  }

  lines.push('', '📈 **Quotas du compte Codex**');
  if (codex.rateLimits?.length) {
    for (const limit of codex.rateLimits) {
      lines.push(
        `${literal(limit.limitName ?? limit.limitId ?? 'Codex')}${
          limit.planType ? ` · ${literal(limit.planType)}` : ''
        }`
      );
      let windows = 0;
      for (const [label, window] of [
        ['Principal', limit.primary],
        ['Secondaire', limit.secondary],
      ] as const) {
        if (!window) {
          continue;
        }
        windows++;
        const mins = window.windowDurationMins;
        const duration = mins
          ? mins % 1440 === 0
            ? `${mins / 1440} j`
            : mins % 60 === 0
              ? `${mins / 60} h`
              : `${mins} min`
          : label;
        lines.push(
          `${duration} : ${number(window.usedPercent)} % utilisé (${number(
            Math.max(0, 100 - window.usedPercent)
          )} % restant)`
        );
        if (window.resetsAt) {
          lines.push(`Réinitialisation : ${date(window.resetsAt * 1000)}`);
        }
      }
      if (!windows) {
        lines.push('Aucune fenêtre de quota communiquée.');
      }
    }
    if (codex.rateLimitsUpdatedAt !== undefined) {
      lines.push(`Mesure reçue : ${date(codex.rateLimitsUpdatedAt)}`);
    }
    if (codex.rateLimitsUnavailable || !codex.processRunning) {
      lines.push('Derniers quotas connus ; actualisation indisponible.');
    }
  } else {
    lines.push('Indisponibles pour le moment (connexion ou compte non compatible).');
  }

  lines.push('', '⚡ **Activité**');
  lines.push(`Requête Telegram : ${remotePromptRunning ? 'en cours' : 'aucune'}`);
  if (codex.turn) {
    const elapsed = Math.max(0, Math.floor((now - codex.turn.startedAt) / 1000));
    const activity = codex.turn.interrupting
      ? 'interruption en cours'
      : codex.pendingApprovals > 0
        ? 'en attente d’approbation'
        : codex.turn.id
          ? 'en cours'
          : 'démarrage';
    lines.push(`${codex.pendingApprovals > 0 ? '🟠' : '⏳'} Turn : ${activity} (${elapsed} s)`);
    if (codex.turn.id) {
      lines.push(`ID turn : ${literal(codex.turn.id)}`);
    }
  } else {
    lines.push('⚪ Turn : aucun en cours');
  }
  lines.push(
    `${codex.pendingApprovals > 0 ? '🔐 ' : ''}Approbations en attente : ${codex.pendingApprovals}`
  );
}

function formatAntigravitySection(
  lines: string[],
  agy: AntigravityServiceStatus,
  workspace: { name: string; path: string } | undefined,
  _remotePromptRunning: boolean,
  now: number
): void {
  lines.push(`Processus Antigravity : ${agy.processRunning ? 'lancé' : 'arrêté'}`);
  if (agy.modelChanging) {
    lines.push('⏳ Changement de modèle : en cours');
  }
  if (agy.branchChanging) {
    lines.push('⏳ Changement de branche : en cours');
  }
  if (agy.sessionChanging) {
    lines.push('⏳ Gestion de session : en cours');
  }
  if (agy.sessionId) {
    const active = agy.sessionActive ?? agy.processRunning;
    const indicator = active ? '🟢' : agy.processRunning ? '🟠' : '🔴';
    lines.push(
      `${indicator} Session Antigravity : ${
        active ? 'active' : agy.processRunning ? 'à reprendre' : 'indisponible (processus arrêté)'
      }`
    );
    lines.push(`ID session : ${literal(agy.sessionId)}`);
    if (agy.sessionBranch) {
      lines.push(`🌿 Branche de la session : ${literal(agy.sessionBranch)}`);
    }
  } else {
    lines.push('⚪ Session Antigravity : aucune');
  }
  if (agy.workspacePath) {
    lines.push(`Workspace de la session : ${literal(agy.workspacePath)}`);
    if (agy.workspacePath !== workspace?.path) {
      lines.push('⚠️ Le workspace de la session diffère du workspace ciblé.');
    }
  }

  lines.push('', '🧠 **Modèle et configuration Antigravity**');
  lines.push(`Modèle de la session : ${literal(agy.model ?? 'indisponible')}`);
  lines.push(`Effort de raisonnement : ${literal(agy.reasoningEffort ?? 'non communiqué')}`);
  if (agy.sandbox) {
    lines.push(`Sandbox : ${literal(agy.sandbox)}`);
  }
  if (agy.modelSelection) {
    lines.push(
      `Choix pour le prochain prompt : ${literal(agy.modelSelection.model)} (${literal(
        agy.modelSelection.effort
      )})`
    );
  }

  lines.push('', '📊 **Tokens de la session Antigravity**');
  const usage = agy.tokenUsage;
  if (usage) {
    lines.push(
      `Total cumulé : ${number(usage.total.totalTokens)}`,
      `Entrée : ${number(usage.total.inputTokens)} · dont cache lu : ${number(
        usage.total.cachedInputTokens
      )}`,
      `Sortie : ${number(usage.total.outputTokens)} · dont pensée/raisonnement : ${number(
        usage.total.reasoningOutputTokens
      )}`,
      `Dernier appel : ${number(usage.last.totalTokens)} tokens`
    );
    if (usage.modelContextWindow && usage.modelContextWindow > 0) {
      const remaining = Math.max(
        0,
        Math.round((1 - usage.last.totalTokens / usage.modelContextWindow) * 100)
      );
      lines.push(
        `Contexte, dernière mesure : ${number(usage.last.totalTokens)} / ${number(
          usage.modelContextWindow
        )} tokens (≈ ${remaining} % restant)`
      );
    }
    if (agy.tokenUsageUpdatedAt !== undefined) {
      lines.push(`Mesure reçue : ${date(agy.tokenUsageUpdatedAt)}`);
    }
    if (!agy.sessionActive) {
      lines.push('Dernière mesure connue ; session actuellement inactive.');
    }
  } else {
    lines.push('Indisponibles : aucune mesure reçue pour cette session.');
  }

  lines.push('', '⚡ **Activité Antigravity**');
  if (agy.turn) {
    const elapsed = Math.max(0, Math.floor((now - agy.turn.startedAt) / 1000));
    const pending = agy.pendingApprovals ?? 0;
    const activity = agy.turn.interrupting
      ? 'interruption en cours'
      : pending > 0
        ? 'en attente d’approbation'
        : agy.turn.id
          ? 'en cours'
          : 'démarrage';
    lines.push(`${pending > 0 ? '🟠' : '⏳'} Turn Antigravity : ${activity} (${elapsed} s)`);
  } else {
    lines.push('⚪ Turn Antigravity : aucun en cours');
  }
  lines.push(
    `${(agy.pendingApprovals ?? 0) > 0 ? '🔐 ' : ''}Approbations en attente : ${agy.pendingApprovals ?? 0}`
  );
}

function number(value: number): string {
  return value.toLocaleString('fr-FR');
}
function date(value: number): string {
  return new Date(value).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'short',
  });
}

function literal(value: string): string {
  return value
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
