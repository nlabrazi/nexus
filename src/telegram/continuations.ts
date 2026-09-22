import { randomBytes } from 'node:crypto';
import { TelegramPeer } from './approvals';
import { TelegramClient } from './client';
import { TelegramCallbackQuery } from './types';

export interface TurnTimeoutRequest {
  agentName?: string;
  elapsedSeconds: number;
}

export type TurnTimeoutHandler = (
  request: TurnTimeoutRequest,
  signal: AbortSignal
) => Promise<boolean>;

interface PendingContinuation {
  agentName: string;
  peer: TelegramPeer;
  messageId?: number;
  expiresAt: number;
  timer?: NodeJS.Timeout;
  settle: (decision: boolean, status: string) => void;
}

export const CONTINUATION_PROMPT_TIMEOUT_MS = 60_000;

export class TelegramContinuations {
  private readonly pending = new Map<string, PendingContinuation>();

  constructor(
    private readonly client: TelegramClient,
    private readonly getPeer: () => TelegramPeer | undefined,
    private readonly promptTimeoutMs = CONTINUATION_PROMPT_TIMEOUT_MS
  ) {}

  request(request: TurnTimeoutRequest, signal: AbortSignal): Promise<boolean> {
    const peer = this.getPeer();
    if (!peer || signal.aborted) {
      return Promise.resolve(false);
    }

    const agentName = request.agentName ?? 'Codex';
    const promptTimeoutSeconds = Math.ceil(this.promptTimeoutMs / 1000);
    const text = [
      `⏳ ${agentName} — La requête a atteint ${request.elapsedSeconds} secondes mais est toujours en cours.`,
      'Voulez-vous continuer ?',
      `Sans réponse sous ${promptTimeoutSeconds} s : arrêt automatique.`,
    ].join('\n\n');

    const token = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + this.promptTimeoutMs;

    return new Promise((resolve) => {
      let closedStatus: string | undefined;
      const onAbort = () => {
        continuation.settle(false, '✅ Requête terminée.');
      };

      const continuation: PendingContinuation = {
        agentName,
        peer,
        expiresAt,
        settle: (decision, status) => {
          if (this.pending.get(token) !== continuation) {
            return;
          }
          this.pending.delete(token);
          if (continuation.timer) {
            clearTimeout(continuation.timer);
            continuation.timer = undefined;
          }
          signal.removeEventListener('abort', onAbort);
          closedStatus = status;
          resolve(decision);
          if (continuation.messageId !== undefined) {
            this.close(peer.chatId, continuation.messageId, status);
          }
        },
      };

      continuation.timer = setTimeout(() => {
        continuation.settle(false, '⌛ Délai de réponse dépassé — requête arrêtée.');
      }, this.promptTimeoutMs);

      this.pending.set(token, continuation);
      signal.addEventListener('abort', onAbort, { once: true });

      void this.client
        .sendKeyboardMessage(peer.chatId, text, {
          inline_keyboard: [
            [
              { text: 'Continuer', callback_data: `continue:${token}:continue` },
              { text: 'Arrêter', callback_data: `continue:${token}:stop` },
            ],
          ],
        })
        .then((message) => {
          continuation.messageId = message.message_id;
          if (closedStatus) {
            this.close(peer.chatId, message.message_id, closedStatus);
          }
        })
        .catch(() => {
          continuation.settle(false, '⛔ Envoi impossible — arrêt de la requête.');
        });
    });
  }

  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const peer = this.getPeer();
    const message = query.message;
    if (
      !peer ||
      query.from.id !== peer.userId ||
      message?.chat.id !== peer.chatId ||
      message.chat.type !== 'private'
    ) {
      await this.answer(query.id, 'Non autorisé.');
      return;
    }

    const match = /^continue:([a-f0-9]{32}):(continue|stop)$/.exec(query.data ?? '');
    if (!match) {
      await this.answer(query.id, 'Bouton invalide.');
      return;
    }

    const continuation = this.pending.get(match[1]);
    if (!continuation) {
      await this.answer(query.id, 'Demande expirée ou déjà traitée.');
      return;
    }

    if (
      continuation.peer.userId !== peer.userId ||
      continuation.peer.chatId !== peer.chatId ||
      continuation.messageId !== message.message_id
    ) {
      await this.answer(query.id, 'Bouton invalide.');
      return;
    }

    if (Date.now() >= continuation.expiresAt) {
      continuation.settle(false, '⌛ Délai de réponse dépassé — requête arrêtée.');
      await this.answer(query.id, 'Délai de réponse dépassé.');
      return;
    }

    const decision = match[2] === 'continue';
    continuation.settle(
      decision,
      decision
        ? `✅ Requête prolongée pour ${continuation.agentName}.`
        : `⛔ Requête interrompue pour ${continuation.agentName}.`
    );
    await this.answer(query.id, decision ? 'Poursuite de la requête.' : 'Arrêt demandé.');
  }

  cancelAll(status = '⛔ Requête annulée.'): void {
    for (const continuation of this.pending.values()) {
      continuation.settle(false, status);
    }
  }

  private close(chatId: number, messageId: number, status: string): void {
    void this.client
      .closeApprovalMessage(chatId, messageId, status)
      .catch(() => console.warn('[Telegram] Unable to remove continuation buttons.'));
  }

  private async answer(id: string, text: string): Promise<void> {
    try {
      await this.client.answerCallbackQuery(id, text);
    } catch {
      console.warn('[Telegram] Unable to acknowledge continuation callback.');
    }
  }
}
