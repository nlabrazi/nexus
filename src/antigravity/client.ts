import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { workspaceEnvironment } from '../workspace/environment';
import { AntigravityError, emptyResponseError, processError, turnTimeoutError } from './errors';
import {
  convertRawUsage,
  isInitEvent,
  isResultEvent,
  isStepUpdateEvent,
  parseModelsOutput,
} from './telemetry';
import {
  AntigravityApprovalHandler,
  AntigravityClientStatus,
  AntigravityModel,
  ConversationTelemetry,
  ConversationTokenUsage,
  ModelSelection,
  StreamOutputEvent,
  UserStreamInput,
} from './types';
import { AntigravityApprovals, isGuardRailTool } from './approvals';

export interface AntigravityClientOptions {
  binaryPath?: string;
  executablePath?: string;
  sandbox?: boolean;
  dangerouslySkipPermissions?: boolean;
  model?: string;
  effort?: string;
  approvalHandler?: AntigravityApprovalHandler;
}

export class AntigravityClient {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private currentTurn?: AntigravityClientStatus['turn'];
  private starting?: Promise<string>;
  private connectionId = 0;
  private turnFailure?: (error: Error) => void;
  private readonly telemetry = new Map<string, ConversationTelemetry>();
  private conversationId?: string;
  private readonly binaryPath: string;
  private readonly approvals: AntigravityApprovals;
  private readonly recentStderr: string[] = [];

  private pushStderr(line: string): void {
    this.recentStderr.push(line);
    if (this.recentStderr.length > 50) {
      this.recentStderr.shift();
    }
  }

  constructor(
    private readonly options: AntigravityClientOptions = {},
    approvalHandler?: AntigravityApprovalHandler
  ) {
    this.binaryPath = options.executablePath ?? options.binaryPath ?? 'agy';
    const handler = this.options.dangerouslySkipPermissions
      ? undefined
      : (approvalHandler ?? options.approvalHandler);
    this.approvals = new AntigravityApprovals(handler);
  }

  async checkInstalled(): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.binaryPath, ['--version'], (error, stdout) => {
        if (error) {
          reject(processError(error));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  getStatus(): AntigravityClientStatus {
    return {
      processRunning: this.process !== undefined,
      turn: this.currentTurn ? { ...this.currentTurn } : undefined,
      pendingApprovals: this.approvals.getPendingCount(),
    };
  }

  getConnectionId(): number | undefined {
    return this.process ? this.connectionId : undefined;
  }

  getConversationTelemetry(conversationId: string): ConversationTelemetry {
    return structuredClone(this.telemetry.get(conversationId) ?? {});
  }

  async listModels(): Promise<AntigravityModel[]> {
    return new Promise((resolve, reject) => {
      execFile(
        this.binaryPath,
        ['models'],
        { timeout: 10_000, env: workspaceEnvironment() },
        (error, stdout) => {
          if (error) {
            reject(
              new AntigravityError(
                'protocol_error',
                `Impossible de récupérer la liste des modèles Antigravity : ${error.message}`,
                { cause: error }
              )
            );
            return;
          }
          try {
            const models = parseModelsOutput(stdout);
            if (!models.length) {
              reject(
                new AntigravityError(
                  'protocol_error',
                  'Antigravity n’a renvoyé aucun modèle disponible.'
                )
              );
              return;
            }
            resolve(models);
          } catch (parseError) {
            reject(
              new AntigravityError(
                'protocol_error',
                'Le catalogue de modèles Antigravity est invalide.',
                { cause: parseError }
              )
            );
          }
        }
      );
    });
  }

  start(options?: {
    cwd?: string;
    conversationId?: string;
    selection?: ModelSelection;
    forceNew?: boolean;
  }): Promise<string> {
    if (this.starting) {
      return this.starting;
    }
    if (
      this.process &&
      this.conversationId &&
      !options?.forceNew &&
      (!options?.conversationId || options.conversationId === this.conversationId)
    ) {
      return Promise.resolve(this.conversationId);
    }
    if (this.process) {
      this.stop();
    }

    const starting = this.startProcess(options);
    this.starting = starting;
    const clear = () => {
      if (this.starting === starting) {
        this.starting = undefined;
      }
    };
    void starting.then(clear, clear);
    return starting;
  }

  private async startProcess(options?: {
    cwd?: string;
    conversationId?: string;
    selection?: ModelSelection;
  }): Promise<string> {
    const args: string[] = [
      '-p',
      '',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
    ];

    if (options?.cwd) {
      args.push('--add-dir', options.cwd);
    }
    if (options?.conversationId) {
      args.push('--conversation', options.conversationId);
    }

    const model = options?.selection?.model ?? this.options.model;
    if (model) {
      args.push('--model', model);
    }
    const effort = options?.selection?.effort ?? this.options.effort;
    if (effort) {
      args.push('--effort', effort);
    }

    if (this.options.sandbox !== false) {
      args.push('--sandbox');
    }
    // In headless stream-json mode, agy cannot prompt on an interactive TTY and
    // will auto-deny any tools requiring permissions (such as unsandboxed paths).
    // Nexus acts as the supervisor that gates actions via Telegram approvals.
    args.push('--dangerously-skip-permissions');

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.binaryPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: workspaceEnvironment(),
      });
    } catch (error) {
      throw processError(error);
    }

    this.process = child;
    this.connectionId++;
    this.buffer = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.on('error', (error) => this.disconnect(child, processError(error)));
    child.on('exit', (code, signal) => {
      const recent = this.recentStderr.slice(-5);
      const extra = recent.length > 0 ? `\nLogs stderr :\n${recent.join('\n')}` : '';
      this.disconnect(
        child,
        processError(new Error(`Antigravity exited: code=${code}, signal=${signal}${extra}`)),
        false
      );
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', (error) => this.disconnect(child, processError(error)));
    }
    child.stdout.on('end', () => {
      this.disconnect(child, processError(new Error('Antigravity stdout closed')));
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      const lines = text
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => Boolean(l));
      for (const line of lines) {
        console.warn(`[Antigravity stderr] ${line}`);
        this.pushStderr(line);
      }
    });

    child.stdout.on('data', (chunk) => this.handleStdout(chunk));

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this.eventListeners.delete(onInit);
        const err = new AntigravityError(
          'stream_timeout',
          'Délai dépassé lors de l’initialisation d’Antigravity.'
        );
        this.disconnect(child, err);
        reject(err);
      }, 15_000);

      const onInit = (event: StreamOutputEvent) => {
        if (settled || this.process !== child) {
          return;
        }
        if (isInitEvent(event)) {
          settled = true;
          clearTimeout(timeout);
          this.eventListeners.delete(onInit);
          this.conversationId = event.conversation_id;

          const telemetry: ConversationTelemetry = {
            model,
            reasoningEffort: effort,
            sandbox: this.options.sandbox !== false ? 'enabled' : 'disabled',
          };
          this.telemetry.set(event.conversation_id, telemetry);
          resolve(event.conversation_id);
        }
      };

      this.eventListeners.add(onInit);
    });
  }

  async runTurn(
    conversationId: string,
    prompt: string,
    onFilesChanged?: (paths: readonly string[]) => void
  ): Promise<string> {
    if (!this.process) {
      throw processError(new Error('Antigravity is not running'));
    }
    if (this.currentTurn) {
      throw new Error('Un turn Antigravity est déjà en cours.');
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Antigravity prompt cannot be empty');
    }

    const child = this.process;
    const currentTurn: NonNullable<AntigravityClientStatus['turn']> = { startedAt: Date.now() };
    this.currentTurn = currentTurn;
    this.approvals.beginTurn(conversationId);

    const stderrStartIdx = this.recentStderr.length;
    const toolsCalled: Array<{ name: string; state: string; error?: string }> = [];
    const changedFiles = new Set<string>();
    let collectedResponse = '';

    console.log(
      `[Antigravity] Starting turn in conversation ${conversationId}: "${trimmedPrompt.slice(0, 100)}${trimmedPrompt.length > 100 ? '...' : ''}"`
    );

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      let interruptTimeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        this.eventListeners.delete(onNotification);
        if (this.currentTurn === currentTurn) {
          this.currentTurn = undefined;
        }
        if (this.turnFailure === fail) {
          this.turnFailure = undefined;
        }
        this.approvals.endTurn();
        clearTimeout(timeout);
        clearTimeout(interruptTimeout);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      this.turnFailure = fail;

      const onNotification = (event: StreamOutputEvent) => {
        if (settled || this.process !== child) {
          return;
        }

        const rawEvent = event as unknown as Record<string, unknown>;
        if (rawEvent.approval_request || rawEvent.permission_request) {
          void this.approvals.handleApprovalEvent(rawEvent).then((decision) => {
            if (decision === 'decline' && !settled) {
              fail(
                new AntigravityError(
                  'approval_declined',
                  'L’approbation a été refusée par l’utilisateur.'
                )
              );
              try {
                child.kill('SIGINT');
              } catch {
                /* ignore */
              }
            }
          });
        }

        if (isStepUpdateEvent(event)) {
          const step = event.step_update;
          if (step.conversation_id !== conversationId) {
            return;
          }

          if (step.step_type === 'agent_response' && step.text_delta) {
            collectedResponse += step.text_delta;
          }

          if (step.step_type === 'tool') {
            const toolName = step.tool_name ?? 'unknown';
            const toolState = step.state ?? 'UNKNOWN';
            const toolError = step.tool_info?.error
              ? `${step.tool_info.error.type ? `[${step.tool_info.error.type}] ` : ''}${step.tool_info.error.message}`
              : undefined;

            console.log(
              `[Antigravity] Tool ${toolName} [${toolState}]${toolError ? ` Error: ${toolError}` : ''}`
            );

            let existingIdx = -1;
            for (let i = toolsCalled.length - 1; i >= 0; i--) {
              if (toolsCalled[i].name === toolName) {
                existingIdx = i;
                break;
              }
            }

            if (existingIdx >= 0 && toolsCalled[existingIdx].state !== 'COMPLETED') {
              toolsCalled[existingIdx] = { name: toolName, state: toolState, error: toolError };
            } else {
              toolsCalled.push({ name: toolName, state: toolState, error: toolError });
            }

            if (toolError) {
              console.warn(`[Antigravity] Tool error on ${toolName}: ${toolError}`);
            }

            if (step.tool_info?.parameters) {
              const params = step.tool_info.parameters;
              for (const key of ['TargetFile', 'file_path', 'path']) {
                const val = params[key];
                if (typeof val === 'string' && val.trim()) {
                  changedFiles.add(val.trim());
                }
              }
            }

            if (step.state === 'ACTIVE' && isGuardRailTool(step.tool_name ?? '')) {
              void this.approvals
                .requestToolApproval(
                  conversationId,
                  step.step_index,
                  step.tool_name!,
                  step.tool_info?.parameters
                )
                .then((decision) => {
                  if (decision === 'decline' && !settled) {
                    fail(
                      new AntigravityError('approval_declined', 'Action refusée par l’utilisateur.')
                    );
                    try {
                      child.kill('SIGINT');
                    } catch {
                      /* ignore */
                    }
                  }
                });
            }
          }

          if (step.usage) {
            this.recordUsage(conversationId, step.usage);
          }
        } else if (isResultEvent(event)) {
          const res = event.result;
          if (res.conversation_id !== conversationId) {
            return;
          }

          if (res.usage) {
            this.recordUsage(conversationId, res.usage);
          }

          if (res.status !== 'SUCCESS') {
            const turnStderr = this.recentStderr.slice(stderrStartIdx);
            console.error(
              `[Antigravity] Turn ended with non-success status: ${res.status}, error: ${res.error}`
            );
            fail(
              new AntigravityError(
                'turn_failed',
                `Le turn Antigravity a échoué : ${res.error ?? 'erreur inconnue'}.`,
                undefined,
                {
                  toolsCalled,
                  changedFiles: [...changedFiles],
                  recentStderr: turnStderr,
                  pendingApprovals: this.approvals.getPendingCount(),
                }
              )
            );
            return;
          }

          const responseText = (res.response || collectedResponse).trim();
          if (!responseText) {
            const turnStderr = this.recentStderr.slice(stderrStartIdx);
            console.warn('[Antigravity] Turn completed with empty response.', {
              toolsCalled,
              changedFiles: [...changedFiles],
              recentStderr: turnStderr,
              pendingApprovals: this.approvals.getPendingCount(),
            });
            fail(
              emptyResponseError(
                {
                  toolsCalled,
                  changedFiles: [...changedFiles],
                  recentStderr: turnStderr,
                  pendingApprovals: this.approvals.getPendingCount(),
                },
                { dangerouslySkipPermissions: this.options.dangerouslySkipPermissions }
              )
            );
            return;
          }

          const completeTurn = async () => {
            if (this.approvals.getPendingCount() > 0) {
              const decisions = await this.approvals.waitForAllPending();
              if (settled) {
                return;
              }
              if (decisions.some((d) => d === 'decline')) {
                fail(
                  new AntigravityError('approval_declined', 'Action refusée par l’utilisateur.')
                );
                try {
                  child.kill('SIGINT');
                } catch {
                  /* ignore */
                }
                return;
              }
            }

            if (onFilesChanged && changedFiles.size > 0) {
              onFilesChanged([...changedFiles]);
            }

            settled = true;
            cleanup();
            resolve(responseText);
          };

          void completeTurn();
        }
      };

      this.eventListeners.add(onNotification);

      // Turn timeout (120 s)
      timeout = setTimeout(() => {
        currentTurn.interrupting = true;
        if (settled) {
          return;
        }

        // Try soft kill first (SIGINT)
        try {
          child.kill('SIGINT');
        } catch {
          /* transport already closed */
        }

        interruptTimeout = setTimeout(() => {
          this.disconnect(child, turnTimeoutError(false));
          fail(turnTimeoutError(false));
        }, 5000);
      }, 120_000);

      // Write prompt to stdin
      const inputMessage: UserStreamInput = {
        event: 'user',
        message: { content: trimmedPrompt },
      };

      try {
        child.stdin.write(`${JSON.stringify(inputMessage)}\n`, (writeError) => {
          if (writeError) {
            this.disconnect(child, processError(writeError));
            fail(processError(writeError));
          }
        });
      } catch (writeException) {
        const err = processError(writeException);
        this.disconnect(child, err);
        fail(err);
      }
    });
  }

  private recordUsage(
    conversationId: string,
    rawUsage: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      cache_read_tokens?: number;
      total_tokens?: number;
    }
  ): void {
    const telemetry = this.telemetry.get(conversationId) ?? {};
    const breakdown = convertRawUsage(rawUsage);
    const existing = telemetry.tokenUsage;

    const cumulativeTotal = existing
      ? {
          totalTokens: existing.total.totalTokens + breakdown.totalTokens,
          inputTokens: existing.total.inputTokens + breakdown.inputTokens,
          cachedInputTokens: existing.total.cachedInputTokens + breakdown.cachedInputTokens,
          outputTokens: existing.total.outputTokens + breakdown.outputTokens,
          reasoningOutputTokens:
            existing.total.reasoningOutputTokens + breakdown.reasoningOutputTokens,
        }
      : breakdown;

    const usage: ConversationTokenUsage = {
      total: cumulativeTotal,
      last: breakdown,
      modelContextWindow: 1_000_000,
    };

    telemetry.tokenUsage = usage;
    telemetry.tokenUsageUpdatedAt = Date.now();
    this.telemetry.set(conversationId, telemetry);
  }

  private eventListeners = new Set<(event: StreamOutputEvent) => void>();

  private handleStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as StreamOutputEvent;
        for (const listener of this.eventListeners) {
          listener(parsed);
        }
      } catch {
        // Non-JSON output from child process (e.g. startup banner, progress info, debug logs)
        console.log(`[Antigravity stdout] ${line}`);
        this.pushStderr(`[stdout] ${line}`);
      }
    }
  }

  stop(): void {
    this.approvals.cancelAll();
    if (this.process) {
      this.disconnect(
        this.process,
        new AntigravityError('stopped', 'Le processus Antigravity a été arrêté.')
      );
    }
  }

  private disconnect(child: ChildProcessWithoutNullStreams, error: Error, kill = true): void {
    if (this.process !== child) {
      return;
    }
    this.approvals.cancelAll();
    this.process = undefined;
    this.starting = undefined;
    this.buffer = '';
    this.turnFailure?.(error);
    this.currentTurn = undefined;
    this.conversationId = undefined;
    this.eventListeners.clear();

    if (kill) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* Already exited */
      }
    }
  }
}
