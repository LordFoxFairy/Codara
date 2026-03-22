import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {feishuPlugin} from '@integration/channel/feishu/plugin';

function mockFetchSequence(responses: Array<Record<string, unknown>>) {
  let callIndex = 0;
  return mock(() => {
    const data = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve({
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);
  }) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('feishuPlugin', () => {
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

  describe('capabilities', () => {
    test('has correct id and name', () => {
      expect(feishuPlugin.id).toBe('feishu');
      expect(feishuPlugin.name).toBe('飞书');
    });

    test('has correct capabilities', () => {
      expect(feishuPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
      expect(feishuPlugin.capabilities.streaming).toBe(false);
      expect(feishuPlugin.capabilities.threads).toBe(true);
      expect(feishuPlugin.capabilities.media).toBe(true);
      expect(feishuPlugin.capabilities.reactions).toBe(true);
      expect(feishuPlugin.capabilities.textLimit).toBe(30000);
    });
  });

  describe('resolveAccount', () => {
    test('resolves valid config', () => {
      const account = feishuPlugin.resolveAccount({
        appId: 'cli_test',
        appSecret: 'secret123',
      });

      expect(account).toBeDefined();
      expect(account!.appId).toBe('cli_test');
      expect(account!.appSecret).toBe('secret123');
      expect(account!.webhookPort).toBe(9321);
      expect(account!.webhookPath).toBe('/feishu/webhook');
    });

    test('resolves config with custom port and path', () => {
      const account = feishuPlugin.resolveAccount({
        appId: 'cli_test',
        appSecret: 'secret123',
        webhookPort: 8080,
        webhookPath: '/custom/hook',
      });

      expect(account).toBeDefined();
      expect(account!.webhookPort).toBe(8080);
      expect(account!.webhookPath).toBe('/custom/hook');
    });

    test('resolves env var values with $ prefix', () => {
      process.env.FEISHU_APP_ID = 'env-app-id';
      process.env.FEISHU_APP_SECRET = 'env-secret';

      const account = feishuPlugin.resolveAccount({
        appId: '$FEISHU_APP_ID',
        appSecret: '$FEISHU_APP_SECRET',
      });

      expect(account).toBeDefined();
      expect(account!.appId).toBe('env-app-id');
      expect(account!.appSecret).toBe('env-secret');
    });

    test('throws when referenced env var is not set', () => {
      delete process.env.MISSING_VAR;

      expect(() =>
        feishuPlugin.resolveAccount({appId: '$MISSING_VAR', appSecret: 'secret'}),
      ).toThrow('Environment variable "MISSING_VAR" is not set');
    });

    test('returns undefined for missing appId', () => {
      const account = feishuPlugin.resolveAccount({appSecret: 'secret'});
      expect(account).toBeUndefined();
    });

    test('returns undefined for empty appId', () => {
      const account = feishuPlugin.resolveAccount({appId: '', appSecret: 'secret'});
      expect(account).toBeUndefined();
    });

    test('returns undefined for missing appSecret', () => {
      const account = feishuPlugin.resolveAccount({appId: 'cli_test'});
      expect(account).toBeUndefined();
    });
  });

  describe('sendText', () => {
    test('sends text message to chat', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 0, msg: 'ok', data: {message_id: 'msg-001'}},
      ]);
      globalThis.fetch = fetchMock;

      const account = feishuPlugin.resolveAccount({appId: 'app1', appSecret: 'secret1'})!;
      const result = await feishuPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'oc_chat001',
        text: 'Hello from Codara',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('msg-001');
    });

    test('replies when replyToId is set', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 0, msg: 'ok', data: {message_id: 'reply-001'}},
      ]);
      globalThis.fetch = fetchMock;

      const account = feishuPlugin.resolveAccount({appId: 'app1', appSecret: 'secret1'})!;
      const result = await feishuPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'oc_chat001',
        text: 'Reply text',
        replyToId: 'om_msg001',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('reply-001');

      const call1 = fetchMock.mock.calls[1] as unknown[];
      expect(call1[0]).toContain('/messages/om_msg001/reply');
    });

    test('returns error on API failure', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 230001, msg: 'invalid chat_id'},
      ]);
      globalThis.fetch = fetchMock;

      const account = feishuPlugin.resolveAccount({appId: 'app1', appSecret: 'secret1'})!;
      const result = await feishuPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'bad-id',
        text: 'Hello',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('230001');
    });
  });

  describe('sendReviewPrompt', () => {
    test('sends interactive card with buttons', async () => {
      const fetchMock = mockFetchSequence([
        {code: 0, msg: 'ok', tenant_access_token: 'token-abc', expire: 7200},
        {code: 0, msg: 'ok', data: {message_id: 'card-001'}},
      ]);
      globalThis.fetch = fetchMock;

      const account = feishuPlugin.resolveAccount({appId: 'app1', appSecret: 'secret1'})!;
      const result = await feishuPlugin.sendReviewPrompt!(account, {
        accountId: 'bot-1',
        to: 'oc_chat001',
        text: '确认执行此操作？',
        review: {id: 'review-1', description: 'Run command'} as unknown as import('@shared/contracts/agent-types').ReviewRequest,
        actions: [
          {id: 'approve', label: '批准', style: 'approve'},
          {id: 'reject', label: '拒绝', style: 'reject'},
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('card-001');

      // Verify interactive card content
      const call1p = fetchMock.mock.calls[1] as unknown[];
      const body = JSON.parse((call1p[1] as RequestInit).body as string);
      expect(body.msg_type).toBe('interactive');

      const card = JSON.parse(body.content);
      expect(card.config.wide_screen_mode).toBe(true);
      expect(card.header.title.content).toBe('需要审批');
      expect(card.elements).toHaveLength(2);
      expect(card.elements[1].actions).toHaveLength(2);
      expect(card.elements[1].actions[0].type).toBe('primary');
      expect(card.elements[1].actions[0].value.action).toBe('approve');
      expect(card.elements[1].actions[1].type).toBe('danger');
      expect(card.elements[1].actions[1].value.action).toBe('reject');
    });
  });
});
