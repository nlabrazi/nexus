import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { RpcMessage, CodexThread } from '../../codex/types';

export class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: RpcMessage[] = [];
  blockedMethods = new Set<string>();
  threads = new Map<string, CodexThread>();
  kills = 0;
  private threadCount = 0;

  constructor() {
    super();
    this.stdin.on('data', chunk => {
      const message = JSON.parse(chunk.toString()) as RpcMessage;
      this.written.push(message);
      if (message.method && this.blockedMethods.has(message.method)) {
        return;
      }
      if (message.method === 'initialize') {
        this.receive({ id: message.id, result: {} });
      } else if (message.method === 'thread/start') {
        const id = ++this.threadCount === 1 ? 'thread' : `thread-${this.threadCount}`;
        const thread = { id, cwd: (message.params as { cwd: string }).cwd, status: { type: 'idle' } };
        this.threads.set(id, thread);
        this.receive({ id: message.id, result: { thread } });
      } else if (message.method === 'thread/read' || message.method === 'thread/resume') {
        const thread = this.threads.get((message.params as { threadId: string }).threadId);
        this.receive(thread ? { id: message.id, result: { thread } }
          : { id: message.id, error: { code: -32000, message: 'Session not found' } });
      } else if (message.method === 'turn/start') {
        this.receive({ id: message.id, result: { turn: { id: 'turn' } } });
      } else if (message.method === 'turn/interrupt') {
        const params = message.params as { threadId: string; turnId: string };
        this.receive({ id: message.id, result: {} });
        this.receive({ method: 'turn/completed', params: {
          threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' },
        } });
      }
    });
  }

  receive(message: RpcMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  approve(id: string): void {
    this.receive({ id, method: 'item/commandExecution/requestApproval', params: {
      threadId: 'thread', turnId: 'turn', itemId: 'item', command: 'npm test',
    } });
  }

  complete(): void {
    this.receive({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', itemId: 'answer', delta: 'Done' } });
    this.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  }

  kill(): boolean { this.kills++; return true; }
}
