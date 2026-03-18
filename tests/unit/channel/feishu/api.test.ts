import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {FeishuApi, FeishuApiError} from '@integration/channel/feishu/api';

function mockFetchSequence(responses: Array<{code: number; msg: string; [key: string]: unknown}>) {
  let callIndex = 0;
  return mock(() => {
    const data = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);
  }) as unknown as typeof fetch & ReturnType<typeof mock>;
}

function mockFetch(response: Record<string, unknown>) {
  return mock(() =>
    Promise.resolve({
      status: 200,
      json: () => Promise.resolve(response),
    } as Response),
  ) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('FeishuApi', () => {
  const appId = 'test-app-id';
  const appSecret = 'test-app-secret';
  let api: FeishuApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    api = new FeishuApi(appId, appSecret);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('getAccessToken', () => {
    test('fetches and caches token', async () => {
      const fetchMock = mockFetch({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'token-abc',
        expire: 7200,
      });
      globalThis.fetch = fetchMock;

      const token1 = await api.getAccessToken();
      const token2 = await api.getAccessToken();

      expect(token1).toBe('token-abc');
      expect(token2).toBe('token-abc');
      // Should only fetch once due to caching
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('sends correct credentials', async () => {
      const fetchMock = mockFetch({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'token-xyz',
        expire: 7200,
      });
      globalThis.fetch = fetchMock;

      await api.getAccessToken();

      const call0 = fetchMock.mock.calls[0] as unknown[];
      expect(call0[0]).toBe('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal');
      const body = JSON.parse((call0[1] as RequestInit).body as string);
      expect(body.app_id).toBe('test-app-id');
      expect(body.app_secret).toBe('test-app-secret');
    });

    test('throws on error response', async () => {
      globalThis.fetch = mockFetch({code: 10003, msg: 'invalid app_id'});

      try {
        await api.getAccessToken();
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(FeishuApiError);
        const apiErr = err as FeishuApiError;
        expect(apiErr.code).toBe(10003);
        expect(apiErr.description).toBe('invalid app_id');
      }
    });

    test('re-fetches after invalidateToken', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-1', expire: 7200},
        {code: 0, msg: 'ok', tenant_access_token: 'token-2', expire: 7200},
      ]);
      globalThis.fetch = fetchMock;

      const token1 = await api.getAccessToken();
      expect(token1).toBe('token-1');

      api.invalidateToken();
      const token2 = await api.getAccessToken();
      expect(token2).toBe('token-2');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendMessage', () => {
    test('sends message with correct parameters', async () => {
      // First call: getAccessToken, second call: sendMessage
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 0, msg: 'ok', data: {message_id: 'msg-123'}},
      ]);
      globalThis.fetch = fetchMock;

      const result = await api.sendMessage('chat-1', 'chat_id', '{"text":"hello"}', 'text');

      expect(result.code).toBe(0);
      expect(result.data?.message_id).toBe('msg-123');

      // Verify sendMessage call
      const call1 = fetchMock.mock.calls[1] as unknown[];
      expect(call1[0]).toBe('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id');
      expect((call1[1] as RequestInit).headers).toHaveProperty('Authorization', 'Bearer token-abc');
      const body = JSON.parse((call1[1] as RequestInit).body as string);
      expect(body.receive_id).toBe('chat-1');
      expect(body.msg_type).toBe('text');
    });

    test('throws on API error', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 230001, msg: 'invalid chat_id'},
      ]);
      globalThis.fetch = fetchMock;

      try {
        await api.sendMessage('bad-id', 'chat_id', '{"text":"hi"}', 'text');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(FeishuApiError);
        expect((err as FeishuApiError).code).toBe(230001);
      }
    });
  });

  describe('replyMessage', () => {
    test('replies to a specific message', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 0, msg: 'ok', data: {message_id: 'reply-456'}},
      ]);
      globalThis.fetch = fetchMock;

      const result = await api.replyMessage('msg-123', '{"text":"reply text"}', 'text');

      expect(result.data?.message_id).toBe('reply-456');

      const call1r = fetchMock.mock.calls[1] as unknown[];
      expect(call1r[0]).toBe('https://open.feishu.cn/open-apis/im/v1/messages/msg-123/reply');
    });
  });
});
