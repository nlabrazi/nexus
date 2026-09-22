import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { StreamOutputEvent, UserStreamInput } from '../../antigravity/types';

export class FakeAntigravityProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: UserStreamInput[] = [];
  kills = 0;
  conversationId = 'test-conversation-uuid';
  cwd = '/workspace';
  autoInit = true;

  constructor(public args: string[] = []) {
    super();

    // Extract conversation ID or CWD if present in args
    const convIdx = args.indexOf('--conversation');
    if (convIdx !== -1 && args[convIdx + 1]) {
      this.conversationId = args[convIdx + 1];
    }
    const dirIdx = args.indexOf('--add-dir');
    if (dirIdx !== -1 && args[dirIdx + 1]) {
      this.cwd = args[dirIdx + 1];
    }

    if (this.autoInit) {
      queueMicrotask(() => {
        this.sendInit(this.conversationId, this.cwd);
      });
    }

    let buffer = '';
    this.stdin.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const message = JSON.parse(line) as UserStreamInput;
        this.written.push(message);
      }
    });
  }

  send(event: StreamOutputEvent): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  sendInit(conversationId = this.conversationId, cwd = this.cwd): void {
    this.send({
      event: 'init',
      conversation_id: conversationId,
      init: {
        cwd,
        tools: ['run_command', 'write_to_file', 'replace_file_content'],
        permission_mode: 'request-review',
      },
    });
  }

  sendDelta(delta: string, stepIndex = 1): void {
    this.send({
      event: 'step_update',
      step_update: {
        conversation_id: this.conversationId,
        step_index: stepIndex,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: delta,
      },
    });
  }

  sendTool(toolName: string, parameters: Record<string, unknown>, output?: string, stepIndex = 2): void {
    this.sendToolActive(toolName, parameters, stepIndex);
    this.sendToolDone(toolName, parameters, output, stepIndex);
  }

  sendToolActive(toolName: string, parameters: Record<string, unknown>, stepIndex = 2): void {
    this.send({
      event: 'step_update',
      step_update: {
        conversation_id: this.conversationId,
        step_index: stepIndex,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: toolName,
        tool_info: { name: toolName, parameters },
      },
    });
  }

  sendToolDone(toolName: string, parameters: Record<string, unknown>, output?: string, stepIndex = 2): void {
    this.send({
      event: 'step_update',
      step_update: {
        conversation_id: this.conversationId,
        step_index: stepIndex,
        state: 'DONE',
        step_type: 'tool',
        tool_name: toolName,
        tool_info: { name: toolName, parameters, output: output ?? 'ok' },
      },
    });
  }

  sendApprovalRequest(id: string, kind: 'command' | 'fileChange', details: string, turnId = '1'): void {
    this.stdout.write(`${JSON.stringify({
      event: 'approval_request',
      conversation_id: this.conversationId,
      approval_request: { id, kind, details, turnId },
    })}\n`);
  }

  complete(
    response = 'Done',
    usage = {
      input_tokens: 100,
      output_tokens: 50,
      thinking_tokens: 20,
      cache_read_tokens: 10,
      total_tokens: 150,
    }
  ): void {
    this.sendDelta(response);
    this.send({
      event: 'result',
      result: {
        conversation_id: this.conversationId,
        status: 'SUCCESS',
        response,
        duration_seconds: 1.0,
        num_turns: 1,
        usage,
      },
    });
  }

  fail(errorMessage: string): void {
    this.send({
      event: 'result',
      result: {
        conversation_id: this.conversationId,
        status: 'ERROR',
        response: '',
        error: errorMessage,
        duration_seconds: 0.5,
        num_turns: 1,
      },
    });
  }

  kill(signal?: string): boolean {
    this.kills++;
    this.emit('exit', signal === 'SIGKILL' ? 137 : 0, signal);
    return true;
  }
}
