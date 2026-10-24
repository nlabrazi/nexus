export interface AgentModel {
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
  models: AgentModel[];
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

export type ApprovalDecision = 'accept' | 'decline';

export interface AgentApprovalRequest {
  agentName?: string;
  kind: 'command' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  details: string;
  expiresAt: number;
}

export type AgentApprovalHandler = (
  request: AgentApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision>;

export interface TurnTimeoutRequest {
  agentName?: string;
  elapsedSeconds: number;
}

export type TurnTimeoutHandler = (
  request: TurnTimeoutRequest,
  signal: AbortSignal
) => Promise<boolean>;

export interface AgentService {
  sendPrompt(
    prompt: string,
    cwd: string,
    onFilesChanged?: (paths: readonly string[]) => void,
    onChunk?: (delta: string) => void
  ): Promise<string>;
  newSession(cwd: string): Promise<string>;
  resumeSession(cwd: string, sessionId: string): Promise<string>;
  getModelMenu(cwd: string): Promise<ModelMenu>;
  selectModelChoice(cwd: string, selection: ModelSelection, context?: string): Promise<void>;
  getActiveWorkspacePath(): string | undefined;
  getCurrentSessionId(): string | undefined;
  refreshStatus(): Promise<void>;
  cancelCurrentWork(): boolean;
  stop(): void;
}

export async function resolveAndSelectModel(
  service: {
    listModels(path: string): Promise<ModelMenu>;
    selectModel(path: string, selection: ModelSelection, context: string): Promise<void>;
  },
  path: string,
  selection: ModelSelection,
  context?: string
): Promise<void> {
  let effectiveContext = context;
  let effectiveEffort = selection.effort;
  let effectiveModel = selection.model;
  if (!effectiveContext || !effectiveEffort) {
    const menu = await service.listModels(path);
    effectiveContext = effectiveContext || menu.context;
    const found = menu.models.find((m) => m.model === selection.model || m.id === selection.model);
    if (found) {
      effectiveModel = found.model;
      if (
        !effectiveEffort ||
        !found.supportedReasoningEfforts.some((e) => e.reasoningEffort === effectiveEffort)
      ) {
        effectiveEffort =
          found.defaultReasoningEffort ||
          found.supportedReasoningEfforts[0]?.reasoningEffort ||
          'medium';
      }
    }
  }
  await service.selectModel(
    path,
    { model: effectiveModel, effort: effectiveEffort },
    effectiveContext ?? ''
  );
}

export function classifyProcessError(
  agentName: string,
  versionCommand: string,
  cause: unknown,
  binaryLabel = agentName
): { code: 'not_installed' | 'process_failed'; message: string } {
  if ((cause as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return {
      code: 'not_installed',
      message: `${binaryLabel} est introuvable. Vérifiez « ${versionCommand} » dans le terminal de VS Code, puis relancez VS Code après installation.`,
    };
  }
  return {
    code: 'process_failed',
    message: `La connexion au processus ${agentName} a été perdue. Vérifiez les modifications éventuelles avant une nouvelle instruction. La session sera reprise si elle est encore disponible.`,
  };
}

export function formatTurnTimeoutMessage(
  agentName: string,
  confirmed: boolean,
  elapsedSeconds = 120
): string {
  return confirmed
    ? `Le délai de ${elapsedSeconds} s est dépassé. ${agentName} a confirmé la fin du turn. Vérifiez les modifications éventuelles avant une nouvelle instruction.`
    : `Le délai de ${elapsedSeconds} s est dépassé et la fin du turn n’a pas été confirmée. Nexus a fermé la connexion et demandé l’arrêt du processus. Vérifiez les commandes et modifications éventuelles avant de continuer.`;
}
