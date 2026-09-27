import { randomUUID } from 'node:crypto';
import { invalidMessageError, protocolVersionMismatchError } from './errors';
import {
  AnyNexusMessage,
  NEXUS_PROTOCOL_VERSION,
  NexusMessage,
  NexusMessageType,
  NexusPayloadMap,
} from './types';

const KNOWN_MESSAGE_TYPES = new Set<NexusMessageType>([
  'node:hello',
  'node:welcome',
  'node:heartbeat',
  'node:heartbeat_ack',
  'node:status',
  'task:start',
  'task:cancel',
  'task:progress',
  'task:completed',
  'task:failed',
  'approval:request',
  'approval:decision',
  'approval:cancelled',
  'core:error',
]);

const VALID_BACKENDS = new Set(['codex', 'antigravity', 'brain']);
const VALID_NODE_STATES = new Set(['idle', 'busy', 'draining']);
const VALID_TASK_STAGES = new Set(['starting', 'inspecting', 'executing', 'synthesizing']);
const VALID_APPROVAL_KINDS = new Set(['command', 'fileChange', 'consent']);
const VALID_APPROVAL_DECISIONS = new Set(['accept', 'decline']);
const VALID_APPROVAL_CANCEL_REASONS = new Set(['timeout', 'task_aborted', 'superseded']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidMessageError(`Le champ « ${field} » doit être une chaîne non vide.`);
  }
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidMessageError(`Le champ « ${field} » doit être un nombre valide.`);
  }
}

export function createNexusMessage<T extends NexusMessageType>(
  type: T,
  payload: NexusPayloadMap[T],
  options?: {
    id?: string;
    traceId?: string;
    timestamp?: number;
  }
): NexusMessage<T> {
  validatePayload(type, payload);
  return {
    v: NEXUS_PROTOCOL_VERSION,
    id: options?.id ?? randomUUID(),
    type,
    timestamp: options?.timestamp ?? Date.now(),
    ...(options?.traceId ? { traceId: options.traceId } : {}),
    payload,
  } as NexusMessage<T>;
}

export function serializeNexusMessage(message: AnyNexusMessage): string {
  if (!isNexusMessage(message)) {
    throw invalidMessageError('Impossible de sérialiser : message Nexus invalide.');
  }
  return JSON.stringify(message);
}

export function parseNexusMessage(raw: string | unknown): AnyNexusMessage {
  let parsed: unknown;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw invalidMessageError('Format JSON invalide.', cause);
    }
  } else {
    parsed = raw;
  }

  if (!isRecord(parsed)) {
    throw invalidMessageError('Le message doit être un objet JSON.');
  }

  if (parsed.v !== NEXUS_PROTOCOL_VERSION) {
    throw protocolVersionMismatchError(parsed.v, NEXUS_PROTOCOL_VERSION);
  }

  assertNonEmptyString(parsed.id, 'id');
  assertNumber(parsed.timestamp, 'timestamp');
  if (parsed.timestamp <= 0) {
    throw invalidMessageError('Le timestamp doit être positif.');
  }

  if (
    parsed.traceId !== undefined &&
    (typeof parsed.traceId !== 'string' || !parsed.traceId.trim())
  ) {
    throw invalidMessageError('Le traceId doit être une chaîne non vide.');
  }

  if (
    typeof parsed.type !== 'string' ||
    !KNOWN_MESSAGE_TYPES.has(parsed.type as NexusMessageType)
  ) {
    throw invalidMessageError(`Type de message inconnu ou non supporté : ${String(parsed.type)}.`);
  }

  const type = parsed.type as NexusMessageType;
  if (!('payload' in parsed) || parsed.payload === undefined) {
    throw invalidMessageError(`Le payload du message « ${type} » est manquant.`);
  }

  validatePayload(type, parsed.payload);

  return parsed as unknown as AnyNexusMessage;
}

export function isNexusMessage(value: unknown): value is AnyNexusMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.v !== NEXUS_PROTOCOL_VERSION) {
    return false;
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    return false;
  }
  if (typeof value.type !== 'string' || !KNOWN_MESSAGE_TYPES.has(value.type as NexusMessageType)) {
    return false;
  }
  if (
    typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp <= 0
  ) {
    return false;
  }
  if (value.traceId !== undefined && (typeof value.traceId !== 'string' || !value.traceId.trim())) {
    return false;
  }
  try {
    validatePayload(value.type as NexusMessageType, value.payload);
    return true;
  } catch {
    return false;
  }
}

export function isNexusMessageType<T extends NexusMessageType>(
  message: AnyNexusMessage,
  type: T
): message is NexusMessage<T> {
  return message.type === type;
}

function validatePayload(type: NexusMessageType, payload: unknown): void {
  if (!isRecord(payload)) {
    throw invalidMessageError(`Le payload de « ${type} » doit être un objet.`);
  }

  switch (type) {
    case 'node:hello':
      validateNodeHello(payload);
      break;
    case 'node:welcome':
      validateNodeWelcome(payload);
      break;
    case 'node:heartbeat':
      validateNodeHeartbeat(payload);
      break;
    case 'node:heartbeat_ack':
      validateNodeHeartbeatAck(payload);
      break;
    case 'node:status':
      validateNodeStatus(payload);
      break;
    case 'task:start':
      validateTaskStart(payload);
      break;
    case 'task:cancel':
      validateTaskCancel(payload);
      break;
    case 'task:progress':
      validateTaskProgress(payload);
      break;
    case 'task:completed':
      validateTaskCompleted(payload);
      break;
    case 'task:failed':
      validateTaskFailed(payload);
      break;
    case 'approval:request':
      validateApprovalRequest(payload);
      break;
    case 'approval:decision':
      validateApprovalDecision(payload);
      break;
    case 'approval:cancelled':
      validateApprovalCancelled(payload);
      break;
    case 'core:error':
      validateCoreError(payload);
      break;
  }
}

function validateNodeHello(p: Record<string, unknown>): void {
  assertNonEmptyString(p.nodeId, 'nodeId');
  assertNonEmptyString(p.nodeName, 'nodeName');
  assertNonEmptyString(p.version, 'version');
  assertNonEmptyString(p.authToken, 'authToken');

  if (!isRecord(p.capabilities)) {
    throw invalidMessageError('node:hello capabilities doit être un objet.');
  }
  if (!Array.isArray(p.capabilities.backends) || p.capabilities.backends.length === 0) {
    throw invalidMessageError('node:hello backends doit être une liste non vide.');
  }
  for (const b of p.capabilities.backends) {
    if (typeof b !== 'string' || !VALID_BACKENDS.has(b)) {
      throw invalidMessageError(`Backend non supporté dans capabilities : ${String(b)}.`);
    }
  }

  if (!Array.isArray(p.projects)) {
    throw invalidMessageError('node:hello projects doit être une liste.');
  }
  for (const proj of p.projects) {
    if (!isRecord(proj)) {
      throw invalidMessageError('Chaque projet dans node:hello doit être un objet.');
    }
    assertNonEmptyString(proj.id, 'project.id');
    assertNonEmptyString(proj.name, 'project.name');
    assertNonEmptyString(proj.path, 'project.path');
  }
}

function validateNodeWelcome(p: Record<string, unknown>): void {
  assertNonEmptyString(p.nodeId, 'nodeId');
  assertNonEmptyString(p.sessionId, 'sessionId');
  assertNumber(p.heartbeatIntervalMs, 'heartbeatIntervalMs');
  if (p.heartbeatIntervalMs <= 0) {
    throw invalidMessageError('heartbeatIntervalMs doit être positif.');
  }
}

function validateNodeHeartbeat(p: Record<string, unknown>): void {
  assertNonEmptyString(p.nodeId, 'nodeId');
  assertNumber(p.timestamp, 'timestamp');
  if (typeof p.state !== 'string' || !VALID_NODE_STATES.has(p.state)) {
    throw invalidMessageError(`État du nœud invalide : ${String(p.state)}.`);
  }
  if (
    p.activeTaskId !== undefined &&
    (typeof p.activeTaskId !== 'string' || !p.activeTaskId.trim())
  ) {
    throw invalidMessageError('activeTaskId doit être une chaîne non vide.');
  }
}

function validateNodeHeartbeatAck(p: Record<string, unknown>): void {
  assertNumber(p.timestamp, 'timestamp');
}

function validateNodeStatus(p: Record<string, unknown>): void {
  assertNonEmptyString(p.nodeId, 'nodeId');
  if (typeof p.state !== 'string' || !VALID_NODE_STATES.has(p.state)) {
    throw invalidMessageError(`État du nœud invalide : ${String(p.state)}.`);
  }
  if (
    p.activeTaskId !== undefined &&
    (typeof p.activeTaskId !== 'string' || !p.activeTaskId.trim())
  ) {
    throw invalidMessageError('activeTaskId doit être une chaîne non vide.');
  }
  if (p.activeProject !== undefined) {
    if (!isRecord(p.activeProject)) {
      throw invalidMessageError('activeProject doit être un objet.');
    }
    assertNonEmptyString(p.activeProject.id, 'activeProject.id');
    assertNonEmptyString(p.activeProject.name, 'activeProject.name');
    assertNonEmptyString(p.activeProject.path, 'activeProject.path');
  }
}

function validateTaskStart(p: Record<string, unknown>): void {
  assertNonEmptyString(p.taskId, 'taskId');
  if (typeof p.backend !== 'string' || !VALID_BACKENDS.has(p.backend)) {
    throw invalidMessageError(`Backend de tâche invalide : ${String(p.backend)}.`);
  }
  assertNonEmptyString(p.prompt, 'prompt');
  if (p.projectId !== undefined && (typeof p.projectId !== 'string' || !p.projectId.trim())) {
    throw invalidMessageError('projectId doit être une chaîne non vide.');
  }
  if (p.projectPath !== undefined && (typeof p.projectPath !== 'string' || !p.projectPath.trim())) {
    throw invalidMessageError('projectPath doit être une chaîne non vide.');
  }
  if (p.sessionId !== undefined && (typeof p.sessionId !== 'string' || !p.sessionId.trim())) {
    throw invalidMessageError('sessionId doit être une chaîne non vide.');
  }
}

function validateTaskCancel(p: Record<string, unknown>): void {
  assertNonEmptyString(p.taskId, 'taskId');
  if (p.reason !== undefined && typeof p.reason !== 'string') {
    throw invalidMessageError('reason doit être une chaîne de caractères.');
  }
}

function validateTaskProgress(p: Record<string, unknown>): void {
  assertNonEmptyString(p.taskId, 'taskId');
  if (typeof p.stage !== 'string' || !VALID_TASK_STAGES.has(p.stage)) {
    throw invalidMessageError(`Étape de tâche invalide : ${String(p.stage)}.`);
  }
  if (p.message !== undefined && typeof p.message !== 'string') {
    throw invalidMessageError('message doit être une chaîne de caractères.');
  }
  if (p.activeTool !== undefined && typeof p.activeTool !== 'string') {
    throw invalidMessageError('activeTool doit être une chaîne de caractères.');
  }
}

function validateTaskCompleted(p: Record<string, unknown>): void {
  assertNonEmptyString(p.taskId, 'taskId');
  if (typeof p.text !== 'string') {
    throw invalidMessageError('text doit être une chaîne de caractères.');
  }
  if (p.fileSummary !== undefined && typeof p.fileSummary !== 'string') {
    throw invalidMessageError('fileSummary doit être une chaîne de caractères.');
  }
  if (p.filesChanged !== undefined && !Array.isArray(p.filesChanged)) {
    throw invalidMessageError('filesChanged doit être une liste de chaînes.');
  }
}

function validateTaskFailed(p: Record<string, unknown>): void {
  assertNonEmptyString(p.taskId, 'taskId');
  if (!isRecord(p.error)) {
    throw invalidMessageError('error doit être un objet.');
  }
  assertNonEmptyString(p.error.code, 'error.code');
  assertNonEmptyString(p.error.message, 'error.message');
}

function validateApprovalRequest(p: Record<string, unknown>): void {
  assertNonEmptyString(p.approvalId, 'approvalId');
  assertNonEmptyString(p.taskId, 'taskId');
  assertNonEmptyString(p.agentName, 'agentName');
  if (typeof p.kind !== 'string' || !VALID_APPROVAL_KINDS.has(p.kind)) {
    throw invalidMessageError(`Type d’approbation invalide : ${String(p.kind)}.`);
  }
  if (typeof p.details !== 'string') {
    throw invalidMessageError('details doit être une chaîne de caractères.');
  }
  assertNumber(p.expiresAt, 'expiresAt');
  if (p.expiresAt <= 0) {
    throw invalidMessageError('expiresAt doit être un timestamp positif.');
  }
}

function validateApprovalDecision(p: Record<string, unknown>): void {
  assertNonEmptyString(p.approvalId, 'approvalId');
  assertNonEmptyString(p.taskId, 'taskId');
  if (typeof p.decision !== 'string' || !VALID_APPROVAL_DECISIONS.has(p.decision)) {
    throw invalidMessageError(`Décision d’approbation invalide : ${String(p.decision)}.`);
  }
  if (p.decidedBy !== undefined && (typeof p.decidedBy !== 'string' || !p.decidedBy.trim())) {
    throw invalidMessageError('decidedBy doit être une chaîne non vide.');
  }
}

function validateApprovalCancelled(p: Record<string, unknown>): void {
  assertNonEmptyString(p.approvalId, 'approvalId');
  assertNonEmptyString(p.taskId, 'taskId');
  if (typeof p.reason !== 'string' || !VALID_APPROVAL_CANCEL_REASONS.has(p.reason)) {
    throw invalidMessageError(`Raison d’annulation d’approbation invalide : ${String(p.reason)}.`);
  }
}

function validateCoreError(p: Record<string, unknown>): void {
  assertNonEmptyString(p.code, 'code');
  assertNonEmptyString(p.message, 'message');
  if (
    p.targetMessageId !== undefined &&
    (typeof p.targetMessageId !== 'string' || !p.targetMessageId.trim())
  ) {
    throw invalidMessageError('targetMessageId doit être une chaîne non vide.');
  }
}
