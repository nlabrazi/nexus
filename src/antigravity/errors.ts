import { classifyProcessError, formatTurnTimeoutMessage } from '../runtime/agent-service';

export type AntigravityErrorCode =
  | 'not_installed'
  | 'process_failed'
  | 'stopped'
  | 'stream_timeout'
  | 'turn_timeout'
  | 'turn_failed'
  | 'interrupted'
  | 'empty_response'
  | 'session_lost'
  | 'approval_declined'
  | 'protocol_error';

export interface AntigravityErrorDetails {
  toolsCalled?: Array<{ name: string; state: string; error?: string }>;
  changedFiles?: string[];
  recentStderr?: string[];
  pendingApprovals?: number;
}

export class AntigravityError extends Error {
  constructor(
    readonly code: AntigravityErrorCode,
    message: string,
    options?: ErrorOptions,
    readonly details?: AntigravityErrorDetails
  ) {
    super(message, options);
    this.name = 'AntigravityError';
  }
}

export function emptyResponseError(
  details?: AntigravityErrorDetails,
  options?: { dangerouslySkipPermissions?: boolean }
): AntigravityError {
  const parts: string[] = ['Antigravity a terminé sans réponse textuelle finale.'];

  if (details?.changedFiles && details.changedFiles.length > 0) {
    parts.push(
      `📁 Fichiers modifiés (${details.changedFiles.length}) :\n${details.changedFiles.map((f) => `• ${f}`).join('\n')}`
    );
  }

  if (details?.toolsCalled && details.toolsCalled.length > 0) {
    const toolList = details.toolsCalled.slice(-5).map((t) => {
      const err = t.error ? ` [erreur: ${t.error}]` : '';
      return `${t.name} (${t.state})${err}`;
    });
    parts.push(
      `🔧 Outils récents (${details.toolsCalled.length} au total) : ${toolList.join(', ')}`
    );
  }

  const toolErrors = details?.toolsCalled?.filter((t) => t.error);
  if (toolErrors && toolErrors.length > 0) {
    const errorLines = toolErrors.slice(-3).map((te) => `• ${te.name} : ${te.error}`);
    parts.push(`⚠️ Erreurs d'outils détectées :\n${errorLines.join('\n')}`);
  }

  if (details?.pendingApprovals && details.pendingApprovals > 0) {
    parts.push('⏳ Une demande d’approbation d’action était en attente.');
  }

  if (details?.recentStderr && details.recentStderr.length > 0) {
    parts.push(
      `📋 Derniers logs processus (stderr) :\n${details.recentStderr.slice(-3).join('\n')}`
    );
  }

  if (!options?.dangerouslySkipPermissions) {
    parts.push(
      '💡 Conseil : Si une invite ou popin de confirmation d’action a été affichée par Antigravity, elle n’a peut-être pas été validée à temps (ou activez « nexus.antigravity.dangerouslySkipPermissions » si vous souhaitez déléguer les approbations à Telegram).'
    );
  }

  return new AntigravityError('empty_response', parts.join('\n\n'), undefined, details);
}

export function processError(cause: unknown): AntigravityError {
  const { code, message } = classifyProcessError(
    'Antigravity',
    'agy --version',
    cause,
    'Antigravity (agy)'
  );
  return new AntigravityError(code, message, { cause });
}

export function turnTimeoutError(confirmed: boolean, elapsedSeconds = 120): AntigravityError {
  return new AntigravityError(
    'turn_timeout',
    formatTurnTimeoutMessage('Antigravity', confirmed, elapsedSeconds)
  );
}

export function sessionLostError(sessionId: string, cause?: unknown): AntigravityError {
  return new AntigravityError(
    'session_lost',
    `La conversation Antigravity « ${sessionId} » est introuvable ou n’est plus accessible. Utilisez /resume <id> pour la reprendre, ou /new pour repartir avec une nouvelle session.`,
    cause !== undefined ? { cause } : undefined
  );
}
