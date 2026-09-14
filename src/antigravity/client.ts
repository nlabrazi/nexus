import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process';
import { workspaceEnvironment } from '../workspace/environment';
import { AntigravityError, processError, turnTimeoutError } from './errors';
import {
  convertRawUsage,
  isInitEvent,
  isResultEvent,
  isStepUpdateEvent,
  parseModelsOutput,
} from './telemetry';
import {
  AntigravityClientStatus,
  AntigravityModel,
  ConversationTelemetry,
  ConversationTokenUsage,
  ModelSelection,
  StreamOutputEvent,
  UserStreamInput,
} from './types';

export interface AntigravityClientOptions {
  binaryPath?: string;
  executablePath?: string;
  sandbox?: boolean;
  dangerouslySkipPermissions?: boolean;
  model?: string;
  effort?: string;
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

  constructor(private readonly options: AntigravityClientOptions = {}) {
    this.binaryPath = options.executablePath ?? options.binaryPath ?? 'agy';
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
    if (this.options.dangerouslySkipPermissions !== false) {
      args.push('--dangerously-skip-permissions');
    }

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

    child.on('error', error => this.disconnect(child, processError(error)));
    child.on('exit', (code, signal) => {
      this.disconnect(
        child,
        processError(new Error(`Antigravity exited: code=${code}, signal=${signal}`)),
        false
      );
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', error => this.disconnect(child, processError(error)));
    }
    child.stdout.on('end', () => {
      this.disconnect(child, processError(new Error('Antigravity stdout closed')));
    });

    child.stdout.on('data', chunk => this.handleStdout(chunk));

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

    const changedFiles = new Set<string>();
    let collectedResponse = '';

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;
      let interruptTimeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (this.currentTurn === currentTurn) {
          this.currentTurn = undefined;
        }
        if (this.turnFailure === fail) {
          this.turnFailure = undefined;
        }
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

        if (isStepUpdateEvent(event)) {
          const step = event.step_update;
          if (step.conversation_id !== conversationId) {
            return;
          }

          if (step.step_type === 'agent_response' && step.text_delta) {
            collectedResponse += step.text_delta;
          }

          if (step.step_type === 'tool' && step.tool_info?.parameters) {
            const params = step.tool_info.parameters;
            for (const key of ['TargetFile', 'file_path', 'path']) {
              const val = params[key];
              if (typeof val === 'string' && val.trim()) {
                changedFiles.add(val.trim());
              }
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
            fail(
              new AntigravityError(
                'turn_failed',
                `Le turn Antigravity a échoué : ${res.error ?? 'erreur inconnue'}.`
              )
            );
            return;
          }

          const responseText = (res.response || collectedResponse).trim();
          if (!responseText) {
            fail(
              new AntigravityError(
                'empty_response',
                'Antigravity a terminé sans réponse textuelle finale.'
              )
            );
            return;
          }

          if (onFilesChanged && changedFiles.size > 0) {
            onFilesChanged([...changedFiles]);
          }

          settled = true;
          cleanup();
          resolve(responseText);
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
        child.stdin.write(`${JSON.stringify(inputMessage)}\n`, writeError => {
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
        reasoningOutputTokens: existing.total.reasoningOutputTokens + breakdown.reasoningOutputTokens,
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
        // Ignore unparseable non-JSON lines
      }
    }
  }

  stop(): void {
    if (this.process) {
      this.disconnect(this.process, new AntigravityError('stopped', 'Le processus Antigravity a été arrêté.'));
    }
  }

  private disconnect(child: ChildProcessWithoutNullStreams, error: Error, kill = true): void {
    if (this.process !== child) {
      return;
    }
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
