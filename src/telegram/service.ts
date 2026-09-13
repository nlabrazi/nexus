import type * as vscode from 'vscode';
import { randomInt } from 'crypto';
import { TelegramClient } from './client';
import { TelegramUpdate } from './types';
import { TelegramApprovals, TelegramPeer } from './approvals';
import { ApprovalDecision, CodexApprovalRequest } from '../codex/types';

type RemotePromptHandler = (
  prompt: string
) => Promise<string>;

export class TelegramService {
  private pairingCode?: string;
  private pairingExpiresAt = 0;
  private running = false;
  private abortController?: AbortController;
  private remotePromptRunning = false;
  private readonly approvals: TelegramApprovals;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TelegramClient,
    private readonly onRemotePrompt?: RemotePromptHandler
  ) {
    this.approvals = new TelegramApprovals(client, () => this.getApprovalPeer());
  }

  requestApproval(request: CodexApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    return this.approvals.request(request, signal);
  }

  private getApprovalPeer(): TelegramPeer | undefined {
    const userId = this.context.globalState.get<number>('nexus.telegram.allowedUserId');
    const chatId = this.context.globalState.get<number>('nexus.telegram.allowedChatId');
    return this.running && userId !== undefined && chatId !== undefined
      ? { userId, chatId } : undefined;
  }

  createPairingCode(): string {
    this.pairingCode = randomInt(100000, 1000000).toString();
    this.pairingExpiresAt = Date.now() + 2 * 60 * 1000;

    return this.pairingCode;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    const controller = new AbortController();
    this.abortController = controller;

    let offset = this.context.globalState.get<number>(
      'nexus.telegram.updateOffset',
      0
    );

    try {
      while (!controller.signal.aborted) {
        try {
          const data = await this.client.getUpdates(
            offset,
            controller.signal
          );

          for (const update of data.result) {
            if (controller.signal.aborted) {
              break;
            }
            offset = update.update_id + 1;

            await this.context.globalState.update(
              'nexus.telegram.updateOffset',
              offset
            );

            if (!controller.signal.aborted) {
              await this.handleUpdate(update);
            }
          }
        } catch (error) {
          if (controller.signal.aborted) {
            break;
          }

          this.approvals.cancelAll();
          console.error('Telegram polling failed.');

          await new Promise(resolve =>
            setTimeout(resolve, 3000)
          );
        }
      }
    } finally {
      if (this.abortController === controller) {
        this.abortController = undefined;
        this.running = false;
        this.approvals.cancelAll();
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.approvals.cancelAll();
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.approvals.handleCallback(update.callback_query);
      return;
    }
    const text = update.message?.text;
    const userId = update.message?.from?.id;
    const chatId = update.message?.chat.id;
    const chatType = update.message?.chat.type;

    if (
      !text ||
      userId === undefined ||
      chatId === undefined
    ) {
      return;
    }

    // Pairing
    if (text.startsWith('/pair ')) {
      const receivedCode = text.split(' ')[1];

      const isValid =
        this.pairingCode !== undefined &&
        receivedCode === this.pairingCode &&
        Date.now() < this.pairingExpiresAt &&
        chatType === 'private';

      if (!isValid) {
        return;
      }

      this.approvals.cancelAll();

      await this.context.globalState.update(
        'nexus.telegram.allowedUserId',
        userId
      );

      await this.context.globalState.update(
        'nexus.telegram.allowedChatId',
        chatId
      );

      this.pairingCode = undefined;
      this.pairingExpiresAt = 0;

      await this.client.sendMessage(
        chatId,
        '✅ Nexus paired successfully.'
      );

      console.log('Telegram account paired.');

      return;
    }

    // Authorization
    const allowedUserId = this.context.globalState.get<number>(
      'nexus.telegram.allowedUserId'
    );

    const allowedChatId = this.context.globalState.get<number>(
      'nexus.telegram.allowedChatId'
    );

    if (
      userId !== allowedUserId ||
      chatId !== allowedChatId ||
      chatType !== 'private'
    ) {
      return;
    }

    // Commands
    if (text === '/ping') {
      await this.client.sendMessage(chatId, 'pong');
    }

    if (text === '/codex') {
      await this.client.sendMessage(
        chatId,
        'Usage: /codex <instruction>'
      );

      return;
    }

    if (text.startsWith('/codex ')) {
      const prompt = text.slice('/codex '.length).trim();

      if (!prompt) {
        await this.client.sendMessage(
          chatId,
          'Usage: /codex <instruction>'
        );

        return;
      }

      if (!this.onRemotePrompt) {
        await this.client.sendMessage(
          chatId,
          'Codex is unavailable.'
        );

        return;
      }

      if (this.remotePromptRunning) {
        await this.client.sendMessage(chatId, 'A Codex turn is already running.');
        return;
      }

      // Polling must continue while Codex waits for an approval callback.
      this.remotePromptRunning = true;
      void this.runRemotePrompt(chatId, prompt, this.abortController!.signal);
      return;
    }
  }

  private async runRemotePrompt(chatId: number, prompt: string, signal: AbortSignal): Promise<void> {
    try {
      await this.client.sendMessage(chatId, '⏳ Codex is working...');
      if (signal.aborted) {
        return;
      }
      const response = await this.onRemotePrompt!(prompt);
      if (!signal.aborted) {
        await this.client.sendMessage(chatId, response);
      }
    } catch (error) {
      if (!signal.aborted) {
        await this.client.sendMessage(chatId,
          `❌ ${error instanceof Error ? error.message : String(error)}`
        ).catch(() => console.error('[Telegram] Codex response delivery failed.'));
      }
    } finally {
      this.remotePromptRunning = false;
    }
  }
}
