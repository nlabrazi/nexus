export interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface CodexThread {
  id: string;
}

export interface ThreadStartResponse {
  thread: CodexThread;
}
