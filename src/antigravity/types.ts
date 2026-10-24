import type {
  AgentApprovalHandler,
  AgentApprovalRequest,
  AgentModel,
  ApprovalDecision,
  ModelControls,
  ModelMenu,
  ModelSelection,
  TokenBreakdown,
  TurnTimeoutHandler,
  TurnTimeoutRequest,
} from '../runtime/agent-service';

export type {
  ApprovalDecision,
  ModelControls,
  ModelMenu,
  ModelSelection,
  TokenBreakdown,
  TurnTimeoutHandler,
  TurnTimeoutRequest,
};
export type AntigravityModel = AgentModel;
export type AntigravityApprovalRequest = AgentApprovalRequest;
export type AntigravityApprovalHandler = AgentApprovalHandler;

export interface AntigravitySession {
  id: string;
  cwd?: string;
  status?: { type: string };
  model?: string | null;
  reasoningEffort?: string | null;
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
