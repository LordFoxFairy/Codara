import {describe, it, expect, beforeEach, mock} from 'bun:test';
import {dingtalkPlugin, type DingTalkAccount} from '@integration/channel/dingtalk/plugin';
import {DingTalkApi} from '@integration/channel/dingtalk/api';
import type {OutboundContext, ReviewPromptContext} from '@gateway/types';
import type {ReviewRequest} from '@shared/contracts/agent-types';

describe('dingtalkPlugin', () => {
  describe('metadata', () => {
    it('has correct plugin id and name', () => {
      expect(dingtalkPlugin.id).toBe('dingtalk');
      expect(dingtalkPlugin.name).toBe('钉钉');
    });

    it('declares correct capabilities', () => {
      expect(dingtalkPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
      expect(dingtalkPlugin.capabilities.streaming).toBe(false);
      expect(dingtalkPlugin.capabilities.threads).toBe(false);
      expect(dingtalkPlugin.capabilities.media).toBe(false);
      expect(dingtalkPlugin.capabilities.reactions).toBe(false);
      expect(dingtalkPlugin.capabilities.textLimit).toBe(20000);
    });
  });

  describe('resolveAccount', () => {
    it('resolves a valid config', () => {
      const account = dingtalkPlugin.resolveAccount({appSecret: 'my-secret'});
      expect(account).toBeDefined();
      expect(account!.appSecret).toBe('my-secret');
      expect(account!.webhookPort).toBe(8075);
      expect(account!.webhookPath).toBe('/dingtalk/webhook');
    });

    it('resolves custom port and path', () => {
      const account = dingtalkPlugin.resolveAccount({
        appSecret: 'my-secret',
        webhookPort: 9090,
        webhookPath: '/custom/path',
      });
      expect(account).toBeDefined();
      expect(account!.webhookPort).toBe(9090);
      expect(account!.webhookPath).toBe('/custom/path');
    });

    it('returns undefined for invalid config (missing appSecret)', () => {
      const account = dingtalkPlugin.resolveAccount({});
      expect(account).toBeUndefined();
    });

    it('returns undefined for empty appSecret', () => {
      const account = dingtalkPlugin.resolveAccount({appSecret: ''});
      expect(account).toBeUndefined();
    });

    it('resolves $ENV_VAR syntax', () => {
      process.env.TEST_DINGTALK_SECRET = 'env-secret-value';
      try {
        const account = dingtalkPlugin.resolveAccount({appSecret: '$TEST_DINGTALK_SECRET'});
        expect(account).toBeDefined();
        expect(account!.appSecret).toBe('env-secret-value');
      } finally {
        delete process.env.TEST_DINGTALK_SECRET;
      }
    });
  });

  describe('sendText', () => {
    let account: DingTalkAccount;
    let api: DingTalkApi;

    beforeEach(() => {
      api = new DingTalkApi();
      account = {
        appSecret: 'test-secret',
        api,
        webhookPort: 8075,
        webhookPath: '/dingtalk/webhook',
      };
    });

    it('returns error when no sessionWebhook is available', async () => {
      const ctx: OutboundContext = {accountId: 'acc', to: 'cid-missing', text: 'hello'};
      const result = await dingtalkPlugin.sendText(account, ctx);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active sessionWebhook');
    });

    it('sends markdown via stored sessionWebhook', async () => {
      // Store a session
      const futureExpiry = Date.now() + 7200000;
      api.setSession('cid-123', 'https://fake.dingtalk.com/session', futureExpiry);

      // Mock fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => new Response('{"errcode":0}', {status: 200})) as unknown as typeof fetch;

      try {
        const ctx: OutboundContext = {accountId: 'acc', to: 'cid-123', text: 'hello response'};
        const result = await dingtalkPlugin.sendText(account, ctx);
        expect(result.ok).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('sendReviewPrompt', () => {
    let account: DingTalkAccount;
    let api: DingTalkApi;

    beforeEach(() => {
      api = new DingTalkApi();
      account = {
        appSecret: 'test-secret',
        api,
        webhookPort: 8075,
        webhookPath: '/dingtalk/webhook',
        callbackBaseUrl: 'https://my-server.com',
      };
    });

    it('returns error when no sessionWebhook is available', async () => {
      const ctx: ReviewPromptContext = {
        accountId: 'acc',
        to: 'cid-missing',
        text: 'Need approval',
        review: {id: 'review-1'} as ReviewRequest,
        actions: [{id: 'approve', label: 'Approve', style: 'approve'}],
      };
      const result = await dingtalkPlugin.sendReviewPrompt!(account, ctx);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No active sessionWebhook');
    });

    it('sends action card with callback URLs', async () => {
      const futureExpiry = Date.now() + 7200000;
      api.setSession('cid-123', 'https://fake.dingtalk.com/session', futureExpiry);

      let sentBody: unknown;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        sentBody = JSON.parse(init?.body as string);
        return new Response('{"errcode":0}', {status: 200});
      }) as unknown as typeof fetch;

      try {
        const ctx: ReviewPromptContext = {
          accountId: 'acc',
          to: 'cid-123',
          text: 'Review needed',
          review: {id: 'review-001'} as ReviewRequest,
          actions: [
            {id: 'approve', label: 'Approve', style: 'approve' as const},
            {id: 'reject', label: 'Reject', style: 'reject' as const},
          ],
        };
        const result = await dingtalkPlugin.sendReviewPrompt!(account, ctx);
        expect(result.ok).toBe(true);
        expect((sentBody as {msgtype: string}).msgtype).toBe('actionCard');
        const card = (sentBody as {actionCard: {btns: {actionURL: string}[]}}).actionCard;
        expect(card.btns).toHaveLength(2);
        expect(card.btns[0].actionURL).toContain('action=approve');
        expect(card.btns[0].actionURL).toContain('id=review-001');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
