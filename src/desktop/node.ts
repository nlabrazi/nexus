import { NexusRuntime } from '../runtime/nexus-runtime';
import { RuntimeApprovalHandler, TurnTimeoutHandler } from '../runtime/types';
import { createStandaloneWorkspaceGuard } from '../runtime/workspace';
import { WorkspaceGuard } from '../workspace/guard';
import { BrainModel } from '../conversational/model';
import {
  DesktopBrainOptions,
  DesktopExecutionResult,
  DesktopNodeConfig,
  DesktopNodeStatus,
  DesktopTaskOptions,
  NodeCapabilities,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  TaskBackend,
} from './types';
import { DesktopCoreClient, DesktopCoreClientOptions } from './ws-client';

export interface DesktopNodeOptions {
  readonly runtime?: NexusRuntime;
  readonly requestApproval?: RuntimeApprovalHandler;
  readonly requestTurnTimeoutContinuation?: TurnTimeoutHandler;
  readonly brainModel?: BrainModel;
  readonly coreClient?: DesktopCoreClient;
}

export class DesktopNode {
  private state: NodeState = 'draining';
  private activeTaskId?: string;
  private readonly projectSummaries: NodeProjectSummary[] = [];
  private readonly projectMap = new Map<string, NodeProjectSummary>();
  private readonly guardMap = new Map<string, WorkspaceGuard>();
  private activeProjectIndex = 0;
  private runtime?: NexusRuntime;
  private coreClient?: DesktopCoreClient;
  private readonly startTime: number;

  constructor(
    private readonly config: DesktopNodeConfig,
    private readonly options?: DesktopNodeOptions
  ) {
    this.startTime = Date.now();
  }

  async start(): Promise<DesktopNodeStatus> {
    if (this.config.projects.length === 0) {
      throw new Error('Aucun projet configuré dans DesktopNode.');
    }

    this.projectSummaries.length = 0;
    this.projectMap.clear();
    this.guardMap.clear();

    for (const projectConfig of this.config.projects) {
      const guard = createStandaloneWorkspaceGuard(projectConfig.path, {
        protectedBranches: projectConfig.protectedBranches ?? this.config.protectedBranches,
      });

      const workspace = await guard.validate(projectConfig.path).catch(() => undefined);
      const summary: NodeProjectSummary = {
        id: projectConfig.id ?? projectConfig.name ?? 'project',
        name: projectConfig.name ?? 'project',
        path: projectConfig.path,
        currentBranch: workspace?.git?.branch,
      };

      this.projectSummaries.push(summary);
      this.projectMap.set(summary.id, summary);
      this.projectMap.set(summary.path, summary);
      this.guardMap.set(summary.id, guard);
      this.guardMap.set(summary.path, guard);
    }

    this.activeProjectIndex = 0;
    const activeProject = this.getActiveProject();
    const activeGuard = this.guardMap.get(activeProject.id)!;

    if (this.options?.runtime) {
      this.runtime = this.options.runtime;
    } else {
      this.runtime = new NexusRuntime({
        workspaceGuard: activeGuard,
        targetPath: () => this.getActiveProject().path,
        defaultBackend: this.config.defaultBackend === 'antigravity' ? 'antigravity' : 'codex',
        requestApproval: this.options?.requestApproval,
        requestTurnTimeoutContinuation: this.options?.requestTurnTimeoutContinuation,
        brainModel: this.options?.brainModel,
      });
    }

    this.state = 'idle';

    if (this.config.coreUrl) {
      await this.connectToCore(this.config.coreUrl, this.config.authToken);
    }

    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.state = 'draining';
    this.disconnectFromCore();
    if (this.runtime) {
      this.runtime.cancelCurrentWork();
      this.runtime.stop();
    }
  }

  getState(): NodeState {
    return this.state;
  }

  getNodeId(): string {
    return this.config.nodeId ?? 'unknown-node';
  }

  getNodeName(): string {
    return this.config.nodeName ?? 'nexus-desktop';
  }

  getCapabilities(): NodeCapabilities {
    return {
      backends: ['codex', 'antigravity', 'brain'],
      speech: {
        stt: false,
        tts: false,
      },
      workspaceGuard: true,
    };
  }

  getProjects(): readonly NodeProjectSummary[] {
    return [...this.projectSummaries];
  }

  getProject(idOrPath: string): NodeProjectSummary | undefined {
    return this.projectMap.get(idOrPath);
  }

  getActiveProject(): NodeProjectSummary {
    if (this.projectSummaries.length === 0) {
      throw new Error('Aucun projet initialisé.');
    }
    return this.projectSummaries[this.activeProjectIndex];
  }

  setActiveProject(idOrPath: string): NodeProjectSummary {
    const found = this.projectMap.get(idOrPath);
    if (!found) {
      throw new Error(`Projet inconnu : ${idOrPath}`);
    }
    const index = this.projectSummaries.findIndex((p) => p.id === found.id);
    if (index !== -1) {
      this.activeProjectIndex = index;
    }
    return found;
  }

  createHelloPayload(authToken?: string): NodeHelloPayload {
    return {
      nodeId: this.getNodeId(),
      nodeName: this.getNodeName(),
      version: '0.4.1',
      authToken: authToken ?? this.config.authToken ?? '',
      capabilities: this.getCapabilities(),
      projects: this.getProjects(),
    };
  }

  createHeartbeatPayload(): NodeHeartbeatPayload {
    return {
      nodeId: this.getNodeId(),
      timestamp: Date.now(),
      state: this.state,
      activeTaskId: this.activeTaskId,
    };
  }

  createStatusPayload(): NodeStatusPayload {
    return {
      nodeId: this.getNodeId(),
      state: this.state,
      activeTaskId: this.activeTaskId,
      activeProject: this.projectSummaries.length > 0 ? this.getActiveProject() : undefined,
    };
  }

  async executeTask(
    backend: TaskBackend,
    prompt: string,
    options?: DesktopTaskOptions
  ): Promise<DesktopExecutionResult> {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }
    if (this.state === 'busy') {
      throw new Error('Le Desktop Node est déjà occupé par une autre tâche.');
    }
    if (this.state === 'draining') {
      throw new Error('Le Desktop Node est en cours d’arrêt.');
    }

    const targetProject = options?.projectId
      ? this.getProject(options.projectId)
      : this.getActiveProject();

    if (!targetProject) {
      throw new Error(`Projet cible introuvable : ${options?.projectId}`);
    }

    this.state = 'busy';
    try {
      const result = await this.runtime.executeTask(backend, prompt, {
        targetPath: targetProject.path,
        onFilesChanged: options?.onFilesChanged,
        signal: options?.signal,
      });

      return {
        ...result,
        projectId: targetProject.id,
        projectPath: targetProject.path,
      };
    } finally {
      if (this.state === 'busy') {
        this.state = 'idle';
      }
    }
  }

  async executeBrain(
    message: string,
    signal: AbortSignal,
    options?: DesktopBrainOptions
  ): Promise<string> {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }
    if (this.state === 'busy') {
      throw new Error('Le Desktop Node est déjà occupé par une autre tâche.');
    }
    if (this.state === 'draining') {
      throw new Error('Le Desktop Node est en cours d’arrêt.');
    }

    const targetProject = options?.projectId
      ? this.getProject(options.projectId)
      : this.getActiveProject();

    if (!targetProject) {
      throw new Error(`Projet cible introuvable : ${options?.projectId}`);
    }

    this.state = 'busy';
    try {
      return await this.runtime.executeBrain(message, signal, {
        targetPath: targetProject.path,
        conversationId: options?.conversationId,
      });
    } finally {
      if (this.state === 'busy') {
        this.state = 'idle';
      }
    }
  }

  async connectToCore(
    coreUrl: string,
    authToken?: string,
    clientOptions?: DesktopCoreClientOptions
  ): Promise<DesktopCoreClient> {
    if (this.coreClient) {
      this.coreClient.disconnect();
    }
    this.coreClient = new DesktopCoreClient(
      coreUrl,
      authToken ?? this.config.authToken ?? '',
      this,
      clientOptions
    );
    await this.coreClient.connect();
    return this.coreClient;
  }

  disconnectFromCore(): void {
    if (this.coreClient) {
      this.coreClient.disconnect();
      this.coreClient = undefined;
    }
  }

  getCoreClient(): DesktopCoreClient | undefined {
    return this.coreClient;
  }

  async getStatus(): Promise<DesktopNodeStatus> {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }

    const runtimeStatus = await this.runtime.getStatus(this.getActiveProject().path);
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      nodeId: this.getNodeId(),
      nodeName: this.getNodeName(),
      state: this.state,
      activeTaskId: this.activeTaskId,
      projects: this.getProjects(),
      activeProject: this.getActiveProject(),
      capabilities: this.getCapabilities(),
      uptimeSeconds,
      runtimeStatus,
      coreConnection: this.coreClient
        ? {
            status: this.coreClient.getStatus(),
            url: this.coreClient.getWsUrl(),
            sessionId: this.coreClient.getSessionId(),
          }
        : undefined,
    };
  }

  getRuntime(): NexusRuntime | undefined {
    return this.runtime;
  }
}
