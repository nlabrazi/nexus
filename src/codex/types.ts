export interface RpcMessage {
  id?: number;
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
