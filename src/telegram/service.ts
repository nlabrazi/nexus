import * as vscode from 'vscode';
import { randomInt } from 'crypto';
import { TelegramClient } from './client';
import { TelegramUpdate } from './types';

export class TelegramService {
  private pairingCode?: string;
  private pairingExpiresAt = 0;
  private running = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TelegramClient
  ) { }

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

    let offset = this.context.globalState.get<number>(
      'nexus.telegram.updateOffset',
      0
    );

    while (this.running) {
      try {
        const data = await this.client.getUpdates(offset);

        for (const update of data.result) {
          offset = update.update_id + 1;

          await this.context.globalState.update(
            'nexus.telegram.updateOffset',
            offset
          );

          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error('Telegram polling error:', error);

        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
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
  }
}
