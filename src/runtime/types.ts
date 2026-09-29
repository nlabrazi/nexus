import { AntigravityClientOptions } from '../antigravity/client';
import { AntigravitySessionPersistence } from '../antigravity/persistence';
import { AntigravityModelPreferences } from '../antigravity/model-preferences';
import { CodexApprovalRequest } from '../codex/types';
import { SessionPersistence } from '../codex/persistence';
import { ModelPreferences } from '../codex/model-preferences';
import { ApprovalDecision } from '../codex/types';
import { BrainModel } from '../conversational/model';
import { BrainSessionPersistence } from '../conversational/persistence';
import { AgentBackendType } from '../telegram/status';
import { WorkspaceGuard } from '../workspace/guard';
import { ProjectMemory } from '../memory/project-memory';

export type TaskBackendType = 'codex' | 'antigravity' | 'brain';

export type RemoteSessionAction = { type: 'new' } | { type: 'resume'; sessionId: string };

export type RemoteBranchAction = { type: 'list' } | { type: 'switch'; name: string };

export interface TaskExecutionResult {
  readonly text: string;
  readonly fileSummary?: string;
  readonly filesChanged?: readonly string[];
}

export interface TurnTimeoutRequest {
  readonly agentName?: string;
  readonly elapsedSeconds: number;
}

export type TurnTimeoutHandler = (
  request: TurnTimeoutRequest,
  signal: AbortSignal
) => Promise<boolean>;

export type RuntimeApprovalRequest =
  | CodexApprovalRequest
  | {
    readonly kind: 'inspection';
    readonly agentName: string;
    readonly details: string;
    readonly expiresAt: number;
  };

export type RuntimeApprovalHandler = (
  request: RuntimeApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision>;

export interface KeyValueStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

import { CodingAgentProjectSummary } from '../conversational/tools';

export interface NexusRuntimeOptions {
  readonly workspaceGuard: WorkspaceGuard;
  readonly targetPath?: () => string;
  readonly requestApproval?: RuntimeApprovalHandler;
  readonly requestTurnTimeoutContinuation?: TurnTimeoutHandler;
  readonly codexPersistence?: SessionPersistence;
  readonly codexModelPreferences?: ModelPreferences;
  readonly antigravityPersistence?: AntigravitySessionPersistence;
  readonly antigravityModelPreferences?: AntigravityModelPreferences;
  readonly antigravityConfig?: AntigravityClientOptions;
  readonly defaultBackend?: AgentBackendType;
  readonly brainModel?: BrainModel;
  readonly brainPersistence?: BrainSessionPersistence;
  readonly projectMemory?: ProjectMemory;
  readonly listProjects?: () =>
    | Promise<readonly CodingAgentProjectSummary[]>
    | readonly CodingAgentProjectSummary[];
  readonly switchProject?: (
    idOrPath: string
  ) => Promise<CodingAgentProjectSummary> | CodingAgentProjectSummary;
}

export interface StandaloneWorkspaceGuardOptions {
  readonly protectedBranches?: readonly string[];
  readonly trusted?: boolean;
}
