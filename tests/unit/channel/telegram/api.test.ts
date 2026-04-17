import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {TelegramApi, TelegramApiError} from '@channels/telegram/api';

function mockFetch(response: {ok: boolean; result?: unknown; description?: string; error_code?: number}) {
  return mock(() =>
    Promise.resolve({
      status: response.error_code ?? 200,
      json: () => Promise.resolve(response),
    } as Response),
  ) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('TelegramApi', () => {
  const token = 'test-token-123';
  let api: TelegramApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    api = new TelegramApi(token);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendMessage', () => {
    test('sends message and returns result', async () => {
      const mockResult = {message_id: 42, date: 1000, chat: {id: 123, type: 'private' as const}};
      globalThis.fetch = mockFetch({ok: true, result: mockResult});

      const result = await api.sendMessage(123, 'Hello');

      expect(result).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
      expect(JSON.parse((opts as RequestInit).body as string)).toEqual({
        chat_id: 123,
        text: 'Hello',
      });
    });

    test('sends message with parse_mode and reply_markup', async () => {
      const mockResult = {message_id: 43, date: 1000, chat: {id: 123, type: 'private'}};
      globalThis.fetch = mockFetch({ok: true, result: mockResult});

      await api.sendMessage(123, '<b>Bold</b>', {
        parse_mode: 'HTML',
        reply_markup: {inline_keyboard: [[{text: 'Click', callback_data: 'test'}]]},
      });

      const [, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.parse_mode).toBe('HTML');
      expect(body.reply_markup.inline_keyboard).toHaveLength(1);
    });
  });

  describe('getUpdates', () => {
    test('parses updates array', async () => {
      const updates = [
        {update_id: 1, message: {message_id: 1, date: 1000, chat: {id: 10, type: 'private'}, text: 'hi'}},
        {update_id: 2, message: {message_id: 2, date: 1001, chat: {id: 10, type: 'private'}, text: 'there'}},
      ];
      globalThis.fetch = mockFetch({ok: true, result: updates});

      const result = await api.getUpdates(0, 30);
      expect(result).toHaveLength(2);
      expect(result[0].update_id).toBe(1);
      expect(result[1].message?.text).toBe('there');
    });

    test('sends offset and timeout parameters', async () => {
      globalThis.fetch = mockFetch({ok: true, result: []});

      await api.getUpdates(42, 60);

      const [, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.offset).toBe(42);
      expect(body.timeout).toBe(60);
    });
  });

  describe('error handling', () => {
    test('throws TelegramApiError on API failure', async () => {
      globalThis.fetch = mockFetch({ok: false, error_code: 403, description: 'Forbidden: bot was blocked'});

      try {
        await api.sendMessage(123, 'test');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(TelegramApiError);
        const apiErr = err as TelegramApiError;
        expect(apiErr.method).toBe('sendMessage');
        expect(apiErr.statusCode).toBe(403);
        expect(apiErr.description).toBe('Forbidden: bot was blocked');
      }
    });

    test('uses status code when error_code is missing', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({
          status: 500,
          json: () => Promise.resolve({ok: false, description: 'Internal error'}),
        } as Response),
      ) as unknown as typeof fetch;

      try {
        await api.sendChatAction(123, 'typing');
        expect(true).toBe(false);
      } catch (err) {
        const apiErr = err as TelegramApiError;
        expect(apiErr.statusCode).toBe(500);
      }
    });
  });

  describe('sendChatAction', () => {
    test('sends typing action', async () => {
      globalThis.fetch = mockFetch({ok: true, result: true});

      const result = await api.sendChatAction(123, 'typing');
      expect(result).toBe(true);

      const [url] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/sendChatAction');
    });
  });

  describe('answerCallbackQuery', () => {
    test('answers callback query with text', async () => {
      globalThis.fetch = mockFetch({ok: true, result: true});

      await api.answerCallbackQuery('query-1', 'Done!');

      const [, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.callback_query_id).toBe('query-1');
      expect(body.text).toBe('Done!');
    });
  });

  describe('deleteWebhook', () => {
    test('deletes webhook', async () => {
      globalThis.fetch = mockFetch({ok: true, result: true});

      const result = await api.deleteWebhook();
      expect(result).toBe(true);

      const [url] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/deleteWebhook');
    });
  });
});
