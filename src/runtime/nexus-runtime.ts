import { RuntimeDashboard, AgentDashboard, QuotaMetric } from './dashboard-types';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { AntigravityService } from '../antigravity/service';
import { WorkspaceAntigravitySessionPersistence } from '../antigravity/persistence';
import { WorkspaceAntigravityModelPreferences } from '../antigravity/model-preferences';
import { CodexService } from '../codex/service';
import { WorkspaceSessionPersistence } from '../codex/persistence';
import { WorkspaceModelPreferences } from '../codex/model-preferences';
import { ModelMenu, ModelSelection } from '../codex/types';
import { CodexBrainModel } from '../conversational/codex-model';
import { CodexProjectInspector } from '../conversational/codex-inspector';
import { ConversationalService } from '../conversational/service';
import { FileBrainSessionPersistence } from '../conversational/persistence';
import { BrainModel } from '../conversational/model';
import { OllamaBrainModel, listOllamaModels } from '../conversational/ollama-model';
import { RoutedBrainModel } from '../conversational/routed-model';
import { CodingAgentTools } from '../conversational/tools';
import { ConversationProjectContext } from '../conversational/types';
import { formatFileSummary } from '../telegram/file-summary';
import { AgentBackendType, NexusStatusSnapshot } from '../telegram/status';
import { WorkspaceBranch, WorkspaceGuard } from '../workspace/guard';
import { DecisionRecordInput, ProjectDecision, ProjectMemorySnapshot } from '../memory/types';
import { ProjectMemory } from '../memory/project-memory';
import { MemoryStorage } from './storage';
import { getDefaultCodeDirectory } from './workspace';
import {
  NexusRuntimeOptions,
  RemoteBranchAction,
  RemoteSessionAction,
  TaskBackendType,
  TaskExecutionResult,
} from './types';

export class NexusRuntime {
  private readonly startedAt = Date.now();
  private readonly workspaceGuard: WorkspaceGuard;
  private readonly targetPathSupplier?: () => string;
  private readonly codexService: CodexService;
  private readonly antigravityService: AntigravityService;
  private readonly conversationalService: ConversationalService;
  private readonly brainModel: BrainModel;
  private readonly projectMemory: ProjectMemory;
  private activeBackend: AgentBackendType;

  constructor(options: NexusRuntimeOptions) {
    this.workspaceGuard = options.workspaceGuard;
    this.targetPathSupplier = options.targetPath;
    this.activeBackend = options.defaultBackend ?? 'codex';
    this.projectMemory = options.projectMemory ?? new ProjectMemory();

    const memoryStorage = new MemoryStorage();

    const codexPersistence =
      options.codexPersistence ?? new WorkspaceSessionPersistence(memoryStorage);
    const codexModelPreferences =
      options.codexModelPreferences ?? new WorkspaceModelPreferences(memoryStorage);

    this.codexService = new CodexService(
      async (request, signal) => {
        if (!options.requestApproval) {
          return 'decline';
        }
        return options.requestApproval(
          { ...request, agentName: request.agentName ?? 'Codex' },
          signal
        );
      },
      (path) => this.workspaceGuard.validate(path),
      codexPersistence,
      codexModelPreferences,
      {
        turnTimeoutHandler: options.requestTurnTimeoutContinuation,
      }
    );

    const agyPersistence =
      options.antigravityPersistence ?? new WorkspaceAntigravitySessionPersistence(memoryStorage);
    const agyModelPreferences =
      options.antigravityModelPreferences ??
      new WorkspaceAntigravityModelPreferences(memoryStorage);

    this.antigravityService = new AntigravityService(
      async (request, signal) => {
        if (!options.requestApproval) {
          return 'decline';
        }
        return options.requestApproval({ ...request, agentName: 'Antigravity' }, signal);
      },
      (path) => this.workspaceGuard.validate(path),
      agyPersistence,
      agyModelPreferences,
      {
        executablePath: options.antigravityConfig?.executablePath,
        sandbox: options.antigravityConfig?.sandbox ?? true,
        dangerouslySkipPermissions: options.antigravityConfig?.dangerouslySkipPermissions ?? false,
        turnTimeoutHandler: options.requestTurnTimeoutContinuation,
      }
    );

    const codingTools = new CodingAgentTools({
      resolveWorkspace: (targetPath?: string) => this.resolveWorkspaceForInspection(targetPath),
      inspector: new CodexProjectInspector((path) => this.resolveWorkspaceForInspection(path)),
      requestConsent: async (request, signal) => {
        if (!options.requestApproval) {
          return false;
        }
        const decision = await options.requestApproval(
          {
            kind: 'inspection',
            agentName: 'Nexus Brain',
            details: `Projet : ${request.project.name}\nBranche : ${request.project.branch ?? 'sans dépôt'}\n\n${request.question}`,
            expiresAt: request.expiresAt,
          },
          signal
        );
        return decision === 'accept';
      },
      projectMemory: this.projectMemory,
      listProjects: options.listProjects,
      switchProject: options.switchProject,
    });

    const brainModel =
      options.brainModel ??
      (process.env.NEXUS_BRAIN_BACKEND === 'codex'
        ? new CodexBrainModel()
        : new RoutedBrainModel());
    this.brainModel = brainModel;
    const brainPersistence =
      options.brainPersistence ??
      new FileBrainSessionPersistence(resolve(homedir(), '.nexus', 'brain-sessions'));
    this.conversationalService = new ConversationalService(
      brainModel,
      codingTools,
      brainPersistence
    );
  }

  private async resolveWorkspaceForInspection(targetPath?: string) {
    const resolvedPath = this.resolveTargetPath(targetPath);
    const guard = new WorkspaceGuard(() => ({
      trusted: true,
      folders: [{ scheme: 'file', path: resolvedPath }],
      dirtyDocuments: [],
      protectedBranches: [],
    }));
    return guard.validate(resolvedPath);
  }

  resolveTargetPath(explicitPath?: string): string {
    if (explicitPath?.trim()) {
      return resolve(explicitPath.trim());
    }
    if (this.targetPathSupplier) {
      return this.targetPathSupplier();
    }
    const guardPath = this.workspaceGuard.targetPath();
    if (guardPath) {
      return guardPath;
    }
    return getDefaultCodeDirectory();
  }

  getActiveBackend(): AgentBackendType {
    return this.activeBackend;
  }

  setActiveBackend(backend: AgentBackendType): void {
    this.activeBackend = backend;
  }

  getCodexService(): CodexService {
    return this.codexService;
  }

  getAntigravityService(): AntigravityService {
    return this.antigravityService;
  }

  getBrainService(): ConversationalService {
    return this.conversationalService;
  }

  getWorkspaceGuard(): WorkspaceGuard {
    return this.workspaceGuard;
  }

  async executeTask(
    backend: TaskBackendType,
    prompt: string,
    options?: {
      targetPath?: string;
      onFilesChanged?: (paths: readonly string[]) => void;
      signal?: AbortSignal;
      disableContextAugmentation?: boolean;
    }
  ): Promise<TaskExecutionResult> {
    if (backend === 'brain') {
      const text = await this.executeBrain(
        prompt,
        options?.signal ?? new AbortController().signal,
        {
          targetPath: options?.targetPath,
        }
      );
      return { text };
    }

    const path = this.resolveTargetPath(options?.targetPath);
    const effectivePrompt = options?.disableContextAugmentation
      ? prompt
      : this.projectMemory.augmentPrompt(prompt, path);
    let files: readonly string[] = [];

    const onFiles = (paths: readonly string[]) => {
      files = paths;
      options?.onFilesChanged?.(paths);
    };

    let text: string;
    let fileSummary: string | undefined;

    if (backend === 'codex') {
      text = await this.codexService.sendPrompt(effectivePrompt, path, onFiles);
      fileSummary = formatFileSummary(files, this.codexService.getStatus().workspacePath ?? path);
    } else {
      text = await this.antigravityService.sendPrompt(effectivePrompt, path, onFiles);
      fileSummary = formatFileSummary(
        files,
        this.antigravityService.getStatus().workspacePath ?? path
      );
    }

    return {
      text,
      fileSummary,
      filesChanged: files,
    };
  }

  async executeBrain(
    message: string,
    signal: AbortSignal,
    options?: {
      conversationId?: string;
      projectContext?: ConversationProjectContext;
      targetPath?: string;
    }
  ): Promise<string> {
    const path = this.resolveTargetPath(options?.targetPath);
    const workspace = await this.workspaceGuard.validate(path).catch(() => undefined);
    const folderName = basename(path);
    const contextSnapshot = this.projectMemory.buildAgentContext(path);

    const project: ConversationProjectContext | undefined =
      options?.projectContext ??
      (workspace || contextSnapshot.hasContext
        ? {
            name: folderName,
            branch: workspace?.git?.branch,
            preferences: contextSnapshot.preferences || undefined,
            decisionsSummary: contextSnapshot.decisionsSummary || undefined,
          }
        : undefined);

    const conversationId = options?.conversationId ?? `brain:${path}`;

    const reply = await this.conversationalService.respond(
      {
        conversationId,
        message,
        project,
      },
      signal
    );

    return reply.text;
  }

  async clearBrainConversation(targetPath?: string): Promise<void> {
    const path = this.resolveTargetPath(targetPath);
    await this.conversationalService.clearConversation(`brain:${path}`);
  }

  async handleSessionAction(
    backend: 'codex' | 'antigravity',
    action: RemoteSessionAction,
    targetPath?: string
  ): Promise<string> {
    const path = this.resolveTargetPath(targetPath);
    if (backend === 'codex') {
      return action.type === 'new'
        ? await this.codexService.newSession(path)
        : await this.codexService.resumeSession(path, action.sessionId);
    }
    return action.type === 'new'
      ? await this.antigravityService.newSession(path)
      : await this.antigravityService.resumeSession(path, action.sessionId);
  }

  async switchBranch(name: string, targetPath?: string): Promise<string> {
    const path = this.resolveTargetPath(targetPath);
    const runner = this.codexService ?? this.antigravityService;
    const branch = await runner.withWorkspaceOperation(() =>
      this.workspaceGuard.switchBranch(path, name)
    );
    const hasSession = Boolean(
      this.codexService.getCurrentSessionId() || this.antigravityService.getCurrentSessionId()
    );
    return (
      `✅ Branche courante : ${branch}.` +
      (hasSession
        ? '\nAvant le prochain prompt, utilisez /new ou /resume <id> pour associer la session à cette branche.'
        : '')
    );
  }

  async listBranches(targetPath?: string): Promise<readonly WorkspaceBranch[]> {
    const path = this.resolveTargetPath(targetPath);
    return this.workspaceGuard.listBranches(path);
  }

  async handleBranchAction(action: RemoteBranchAction, targetPath?: string): Promise<string> {
    if (action.type === 'switch') {
      return this.switchBranch(action.name, targetPath);
    }
    const path = this.resolveTargetPath(targetPath);
    const branches = await this.workspaceGuard.listBranches(path);
    return [
      'Branches disponibles (références Git connues localement) :',
      ...branches.map(
        (branch) =>
          `${branch.current ? '→ ' : '• '}${branch.name}${branch.remote ? ' (distante)' : ''}${branch.protected ? ' 🔒 protégée' : ''}`
      ),
      branches.length
        ? 'Choisir : /switch <nom exact>\nExemples : /switch staging ou /switch origin/staging'
        : 'Aucune branche disponible.',
    ].join('\n');
  }

  async listModels(
    backend: 'codex' | 'antigravity' | 'brain',
    targetPath?: string
  ): Promise<ModelMenu> {
    const path = this.resolveTargetPath(targetPath);
    if (backend === 'codex') {
      return this.codexService.listModels(path);
    }
    if (backend === 'antigravity') {
      return this.antigravityService.listModels(path);
    }

    if (this.brainModel instanceof RoutedBrainModel) return this.brainModel.listModels();

    let availableModels: string[] = [];
    try {
      if (this.brainModel instanceof OllamaBrainModel) {
        availableModels = await listOllamaModels(this.brainModel.getHost());
      }
    } catch {
      // Ollama unreachable, fallback
    }

    const currentModel =
      typeof (this.brainModel as unknown as { getModel?: () => string }).getModel === 'function'
        ? (this.brainModel as unknown as { getModel: () => string }).getModel()
        : 'qwen3.6:27b-mtp-q4_K_M';

    if (availableModels.length === 0) {
      availableModels = [currentModel];
    } else if (!availableModels.includes(currentModel)) {
      availableModels.unshift(currentModel);
    }

    const models = availableModels.map((m) => ({
      id: m,
      model: m,
      displayName: m,
      description:
        this.brainModel instanceof OllamaBrainModel ? 'Modèle local Ollama' : 'Modèle Brain',
      isDefault: m === currentModel,
      defaultReasoningEffort: '',
      supportedReasoningEfforts: [{ reasoningEffort: '', description: 'Par défaut' }],
    }));

    return {
      models,
      selected: { model: currentModel, effort: '' },
      context: `brain:${Date.now()}`,
    };
  }

  async selectModel(
    backend: 'codex' | 'antigravity' | 'brain',
    selection: ModelSelection,
    context?: string,
    targetPath?: string
  ): Promise<void> {
    const path = this.resolveTargetPath(targetPath);
    if (backend === 'codex') {
      await this.codexService.selectModel(path, selection, context ?? '');
    } else if (backend === 'antigravity') {
      await this.antigravityService.selectModel(path, selection, context ?? '');
    } else if (backend === 'brain') {
      if (
        typeof (this.brainModel as unknown as { setModel?: (m: string) => void }).setModel ===
        'function'
      ) {
        (this.brainModel as unknown as { setModel: (m: string) => void }).setModel(selection.model);
      }
    }
  }

  async getDashboard(): Promise<RuntimeDashboard> {
    const [brain] = await Promise.all([
      this.brainModel instanceof RoutedBrainModel
        ? this.brainModel.getDashboard()
        : Promise.resolve({
            selection:
              this.brainModel instanceof OllamaBrainModel
                ? `ollama:${this.brainModel.getModel()}`
                : this.brainModel instanceof CodexBrainModel
                  ? 'codex'
                  : 'custom',
            providers: [],
          }),
      this.codexService.refreshStatus(),
    ]);
    const codex = this.codexService.getStatus();
    const antigravity = this.antigravityService.getStatus();
    const agents: AgentDashboard[] = (['codex', 'antigravity'] as const).map((id) => {
      const status = id === 'codex' ? codex : antigravity;
      const limits: QuotaMetric[] = [];
      if (id === 'codex')
        for (const [index, snapshot] of (codex.rateLimits ?? []).entries()) {
          for (const key of ['primary', 'secondary'] as const) {
            const window = snapshot[key];
            if (!window || !Number.isFinite(window.usedPercent)) continue;
            const used = Math.min(100, Math.max(0, window.usedPercent));
            const minutes = window.windowDurationMins;
            limits.push({
              id: `${index}-${key}`,
              label: `${snapshot.limitName ?? 'Codex'} · ${minutes ? (minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`) : key === 'primary' ? 'fenêtre principale' : 'fenêtre secondaire'}`,
              unit: 'percent',
              limit: 100,
              used,
              remaining: 100 - used,
              resetsAt: window.resetsAt ? window.resetsAt * 1000 : undefined,
              observedAt: codex.rateLimitsUpdatedAt ?? Date.now(),
            });
          }
        }
      return {
        id,
        state: status.turn ? 'running' : status.sessionActive ? 'ready' : 'stopped',
        model:
          id === 'codex'
            ? (codex.reroutedModel ?? status.model ?? status.modelSelection?.model)
            : (status.model ?? status.modelSelection?.model),
        totalTokens: status.tokenUsage?.total.totalTokens,
        limits,
        observedAt: status.tokenUsageUpdatedAt,
      };
    });
    return { generatedAt: Date.now(), startedAt: this.startedAt, brain, agents };
  }

  async getStatus(targetPath?: string): Promise<NexusStatusSnapshot> {
    await this.codexService.refreshStatus();
    await this.antigravityService.refreshStatus();

    let workspace: { name: string; path: string } | undefined;
    try {
      const resolved = this.resolveTargetPath(targetPath);
      workspace = { name: basename(resolved), path: resolved };
    } catch {
      workspace = undefined;
    }

    return {
      workspace,
      workspaceCount: workspace ? 1 : 0,
      activeBackend: this.activeBackend,
      brain:
        this.brainModel instanceof RoutedBrainModel
          ? this.brainModel.getStatus()
          : this.brainModel instanceof OllamaBrainModel
            ? { provider: 'ollama', model: this.brainModel.getModel() }
            : { provider: this.brainModel instanceof CodexBrainModel ? 'codex' : 'custom' },
      codex: this.codexService.getStatus(),
      antigravity: this.antigravityService.getStatus(),
    };
  }

  getProjectMemory(): ProjectMemory {
    return this.projectMemory;
  }

  getProjectMemorySnapshot(targetPath?: string): ProjectMemorySnapshot {
    const path = this.resolveTargetPath(targetPath);
    return this.projectMemory.getSnapshot(path);
  }

  recordProjectDecision(input: DecisionRecordInput, targetPath?: string): ProjectDecision {
    const path = this.resolveTargetPath(targetPath);
    return this.projectMemory.recordDecision(path, input);
  }

  clearProjectMemory(targetPath?: string): void {
    const path = this.resolveTargetPath(targetPath);
    this.projectMemory.clearMemory(path);
  }

  cancelCurrentWork(): boolean {
    const codexCancelled = this.codexService.cancelCurrentWork();
    const agyCancelled = this.antigravityService.cancelCurrentWork();
    return codexCancelled || agyCancelled;
  }

  stop(): void {
    this.codexService.stop();
    this.antigravityService.stop();
  }
}
