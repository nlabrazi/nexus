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

export class AntigravityError extends Error {
  constructor(
    readonly code: AntigravityErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AntigravityError';
  }
}

export function processError(cause: unknown): AntigravityError {
  if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return new AntigravityError(
      'not_installed',
      'Antigravity (agy) est introuvable. Vérifiez « agy --version » dans le terminal de VS Code, puis relancez VS Code après installation.',
      { cause }
    );
  }
  return new AntigravityError(
    'process_failed',
    'La connexion au processus Antigravity a été perdue. Vérifiez les modifications éventuelles avant une nouvelle instruction. La session sera reprise si elle est encore disponible.',
    { cause }
  );
}

export function turnTimeoutError(confirmed: boolean): AntigravityError {
  return new AntigravityError(
    'turn_timeout',
    confirmed
      ? 'Le délai de 120 s est dépassé. Antigravity a confirmé la fin du turn. Vérifiez les modifications éventuelles avant une nouvelle instruction.'
      : 'Le délai de 120 s est dépassé et la fin du turn n’a pas été confirmée. Nexus a fermé la connexion et demandé l’arrêt du processus. Vérifiez les commandes et modifications éventuelles avant de continuer.'
  );
}

export function sessionLostError(sessionId: string, cause?: unknown): AntigravityError {
  return new AntigravityError(
    'session_lost',
    `La conversation Antigravity « ${sessionId} » est introuvable ou n’est plus accessible. Utilisez /resume <id> pour la reprendre, ou /new pour repartir avec une nouvelle session.`,
    cause !== undefined ? { cause } : undefined
  );
}
