import { basename } from 'node:path';
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
import { CodingAgentTools } from '../conversational/tools';
import { ConversationProjectContext } from '../conversational/types';
import { formatFileSummary } from '../telegram/file-summary';
import { AgentBackendType, NexusStatusSnapshot } from '../telegram/status';
import { WorkspaceBranch, WorkspaceGuard } from '../workspace/guard';
import { MemoryStorage } from './storage';
import {
  NexusRuntimeOptions,
  RemoteBranchAction,
  RemoteSessionAction,
  TaskBackendType,
  TaskExecutionResult,
} from './types';

export class NexusRuntime {
  private readonly workspaceGuard: WorkspaceGuard;
  private readonly targetPathSupplier?: () => string;
  private readonly codexService: CodexService;
  private readonly antigravityService: AntigravityService;
  private readonly conversationalService: ConversationalService;
  private activeBackend: AgentBackendType;

  constructor(options: NexusRuntimeOptions) {
    this.workspaceGuard = options.workspaceGuard;
    this.targetPathSupplier = options.targetPath;
    this.activeBackend = options.defaultBackend ?? 'codex';

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
      resolveWorkspace: () => this.workspaceGuard.validate(this.resolveTargetPath()),
      inspector: new CodexProjectInspector((path) => this.workspaceGuard.validate(path)),
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
    });

    const brainModel = options.brainModel ?? new CodexBrainModel();
    this.conversationalService = new ConversationalService(brainModel, codingTools);
  }

  resolveTargetPath(explicitPath?: string): string {
    if (explicitPath?.trim()) {
      return explicitPath.trim();
    }
    if (this.targetPathSupplier) {
      return this.targetPathSupplier();
    }
    return this.workspaceGuard.targetPath();
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
    let files: readonly string[] = [];

    const onFiles = (paths: readonly string[]) => {
      files = paths;
      options?.onFilesChanged?.(paths);
    };

    let text: string;
    let fileSummary: string | undefined;

    if (backend === 'codex') {
      text = await this.codexService.sendPrompt(prompt, path, onFiles);
      fileSummary = formatFileSummary(files, this.codexService.getStatus().workspacePath ?? path);
    } else {
      text = await this.antigravityService.sendPrompt(prompt, path, onFiles);
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

    const project =
      options?.projectContext ??
      (workspace ? { name: folderName, branch: workspace.git?.branch } : undefined);

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

  async listModels(backend: 'codex' | 'antigravity', targetPath?: string): Promise<ModelMenu> {
    const path = this.resolveTargetPath(targetPath);
    return backend === 'codex'
      ? this.codexService.listModels(path)
      : this.antigravityService.listModels(path);
  }

  async selectModel(
    backend: 'codex' | 'antigravity',
    selection: ModelSelection,
    context: string,
    targetPath?: string
  ): Promise<void> {
    const path = this.resolveTargetPath(targetPath);
    if (backend === 'codex') {
      await this.codexService.selectModel(path, selection, context);
    } else {
      await this.antigravityService.selectModel(path, selection, context);
    }
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
      codex: this.codexService.getStatus(),
      antigravity: this.antigravityService.getStatus(),
    };
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
