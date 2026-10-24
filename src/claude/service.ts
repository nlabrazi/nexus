import { resolve } from 'node:path';
import { AgentService, ModelMenu, ModelSelection } from '../runtime/agent-service';
import { KeyValueStorage } from '../runtime/types';
import { ClaudeCodeClient } from './client';
import {
  ClaudeCodeClientOptions,
  ClaudeCodeClientStatus,
  ClaudeCodeModel,
  ClaudeTelemetrySnapshot,
} from './types';

export class ClaudeCodeService implements AgentService {
  private readonly client: ClaudeCodeClient;
  private readonly storage?: KeyValueStorage;
  private selectedModel = 'claude-sonnet-4-6';
  private selectedEffort = 'medium';
  private readonly sessions = new Map<string, string>();
  private telemetry: ClaudeTelemetrySnapshot = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    turns: 0,
  };

  constructor(options: ClaudeCodeClientOptions = {}) {
    this.client = new ClaudeCodeClient(options);
    this.storage = options.storage;
    this.loadPersistedState();
  }

  private loadPersistedState(): void {
    if (!this.storage) return;
    const savedPref = this.storage.get('nexus.claude.model') as
      | { model?: string; effort?: string }
      | undefined;
    if (savedPref?.model) {
      this.selectedModel = savedPref.model;
    }
    if (savedPref?.effort) {
      this.selectedEffort = savedPref.effort;
    }
    const savedTelemetry = this.storage.get('nexus.claude.telemetry') as
      | ClaudeTelemetrySnapshot
      | undefined;
    if (savedTelemetry && typeof savedTelemetry.totalTokens === 'number') {
      this.telemetry = savedTelemetry;
    }
    const savedSessions = this.storage.get('nexus.claude.sessions') as
      | Record<string, string>
      | undefined;
    if (savedSessions && typeof savedSessions === 'object') {
      for (const [k, v] of Object.entries(savedSessions)) {
        if (typeof v === 'string') {
          this.sessions.set(k, v);
        }
      }
    }
  }

  public async sendPrompt(
    prompt: string,
    workspacePath: string,
    onFilesChanged?: (paths: readonly string[]) => void,
    onChunk?: (delta: string) => void
  ): Promise<string> {
    this.loadPersistedState();
    const normPath = resolve(workspacePath);
    const existingSession = this.sessions.get(normPath);

    return this.client.sendPrompt(prompt, workspacePath, onFilesChanged, onChunk, {
      model: this.selectedModel,
      effort: this.selectedEffort,
      sessionId: existingSession,
      onMetadata: (meta) => {
        if (meta.sessionId) {
          this.sessions.set(normPath, meta.sessionId);
          if (this.storage) {
            void this.storage.update(
              'nexus.claude.sessions',
              Object.fromEntries(this.sessions.entries())
            );
          }
        }
        const addIn = meta.inputTokens ?? 0;
        const addOut = meta.outputTokens ?? 0;
        const addCached = meta.cachedTokens ?? 0;
        const addCost = meta.costUsd ?? 0;
        if (addIn > 0 || addOut > 0 || addCached > 0 || addCost > 0) {
          this.telemetry = {
            inputTokens: this.telemetry.inputTokens + addIn,
            outputTokens: this.telemetry.outputTokens + addOut,
            cachedInputTokens: this.telemetry.cachedInputTokens + addCached,
            totalTokens: this.telemetry.totalTokens + addIn + addOut + addCached,
            totalCostUsd: Number((this.telemetry.totalCostUsd + addCost).toFixed(6)),
            turns: this.telemetry.turns + 1,
            updatedAt: Date.now(),
          };
          if (this.storage) {
            void this.storage.update('nexus.claude.telemetry', this.telemetry);
          }
        }
      },
    });
  }

  public resetSession(workspacePath?: string): void {
    if (workspacePath) {
      this.sessions.delete(resolve(workspacePath));
    } else {
      this.sessions.clear();
    }
    if (this.storage) {
      void this.storage.update(
        'nexus.claude.sessions',
        Object.fromEntries(this.sessions.entries())
      );
    }
  }

  public async newSession(workspacePath: string): Promise<string> {
    this.resetSession(workspacePath);
    return `claude:${Date.now().toString(36)}`;
  }

  public async resumeSession(workspacePath: string, sessionId: string): Promise<string> {
    const id = sessionId.trim();
    if (!id || /\s/.test(id)) {
      throw new Error('Indiquez un identifiant de session valide : /resume <id>.');
    }
    this.sessions.set(resolve(workspacePath), id);
    if (this.storage) {
      await this.storage.update(
        'nexus.claude.sessions',
        Object.fromEntries(this.sessions.entries())
      );
    }
    return id;
  }

  public async listModels(): Promise<ClaudeCodeModel[]> {
    return [
      {
        id: 'claude-sonnet-4-6',
        model: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        description:
          'Modèle principal Anthropic équilibré vitesse & raisonnement profond (alias: sonnet)',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Rapide et économique' },
          { reasoningEffort: 'medium', description: 'Équilibré (défaut)' },
          { reasoningEffort: 'high', description: 'Raisonnement approfondi' },
        ],
      },
      {
        id: 'claude-opus-4-6',
        model: 'claude-opus-4-6',
        displayName: 'Claude Opus 4.6',
        description:
          'Raisonnement architectural complexe et tâches multi-fichiers critiques (alias: opus)',
        isDefault: false,
        defaultReasoningEffort: 'high',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Rapide' },
          { reasoningEffort: 'medium', description: 'Équilibré' },
          { reasoningEffort: 'high', description: 'Approfondi (défaut)' },
          { reasoningEffort: 'max', description: 'Capacité maximale' },
        ],
      },
      {
        id: 'claude-haiku-4-5',
        model: 'claude-haiku-4-5',
        displayName: 'Claude Haiku 4.5',
        description: 'Ultra-rapide et léger pour les éditions ciblées (alias: haiku)',
        isDefault: false,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Instantané (défaut)' },
          { reasoningEffort: 'medium', description: 'Standard' },
        ],
      },
    ];
  }

  public async getModelMenu(
    _workspacePath?: string
  ): Promise<ModelMenu & { current: ModelSelection }> {
    this.loadPersistedState();
    const models = await this.listModels();
    const current = {
      model: this.selectedModel,
      effort: this.selectedEffort,
    };
    return {
      models,
      current,
      selected: current,
      context: 'claude-global',
    };
  }

  public async selectModelChoice(_workspacePath: string, selection: ModelSelection): Promise<void> {
    await this.selectModel(selection);
  }

  public getActiveWorkspacePath(): string | undefined {
    return undefined;
  }

  public getCurrentSessionId(): string | undefined {
    return this.client.getStatus().sessionId;
  }

  public async refreshStatus(): Promise<void> {
    // Claude Code CLI status is synchronous
  }

  public async selectModel(
    selection: { model: string; effort?: string } | string
  ): Promise<ClaudeCodeModel> {
    const models = await this.listModels();
    const requestedModel = typeof selection === 'string' ? selection : selection.model;
    const requestedEffort = typeof selection === 'string' ? undefined : selection.effort;

    // Support short aliases sonnet / opus / haiku as well as full IDs
    const aliasMap: Record<string, string> = {
      sonnet: 'claude-sonnet-4-6',
      opus: 'claude-opus-4-6',
      haiku: 'claude-haiku-4-5',
    };
    const resolvedId = aliasMap[requestedModel] ?? requestedModel;
    const found = models.find((m) => m.id === resolvedId || m.model === resolvedId);
    if (!found) {
      throw new Error(`Modèle Claude Code inconnu : ${requestedModel}`);
    }

    const validEffort =
      requestedEffort &&
      found.supportedReasoningEfforts.some((e) => e.reasoningEffort === requestedEffort)
        ? requestedEffort
        : found.defaultReasoningEffort;

    this.selectedModel = found.model;
    this.selectedEffort = validEffort;

    if (this.storage) {
      await this.storage.update('nexus.claude.model', {
        model: this.selectedModel,
        effort: this.selectedEffort,
      });
    }

    return found;
  }

  public getStatus(): ClaudeCodeClientStatus {
    this.loadPersistedState();
    const base = this.client.getStatus();
    return {
      ...base,
      model: this.selectedModel,
      effort: this.selectedEffort,
      telemetry: this.telemetry,
    };
  }

  public cancelCurrentWork(): boolean {
    return this.client.cancel();
  }

  public stop(): void {
    this.client.cancel();
  }
}
