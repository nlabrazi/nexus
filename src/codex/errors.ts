export type CodexErrorCode = 'not_installed' | 'process_failed' | 'stopped' |
  'rpc_timeout' | 'rpc_failed' | 'turn_timeout' | 'turn_failed' | 'interrupted' |
  'empty_response' | 'session_lost' | 'protocol_error';

export class CodexError extends Error {
  constructor(readonly code: CodexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexError';
  }
}

export function processError(cause: unknown): CodexError {
  if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return new CodexError('not_installed',
      'Codex est introuvable. Vérifiez « codex --version » dans le terminal de VS Code, puis relancez VS Code après installation.',
      { cause });
  }
  return new CodexError('process_failed',
    'La connexion au processus Codex a été perdue. Vérifiez les modifications éventuelles avant une nouvelle instruction. La session sera reprise si elle est encore disponible.',
    { cause });
}

export function turnTimeoutError(confirmed: boolean): CodexError {
  return new CodexError('turn_timeout', confirmed
    ? 'Le délai de 120 s est dépassé. Codex a confirmé la fin du turn. Vérifiez les modifications éventuelles avant une nouvelle instruction.'
    : 'Le délai de 120 s est dépassé et la fin du turn n’a pas été confirmée. Nexus a fermé la connexion et demandé l’arrêt du processus. Vérifiez les commandes et modifications éventuelles avant de continuer.');
}

export function rpcError(method: string, code: number, message: string): CodexError {
  // The stdio protocol has no dedicated, stable "thread not found" error code.
  const missingSession = /\b(?:thread|session|conversation)\b[^\n]*(?:not found|not loaded|does not exist|unknown)|(?:no rollout found|unknown (?:thread|session|conversation))/i.test(message);
  if (['thread/read', 'thread/resume', 'turn/start'].includes(method) && missingSession) {
    return new CodexError('session_lost',
      'La session Codex est introuvable ou n’est plus chargée. Utilisez /resume <id> pour la reprendre, ou /new pour repartir avec une nouvelle session.',
      { cause: { method, code, message } });
  }
  return new CodexError('rpc_failed', `Codex a refusé la requête ${method} : ${message}`,
    { cause: { method, code, message } });
}
