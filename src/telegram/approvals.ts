import { randomBytes } from 'crypto';
import { ApprovalDecision, CodexApprovalRequest } from '../codex/types';
import { TelegramClient } from './client';
import { TelegramCallbackQuery } from './types';

export interface TelegramPeer {
  userId: number;
  chatId: number;
}

export type ApprovalRequest = CodexApprovalRequest;
export type ApprovalHandler = (
  request: ApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision>;

interface PendingApproval {
  agentName: string;
  peer: TelegramPeer;
  messageId?: number;
  expiresAt: number;
  settle: (decision: ApprovalDecision, status: string) => void;
}

export class TelegramApprovals {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly client: TelegramClient,
    private readonly getPeer: () => TelegramPeer | undefined
  ) { }

  request(request: CodexApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    request(request: ApprovalRequest, signal: AbortSignal): Promise < ApprovalDecision > {
      const peer = this.getPeer();
      if(!peer || signal.aborted || Date.now() >= request.expiresAt) {
      return Promise.resolve('decline');
    }

    const agentName = request.agentName ?? 'Codex';
    const seconds = Math.ceil((request.expiresAt - Date.now()) / 1000);
    const text = [
      `🔐 Codex — ${request.kind === 'command' ? 'commande' : 'modification de fichiers'}`,
      `🔐 ${agentName} — ${request.kind === 'command' ? 'commande' : 'modification de fichiers'}`,
      `Sans réponse sous ${seconds} s : refus automatique.`,
      request.details,
    ].join('\n\n');
    // Never authorize an action after showing only a truncated preview.
    if (text.length > 4000) {
      void this.client.sendMessage(peer.chatId,
        '⛔ Approbation refusée : les détails sont trop longs pour être affichés intégralement.'
      ).catch(() => console.warn('[Telegram] Approval notice failed.'));
      return Promise.resolve('decline');
    }

    // Random per-request identifiers also invalidate buttons after a restart.
    const token = randomBytes(16).toString('hex');
    return new Promise(resolve => {
      let closedStatus: string | undefined;
      const onAbort = () => approval.settle('decline',
        Date.now() >= request.expiresAt
          ? '⌛ Approbation expirée — refusée.'
          : '⛔ Approbation annulée — aucune autorisation.'
      );
      const approval: PendingApproval = {
        agentName,
        peer,
        expiresAt: request.expiresAt,
        settle: (decision, status) => {
          if (this.pending.get(token) !== approval) {
            return;
          }
          // Consume before any asynchronous Telegram call: first click wins.
          this.pending.delete(token);
          signal.removeEventListener('abort', onAbort);
          closedStatus = status;
          resolve(decision);
          if (approval.messageId !== undefined) {
            this.close(peer.chatId, approval.messageId, status);
          }
        },
      };
      this.pending.set(token, approval);
      signal.addEventListener('abort', onAbort, { once: true });
      void this.client.sendApprovalMessage(peer.chatId, text, {
        inline_keyboard: [[
          { text: 'Autoriser une fois', callback_data: `approval:${token}:accept` },
          { text: 'Refuser', callback_data: `approval:${token}:decline` },
        ]],
      }).then(message => {
        approval.messageId = message.message_id;
        // Delivery can finish after cancellation/timeout; remove those buttons too.
        if (closedStatus) {
          this.close(peer.chatId, message.message_id, closedStatus);
        }
      }).catch(() => {
        approval.settle('decline', '⛔ Envoi impossible — approbation refusée.');
      });
    });
  }

  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const peer = this.getPeer();
    const message = query.message;
    if (!peer || query.from.id !== peer.userId ||
      message?.chat.id !== peer.chatId || message.chat.type !== 'private') {
      await this.answer(query.id, 'Non autorisé.');
      return;
    }
    const match = /^approval:([a-f0-9]{32}):(accept|decline)$/.exec(query.data ?? '');
    if (!match) {
      await this.answer(query.id, 'Bouton invalide.');
      return;
    }
    const approval = this.pending.get(match[1]);
    if (!approval) {
      await this.answer(query.id, 'Approbation expirée ou déjà traitée.');
      return;
    }
    if (approval.peer.userId !== peer.userId || approval.peer.chatId !== peer.chatId ||
      approval.messageId !== message.message_id) {
      await this.answer(query.id, 'Bouton invalide.');
      return;
    }
    if (Date.now() >= approval.expiresAt) {
      approval.settle('decline', '⌛ Approbation expirée — refusée.');
      await this.answer(query.id, 'Approbation expirée.');
      return;
    }

    const decision = match[2] as ApprovalDecision;
    approval.settle(decision, decision === 'accept'
      ? '✅ Autorisation ponctuelle transmise à Codex.'
        ? `✅ Autorisation ponctuelle transmise à ${approval.agentName}.`
        : '⛔ Approbation refusée.'
    );
    await this.answer(query.id, decision === 'accept' ? 'Autorisé une fois.' : 'Refusé.');
  }

  cancelAll(): void {
    for (const approval of this.pending.values()) {
      approval.settle('decline', '⛔ Approbation annulée — refusée.');
    }
  }

  private close(chatId: number, messageId: number, status: string): void {
    void this.client.closeApprovalMessage(chatId, messageId, status)
      .catch(() => console.warn('[Telegram] Unable to remove approval buttons.'));
  }

  private async answer(id: string, text: string): Promise<void> {
    try {
      await this.client.answerCallbackQuery(id, text);
    } catch {
      console.warn('[Telegram] Unable to acknowledge approval callback.');
    }
  }
}
