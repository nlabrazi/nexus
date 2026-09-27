export const NEXUS_PROTOCOL_VERSION = 1;

export type TaskBackend = 'codex' | 'antigravity' | 'brain';

export type TaskStage = 'starting' | 'inspecting' | 'executing' | 'synthesizing';

export type NodeState = 'idle' | 'busy' | 'draining';

export type ApprovalKind = 'command' | 'fileChange' | 'consent';

export type ApprovalDecision = 'accept' | 'decline';

export type ApprovalCancelReason = 'timeout' | 'task_aborted' | 'superseded';

export type NexusErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'NODE_OFFLINE'
  | 'NODE_BUSY'
  | 'PROJECT_NOT_FOUND'
  | 'WORKSPACE_GUARD_REJECTED'
  | 'TASK_NOT_FOUND'
  | 'TASK_ALREADY_RUNNING'
  | 'TASK_CANCELLED'
  | 'TASK_TIMEOUT'
  | 'TASK_EXECUTION_FAILED'
  | 'APPROVAL_TIMEOUT'
  | 'APPROVAL_NOT_FOUND'
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'SPEECH_NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

export interface NodeProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly currentBranch?: string;
  readonly isActive?: boolean;
  readonly nodeId?: string;
  readonly nodeName?: string;
}

export interface NodeCapabilities {
  readonly backends: readonly TaskBackend[];
  readonly speech?: {
    readonly stt: boolean;
    readonly tts: boolean;
  };
  readonly workspaceGuard?: boolean;
}

export interface NodeHelloPayload {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly version: string;
  readonly authToken: string;
  readonly capabilities: NodeCapabilities;
  readonly projects: readonly NodeProjectSummary[];
}

export interface NodeWelcomePayload {
  readonly nodeId: string;
  readonly sessionId: string;
  readonly heartbeatIntervalMs: number;
}

export interface NodeHeartbeatPayload {
  readonly nodeId: string;
  readonly timestamp: number;
  readonly state: NodeState;
  readonly activeTaskId?: string;
}

export interface NodeHeartbeatAckPayload {
  readonly timestamp: number;
}

export interface NodeStatusPayload {
  readonly nodeId: string;
  readonly state: NodeState;
  readonly activeTaskId?: string;
  readonly activeProject?: NodeProjectSummary;
}

export interface TaskStartPayload {
  readonly taskId: string;
  readonly backend: TaskBackend;
  readonly prompt: string;
  readonly projectId?: string;
  readonly projectPath?: string;
  readonly sessionId?: string;
}

export interface TaskCancelPayload {
  readonly taskId: string;
  readonly reason?: string;
}

export interface TaskProgressPayload {
  readonly taskId: string;
  readonly stage: TaskStage;
  readonly message?: string;
  readonly activeTool?: string;
}

export interface TaskUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface TaskCompletedPayload {
  readonly taskId: string;
  readonly text: string;
  readonly fileSummary?: string;
  readonly filesChanged?: readonly string[];
  readonly usage?: TaskUsage;
}

export interface TaskFailedPayload {
  readonly taskId: string;
  readonly error: {
    readonly code: NexusErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

export interface ApprovalRequestPayload {
  readonly approvalId: string;
  readonly taskId: string;
  readonly agentName: string;
  readonly kind: ApprovalKind;
  readonly details: string;
  readonly expiresAt: number;
}

export interface ApprovalDecisionPayload {
  readonly approvalId: string;
  readonly taskId: string;
  readonly decision: ApprovalDecision;
  readonly decidedBy?: string;
}

export interface ApprovalCancelledPayload {
  readonly approvalId: string;
  readonly taskId: string;
  readonly reason: ApprovalCancelReason;
}

export interface CoreErrorPayload {
  readonly code: NexusErrorCode;
  readonly message: string;
  readonly targetMessageId?: string;
  readonly details?: unknown;
}

export interface NodeSwitchProjectPayload {
  readonly projectId: string;
}

export interface NexusPayloadMap {
  'node:hello': NodeHelloPayload;
  'node:welcome': NodeWelcomePayload;
  'node:heartbeat': NodeHeartbeatPayload;
  'node:heartbeat_ack': NodeHeartbeatAckPayload;
  'node:status': NodeStatusPayload;
  'node:switch_project': NodeSwitchProjectPayload;
  'task:start': TaskStartPayload;
  'task:cancel': TaskCancelPayload;
  'task:progress': TaskProgressPayload;
  'task:completed': TaskCompletedPayload;
  'task:failed': TaskFailedPayload;
  'approval:request': ApprovalRequestPayload;
  'approval:decision': ApprovalDecisionPayload;
  'approval:cancelled': ApprovalCancelledPayload;
  'core:error': CoreErrorPayload;
}

export type NexusMessageType = keyof NexusPayloadMap;

export interface NexusMessageEnvelope<TType extends NexusMessageType = NexusMessageType> {
  readonly v: typeof NEXUS_PROTOCOL_VERSION;
  readonly id: string;
  readonly type: TType;
  readonly timestamp: number;
  readonly traceId?: string;
  readonly payload: NexusPayloadMap[TType];
}

export type AnyNexusMessage = {
  [K in NexusMessageType]: NexusMessageEnvelope<K>;
}[NexusMessageType];

export type NexusMessage<TType extends NexusMessageType> = Extract<
  AnyNexusMessage,
  { type: TType }
>;
