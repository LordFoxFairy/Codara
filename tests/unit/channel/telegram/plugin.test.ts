import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {telegramPlugin} from '@integration/channel/telegram/plugin';

function mockFetch(response: {ok: boolean; result?: unknown; description?: string; error_code?: number}) {
  return mock(() =>
    Promise.resolve({
      status: response.error_code ?? 200,
      json: () => Promise.resolve(response),
    } as Response),
  ) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('telegramPlugin', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = {...process.env};
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  describe('resolveAccount', () => {
    test('resolves valid config', () => {
      const account = telegramPlugin.resolveAccount({
        botToken: 'my-token',
        allowUsers: ['alice'],
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('my-token');
      expect(account!.allowUsers).toEqual(['alice']);
    });

    test('resolves env var token with $ prefix', () => {
      process.env.MY_TG_TOKEN = 'env-token-value';

      const account = telegramPlugin.resolveAccount({
        botToken: '$MY_TG_TOKEN',
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('env-token-value');
    });

    test('throws when referenced env var is not set', () => {
      delete process.env.MISSING_TOKEN;

      expect(() =>
        telegramPlugin.resolveAccount({botToken: '$MISSING_TOKEN'}),
      ).toThrow('Environment variable "MISSING_TOKEN" is not set');
    });

    test('returns undefined for invalid config', () => {
      const account = telegramPlugin.resolveAccount({});
      expect(account).toBeUndefined();
    });

    test('returns undefined for empty botToken', () => {
      const account = telegramPlugin.resolveAccount({botToken: ''});
      expect(account).toBeUndefined();
    });
  });

  describe('sendText', () => {
    test('sends message with HTML parse mode', async () => {
      const fetchMock = mockFetch({
        ok: true,
        result: {message_id: 99, date: 1000, chat: {id: 123, type: 'private'}},
      });
      globalThis.fetch = fetchMock;

      const account = telegramPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await telegramPlugin.sendText(account, {
        accountId: 'bot-1',
        to: '123',
        text: '<b>Hello</b>',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('99');

      const call0 = fetchMock.mock.calls[0] as unknown[];
      const body = JSON.parse((call0[1] as RequestInit).body as string);
      expect(body.parse_mode).toBe('HTML');
    });

    test('falls back to plain text on HTML parse error', async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount === 1) {
          // HTML parse fails
          return Promise.resolve({
            status: 400,
            json: () =>
              Promise.resolve({ok: false, error_code: 400, description: "can't parse entities"}),
          } as Response);
        }
        // Plain text succeeds
        return Promise.resolve({
          status: 200,
          json: () =>
            Promise.resolve({ok: true, result: {message_id: 100, date: 1000, chat: {id: 123, type: 'private'}}}),
        } as Response);
      }) as unknown as typeof fetch;

      const account = telegramPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await telegramPlugin.sendText(account, {
        accountId: 'bot-1',
        to: '123',
        text: 'plain text',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('100');
      expect(callCount).toBe(2);
    });
  });

  describe('sendTyping', () => {
    test('sends chat action', async () => {
      const fetchMock = mockFetch({ok: true, result: true});
      globalThis.fetch = fetchMock;

      const account = telegramPlugin.resolveAccount({botToken: 'test-token'})!;
      await telegramPlugin.sendTyping!(account, {
        accountId: 'bot-1',
        to: '123',
        text: '',
      });

      const call0t = fetchMock.mock.calls[0] as unknown[];
      expect(call0t[0]).toContain('/sendChatAction');
    });
  });

  describe('capabilities', () => {
    test('has correct capabilities', () => {
      expect(telegramPlugin.id).toBe('telegram');
      expect(telegramPlugin.capabilities.textLimit).toBe(4096);
      expect(telegramPlugin.capabilities.streaming).toBe(true);
      expect(telegramPlugin.capabilities.threads).toBe(false);
      expect(telegramPlugin.capabilities.media).toBe(true);
      expect(telegramPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
    });
  });

  describe('sendReviewPrompt', () => {
    test('sends message with inline keyboard buttons', async () => {
      const fetchMock = mockFetch({
        ok: true,
        result: {message_id: 200, date: 1000, chat: {id: 123, type: 'private'}},
      });
      globalThis.fetch = fetchMock;

      const account = telegramPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await telegramPlugin.sendReviewPrompt!(account, {
        accountId: 'bot-1',
        to: '123',
        text: 'Approve this action?',
        review: {id: 'review-1', description: 'Run command'} as unknown as import('@shared/contracts/agent-types').ReviewRequest,
        actions: [
          {id: 'approve', label: 'Approve', style: 'approve'},
          {id: 'reject', label: 'Reject', style: 'reject'},
        ],
      });

      expect(result.ok).toBe(true);

      const call0pp = fetchMock.mock.calls[0] as unknown[];
      const body = JSON.parse((call0pp[1] as RequestInit).body as string);
      expect(body.reply_markup.inline_keyboard).toHaveLength(1);
      expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
      expect(body.reply_markup.inline_keyboard[0][0]).toEqual({
        text: 'Approve',
        callback_data: 'review:review-1:approve',
      });
      expect(body.reply_markup.inline_keyboard[0][1]).toEqual({
        text: 'Reject',
        callback_data: 'review:review-1:reject',
      });
    });
  });
});
