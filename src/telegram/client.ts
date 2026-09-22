import {
  TelegramFile,
  TelegramGetMeResponse,
  TelegramInlineKeyboard,
  TelegramSentMessage,
  TelegramUpdatesResponse,
  TelegramVoice,
  TelegramVoiceFile,
} from './types';
import { formatTelegramResponse, splitTelegramMessage } from './formatting';

export const TELEGRAM_VOICE_MAX_BYTES = 20_000_000;

export class TelegramVoiceDownloadError extends Error {
  constructor(readonly code: 'too_large' | 'invalid_file' | 'timeout' | 'cancelled' | 'download_failed') {
    super({
      too_large: 'Le message vocal dépasse la limite de 20 Mo.',
      invalid_file: 'Le fichier vocal reçu est invalide ou vide.',
      timeout: 'Le téléchargement du message vocal a expiré. Réessayez.',
      cancelled: 'Téléchargement du message vocal annulé.',
      download_failed: 'Impossible de télécharger le message vocal. Réessayez.',
    }[code]);
    this.name = 'TelegramVoiceDownloadError';
  }
}

function checkVoiceSize(size: number | undefined): void {
  if (size === undefined) { return; }
  if (!Number.isSafeInteger(size) || size < 0) { throw new TelegramVoiceDownloadError('invalid_file'); }
  if (size > TELEGRAM_VOICE_MAX_BYTES) { throw new TelegramVoiceDownloadError('too_large'); }
}

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

  async downloadVoice(voice: TelegramVoice, signal?: AbortSignal): Promise<TelegramVoiceFile> {
    const requestSignal = AbortSignal.any([
      ...(signal ? [signal] : []), AbortSignal.timeout(30_000),
    ]);
    try {
      requestSignal.throwIfAborted();
      if (typeof voice.file_id !== 'string' || !voice.file_id.trim()) {
        throw new TelegramVoiceDownloadError('invalid_file');
      }
      checkVoiceSize(voice.file_size);
      // Request a fresh path for each download; Telegram file links expire.
      const file = await this.call<TelegramFile>('getFile', { file_id: voice.file_id }, requestSignal);
      requestSignal.throwIfAborted();
      const path = file?.file_path;
      if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) ||
        path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
        throw new TelegramVoiceDownloadError('invalid_file');
      }
      checkVoiceSize(file.file_size);
      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${path}`, {
        signal: requestSignal, redirect: 'error',
      });
      if (!response.body) { throw new TelegramVoiceDownloadError('invalid_file'); }
      const reader = response.body.getReader();
      try {
        requestSignal.throwIfAborted();
        if (!response.ok) { throw new TelegramVoiceDownloadError('download_failed'); }
        const length = response.headers.get('content-length');
        if (length !== null) { checkVoiceSize(Number(length)); }
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          requestSignal.throwIfAborted();
          if (done) { break; }
          size += value.byteLength;
          checkVoiceSize(size);
          chunks.push(value);
        }
        if (size === 0) { throw new TelegramVoiceDownloadError('invalid_file'); }
        return {
          data: Buffer.concat(chunks, size),
          fileName: path.split('/').at(-1)!,
          // getFile does not preserve the original MIME type.
          mimeType: voice.mime_type,
        };
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      if (requestSignal.aborted || (error instanceof Error && error.name === 'TimeoutError')) {
        const reason = requestSignal.reason ?? error;
        throw new TelegramVoiceDownloadError(reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
      }
      if (error instanceof TelegramVoiceDownloadError) { throw error; }
      // Download URLs contain the bot token. Never expose raw transport errors.
      throw new TelegramVoiceDownloadError('download_failed');
    }
  }

  async sendMessage(
    chatId: number,
    text: string,
    format: 'plain' | 'markdown' = 'plain'
  ): Promise<void> {
    const chunks = format === 'markdown' ? formatTelegramResponse(text) : splitTelegramMessage(text);

    for (const chunk of chunks) {
      await this.call('sendMessage', {
        chat_id: chatId,
        text: chunk.text,
        ...(chunk.entities.length > 0 ? { entities: chunk.entities } : {}),
        link_preview_options: { is_disabled: true },
      });
    }
  }

  async sendApprovalMessage(
    chatId: number,
    text: string,
    keyboard: TelegramInlineKeyboard
  ): Promise<TelegramSentMessage> {
    return this.sendKeyboardMessage(chatId, text, keyboard);
  }

  async sendKeyboardMessage(chatId: number, text: string, keyboard: TelegramInlineKeyboard): Promise<TelegramSentMessage> {
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

  async editKeyboardMessage(chatId: number, messageId: number, text: string, keyboard: TelegramInlineKeyboard): Promise<void> {
    await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard });
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

  private async call<T>(method: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]),
    });
    const data = await response.json() as { ok: boolean; result: T };
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method} failed: ${response.status}`);
    }
    return data.result;
  }
}
