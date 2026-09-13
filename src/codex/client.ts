import {
  spawn,
  ChildProcessWithoutNullStreams
} from 'child_process';

import {
  RpcResponse,
  ThreadStartResponse
} from './types';

export class CodexClient {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = '';
  private requestId = 0;

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

      let message: RpcResponse;

      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        console.error(
          '[Codex] Invalid JSON received:',
          line
        );

        continue;
      }

      if (message.id === undefined) {
        continue;
      }

      const request = this.pending.get(message.id);

      if (!request) {
        continue;
      }

      this.pending.delete(message.id);

      if (message.error) {
        request.reject(
          new Error(message.error.message)
        );

        continue;
      }
      clearTimeout(request.timeout);

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
