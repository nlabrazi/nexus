export interface TelegramGetMeResponse {
  ok: boolean;
  result?: {
    username?: string;
    first_name: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
  message?: {
    text?: string;
    from?: {
      id: number;
    };
    chat: {
      id: number;
      type: string;
    };
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
  };
}

export interface TelegramInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

export interface TelegramSentMessage {
  message_id: number;
}

export interface TelegramMessageEntity {
  type: 'bold' | 'code' | 'pre' | 'text_link';
  offset: number;
  length: number;
  url?: string;
  language?: string;
}

export interface TelegramTextMessage {
  text: string;
  entities: TelegramMessageEntity[];
}

export interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}
