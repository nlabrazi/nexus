import { LogRecord, redactLogText } from '../logging/logger';
import { NexusStatusSnapshot } from '../telegram/status';

export function formatDiagnostics(
  snapshot: NexusStatusSnapshot,
  options: { telegram: string; lastError?: LogRecord; logsAvailable: boolean }
): string {
  const agent = (name: 'codex' | 'antigravity') => {
    // Core presence is not proof that an agent process or session is connected.
    if (snapshot.core) return 'état distant non vérifié';
    const state = snapshot[name];
    return state?.sessionActive
      ? 'session active'
      : state?.processRunning
        ? 'processus lancé'
        : 'arrêté';
  };
  const lastError = options.lastError;
  return redactLogText(
    [
      'Nexus : ON',
      `Workspace : ${snapshot.workspace?.name ?? 'aucun'}`,
      `Telegram : ${options.telegram}`,
      `Brain : ${snapshot.brain ? `${snapshot.brain.provider} / ${snapshot.brain.model ?? 'modèle automatique'} (configuré, disponibilité non vérifiée)` : 'état distant non vérifié'}`,
      `Codex : ${agent('codex')}`,
      `Antigravity : ${agent('antigravity')}`,
      `TTS : ${snapshot.tts ?? 'indisponible sur ce parcours'}`,
      `Logs persistants : ${options.logsAvailable ? 'actifs' : 'indisponibles'}`,
      `Dernière erreur locale : ${lastError ? `${lastError.component}/${lastError.operation} — ${lastError.error?.message ?? lastError.status ?? 'échec'} (${lastError.timestamp})` : 'aucune'}`,
    ].join('\n')
  );
}
