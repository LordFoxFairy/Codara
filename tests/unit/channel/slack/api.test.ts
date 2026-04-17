import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {SlackApi, SlackApiError} from '@channels/slack/api';

function mockFetch(response: unknown) {
  return mock(() =>
    Promise.resolve({
      json: () => Promise.resolve(response),
    } as Response),
  ) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('SlackApi', () => {
  const token = 'xoxb-test-token';
  let api: SlackApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    api = new SlackApi(token);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('postMessage', () => {
    test('sends message and returns result', async () => {
      globalThis.fetch = mockFetch({ok: true, ts: '1617243423.000100', channel: 'C123'});

      const result = await api.postMessage('C123', 'Hello Slack');

      expect(result.ok).toBe(true);
      expect(result.ts).toBe('1617243423.000100');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://slack.com/api/chat.postMessage');
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.channel).toBe('C123');
      expect(body.text).toBe('Hello Slack');
      expect((opts as RequestInit).headers).toHaveProperty('Authorization', `Bearer ${token}`);
    });

    test('sends message with thread_ts', async () => {
      globalThis.fetch = mockFetch({ok: true, ts: '1617243423.000200', channel: 'C123'});

      await api.postMessage('C123', 'Thread reply', {thread_ts: '1617243400.000000'});

      const [, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.thread_ts).toBe('1617243400.000000');
    });

    test('sends message with blocks', async () => {
      globalThis.fetch = mockFetch({ok: true, ts: '1617243423.000300', channel: 'C123'});

      const blocks = [
        {type: 'section', text: {type: 'mrkdwn' as const, text: 'Test block'}},
      ];
      await api.postMessage('C123', 'Fallback', {blocks});

      const [, opts] = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.blocks).toHaveLength(1);
      expect(body.blocks[0].type).toBe('section');
    });
  });

  describe('authTest', () => {
    test('returns auth info', async () => {
      globalThis.fetch = mockFetch({ok: true, user_id: 'U123', bot_id: 'B456'});

      const result = await api.authTest();

      expect(result.ok).toBe(true);
      expect(result.user_id).toBe('U123');
      expect(result.bot_id).toBe('B456');
    });
  });

  describe('error handling', () => {
    test('throws SlackApiError on API failure', async () => {
      globalThis.fetch = mockFetch({ok: false, error: 'channel_not_found'});

      try {
        await api.postMessage('C999', 'test');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(SlackApiError);
        const apiErr = err as SlackApiError;
        expect(apiErr.method).toBe('chat.postMessage');
        expect(apiErr.errorCode).toBe('channel_not_found');
      }
    });
  });
});
