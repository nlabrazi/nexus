import type * as vscode from 'vscode';
import { TelegramClient } from '../../telegram/client';
import { TelegramInlineKeyboard, TelegramUpdate, TelegramUpdatesResponse, TelegramVoice, TelegramVoiceFile } from '../../telegram/types';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

export function context(): vscode.ExtensionContext {
  const values = new Map<string, unknown>([
    ['nexus.telegram.allowedUserId', 10],
    ['nexus.telegram.allowedChatId', 20],
  ]);
  return {
    globalState: {
      get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
      update: async (key: string, value: unknown) => { values.set(key, value); },
    },
  } as unknown as vscode.ExtensionContext;
}

export class FakeTelegram extends TelegramClient {
  messages: string[] = [];
  approvals: { text: string; keyboard: TelegramInlineKeyboard; messageId: number }[] = [];
  answers: string[] = [];
  closed: { messageId: number; text: string }[] = [];
  failSend = false;
  failEdit = false;
  failAnswer = false;
  delivery?: Promise<void>;
  private batches: TelegramUpdate[][] = [];
  private waiting?: ReturnType<typeof deferred<TelegramUpdatesResponse>>;

  constructor() { super('fake-token'); }

  push(...updates: TelegramUpdate[]): void {
    if (this.waiting) {
      this.waiting.resolve({ ok: true, result: updates });
      this.waiting = undefined;
    } else {
      this.batches.push(updates);
    }
  }

  override async getUpdates(_offset: number, signal?: AbortSignal): Promise<TelegramUpdatesResponse> {
    signal?.throwIfAborted();
    const batch = this.batches.shift();
    if (batch) {
      return { ok: true, result: batch };
    }
    const waiting = deferred<TelegramUpdatesResponse>();
    this.waiting = waiting;
    const abort = () => waiting.reject(new Error('Polling stopped'));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await waiting.promise;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.waiting === waiting) { this.waiting = undefined; }
    }
  }

  override async sendMessage(_chatId: number, text: string): Promise<void> {
    this.messages.push(text);
  }

  override async downloadVoice(voice: TelegramVoice, signal?: AbortSignal): Promise<TelegramVoiceFile> {
    signal?.throwIfAborted();
    return { data: Buffer.from('fake-audio'), fileName: 'voice.oga', mimeType: voice.mime_type };
  }

  override async sendApprovalMessage(_chatId: number, text: string, keyboard: TelegramInlineKeyboard) {
    const messageId = this.approvals.length + 1;
    this.approvals.push({ text, keyboard, messageId });
    if (this.failSend) { throw new Error('Offline'); }
    await this.delivery;
    return { message_id: messageId };
  }

  override async sendKeyboardMessage(chatId: number, text: string, keyboard: TelegramInlineKeyboard) {
    return this.sendApprovalMessage(chatId, text, keyboard);
  }

  override async editKeyboardMessage(_chatId: number, messageId: number, text: string, keyboard: TelegramInlineKeyboard): Promise<void> {
    if (this.failEdit) { throw new Error('Offline'); }
    const sent = this.approvals.find(message => message.messageId === messageId);
    if (sent) { sent.text = text; sent.keyboard = keyboard; }
  }

  override async answerCallbackQuery(_id: string, text: string): Promise<void> {
    if (this.failAnswer) { throw new Error('Offline'); }
    this.answers.push(text);
  }

  override async closeApprovalMessage(_chatId: number, messageId: number, text: string): Promise<void> {
    if (this.failEdit) { throw new Error('Offline'); }
    this.closed.push({ messageId, text });
  }
}
