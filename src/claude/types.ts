import { KeyValueStorage } from '../runtime/types';

export interface ClaudeCodeModel {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly defaultReasoningEffort: string;
  readonly supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
}

export interface ClaudeCodeClientOptions {
  readonly binaryPath?: string;
  readonly turnTimeoutMs?: number;
  readonly storage?: KeyValueStorage;
}

export interface ClaudeRawUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

export interface ClaudeStreamMessage {
  readonly type: string;
  readonly subtype?: string;
  readonly session_id?: string;
  readonly message?: {
    readonly content?: Array<{
      readonly type: string;
      readonly text?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
    readonly usage?: ClaudeRawUsage;
  };
  readonly result?: string;
  readonly error?: string;
  readonly total_cost_usd?: number;
  readonly duration_ms?: number;
  readonly num_turns?: number;
  readonly usage?: ClaudeRawUsage;
}

export interface ClaudeTelemetrySnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly turns: number;
  readonly updatedAt?: number;
}

export interface ClaudeCodeClientStatus {
  readonly available: boolean;
  readonly binaryPath: string;
  readonly version?: string;
  readonly error?: string;
  readonly activeTaskId?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly sessionId?: string;
  readonly telemetry?: ClaudeTelemetrySnapshot;
}
