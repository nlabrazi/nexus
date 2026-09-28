import { NexusErrorCode } from './types';

export class NexusProtocolError extends Error {
  constructor(
    readonly code: NexusErrorCode,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'NexusProtocolError';
  }
}

export function invalidMessageError(message: string, details?: unknown): NexusProtocolError {
  return new NexusProtocolError('INVALID_MESSAGE', message, details);
}

export function protocolVersionMismatchError(
  receivedVersion: unknown,
  expectedVersion: number
): NexusProtocolError {
  return new NexusProtocolError(
    'PROTOCOL_VERSION_MISMATCH',
    `Version de protocole non supportée : reçu ${String(receivedVersion)}, attendu ${expectedVersion}.`,
    { receivedVersion, expectedVersion }
  );
}

export function unauthenticatedError(message = 'Authentification requise.'): NexusProtocolError {
  return new NexusProtocolError('UNAUTHENTICATED', message);
}

export function unauthorizedError(message = 'Action non autorisée.'): NexusProtocolError {
  return new NexusProtocolError('UNAUTHORIZED', message);
}

export function nodeOfflineError(nodeId?: string): NexusProtocolError {
  return new NexusProtocolError(
    'NODE_OFFLINE',
    nodeId ? `Le nœud desktop « ${nodeId} » est hors ligne.` : 'Aucun nœud desktop disponible.'
  );
}

export function nodeBusyError(nodeId?: string): NexusProtocolError {
  return new NexusProtocolError(
    'NODE_BUSY',
    nodeId ? `Le nœud desktop « ${nodeId} » est occupé.` : 'Le nœud desktop est occupé.'
  );
}

export function taskNotFoundError(taskId: string): NexusProtocolError {
  return new NexusProtocolError('TASK_NOT_FOUND', `Tâche introuvable : ${taskId}.`, { taskId });
}

export function approvalTimeoutError(approvalId: string): NexusProtocolError {
  return new NexusProtocolError(
    'APPROVAL_TIMEOUT',
    `La demande d’approbation ${approvalId} a expiré sans réponse.`,
    { approvalId }
  );
}

export function approvalNotFoundError(approvalId: string): NexusProtocolError {
  return new NexusProtocolError(
    'APPROVAL_NOT_FOUND',
    `Demande d’approbation introuvable ou déjà traitée : ${approvalId}.`,
    { approvalId }
  );
}

export function taskCancelledError(taskId: string, message?: string): NexusProtocolError {
  return new NexusProtocolError('TASK_CANCELLED', message ?? `La tâche ${taskId} a été annulée.`, {
    taskId,
  });
}

export function taskExecutionFailedError(
  taskId: string,
  message: string,
  details?: unknown
): NexusProtocolError {
  return new NexusProtocolError('TASK_EXECUTION_FAILED', message, { taskId, details });
}

export function projectNotFoundError(projectId: string): NexusProtocolError {
  return new NexusProtocolError('PROJECT_NOT_FOUND', `Projet introuvable : ${projectId}.`, {
    projectId,
  });
}
