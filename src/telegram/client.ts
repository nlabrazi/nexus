import {
  TelegramGetMeResponse,
  TelegramUpdatesResponse,
} from './types';

export class TelegramClient {
  constructor(private readonly token: string) { }

  async getMe(): Promise<TelegramGetMeResponse> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/getMe`
    );

    const data =
      await response.json() as TelegramGetMeResponse;

    if (!response.ok || !data.ok) {
      throw new Error('Telegram getMe failed');
    }

    return data;
  }

  async getUpdates(
    offset: number,
    signal?: AbortSignal
  ): Promise<TelegramUpdatesResponse> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/getUpdates?offset=${offset}&timeout=20`,
      { signal }
    );

    if (!response.ok) {
      throw new Error(
        `Telegram getUpdates failed: ${response.status}`
      );
    }

    return await response.json() as TelegramUpdatesResponse;
  }

  async sendMessage(
    chatId: number,
    text: string
  ): Promise<void> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Telegram sendMessage failed: ${response.status}`
      );
    }
  }
}
