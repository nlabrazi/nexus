export type RpcRequestId = number | string;

export interface RpcMessage {
  jsonrpc?: '2.0';
  id?: RpcRequestId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface CodexThread {
  id: string;
  cwd?: string;
  status?: { type: string };
  model?: string | null;
  modelProvider?: string;
  reasoningEffort?: string | null;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden?: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}

export interface ModelSelection { model: string; effort: string }
export interface ModelMenu { models: CodexModel[]; selected?: ModelSelection; context: string }
export interface ModelControls {
  list(): Promise<ModelMenu>;
  select(selection: ModelSelection, context: string): Promise<void>;
}

export interface TokenBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}
export interface ThreadTokenUsage {
  total: TokenBreakdown;
  last: TokenBreakdown;
  modelContextWindow: number | null;
}
export interface RateLimitWindow { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null }
export interface RateLimitSnapshot {
  limitId?: string | null;
  limitName?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: string | null;
}
export interface ThreadTelemetry {
  model?: string;
  modelProvider?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  approvalPolicy?: string;
  sandbox?: string;
  tokenUsage?: ThreadTokenUsage;
  tokenUsageUpdatedAt?: number;
  reroutedModel?: string;
}

export interface CodexClientStatus {
  processRunning: boolean;
  turn?: {
    id?: string;
    startedAt: number;
    interrupting?: boolean;
  };
  pendingApprovals: number;
  rateLimits?: RateLimitSnapshot[];
  rateLimitsUpdatedAt?: number;
  rateLimitsUnavailable?: boolean;
}

export interface CodexServiceStatus extends CodexClientStatus, ThreadTelemetry {
  sessionId?: string;
  workspacePath?: string;
  sessionBranch?: string;
  sessionActive?: boolean;
  sessionChanging?: boolean;
  modelSelection?: ModelSelection;
  modelChanging?: boolean;
  branchChanging?: boolean;
}

export type CodexTurnStatus =
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'inProgress';

export interface CodexTurn {
  id: string;
  status: CodexTurnStatus;
  items?: CodexItem[];
  error?: {
    message: string;
  } | null;
}

export interface ThreadStartResponse {
  thread: CodexThread;
  model?: string;
  modelProvider?: string;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  approvalPolicy?: string | object;
  sandbox?: { type: string };
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

export interface RpcNotification {
  method: string;
  params?: unknown;
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: CodexItem;
}

export interface CodexItem {
  id: string;
  type: string;
  text?: string;
  phase?: 'commentary' | 'final_answer' | null;
  status?: string;
  changes?: { path: string }[];
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: CodexTurn;
}

export interface RpcServerRequest {
  id: RpcRequestId;
  method: string;
  params?: unknown;
}

export type ApprovalDecision = 'accept' | 'decline';

export interface CodexApprovalRequest {
  agentName?: string;
  kind: 'command' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  details: string;
  expiresAt: number;
}

export type CodexApprovalHandler = (
  request: CodexApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision>;
