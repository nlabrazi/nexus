export interface ClaudeCodeModel {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort?: string;
  readonly supportedReasoningEfforts?: Array<{
    reasoningEffort: string;
    description: string;
  }>;
}

export interface ClaudeCodeClientOptions {
  readonly binaryPath?: string;
  readonly turnTimeoutMs?: number;
}

export interface ClaudeStreamMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly message?: {
    readonly content?: Array<{
      readonly type: string;
      readonly text?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
  };
  readonly result?: string;
  readonly error?: string;
}

export interface ClaudeCodeClientStatus {
  readonly available: boolean;
  readonly binaryPath: string;
  readonly version?: string;
  readonly error?: string;
  readonly activeTaskId?: string;
}
