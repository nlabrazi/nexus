import {
  AntigravityApprovalHandler,
  AntigravityApprovalRequest,
  ApprovalDecision,
} from './types';

export const APPROVAL_TIMEOUT_MS = 60_000;

const COMMAND_TOOLS = new Set([
  'run_command',
  'command',
  'terminal_command',
  'execute_command',
]);

const FILE_CHANGE_TOOLS = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
  'create_file',
  'delete_file',
]);

const PERMISSION_TOOLS = new Set([
  'ask_permission',
  'ask_custom_permission',
  'request_approval',
]);

export function getGuardRailKind(toolName: string): 'command' | 'fileChange' | undefined {
  if (COMMAND_TOOLS.has(toolName)) {
    return 'command';
  }
  if (FILE_CHANGE_TOOLS.has(toolName)) {
    return 'fileChange';
  }
  if (PERMISSION_TOOLS.has(toolName)) {
    return 'command';
  }
  return undefined;
}

export function isGuardRailTool(toolName: string): boolean {
  return getGuardRailKind(toolName) !== undefined;
}

interface PendingApproval {
  conversationId: string;
  stepIndex: number;
  settle: (decision: ApprovalDecision) => void;
}

/** Owns Antigravity approval lifecycle, timeouts, and guard-rail detection. */
export class AntigravityApprovals {
  private readonly pending = new Map<string, PendingApproval>();
  private activeTurn?: { conversationId: string };

  constructor(
    private readonly handler?: AntigravityApprovalHandler,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS
  ) { }

  getPendingCount(): number {
    return this.pending.size;
  }

  beginTurn(conversationId: string): void {
    this.endTurn();
    this.activeTurn = { conversationId };
  }

  endTurn(): void {
    this.activeTurn = undefined;
    for (const approval of this.pending.values()) {
      approval.settle('decline');
    }
    this.pending.clear();
  }

  cancelAll(): void {
    this.endTurn();
  }

  async requestToolApproval(
    conversationId: string,
    stepIndex: number,
    toolName: string,
    parameters?: Record<string, unknown>
  ): Promise<ApprovalDecision> {
    if (!this.handler) {
      return 'accept';
    }
    const kind = getGuardRailKind(toolName);
    if (!kind) {
      return 'accept';
    }
    if (this.activeTurn?.conversationId !== conversationId) {
      return 'decline';
    }

    const key = `${conversationId}:${stepIndex}:${toolName}`;
    if (this.pending.has(key)) {
      return 'decline';
    }

    const details = JSON.stringify({
      tool: toolName,
      ...(parameters ?? {}),
    }, null, 2);

    const controller = new AbortController();
    const expiresAt = Date.now() + this.timeoutMs;

    return new Promise<ApprovalDecision>(resolve => {
      const approval: PendingApproval = {
        conversationId,
        stepIndex,
        settle: (decision: ApprovalDecision) => {
          if (this.pending.get(key) !== approval) {
            return;
          }
          this.pending.delete(key);
          clearTimeout(timer);
          controller.abort();
          resolve(decision);
        },
      };

      const timer = setTimeout(() => approval.settle('decline'), this.timeoutMs);
      this.pending.set(key, approval);

      const request: AntigravityApprovalRequest = {
        agentName: 'Antigravity',
        kind,
        threadId: conversationId,
        turnId: String(stepIndex),
        itemId: toolName,
        details,
        expiresAt,
      };

      void Promise.resolve()
        .then(() => controller.signal.aborted ? 'decline' as const : this.handler!(request, controller.signal))
        .then(decision => approval.settle(decision === 'accept' ? 'accept' : 'decline'))
        .catch(() => approval.settle('decline'));
    });
  }

  async handleApprovalEvent(event: Record<string, unknown>): Promise<ApprovalDecision | undefined> {
    if (!this.handler) {
      return 'accept';
    }
    const req = (event.approval_request ?? event.permission_request) as Record<string, unknown> | undefined;
    if (!req) {
      return undefined;
    }
    const kind = req.kind === 'fileChange' ? 'fileChange' : 'command';
    const conversationId = (event.conversation_id ?? this.activeTurn?.conversationId ?? '') as string;
    const key = String(req.id ?? Date.now());
    const details = typeof req.details === 'string' ? req.details : JSON.stringify(req, null, 2);
    const controller = new AbortController();
    const expiresAt = Date.now() + this.timeoutMs;

    return new Promise<ApprovalDecision>(resolve => {
      const approval: PendingApproval = {
        conversationId,
        stepIndex: 0,
        settle: (decision: ApprovalDecision) => {
          if (this.pending.get(key) !== approval) {
            return;
          }
          this.pending.delete(key);
          clearTimeout(timer);
          controller.abort();
          resolve(decision);
        },
      };

      const timer = setTimeout(() => approval.settle('decline'), this.timeoutMs);
      this.pending.set(key, approval);

      const request: AntigravityApprovalRequest = {
        agentName: 'Antigravity',
        kind,
        threadId: conversationId,
        turnId: String(req.turnId ?? '0'),
        itemId: String(req.id ?? 'approval'),
        details,
        expiresAt,
      };

      void Promise.resolve()
        .then(() => controller.signal.aborted ? 'decline' as const : this.handler!(request, controller.signal))
        .then(decision => approval.settle(decision === 'accept' ? 'accept' : 'decline'))
        .catch(() => approval.settle('decline'));
    });
  }
}
