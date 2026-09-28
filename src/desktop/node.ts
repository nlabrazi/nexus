import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { NexusRuntime } from '../runtime/nexus-runtime';
import {
  RuntimeApprovalHandler,
  RuntimeApprovalRequest,
  TurnTimeoutHandler,
} from '../runtime/types';
import { createStandaloneWorkspaceGuard, getDefaultCodeDirectory } from '../runtime/workspace';
import { isProjectDir } from './config';
import { WorkspaceGuard } from '../workspace/guard';
import { BrainModel } from '../conversational/model';
import { DecisionRecordInput, ProjectDecision, ProjectMemorySnapshot } from '../memory/types';
import { createNexusMessage } from '../protocol/messages';
import {
  AnyNexusMessage,
  ApprovalCancelReason,
  ApprovalCancelledPayload,
  ApprovalDecision,
  ApprovalDecisionPayload,
  ApprovalKind,
  NodeSwitchProjectPayload,
  TaskCancelPayload,
  TaskStartPayload,
} from '../protocol/types';
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
  private activeTaskAbortController?: AbortController;
  private readonly projectSummaries: NodeProjectSummary[] = [];
  private readonly projectMap = new Map<string, NodeProjectSummary>();
  private readonly guardMap = new Map<string, WorkspaceGuard>();
  private activeProjectIndex = 0;
  private runtime?: NexusRuntime;
  private coreClient?: DesktopCoreClient;
  private readonly startTime: number;
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (d: ApprovalDecision) => void;
      reject: (err: unknown) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly config: DesktopNodeConfig,
    private readonly options?: DesktopNodeOptions
  ) {
    this.startTime = Date.now();
    if (this.options?.coreClient) {
      this.coreClient = this.options.coreClient;
      this.attachCoreClientListeners(this.coreClient);
    }
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
      const delegatingGuard = {
        validate: async (path: string) => {
          const current = this.getActiveProject();
          const guard =
            this.guardMap.get(current.id) ?? this.guardMap.get(current.path) ?? activeGuard;
          return guard.validate(path);
        },
        listBranches: async (path: string) => {
          const current = this.getActiveProject();
          const guard =
            this.guardMap.get(current.id) ?? this.guardMap.get(current.path) ?? activeGuard;
          return guard.listBranches(path);
        },
        switchBranch: async (path: string, branch: string) => {
          const current = this.getActiveProject();
          const guard =
            this.guardMap.get(current.id) ?? this.guardMap.get(current.path) ?? activeGuard;
          return guard.switchBranch(path, branch);
        },
        targetPath: () => {
          const current = this.getActiveProject();
          const guard =
            this.guardMap.get(current.id) ?? this.guardMap.get(current.path) ?? activeGuard;
          return guard.targetPath();
        },
      } as unknown as WorkspaceGuard;

      this.runtime = new NexusRuntime({
        workspaceGuard: delegatingGuard,
        targetPath: () => this.getActiveProject().path,
        defaultBackend: this.config.defaultBackend === 'antigravity' ? 'antigravity' : 'codex',
        requestApproval: (req, sig) => this.handleApprovalRequest(req, sig),
        requestTurnTimeoutContinuation: this.options?.requestTurnTimeoutContinuation,
        brainModel: this.options?.brainModel,
        listProjects: () => {
          const current = this.getActiveProject();
          const list = this.getProjects().map((p) => ({
            id: p.id,
            name: p.name,
            path: p.path,
            currentBranch: p.currentBranch,
            isCurrent: p.id === current.id || p.path === current.path,
          }));
          try {
            const codeDir = getDefaultCodeDirectory();
            const scanDirs = [dirname(current.path)];
            if (
              existsSync(codeDir) &&
              statSync(codeDir).isDirectory() &&
              !scanDirs.includes(codeDir)
            ) {
              scanDirs.push(codeDir);
            }
            for (const dir of scanDirs) {
              const isSystemDir =
                dir === '/' || dir === '/tmp' || dir === '/home' || dir === '/var';
              if (!isSystemDir && existsSync(dir) && statSync(dir).isDirectory()) {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  if (
                    entry.isDirectory() &&
                    !entry.name.startsWith('.') &&
                    entry.name !== 'node_modules'
                  ) {
                    const siblingPath = resolve(dir, entry.name);
                    if (isProjectDir(siblingPath) && !list.some((p) => p.path === siblingPath)) {
                      list.push({
                        id: entry.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
                        name: entry.name,
                        path: siblingPath,
                        currentBranch: undefined,
                        isCurrent: false,
                      });
                    }
                  }
                }
              }
            }
          } catch {}
          return list;
        },
        switchProject: (idOrPath) => {
          const switched = this.setActiveProject(idOrPath);
          return {
            id: switched.id,
            name: switched.name,
            path: switched.path,
            currentBranch: switched.currentBranch,
            isCurrent: true,
          };
        },
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
    this.cancelAllPendingApprovals('task_aborted');
    if (this.activeTaskAbortController) {
      this.activeTaskAbortController.abort(new Error('DesktopNode en cours d’arrêt.'));
      this.activeTaskAbortController = undefined;
    }
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
    let found = this.projectMap.get(idOrPath);
    if (!found) {
      const resolved = resolve(idOrPath);
      found = this.projectMap.get(resolved);
      if (!found) {
        const lower = idOrPath.toLowerCase().trim();
        found = this.projectSummaries.find(
          (p) => p.name.toLowerCase() === lower || p.id.toLowerCase() === lower
        );
      }
      if (!found && existsSync(resolved) && statSync(resolved).isDirectory()) {
        const name = basename(resolved);
        const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const guard = createStandaloneWorkspaceGuard(resolved, {
          protectedBranches: this.config.protectedBranches ?? [],
        });
        const summary: NodeProjectSummary = {
          id,
          name,
          path: resolved,
        };
        this.projectSummaries.push(summary);
        this.projectMap.set(summary.id, summary);
        this.projectMap.set(summary.path, summary);
        this.guardMap.set(summary.id, guard);
        this.guardMap.set(summary.path, guard);
        found = summary;
      }
      if (!found) {
        const codeDir = getDefaultCodeDirectory();
        const candidateUnderCode = resolve(codeDir, idOrPath);
        if (existsSync(candidateUnderCode) && statSync(candidateUnderCode).isDirectory()) {
          const name = basename(candidateUnderCode);
          const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
          const guard = createStandaloneWorkspaceGuard(candidateUnderCode, {
            protectedBranches: this.config.protectedBranches ?? [],
          });
          const summary: NodeProjectSummary = {
            id,
            name,
            path: candidateUnderCode,
          };
          this.projectSummaries.push(summary);
          this.projectMap.set(summary.id, summary);
          this.projectMap.set(summary.path, summary);
          this.guardMap.set(summary.id, guard);
          this.guardMap.set(summary.path, guard);
          found = summary;
        }
      }
    }
    if (!found) {
      throw new Error(`Projet inconnu : ${idOrPath}`);
    }
    const index = this.projectSummaries.findIndex(
      (p) => p.id === found!.id || p.path === found!.path
    );
    if (index !== -1) {
      this.activeProjectIndex = index;
    }
    return found;
  }

  getProjectMemorySnapshot(projectId?: string): ProjectMemorySnapshot {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }
    const project = projectId ? this.getProject(projectId) : this.getActiveProject();
    if (!project) {
      throw new Error(`Projet cible introuvable : ${projectId}`);
    }
    return this.runtime.getProjectMemorySnapshot(project.path);
  }

  recordProjectDecision(input: DecisionRecordInput, projectId?: string): ProjectDecision {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }
    const project = projectId ? this.getProject(projectId) : this.getActiveProject();
    if (!project) {
      throw new Error(`Projet cible introuvable : ${projectId}`);
    }
    return this.runtime.recordProjectDecision(input, project.path);
  }

  clearProjectMemory(projectId?: string): void {
    if (!this.runtime) {
      throw new Error('DesktopNode non démarré.');
    }
    const project = projectId ? this.getProject(projectId) : this.getActiveProject();
    if (!project) {
      throw new Error(`Projet cible introuvable : ${projectId}`);
    }
    this.runtime.clearProjectMemory(project.path);
  }

  createHelloPayload(authToken?: string): NodeHelloPayload {
    return {
      nodeId: this.getNodeId(),
      nodeName: this.getNodeName(),
      version: '0.4.2',
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
    if (this.state === 'busy' && (!options?.taskId || options.taskId !== this.activeTaskId)) {
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
      if (this.state === 'busy' && !this.activeTaskId) {
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
    if (this.state === 'busy' && (!options?.taskId || options.taskId !== this.activeTaskId)) {
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

    const codeDir = getDefaultCodeDirectory();
    const effectivePath = options?.projectId
      ? targetProject.path
      : existsSync(codeDir) && statSync(codeDir).isDirectory()
        ? codeDir
        : targetProject.path;

    this.state = 'busy';
    try {
      return await this.runtime.executeBrain(message, signal, {
        targetPath: effectivePath,
        conversationId: options?.conversationId,
      });
    } finally {
      if (this.state === 'busy' && !this.activeTaskId) {
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
    this.attachCoreClientListeners(this.coreClient);
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

  cancelActiveTask(reason = 'Tâche annulée'): boolean {
    if (!this.activeTaskId) {
      return false;
    }
    this.handleRemoteTaskCancel({ taskId: this.activeTaskId, reason });
    return true;
  }

  private attachCoreClientListeners(client: DesktopCoreClient): void {
    client.on('message', (message: AnyNexusMessage) => {
      this.handleCoreMessage(message);
    });
  }

  private handleCoreMessage(message: AnyNexusMessage): void {
    switch (message.type) {
      case 'task:start':
        void this.handleRemoteTaskStart(message.payload as TaskStartPayload);
        break;
      case 'task:cancel':
        this.handleRemoteTaskCancel(message.payload as TaskCancelPayload);
        break;
      case 'approval:decision':
        this.handleRemoteApprovalDecision(message.payload as ApprovalDecisionPayload);
        break;
      case 'approval:cancelled':
        this.handleRemoteApprovalCancelled(message.payload as ApprovalCancelledPayload);
        break;
      case 'node:switch_project':
        this.handleRemoteSwitchProject(message.payload as NodeSwitchProjectPayload, message.id);
        break;
    }
  }

  private handleRemoteSwitchProject(payload: NodeSwitchProjectPayload, messageId?: string): void {
    const { projectId } = payload;
    try {
      const activeProject = this.setActiveProject(projectId);
      console.log(
        `[Nexus Desktop] 🌿 Projet actif basculé sur "${activeProject.name}" (${activeProject.path})`
      );
      this.coreClient?.send(createNexusMessage('node:status', this.createStatusPayload()));
    } catch (err) {
      console.warn(`[Nexus Desktop] Échec du basculement de projet :`, err);
      this.coreClient?.send(
        createNexusMessage('core:error', {
          code: 'PROJECT_NOT_FOUND',
          message: err instanceof Error ? err.message : String(err),
          targetMessageId: messageId,
        })
      );
    }
  }

  private async handleRemoteTaskStart(payload: TaskStartPayload): Promise<void> {
    const { taskId, backend, prompt, projectId } = payload;

    if (this.state === 'busy') {
      this.coreClient?.send(
        createNexusMessage('task:failed', {
          taskId,
          error: {
            code: 'NODE_BUSY',
            message: 'Le Desktop Node est déjà occupé par une autre tâche.',
          },
        })
      );
      return;
    }

    if (this.state === 'draining') {
      this.coreClient?.send(
        createNexusMessage('task:failed', {
          taskId,
          error: {
            code: 'NODE_OFFLINE',
            message: 'Le Desktop Node est en cours d’arrêt.',
          },
        })
      );
      return;
    }

    if (projectId && !this.getProject(projectId)) {
      this.coreClient?.send(
        createNexusMessage('task:failed', {
          taskId,
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Projet cible introuvable sur ce Desktop Node : ${projectId}`,
          },
        })
      );
      return;
    }

    this.state = 'busy';
    this.activeTaskId = taskId;
    this.activeTaskAbortController = new AbortController();
    const signal = this.activeTaskAbortController.signal;

    const preview = prompt.length > 70 ? `${prompt.slice(0, 67)}...` : prompt;
    console.log(`[Nexus Desktop] 🚀 Tâche reçue [${backend}]: "${preview}"`);

    // Send task:progress (starting)
    this.coreClient?.send(
      createNexusMessage('task:progress', {
        taskId,
        stage: 'starting',
        message: `Exécution démarrée avec le backend ${backend}`,
      })
    );

    try {
      if (backend === 'brain') {
        this.coreClient?.send(
          createNexusMessage('task:progress', {
            taskId,
            stage: 'synthesizing',
            message: 'Génération de la réponse Brain...',
          })
        );

        const text = await this.executeBrain(prompt, signal, {
          projectId,
          taskId,
        });

        this.coreClient?.send(
          createNexusMessage('task:completed', {
            taskId,
            text,
          })
        );
        console.log('[Nexus Desktop] ✅ Tâche Brain terminée avec succès.');
      } else {
        this.coreClient?.send(
          createNexusMessage('task:progress', {
            taskId,
            stage: 'executing',
            message: `Exécution de la tâche (${backend})...`,
          })
        );

        const result = await this.executeTask(backend, prompt, {
          projectId,
          signal,
          taskId,
          onFilesChanged: (paths) => {
            this.coreClient?.send(
              createNexusMessage('task:progress', {
                taskId,
                stage: 'executing',
                message: `${paths.length} fichier(s) modifié(s)`,
              })
            );
          },
        });

        this.coreClient?.send(
          createNexusMessage('task:completed', {
            taskId,
            text: result.text,
            fileSummary: result.fileSummary,
            filesChanged: result.filesChanged ? [...result.filesChanged] : undefined,
          })
        );
        const summary = result.fileSummary ? ` (${result.fileSummary})` : '';
        console.log(`[Nexus Desktop] ✅ Tâche ${backend} terminée avec succès.${summary}`);
      }
    } catch (err: unknown) {
      const isCancelled =
        signal.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' ||
            err.message.toLowerCase().includes('annul') ||
            err.message.toLowerCase().includes('abort')));

      if (isCancelled) {
        console.log(`[Nexus Desktop] ⏹ Tâche ${backend} annulée.`);
        this.coreClient?.send(
          createNexusMessage('task:failed', {
            taskId,
            error: {
              code: 'TASK_CANCELLED',
              message: 'Tâche annulée.',
            },
          })
        );
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[Nexus Desktop] ❌ Tâche ${backend} échouée : ${errorMessage}`);
        this.coreClient?.send(
          createNexusMessage('task:failed', {
            taskId,
            error: {
              code: 'TASK_EXECUTION_FAILED',
              message: errorMessage,
            },
          })
        );
      }
    } finally {
      if (this.activeTaskId === taskId) {
        this.cancelAllPendingApprovals('task_aborted');
        this.activeTaskId = undefined;
        this.activeTaskAbortController = undefined;
        if (this.state === 'busy') {
          this.state = 'idle';
        }
      }
    }
  }

  private handleRemoteTaskCancel(payload: TaskCancelPayload): void {
    const { taskId, reason } = payload;
    if (this.activeTaskId !== taskId) {
      return;
    }

    if (this.activeTaskAbortController && !this.activeTaskAbortController.signal.aborted) {
      this.activeTaskAbortController.abort(new Error(reason ?? 'Annulé par l’utilisateur'));
    }

    this.cancelAllPendingApprovals('task_aborted');

    if (this.runtime) {
      this.runtime.cancelCurrentWork();
    }
  }

  async handleApprovalRequest(
    request: RuntimeApprovalRequest,
    signal: AbortSignal
  ): Promise<ApprovalDecision> {
    if (signal.aborted) {
      return 'decline';
    }

    // If executing a remote task and connected to Core, route approval to Core
    const taskId = this.activeTaskId;
    if (taskId && this.coreClient?.isConnected()) {
      const approvalId = randomUUID();
      const expiresAt = request.expiresAt > Date.now() ? request.expiresAt : Date.now() + 60_000;

      return new Promise<ApprovalDecision>((resolve, reject) => {
        const timeoutMs = Math.max(0, expiresAt - Date.now());
        const timer = setTimeout(() => {
          this.pendingApprovals.delete(approvalId);
          resolve('decline'); // fail closed on timeout
        }, timeoutMs);
        timer.unref?.();

        const onAbort = () => {
          if (this.pendingApprovals.has(approvalId)) {
            this.pendingApprovals.delete(approvalId);
            clearTimeout(timer);
            this.coreClient?.send(
              createNexusMessage('approval:cancelled', {
                approvalId,
                taskId,
                reason: 'task_aborted',
              })
            );
            resolve('decline');
          }
        };

        signal.addEventListener('abort', onAbort, { once: true });

        this.pendingApprovals.set(approvalId, {
          resolve: (decision) => {
            signal.removeEventListener('abort', onAbort);
            clearTimeout(timer);
            this.pendingApprovals.delete(approvalId);
            resolve(decision);
          },
          reject: (err) => {
            signal.removeEventListener('abort', onAbort);
            clearTimeout(timer);
            this.pendingApprovals.delete(approvalId);
            reject(err);
          },
          timer,
        });

        const kind: ApprovalKind = request.kind === 'inspection' ? 'consent' : request.kind;

        const sent = this.coreClient?.send(
          createNexusMessage('approval:request', {
            approvalId,
            taskId,
            agentName: request.agentName ?? 'nexus-agent',
            kind,
            details: request.details,
            expiresAt,
          })
        );

        if (!sent) {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          this.pendingApprovals.delete(approvalId);
          resolve('decline');
        }
      });
    }

    // Fall back to local approval handler (CLI interactive prompt or custom handler)
    if (this.options?.requestApproval) {
      return this.options.requestApproval(request, signal);
    }

    // Fail closed if no approval handler configured
    return 'decline';
  }

  private handleRemoteApprovalDecision(payload: ApprovalDecisionPayload): void {
    const pending = this.pendingApprovals.get(payload.approvalId);
    if (pending) {
      pending.resolve(payload.decision);
    }
  }

  private handleRemoteApprovalCancelled(payload: ApprovalCancelledPayload): void {
    const pending = this.pendingApprovals.get(payload.approvalId);
    if (pending) {
      pending.resolve('decline');
    }
  }

  private cancelAllPendingApprovals(reason: ApprovalCancelReason): void {
    for (const [approvalId, pending] of this.pendingApprovals.entries()) {
      clearTimeout(pending.timer);
      if (this.activeTaskId && this.coreClient?.isConnected()) {
        this.coreClient.send(
          createNexusMessage('approval:cancelled', {
            approvalId,
            taskId: this.activeTaskId,
            reason,
          })
        );
      }
      pending.resolve('decline');
    }
    this.pendingApprovals.clear();
  }
}
