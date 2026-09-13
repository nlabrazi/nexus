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
}

export interface CodexClientStatus {
  processRunning: boolean;
  turn?: {
    id?: string;
    startedAt: number;
    interrupting?: boolean;
  };
  pendingApprovals: number;
}

export interface CodexServiceStatus extends CodexClientStatus {
  sessionId?: string;
  workspacePath?: string;
  sessionBranch?: string;
  sessionActive?: boolean;
  sessionChanging?: boolean;
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
