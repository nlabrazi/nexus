import {
  TelegramGetMeResponse,
  TelegramInlineKeyboard,
  TelegramSentMessage,
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
    const query = new URLSearchParams({
      offset: String(offset),
      timeout: '20',
      allowed_updates: JSON.stringify(['message', 'callback_query']),
    });
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/getUpdates?${query}`,
      { signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30_000),
      ]) }
    );

    if (!response.ok) {
      throw new Error(
        `Telegram getUpdates failed: ${response.status}`
      );
    }

    const data = await response.json() as TelegramUpdatesResponse;
    if (!data.ok || !Array.isArray(data.result)) {
      throw new Error('Telegram getUpdates failed');
    }
    return data;
  }

  async sendMessage(
    chatId: number,
    text: string
  ): Promise<void> {
    const chunks = text.match(/[\s\S]{1,4000}/g) ?? [];

    for (const chunk of chunks) {
      await this.call('sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  async sendApprovalMessage(
    chatId: number,
    text: string,
    keyboard: TelegramInlineKeyboard
  ): Promise<TelegramSentMessage> {
    const result = await this.call<TelegramSentMessage>('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
    if (!result || !Number.isSafeInteger(result.message_id)) {
      throw new Error('Telegram approval message ID missing');
    }
    return result;
  }

  async answerCallbackQuery(id: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, text });
  }

  async closeApprovalMessage(chatId: number, messageId: number, text: string): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    });
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json() as { ok: boolean; result: T };
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${response.status}`);
    }
    return data.result;
  }
}
