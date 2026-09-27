import { homedir } from 'node:os';
import { join } from 'node:path';
import { NexusCore } from '../core/nexus-core';
import { PendingApproval } from '../core/types';
import { NexusProtocolError } from '../protocol/errors';
import { TelegramClient } from './client';
import {
  FileTelegramStorage,
  TelegramContextLike,
  TelegramService,
  TelegramServiceOptions,
} from './service';
import { AgentBackendType, NexusStatusSnapshot } from './status';

export interface TelegramCoreBridgeOptions {
  readonly projectId?: string;
  readonly defaultBackend?: AgentBackendType;
  readonly context?: TelegramContextLike;
}

export class TelegramCoreBridge {
  private activeBackend: AgentBackendType;
  private currentProjectId?: string;
  private activeTaskId?: string;
  private telegramService?: TelegramService;

  constructor(
    private readonly core: NexusCore,
    options?: TelegramCoreBridgeOptions
  ) {
    this.activeBackend = options?.defaultBackend ?? 'codex';
    this.currentProjectId = options?.projectId;

    // Relay approval requests from Core to Telegram
    this.core.on('approval:request', (approval: PendingApproval) => {
      this.handleCoreApprovalRequest(approval);
    });
  }

  attachTelegramService(service: TelegramService): void {
    this.telegramService = service;
  }

  getActiveBackend(): AgentBackendType {
    return this.activeBackend;
  }

  setActiveBackend(backend: AgentBackendType): void {
    this.activeBackend = backend;
  }

  getProjectId(): string | undefined {
    return this.currentProjectId;
  }

  setProjectId(projectId: string | undefined): void {
    this.currentProjectId = projectId;
  }

  getActiveTaskId(): string | undefined {
    return this.activeTaskId;
  }

  private handleCoreApprovalRequest(approval: PendingApproval): void {
    if (!this.telegramService) {
      return;
    }

    const controller = new AbortController();
    const onCancelled = (cancelled: PendingApproval) => {
      if (cancelled.approvalId === approval.approvalId) {
        controller.abort();
      }
    };

    this.core.once('approval:cancelled', onCancelled);

    this.telegramService
      .requestApproval(
        {
          agentName: approval.agentName,
          kind: approval.kind,
          details: approval.details,
          expiresAt: approval.expiresAt,
          taskId: approval.taskId,
          approvalId: approval.approvalId,
        },
        controller.signal
      )
      .then((decision) => {
        this.core.removeListener('approval:cancelled', onCancelled);
        try {
          this.core.decideApproval(approval.approvalId, decision, 'telegram');
        } catch {
          // May have already timed out or been handled
        }
      })
      .catch(() => {
        this.core.removeListener('approval:cancelled', onCancelled);
        try {
          this.core.decideApproval(approval.approvalId, 'decline', 'telegram');
        } catch {
          // May have already timed out or been handled
        }
      });
  }

  createServiceOptions(): TelegramServiceOptions {
    return {
      getActiveBackend: () => this.activeBackend,
      setActiveBackend: (backend) => {
        this.activeBackend = backend;
      },
      onRemotePrompt: async (prompt) => {
        return this.executeAgentPrompt('codex', prompt);
      },
      onRemoteAntigravityPrompt: async (prompt) => {
        return this.executeAgentPrompt('antigravity', prompt);
      },
      onBrainPrompt: async (prompt, _signal) => {
        const result = await this.executeAgentPrompt('brain', prompt);
        return typeof result === 'string' ? result : result.text;
      },
      getStatus: async () => {
        return this.getStatusSnapshot();
      },
      onStop: () => {
        return this.stopCurrentTask();
      },
      onBranchAction: async (action) => {
        return this.handleBranchAction(action);
      },
      onSessionAction: async (action) => {
        return this.handleSessionAction(action);
      },
    };
  }

  private async executeAgentPrompt(
    backend: 'codex' | 'antigravity' | 'brain',
    prompt: string
  ): Promise<{ text: string; fileSummary?: string }> {
    try {
      const taskPromise = this.core.executeTask({
        backend,
        prompt,
        projectId: this.currentProjectId,
      });

      // Track active task id from current running/pending tasks
      const runningTasks = this.core.listTasks({ status: 'running' });
      const pendingTasks = this.core.listTasks({ status: 'pending' });
      const current = runningTasks.at(-1) ?? pendingTasks.at(-1);
      if (current) {
        this.activeTaskId = current.taskId;
      }

      const completed = await taskPromise;
      return {
        text: completed.text,
        fileSummary: completed.fileSummary,
      };
    } catch (err) {
      if (err instanceof NexusProtocolError && err.code === 'NODE_OFFLINE') {
        throw new Error(
          'Aucun Desktop Node connecté à Nexus Core. Démarrez votre nœud avec "nexus-desktop start".'
        );
      }
      if (err instanceof NexusProtocolError && err.code === 'NODE_BUSY') {
        throw new Error('Le Desktop Node est déjà occupé par une autre tâche.');
      }
      if (err instanceof NexusProtocolError && err.code === 'TASK_CANCELLED') {
        throw new Error('Tâche annulée.');
      }
      throw err;
    } finally {
      this.activeTaskId = undefined;
    }
  }

  private stopCurrentTask(): boolean {
    if (this.activeTaskId) {
      this.core.cancelTask(this.activeTaskId, 'Interrompu via Telegram /stop');
      this.activeTaskId = undefined;
      return true;
    }
    const running = this.core.listTasks({ status: 'running' });
    if (running.length > 0) {
      const target = running[running.length - 1];
      this.core.cancelTask(target.taskId, 'Interrompu via Telegram /stop');
      return true;
    }
    return false;
  }

  private getStatusSnapshot(): NexusStatusSnapshot {
    const status = this.core.getStatus();
    const onlineNodes = status.nodes.filter((n) => n.online);
    const primaryNode = onlineNodes[0];

    const activeProject = this.currentProjectId
      ? status.projects.find(
          (p) => p.id === this.currentProjectId || p.name === this.currentProjectId
        )
      : (primaryNode?.activeProject ?? status.projects[0]);

    const sessionBranch = activeProject?.currentBranch;

    return {
      activeBackend: this.activeBackend,
      workspace: activeProject ? { name: activeProject.name, path: activeProject.path } : undefined,
      workspaceCount: status.projects.length,
      codex:
        this.activeBackend === 'codex'
          ? {
              processRunning: onlineNodes.length > 0,
              sessionActive: onlineNodes.length > 0,
              sessionBranch,
              workspacePath: activeProject?.path,
              pendingApprovals: status.pendingApprovals ?? 0,
            }
          : undefined,
      antigravity:
        this.activeBackend === 'antigravity'
          ? {
              processRunning: onlineNodes.length > 0,
              sessionActive: onlineNodes.length > 0,
              sessionBranch,
              workspacePath: activeProject?.path,
              pendingApprovals: status.pendingApprovals ?? 0,
            }
          : undefined,
      core: {
        uptimeSeconds: status.uptimeSeconds,
        onlineNodes: status.onlineNodes,
        totalNodes: status.totalNodes,
        activeTasks: status.activeTasks ?? 0,
        nodes: status.nodes.map((n) => ({
          nodeId: n.nodeId,
          nodeName: n.nodeName,
          online: n.online,
          state: n.state,
        })),
      },
    };
  }

  private async handleBranchAction(
    action:
      | {
          type: 'list';
        }
      | {
          type: 'switch';
          name: string;
        }
  ): Promise<string> {
    const status = this.core.getStatus();
    const onlineNodes = status.nodes.filter((n) => n.online);
    if (onlineNodes.length === 0) {
      throw new Error('Aucun Desktop Node connecté pour inspecter les branches.');
    }

    if (action.type === 'list') {
      const projects = status.projects;
      if (projects.length === 0) {
        return 'Aucun projet disponible sur les nœuds connectés.';
      }
      const lines = ['🌿 Projets et branches disponibles :'];
      for (const p of projects) {
        lines.push(`• ${p.name} (${p.path}) : branche ${p.currentBranch ?? 'inconnue'}`);
      }
      return lines.join('\n');
    }

    return `Changement de branche vers "${action.name}" non supporté à distance sans session active.`;
  }

  private async handleSessionAction(
    action:
      | {
          type: 'new';
        }
      | {
          type: 'resume';
          sessionId: string;
        }
  ): Promise<string> {
    if (action.type === 'new') {
      return `session-${Date.now().toString(36)}`;
    }
    return action.sessionId;
  }
}

export function createCoreTelegramService(
  core: NexusCore,
  token: string,
  options?: TelegramCoreBridgeOptions
): {
  service: TelegramService;
  bridge: TelegramCoreBridge;
  client: TelegramClient;
  context: TelegramContextLike;
} {
  const client = new TelegramClient(token);
  const bridge = new TelegramCoreBridge(core, options);
  const defaultPath = join(homedir(), '.nexus', 'telegram-state.json');
  const context = options?.context ?? {
    globalState: new FileTelegramStorage(defaultPath),
  };
  const service = new TelegramService(context, client, bridge.createServiceOptions());
  bridge.attachTelegramService(service);
  return { service, bridge, client, context };
}
