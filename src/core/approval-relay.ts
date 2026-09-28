import { EventEmitter } from 'node:events';
import { invalidMessageError, NexusProtocolError } from '../protocol/errors';
import { createNexusMessage, serializeNexusMessage } from '../protocol/messages';
import { ApprovalCancelReason, ApprovalDecision, ApprovalRequestPayload } from '../protocol/types';
import { PendingApproval, PendingApprovalStatus } from './types';
import { WebSocketServerConnection } from './ws-connection';

export class ApprovalRelay extends EventEmitter {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly getConnection: (nodeId: string) => WebSocketServerConnection | undefined
  ) {
    super();
  }

  registerApproval(nodeId: string, payload: ApprovalRequestPayload): PendingApproval {
    const { approvalId, taskId, agentName, kind, details, expiresAt } = payload;

    if (this.approvals.has(approvalId)) {
      throw invalidMessageError(`Une approbation avec l'ID « ${approvalId} » existe déjà.`);
    }

    const pending: PendingApproval = {
      approvalId,
      taskId,
      nodeId,
      agentName: agentName || 'nexus-agent',
      kind,
      details,
      expiresAt,
      createdAt: Date.now(),
      status: 'pending',
    };

    this.approvals.set(approvalId, pending);

    const now = Date.now();
    const timeoutMs = Math.max(0, expiresAt - now);
    const timer = setTimeout(() => {
      this.handleTimeout(approvalId);
    }, timeoutMs);
    timer.unref?.();
    this.timers.set(approvalId, timer);

    this.emit('approval:request', pending);
    return pending;
  }

  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    decidedBy?: string
  ): PendingApproval {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new NexusProtocolError(
        'APPROVAL_NOT_FOUND',
        `Demande d’approbation introuvable : « ${approvalId} »`
      );
    }

    if (approval.status === 'timed_out') {
      throw new NexusProtocolError(
        'APPROVAL_TIMEOUT',
        `Demande d’approbation expirée : « ${approvalId} »`
      );
    }

    if (approval.status !== 'pending') {
      throw invalidMessageError(
        `La demande d’approbation « ${approvalId} » a déjà été traitée (statut : ${approval.status}).`
      );
    }

    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }

    approval.status = decision === 'accept' ? 'approved' : 'declined';
    approval.decision = decision;
    approval.decidedBy = decidedBy;
    approval.decidedAt = Date.now();

    const conn = this.getConnection(approval.nodeId);
    if (conn?.isOpen()) {
      const msg = createNexusMessage('approval:decision', {
        approvalId: approval.approvalId,
        taskId: approval.taskId,
        decision,
        decidedBy,
      });
      conn.send(serializeNexusMessage(msg));
    }

    this.emit('approval:decided', approval);
    return approval;
  }

  cancelApproval(approvalId: string, reason: ApprovalCancelReason = 'task_aborted'): boolean {
    const approval = this.approvals.get(approvalId);
    if (approval?.status !== 'pending') {
      return false;
    }

    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }

    approval.status = 'cancelled';

    const conn = this.getConnection(approval.nodeId);
    if (conn?.isOpen()) {
      const msg = createNexusMessage('approval:cancelled', {
        approvalId: approval.approvalId,
        taskId: approval.taskId,
        reason,
      });
      conn.send(serializeNexusMessage(msg));
    }

    this.emit('approval:cancelled', approval);
    return true;
  }

  cancelTaskApprovals(taskId: string, reason: ApprovalCancelReason = 'task_aborted'): void {
    for (const approval of this.approvals.values()) {
      if (approval.taskId === taskId && approval.status === 'pending') {
        this.cancelApproval(approval.approvalId, reason);
      }
    }
  }

  handleNodeDisconnected(nodeId: string): void {
    for (const approval of this.approvals.values()) {
      if (approval.nodeId === nodeId && approval.status === 'pending') {
        const timer = this.timers.get(approval.approvalId);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(approval.approvalId);
        }
        approval.status = 'cancelled';
        this.emit('approval:cancelled', approval);
      }
    }
  }

  private handleTimeout(approvalId: string): void {
    const approval = this.approvals.get(approvalId);
    if (approval?.status !== 'pending') {
      return;
    }

    this.timers.delete(approvalId);
    approval.status = 'timed_out';
    approval.decision = 'decline';

    // Fail closed: send decline decision to Desktop Node
    const conn = this.getConnection(approval.nodeId);
    if (conn?.isOpen()) {
      const msg = createNexusMessage('approval:decision', {
        approvalId: approval.approvalId,
        taskId: approval.taskId,
        decision: 'decline',
        decidedBy: 'timeout',
      });
      conn.send(serializeNexusMessage(msg));
    }

    this.emit('approval:timeout', approval);
    this.emit('approval:cancelled', approval);
  }

  getApproval(approvalId: string): PendingApproval | undefined {
    return this.approvals.get(approvalId);
  }

  listApprovals(filter?: {
    status?: PendingApprovalStatus;
    taskId?: string;
  }): readonly PendingApproval[] {
    let list = Array.from(this.approvals.values());
    if (filter?.status) {
      list = list.filter((a) => a.status === filter.status);
    }
    if (filter?.taskId) {
      list = list.filter((a) => a.taskId === filter.taskId);
    }
    return list;
  }

  getPendingCount(): number {
    let count = 0;
    for (const a of this.approvals.values()) {
      if (a.status === 'pending') {
        count++;
      }
    }
    return count;
  }
}
