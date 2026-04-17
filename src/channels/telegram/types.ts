export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string};
  from?: {id: number; is_bot: boolean; first_name: string; username?: string};
  text?: string;
  caption?: string;
  photo?: {file_id: string; width: number; height: number}[];
  document?: {file_id: string; file_name?: string; mime_type?: string};
  reply_to_message?: TelegramMessage;
  media_group_id?: string;
  entities?: {type: string; offset: number; length: number; url?: string}[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: {id: number; first_name: string; username?: string};
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export interface TelegramAccountConfig {
  botToken: string;
  allowUsers?: string[];
  allowGroups?: string[];
  groupPolicy?: {requireMention?: boolean};
  pollingTimeout?: number;
}
