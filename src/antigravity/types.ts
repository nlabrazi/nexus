export interface AntigravitySession {
  id: string;
  cwd?: string;
  status?: { type: string };
  model?: string | null;
  reasoningEffort?: string | null;
}

export interface AntigravityModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden?: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}

export interface ModelSelection {
  model: string;
  effort: string;
}

export interface ModelMenu {
  models: AntigravityModel[];
  selected?: ModelSelection;
  context: string;
}

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

export interface ConversationTokenUsage {
  total: TokenBreakdown;
  last: TokenBreakdown;
  modelContextWindow: number | null;
}

export interface ConversationTelemetry {
  model?: string;
  reasoningEffort?: string | null;
  sandbox?: string;
  tokenUsage?: ConversationTokenUsage;
  tokenUsageUpdatedAt?: number;
}

import type { ApprovalDecision } from '../codex/types';
export type { ApprovalDecision };

export interface AntigravityApprovalRequest {
  agentName?: string;
  kind: 'command' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  details: string;
  expiresAt: number;
}

export type AntigravityApprovalHandler = (
  request: AntigravityApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision>;

export interface AntigravityClientStatus {
  processRunning: boolean;
  turn?: {
    id?: string;
    startedAt: number;
    interrupting?: boolean;
  };
  pendingApprovals?: number;
}

export interface AntigravityServiceStatus extends AntigravityClientStatus, ConversationTelemetry {
  sessionId?: string;
  workspacePath?: string;
  sessionBranch?: string;
  sessionActive?: boolean;
  sessionChanging?: boolean;
  modelSelection?: ModelSelection;
  modelChanging?: boolean;
  branchChanging?: boolean;
}

export interface InitEvent {
  event: 'init';
  conversation_id: string;
  init: {
    cwd: string;
    tools?: string[];
    permission_mode?: string;
  };
}

export interface StepUpdateEvent {
  event: 'step_update';
  step_update: {
    conversation_id: string;
    step_index: number;
    state: 'ACTIVE' | 'DONE' | 'ERROR';
    step_type: 'user_input' | 'agent_response' | 'tool' | string;
    text_delta?: string;
    duration_seconds?: number;
    tool_name?: string;
    tool_info?: {
      name: string;
      parameters?: Record<string, unknown>;
      output?: string;
      error?: {
        type: string;
        message: string;
      };
    };
    usage?: {
      input_tokens: number;
      output_tokens: number;
      thinking_tokens: number;
      cache_read_tokens: number;
      total_tokens: number;
    };
  };
}

export interface ResultEvent {
  event: 'result';
  result: {
    conversation_id: string;
    status: 'SUCCESS' | 'ERROR';
    response: string;
    error?: string;
    duration_seconds: number;
    num_turns: number;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      thinking_tokens: number;
      cache_read_tokens: number;
      total_tokens: number;
    };
  };
}

export type StreamOutputEvent = InitEvent | StepUpdateEvent | ResultEvent;

export interface UserStreamInput {
  event: 'user';
  message: {
    content: string;
  };
}
