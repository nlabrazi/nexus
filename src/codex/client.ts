import {
  spawn,
  ChildProcessWithoutNullStreams
} from 'child_process';

import {
  AgentMessageDeltaNotification,
  ItemCompletedNotification,
  RpcMessage,
  RpcNotification,
  ThreadStartResponse,
  TurnCompletedNotification,
  TurnStartResponse,
} from './types';

export class CodexClient {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private requestId = 0;

  private notificationListeners = new Set<
    (notification: RpcNotification) => void
  >();

  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(
      'codex',
      ['app-server', '--stdio'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    this.process.stdout.on('data', chunk => {
      this.handleStdout(chunk);
    });

    this.process.stderr.on('data', chunk => {
      const message = chunk.toString().trim();

      if (message) {
        console.log(`[Codex] ${message}`);
      }
    });

    this.process.on('error', error => {
      this.rejectPending(error);
      this.process = undefined;
    });

    this.process.on('exit', code => {
      this.rejectPending(
        new Error(`Codex process exited with code ${code}`)
      );

      this.process = undefined;
    });

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

    this.notify('initialized', {});
  }

  async startSession(
    cwd: string
  ): Promise<ThreadStartResponse> {
    return await this.request(
      'thread/start',
      {
        cwd,
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        serviceName: 'nexus',
      }
    ) as ThreadStartResponse;
  }

  stop(): void {
    this.process?.kill();
    this.process = undefined;

    this.rejectPending(
      new Error('Codex stopped')
    );
  }

  async runTurn(
    threadId: string,
    prompt: string
  ): Promise<string> {
    if (!this.process) {
      throw new Error('Codex is not running');
    }

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      throw new Error('Codex prompt cannot be empty');
    }

    const child = this.process;

    let turnId: string | undefined;
    let streamedText = '';
    let completedText = '';
    let earlyCompletion: TurnCompletedNotification | undefined;

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        clearTimeout(timeout);
        this.notificationListeners.delete(onNotification);
        child.off('exit', onExit);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const complete = (
        params: TurnCompletedNotification
      ) => {
        if (settled) {
          return;
        }

        if (params.turn.status !== 'completed') {
          fail(
            new Error(
              params.turn.error?.message ??
              `Codex turn ${params.turn.status}`
            )
          );

          return;
        }

        const response =
          streamedText.trim() ||
          completedText.trim();

        if (!response) {
          fail(
            new Error(
              'Codex completed without a text response'
            )
          );

          return;
        }

        settled = true;
        cleanup();
        resolve(response);
      };

      const onNotification = (
        notification: RpcNotification
      ) => {
        if (
          notification.method ===
          'item/agentMessage/delta'
        ) {
          const params =
            notification.params as AgentMessageDeltaNotification;

          if (params.threadId !== threadId) {
            return;
          }

          if (
            turnId &&
            params.turnId !== turnId
          ) {
            return;
          }

          streamedText += params.delta;

          return;
        }

        if (
          notification.method ===
          'item/completed'
        ) {
          const params =
            notification.params as ItemCompletedNotification;

          if (
            params.threadId !== threadId ||
            params.item.type !== 'agentMessage'
          ) {
            return;
          }

          if (
            turnId &&
            params.turnId !== turnId
          ) {
            return;
          }

          completedText =
            params.item.text ?? '';

          return;
        }

        if (
          notification.method ===
          'turn/completed'
        ) {
          const params =
            notification.params as TurnCompletedNotification;

          if (params.threadId !== threadId) {
            return;
          }

          if (!turnId) {
            earlyCompletion = params;
            return;
          }

          if (params.turn.id !== turnId) {
            return;
          }

          complete(params);
        }
      };

      const onExit = (code: number | null) => {
        fail(
          new Error(
            `Codex exited during turn with code ${code}`
          )
        );
      };

      timeout = setTimeout(() => {
        fail(
          new Error('Codex turn timeout after 120 seconds')
        );
      }, 120_000);

      this.notificationListeners.add(onNotification);
      child.once('exit', onExit);

      void this.request(
        'turn/start',
        {
          threadId,
          input: [
            {
              type: 'text',
              text: trimmedPrompt,
              textElements: [],
            },
          ],
        }
      )
        .then(result => {
          const response =
            result as TurnStartResponse;

          turnId = response.turn.id;

          if (
            earlyCompletion &&
            earlyCompletion.turn.id === turnId
          ) {
            complete(earlyCompletion);
          }
        })
        .catch(error => {
          fail(
            error instanceof Error
              ? error
              : new Error(String(error))
          );
        });
    });
  }

  private request(
    method: string,
    params: unknown
  ): Promise<unknown> {
    const id = ++this.requestId;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }

        this.pending.delete(id);

        reject(
          new Error(`Codex RPC timeout: ${method}`)
        );
      }, 15_000);

      this.pending.set(id, {
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

        reject(
          error instanceof Error
            ? error
            : new Error(String(error))
        );
      }
    });
  }

  private notify(
    method: string,
    params: unknown
  ): void {
    this.write({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private write(message: unknown): void {
    if (!this.process) {
      throw new Error('Codex is not running');
    }

    this.process.stdin.write(
      `${JSON.stringify(message)}\n`
    );
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let message: RpcMessage;

      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        console.error(
          '[Codex] Invalid JSON received:',
          line
        );

        continue;
      }

      // Notification Codex
      if (
        message.method &&
        message.id === undefined
      ) {
        const notification: RpcNotification = {
          method: message.method,
          params: message.params,
        };

        for (
          const listener
          of this.notificationListeners
        ) {
          listener(notification);
        }

        continue;
      }

      // Requête envoyée PAR Codex vers Nexus.
      // Exemple futur : approval.
      if (
        message.method &&
        message.id !== undefined
      ) {
        console.warn(
          `[Codex] Unsupported server request: ${message.method}`
        );

        continue;
      }

      // Réponse à une RPC Nexus → Codex
      if (message.id === undefined) {
        continue;
      }

      const request =
        this.pending.get(message.id);

      if (!request) {
        continue;
      }

      clearTimeout(request.timeout);

      this.pending.delete(message.id);

      if (message.error) {
        request.reject(
          new Error(message.error.message)
        );

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
