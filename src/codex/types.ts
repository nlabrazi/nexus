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
}

export interface CodexClientStatus {
  processRunning: boolean;
  turn?: {
    id?: string;
    startedAt: number;
  };
  pendingApprovals: number;
}

export interface CodexServiceStatus extends CodexClientStatus {
  sessionId?: string;
  workspacePath?: string;
}

export type CodexTurnStatus =
  | 'completed'
  | 'interrupted'
  | 'failed'
  | 'inProgress';

export interface CodexTurn {
  id: string;
  status: CodexTurnStatus;
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
  item: {
    type: string;
    text?: string;
  };
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
