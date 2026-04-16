import type {TelegramApiResponse, TelegramMessage, TelegramUpdate} from './types';

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly statusCode: number,
    public readonly description: string,
  ) {
    super(`Telegram API error [${method}] ${statusCode}: ${description}`);
    this.name = 'TelegramApiError';
  }
}

export interface SendMessageOptions {
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  reply_to_message_id?: number;
  reply_markup?: {inline_keyboard: {text: string; callback_data?: string; url?: string}[][]};
}

export class TelegramApi {
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: params ? JSON.stringify(params) : undefined,
    });

    const data = (await res.json()) as TelegramApiResponse<T>;
    if (!data.ok) {
      throw new TelegramApiError(method, data.error_code ?? res.status, data.description ?? 'Unknown error');
    }
    return data.result as T;
  }

  async getUpdates(offset?: number, timeout?: number): Promise<TelegramUpdate[]> {
    const params: Record<string, unknown> = {};
    if (offset !== undefined) params.offset = offset;
    if (timeout !== undefined) params.timeout = timeout;
    return this.call<TelegramUpdate[]>('getUpdates', params);
  }

  async sendMessage(chatId: number | string, text: string, options?: SendMessageOptions): Promise<TelegramMessage> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  async sendChatAction(chatId: number | string, action: string): Promise<boolean> {
    return this.call<boolean>('sendChatAction', {chat_id: chatId, action});
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    const params: Record<string, unknown> = {callback_query_id: callbackQueryId};
    if (text !== undefined) params.text = text;
    return this.call<boolean>('answerCallbackQuery', params);
  }

  async deleteWebhook(): Promise<boolean> {
    return this.call<boolean>('deleteWebhook', {drop_pending_updates: false});
  }

  /** Get information about the bot itself. */
  async getMe(): Promise<{id: number; is_bot: boolean; first_name: string; username?: string}> {
    return this.call<{id: number; is_bot: boolean; first_name: string; username?: string}>('getMe');
  }
}
