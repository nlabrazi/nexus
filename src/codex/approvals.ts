import {
  ApprovalDecision,
  CodexApprovalHandler,
  RpcMessage,
  RpcNotification,
  RpcRequestId,
  RpcServerRequest,
} from './types';

export const APPROVAL_TIMEOUT_MS = 60_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

interface PendingApproval {
  threadId: string;
  turnId: string;
  settle: (decision: ApprovalDecision, reply?: boolean) => void;
}

/** Owns RPC replies and cancellation; Telegram only supplies a user decision. */
export class CodexApprovals {
  private readonly pending = new Map<RpcRequestId, PendingApproval>();
  private readonly items = new Map<string, Record<string, unknown>>();
  private activeTurn?: { threadId: string; turnId?: string };

  constructor(
    private readonly reply: (message: RpcMessage) => void,
    private readonly handler?: CodexApprovalHandler,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS
  ) {}

  getPendingCount(): number {
    return this.pending.size;
  }

  beginTurn(threadId: string): void {
    this.endTurn();
    this.activeTurn = { threadId };
  }

  setTurnId(turnId: string): void {
    if (!this.activeTurn) {
      return;
    }
    this.activeTurn.turnId = turnId;
    for (const approval of this.pending.values()) {
      if (approval.turnId !== turnId) {
        approval.settle('decline');
      }
    }
  }

  endTurn(reply = true): void {
    this.activeTurn = undefined;
    for (const approval of this.pending.values()) {
      approval.settle('decline', reply);
    }
    this.items.clear();
  }

  handleNotification(notification: RpcNotification): void {
    const params = record(notification.params);
    if (!params) {
      return;
    }
    if (notification.method === 'serverRequest/resolved') {
      const id = params.requestId;
      if (typeof id === 'number' || typeof id === 'string') {
        const approval = this.pending.get(id);
        if (approval && approval.threadId === params.threadId) {
          approval.settle('decline', false);
        }
      }
      return;
    }
    if (params.threadId !== this.activeTurn?.threadId) {
      return;
    }
    if (notification.method === 'item/started') {
      const item = record(params.item);
      if (item && typeof item.id === 'string' && typeof params.turnId === 'string') {
        this.items.set(JSON.stringify([params.turnId, item.id]), item);
      }
    } else if (notification.method === 'item/completed') {
      const item = record(params.item);
      this.items.delete(JSON.stringify([params.turnId, item?.id]));
    }
  }

  handleRequest(request: RpcServerRequest): void {
    // Duplicate delivery must neither open a second prompt nor reply twice.
    if (this.pending.has(request.id)) {
      return;
    }
    if (request.method === 'item/permissions/requestApproval') {
      // This protocol grants access for a turn/session, not a single action.
      this.send({ id: request.id, result: { permissions: {}, scope: 'turn' } });
      return;
    }
    const kind =
      request.method === 'item/commandExecution/requestApproval'
        ? 'command'
        : request.method === 'item/fileChange/requestApproval'
          ? 'fileChange'
          : undefined;
    if (!kind) {
      this.send({
        id: request.id,
        error: { code: -32601, message: 'Unsupported server request' },
      });
      return;
    }

    const params = record(request.params);
    const threadId = params?.threadId;
    const turnId = params?.turnId;
    const itemId = params?.itemId;
    if (
      !this.handler ||
      !params ||
      typeof threadId !== 'string' ||
      typeof turnId !== 'string' ||
      typeof itemId !== 'string' ||
      !threadId ||
      !turnId ||
      !itemId ||
      threadId !== this.activeTurn?.threadId ||
      (this.activeTurn.turnId !== undefined && turnId !== this.activeTurn.turnId) ||
      (params.availableDecisions !== undefined &&
        params.availableDecisions !== null &&
        (!Array.isArray(params.availableDecisions) ||
          !params.availableDecisions.includes('accept')))
    ) {
      this.send({ id: request.id, result: { decision: 'decline' } });
      return;
    }

    const item = this.items.get(JSON.stringify([turnId, itemId]));
    const network = record(params.networkApprovalContext);
    const command = params.command ?? item?.command;
    const hasAction =
      kind === 'command'
        ? (typeof command === 'string' && command.trim().length > 0) ||
          (typeof network?.host === 'string' && typeof network.protocol === 'string')
        : item?.type === 'fileChange' && Array.isArray(item.changes) && item.changes.length > 0;
    if (!hasAction) {
      this.send({ id: request.id, result: { decision: 'decline' } });
      return;
    }
    // Keep the entire action visible. Oversized prompts are refused by Telegram.
    const details = JSON.stringify(
      {
        ...params,
        ...(item ? { action: item } : {}),
      },
      null,
      2
    );
    const controller = new AbortController();
    const expiresAt = Date.now() + this.timeoutMs;
    const approval: PendingApproval = {
      threadId,
      turnId,
      settle: (decision, reply = true) => {
        if (this.pending.get(request.id) !== approval) {
          return;
        }
        this.pending.delete(request.id);
        clearTimeout(timeout);
        if (reply) {
          this.send({
            id: request.id,
            result: {
              decision:
                decision === 'accept' &&
                Date.now() < expiresAt &&
                this.activeTurn?.turnId === turnId
                  ? 'accept'
                  : 'decline',
            },
          });
        }
        controller.abort();
      },
    };
    const timeout = setTimeout(() => approval.settle('decline'), this.timeoutMs);
    this.pending.set(request.id, approval);
    void Promise.resolve()
      .then(() =>
        controller.signal.aborted
          ? ('decline' as const)
          : this.handler!(
              {
                kind,
                threadId,
                turnId,
                itemId,
                details,
                expiresAt,
              },
              controller.signal
            )
      )
      .then((decision) => approval.settle(decision === 'accept' ? 'accept' : 'decline'))
      .catch(() => approval.settle('decline'));
  }

  private send(message: RpcMessage): void {
    try {
      this.reply({ jsonrpc: '2.0', ...message });
    } catch {
      // The process may have exited. Never replay a decision to a new process.
      console.warn('[Codex] Unable to deliver approval response.');
    }
  }
}
