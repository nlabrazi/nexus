export interface TelegramGetMeResponse {
  ok: boolean;
  result?: {
    username?: string;
    first_name: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
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

export interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}
