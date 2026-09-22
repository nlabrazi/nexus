import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

import {
  AgentMessageDeltaNotification,
  ItemCompletedNotification,
  RpcMessage,
  RpcNotification,
  ThreadStartResponse,
  TurnCompletedNotification,
  TurnStartResponse,
  CodexApprovalHandler,
  CodexClientStatus,
  CodexModel,
  ModelSelection,
  ThreadTelemetry,
  RateLimitSnapshot,
  TurnTimeoutHandler,
} from './types';
import { CodexApprovals } from './approvals';
import { CodexError, processError, rpcError, turnTimeoutError } from './errors';
import { workspaceEnvironment } from '../workspace/environment';
import { isModel, isRateLimit, isTokenUsage } from './telemetry';

export interface CodexClientOptions {
  turnTimeoutHandler?: TurnTimeoutHandler;
  turnTimeoutMs?: number;
}

export class CodexClient {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private requestId = 0;
  private readonly approvals: CodexApprovals;
  private currentTurn?: CodexClientStatus['turn'];
  private starting?: Promise<void>;
  private connectionId = 0;
  private turnFailure?: (error: Error) => void;
  private readonly telemetry = new Map<string, ThreadTelemetry>();
  private rateLimits?: RateLimitSnapshot[];
  private rateLimitsUpdatedAt?: number;
  private rateLimitsUnavailable = false;
  private rateLimitsRevision = 0;
  private rateLimitsRefresh?: Promise<void>;

  constructor(
    approvalHandler?: CodexApprovalHandler,
    private readonly options?: CodexClientOptions
  ) {
    this.approvals = new CodexApprovals((message) => this.write(message), approvalHandler);
  }

  getStatus(): CodexClientStatus {
    return {
      processRunning: this.process !== undefined,
      turn: this.currentTurn ? { ...this.currentTurn } : undefined,
      pendingApprovals: this.approvals.getPendingCount(),
      ...(this.rateLimits
        ? {
            rateLimits: structuredClone(this.rateLimits),
            rateLimitsUpdatedAt: this.rateLimitsUpdatedAt,
          }
        : {}),
      ...(this.rateLimitsUnavailable ? { rateLimitsUnavailable: true } : {}),
    };
  }

  getThreadTelemetry(threadId: string): ThreadTelemetry {
    return structuredClone(this.telemetry.get(threadId) ?? {});
  }

  async listModels(): Promise<CodexModel[]> {
    const models = new Map<string, CodexModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = (await this.request('model/list', {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      })) as { data?: unknown[]; nextCursor?: string | null };
      if (
        !result ||
        !Array.isArray(result.data) ||
        !result.data.every(isModel) ||
        (result.nextCursor !== null &&
          result.nextCursor !== undefined &&
          (typeof result.nextCursor !== 'string' ||
            !result.nextCursor ||
            cursors.has(result.nextCursor)))
      ) {
        throw new CodexError(
          'protocol_error',
          'La liste des modèles renvoyée par Codex est invalide.'
        );
      }
      for (const model of result.data) {
        if (!model.hidden) {
          models.set(model.model, model);
        }
      }
      cursor = result.nextCursor ?? undefined;
      if (cursor) {
        cursors.add(cursor);
      }
      if (cursors.size > 100) {
        throw new CodexError('protocol_error', 'La liste des modèles Codex est trop longue.');
      }
    } while (cursor);
    return [...models.values()];
  }

  refreshRateLimits(): Promise<void> {
    if (!this.process) {
      return Promise.resolve();
    }
    if (this.rateLimitsRefresh) {
      return this.rateLimitsRefresh;
    }
    const child = this.process;
    const revision = this.rateLimitsRevision;
    const refresh = (async () => {
      try {
        const result = (await this.request('account/rateLimits/read', {}, 3000)) as {
          rateLimits?: unknown;
          rateLimitsByLimitId?: Record<string, unknown> | null;
        };
        if (this.process !== child || revision !== this.rateLimitsRevision) {
          return;
        }
        const limits = result?.rateLimitsByLimitId
          ? Object.values(result.rateLimitsByLimitId)
          : [result?.rateLimits];
        if (!limits.length || !limits.every(isRateLimit)) {
          throw new Error('Invalid rate limits');
        }
        this.rateLimits = limits;
        this.rateLimitsUpdatedAt = Date.now();
        this.rateLimitsUnavailable = false;
      } catch {
        if (this.process === child && revision === this.rateLimitsRevision) {
          this.rateLimitsUnavailable = true;
        }
      }
    })();
    this.rateLimitsRefresh = refresh;
    void refresh.finally(() => {
      if (this.rateLimitsRefresh === refresh) {
        this.rateLimitsRefresh = undefined;
      }
    });
    return refresh;
  }

  private rememberTelemetry(notification: RpcNotification): void {
    const params = notification.params as
      | { threadId?: string; tokenUsage?: unknown; rateLimits?: unknown; toModel?: string }
      | undefined;
    if (!params) {
      return;
    }
    if (notification.method === 'account/updated') {
      this.rateLimits = undefined;
      this.rateLimitsUpdatedAt = undefined;
      this.rateLimitsUnavailable = false;
      this.rateLimitsRevision++;
      this.rateLimitsRefresh = undefined;
      return;
    }
    if (notification.method === 'account/rateLimits/updated' && isRateLimit(params.rateLimits)) {
      const updated = params.rateLimits;
      const limits = this.rateLimits ?? [];
      this.rateLimits = [...limits.filter((limit) => limit.limitId !== updated.limitId), updated];
      this.rateLimitsUpdatedAt = Date.now();
      this.rateLimitsUnavailable = false;
      this.rateLimitsRevision++;
    }
    if (typeof params.threadId !== 'string' || !this.telemetry.has(params.threadId)) {
      return;
    }
    const state = this.telemetry.get(params.threadId)!;
    if (notification.method === 'thread/tokenUsage/updated' && isTokenUsage(params.tokenUsage)) {
      state.tokenUsage = structuredClone(params.tokenUsage);
      state.tokenUsageUpdatedAt = Date.now();
    }
    if (notification.method === 'model/rerouted' && typeof params.toModel === 'string') {
      state.reroutedModel = params.toModel;
    }
  }

  private notificationListeners = new Set<(notification: RpcNotification) => void>();

  private pending = new Map<
    number,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  getConnectionId(): number | undefined {
    return this.process ? this.connectionId : undefined;
  }

  start(): Promise<void> {
    if (this.starting) {
      return this.starting;
    }
    if (this.process) {
      return Promise.resolve();
    }
    const starting = this.startProcess();
    this.starting = starting;
    const clear = () => {
      if (this.starting === starting) {
        this.starting = undefined;
      }
    };
    void starting.then(clear, clear);
    return starting;
  }

  private async startProcess(): Promise<void> {
    try {
      this.process = spawn('codex', ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: workspaceEnvironment(),
      });
    } catch (error) {
      throw processError(error);
    }
    const child = this.process;
    this.connectionId++;
    this.buffer = '';

    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    this.process.stdout.on('data', (chunk) => {
      if (this.process === child) {
        try {
          this.handleStdout(chunk);
        } catch (error) {
          this.disconnect(
            child,
            new CodexError(
              'protocol_error',
              'Codex a envoyé une réponse invalide. La connexion a été fermée. Vérifiez les modifications éventuelles avant de réessayer.',
              { cause: error }
            )
          );
        }
      }
    });

    this.process.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();

      if (message) {
        console.log(`[Codex] ${message}`);
      }
    });

    child.on('error', (error) => this.disconnect(child, processError(error)));
    child.on('exit', (code, signal) =>
      this.disconnect(
        child,
        processError(new Error(`Codex exited: code=${code}, signal=${signal}`)),
        false
      )
    );
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', (error) => this.disconnect(child, processError(error)));
    }
    child.stdout.on('end', () =>
      this.disconnect(child, processError(new Error('Codex stdout closed')))
    );

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'nexus',
          title: 'Nexus',
          version: '0.0.1',
        },
        capabilities: {
          experimentalApi: false,
        },
      });

      if (this.process !== child) {
        throw new Error('Codex initialization cancelled');
      }
      this.notify('initialized', {});
    } catch (error) {
      if (this.process === child) {
        this.stop();
      }
      throw error;
    }
  }

  async startSession(cwd: string, selection?: ModelSelection): Promise<ThreadStartResponse> {
    return await this.sessionRequest('thread/start', {
      cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      serviceName: 'nexus',
      ...(selection
        ? { model: selection.model, config: { model_reasoning_effort: selection.effort } }
        : {}),
    });
  }

  async readSession(threadId: string): Promise<ThreadStartResponse> {
    return await this.sessionRequest('thread/read', {
      threadId,
      includeTurns: false,
    });
  }

  async resumeSession(
    threadId: string,
    cwd: string,
    selection?: ModelSelection
  ): Promise<ThreadStartResponse> {
    return await this.sessionRequest('thread/resume', {
      threadId,
      cwd,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      ...(selection
        ? { model: selection.model, config: { model_reasoning_effort: selection.effort } }
        : {}),
    });
  }

  private async sessionRequest(method: string, params: unknown): Promise<ThreadStartResponse> {
    const child = this.process;
    try {
      const result = (await this.request(method, params)) as ThreadStartResponse;
      if (!result?.thread || typeof result.thread.id !== 'string' || !result.thread.id.trim()) {
        throw new CodexError('protocol_error', 'Codex a renvoyé une session invalide.');
      }
      const state = this.telemetry.get(result.thread.id) ?? {};
      const model = result.model ?? result.thread.model;
      if (typeof model === 'string') {
        state.model = model;
      }
      const provider = result.modelProvider ?? result.thread.modelProvider;
      if (typeof provider === 'string') {
        state.modelProvider = provider;
      }
      if ('reasoningEffort' in result || 'reasoningEffort' in result.thread) {
        state.reasoningEffort = result.reasoningEffort ?? result.thread.reasoningEffort ?? null;
      }
      if ('serviceTier' in result) {
        state.serviceTier = result.serviceTier;
      }
      if (typeof result.approvalPolicy === 'string') {
        state.approvalPolicy = result.approvalPolicy;
      }
      if (typeof result.sandbox?.type === 'string') {
        state.sandbox = result.sandbox.type;
      }
      this.telemetry.set(result.thread.id, state);
      return result;
    } catch (error) {
      if (
        child &&
        error instanceof CodexError &&
        ['rpc_timeout', 'protocol_error'].includes(error.code)
      ) {
        this.disconnect(child, error);
      }
      throw error;
    }
  }

  stop(): void {
    if (this.process) {
      this.disconnect(this.process, new CodexError('stopped', 'Le processus Codex a été arrêté.'));
    }
  }

  private disconnect(child: ChildProcessWithoutNullStreams, error: Error, kill = true): void {
    if (this.process !== child) {
      return;
    }
    this.process = undefined;
    this.rateLimitsRefresh = undefined;
    this.starting = undefined;
    this.buffer = '';
    this.approvals.endTurn(false);
    this.turnFailure?.(error);
    this.currentTurn = undefined;
    this.rejectPending(error);
    if (kill) {
      try {
        child.kill();
      } catch {
        /* The transport may already be gone. */
      }
    }
  }

  async runTurn(
    threadId: string,
    prompt: string,
    onFilesChanged?: (paths: readonly string[]) => void,
    selection?: ModelSelection
  ): Promise<string> {
    if (!this.process) {
      throw processError(new Error('Codex is not running'));
    }
    if (this.currentTurn) {
      throw new Error('Un turn Codex est déjà en cours.');
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Codex prompt cannot be empty');
    }

    const child = this.process;
    const telemetry = this.telemetry.get(threadId) ?? {};
    delete telemetry.reroutedModel;
    this.telemetry.set(threadId, telemetry);
    this.approvals.beginTurn(threadId);
    const currentTurn: NonNullable<CodexClientStatus['turn']> = { startedAt: Date.now() };
    this.currentTurn = currentTurn;
    let turnId: string | undefined;
    let timedOut = false;
    const earlyNotifications: RpcNotification[] = [];
    const messages = new Map<
      string,
      { streamed: string; completed?: string; phase?: string | null }
    >();
    const changedFiles = new Map<string, string[]>();

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      let interruptTimeout: ReturnType<typeof setTimeout> | undefined;
      let timeoutPromptController: AbortController | undefined;
      const turnTimeoutMs = this.options?.turnTimeoutMs ?? 120_000;
      let elapsedSeconds = Math.round(turnTimeoutMs / 1000);

      const cleanup = () => {
        timeoutPromptController?.abort();
        if (this.currentTurn === currentTurn) {
          this.currentTurn = undefined;
        }
        if (this.turnFailure === fail) {
          this.turnFailure = undefined;
        }
        if (this.process === child) {
          this.approvals.endTurn();
        }
        clearTimeout(timeout);
        clearTimeout(interruptTimeout);
        this.notificationListeners.delete(onNotification);
      };
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };
      const rememberItem = (item: ItemCompletedNotification['item'], completed: boolean) => {
        if (item.type === 'fileChange' && completed && typeof item.id === 'string') {
          changedFiles.set(
            item.id,
            item.status === 'completed' && Array.isArray(item.changes)
              ? item.changes.flatMap((change) =>
                  typeof change?.path === 'string' && change.path.trim() ? [change.path] : []
                )
              : []
          );
        }
        if (item.type !== 'agentMessage') {
          return;
        }
        if (typeof item.id !== 'string' || typeof item.text !== 'string') {
          throw new Error('Invalid agent message');
        }
        const message = messages.get(item.id) ?? { streamed: '' };
        if (completed) {
          message.completed = item.text;
        }
        if (item.phase !== undefined) {
          message.phase = item.phase;
        }
        messages.set(item.id, message);
      };
      const complete = (params: TurnCompletedNotification) => {
        if (!['completed', 'interrupted', 'failed'].includes(params.turn.status)) {
          throw new Error('Invalid terminal turn status');
        }
        if (timedOut) {
          fail(turnTimeoutError(true, elapsedSeconds));
          return;
        }
        if (params.turn.status !== 'completed') {
          fail(
            new CodexError(
              params.turn.status === 'interrupted' ? 'interrupted' : 'turn_failed',
              params.turn.status === 'interrupted'
                ? 'Le turn Codex a été interrompu. Vérifiez les modifications éventuelles avant de continuer.'
                : `Le turn Codex a échoué : ${params.turn.error?.message ?? 'raison non précisée'}. Vérifiez les modifications éventuelles avant de continuer.`
            )
          );
          return;
        }
        for (const item of params.turn.items ?? []) {
          rememberItem(item, true);
        }
        const values = [...messages.values()];
        const final = values.filter((message) => message.phase === 'final_answer');
        const candidates = final.length
          ? final
          : values.filter((message) => message.phase !== 'commentary');
        // Completed items are authoritative, even if their text is empty.
        const response = candidates
          .map((message) => (message.completed ?? message.streamed).trim())
          .filter(Boolean)
          .join('\n\n');
        if (!response) {
          fail(
            new CodexError(
              'empty_response',
              'Codex a terminé sans réponse textuelle finale. Des actions ont pu être effectuées : vérifiez les fichiers avant de renvoyer une instruction.'
            )
          );
          return;
        }
        onFilesChanged?.([...new Set([...changedFiles.values()].flat())]);
        settled = true;
        cleanup();
        resolve(response);
      };
      const onNotification = (notification: RpcNotification) => {
        if (
          settled ||
          this.process !== child ||
          !['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed'].includes(
            notification.method
          )
        ) {
          return;
        }
        const params = notification.params as AgentMessageDeltaNotification &
          ItemCompletedNotification &
          TurnCompletedNotification;
        if (!params || params.threadId !== threadId) {
          return;
        }
        if (!turnId) {
          // An old turn's late events must not become the next turn's response.
          earlyNotifications.push(notification);
          return;
        }
        const eventTurnId =
          notification.method === 'turn/completed' ? params.turn?.id : params.turnId;
        if (eventTurnId !== turnId) {
          return;
        }
        if (notification.method === 'turn/completed') {
          complete(params);
        } else if (notification.method === 'item/agentMessage/delta') {
          if (typeof params.itemId !== 'string' || typeof params.delta !== 'string') {
            throw new Error('Invalid agent message delta');
          }
          const message = messages.get(params.itemId) ?? { streamed: '' };
          message.streamed += params.delta;
          messages.set(params.itemId, message);
        } else {
          rememberItem(params.item, notification.method === 'item/completed');
        }
      };

      const triggerInterrupt = () => {
        timedOut = true;
        currentTurn.interrupting = true;
        // Invalidate approval buttons immediately, but keep the turn lock until termination.
        this.approvals.endTurn();
        if (settled) {
          return;
        }
        if (!turnId) {
          this.disconnect(child, turnTimeoutError(false, elapsedSeconds));
          return;
        }
        interruptTimeout = setTimeout(() => {
          this.disconnect(child, turnTimeoutError(false, elapsedSeconds));
        }, 5000);
        // An RPC acknowledgement alone does not confirm that the turn has ended.
        void this.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => {
          if (!settled) {
            this.disconnect(child, turnTimeoutError(false, elapsedSeconds));
          }
        });
      };

      const scheduleTimeout = () => {
        timeout = setTimeout(async () => {
          if (settled) {
            return;
          }
          if (this.options?.turnTimeoutHandler) {
            const controller = new AbortController();
            timeoutPromptController = controller;
            let shouldContinue = false;
            try {
              shouldContinue = await this.options.turnTimeoutHandler(
                { agentName: 'Codex', elapsedSeconds },
                controller.signal
              );
            } catch {
              shouldContinue = false;
            } finally {
              if (timeoutPromptController === controller) {
                timeoutPromptController = undefined;
              }
            }
            if (settled) {
              return;
            }
            if (shouldContinue) {
              elapsedSeconds += Math.round(turnTimeoutMs / 1000);
              scheduleTimeout();
              return;
            }
          }
          triggerInterrupt();
        }, turnTimeoutMs);
      };

      scheduleTimeout();
      this.turnFailure = fail;
      this.notificationListeners.add(onNotification);
      void this.request('turn/start', {
        threadId,
        ...(selection ? { model: selection.model, effort: selection.effort } : {}),
        input: [{ type: 'text', text: trimmedPrompt, textElements: [] }],
      })
        .then((result) => {
          if (settled) {
            return;
          }
          const response = result as TurnStartResponse;
          if (!response?.turn || typeof response.turn.id !== 'string' || !response.turn.id.trim()) {
            throw new CodexError('protocol_error', 'Codex a renvoyé un turn invalide.');
          }
          turnId = response.turn.id;
          if (selection) {
            telemetry.model = selection.model;
            telemetry.reasoningEffort = selection.effort;
          }
          currentTurn.id = turnId;
          this.approvals.setTurnId(turnId);
          for (const notification of earlyNotifications) {
            onNotification(notification);
          }
          earlyNotifications.length = 0;
        })
        .catch((error) => {
          if (settled) {
            return;
          }
          if (error instanceof CodexError && ['rpc_failed', 'session_lost'].includes(error.code)) {
            fail(error);
          } else {
            // A missing/malformed start acknowledgement leaves execution uncertain.
            this.disconnect(
              child,
              error instanceof CodexError
                ? error
                : new CodexError(
                    'protocol_error',
                    'Réponse Codex invalide. La connexion a été fermée.',
                    { cause: error }
                  )
            );
          }
        });
    });
  }

  private request(method: string, params: unknown, timeoutMs = 15_000): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }

        this.pending.delete(id);

        reject(
          new CodexError(
            'rpc_timeout',
            `Codex n’a pas répondu à ${method} sous ${timeoutMs / 1000} s. Vérifiez son état avant de réessayer ; la requête n’a pas été rejouée.`
          )
        );
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });

      try {
        this.write({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);

        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private write(message: unknown): void {
    const child = this.process;
    if (!child) {
      throw processError(new Error('Codex is not running'));
    }

    try {
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.disconnect(child, processError(error));
        }
      });
    } catch (error) {
      const failure = processError(error);
      this.disconnect(child, failure);
      throw failure;
    }
  }

  private handleStdout(chunk: string): void {
    const child = this.process;
    this.buffer += chunk;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (this.process !== child) {
        return;
      }
      if (!line.trim()) {
        continue;
      }

      const message = JSON.parse(line) as RpcMessage;
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new Error('Invalid RPC message');
      }

      // Notification Codex
      if (message.method && message.id === undefined) {
        const notification: RpcNotification = {
          method: message.method,
          params: message.params,
        };
        this.approvals.handleNotification(notification);
        this.rememberTelemetry(notification);

        for (const listener of this.notificationListeners) {
          listener(notification);
        }

        continue;
      }

      // Requête envoyée PAR Codex vers Nexus.
      if (message.method && message.id !== undefined) {
        this.approvals.handleRequest({
          id: message.id,
          method: message.method,
          params: message.params,
        });

        continue;
      }

      // Réponse à une RPC Nexus → Codex
      if (typeof message.id !== 'number') {
        continue;
      }

      const request = this.pending.get(message.id);

      if (!request) {
        continue;
      }

      clearTimeout(request.timeout);

      this.pending.delete(message.id);

      if (message.error) {
        request.reject(rpcError(request.method, message.error.code, message.error.message));

        continue;
      }

      request.resolve(message.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }

    this.pending.clear();
  }
}
