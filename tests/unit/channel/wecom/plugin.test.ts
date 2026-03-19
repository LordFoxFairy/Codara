import {describe, test, expect} from 'bun:test';
import {wecomPlugin} from '@integration/channel/wecom/plugin';
import type {WeComAccount} from '@integration/channel/wecom/plugin';

describe('wecomPlugin', () => {
  test('has correct id and name', () => {
    expect(wecomPlugin.id).toBe('wecom');
    expect(wecomPlugin.name).toBe('企业微信');
  });

  test('capabilities are correct', () => {
    expect(wecomPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
    expect(wecomPlugin.capabilities.streaming).toBe(false);
    expect(wecomPlugin.capabilities.threads).toBe(false);
    expect(wecomPlugin.capabilities.media).toBe(true);
    expect(wecomPlugin.capabilities.reactions).toBe(false);
    expect(wecomPlugin.capabilities.textLimit).toBe(2048);
  });
});

describe('resolveAccount', () => {
  test('returns account for valid config', () => {
    const config = {
      corpId: 'wx_test_corp',
      corpSecret: 'test_secret_123',
      agentId: 1000001,
      token: 'test_token',
      encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      webhookPort: 9400,
      webhookPath: '/wecom/test',
    };

    const account = wecomPlugin.resolveAccount(config);
    expect(account).toBeDefined();
    expect(account!.corpId).toBe('wx_test_corp');
    expect(account!.agentId).toBe(1000001);
    expect(account!.webhookPort).toBe(9400);
    expect(account!.webhookPath).toBe('/wecom/test');
  });

  test('returns undefined for invalid config (missing corpId)', () => {
    const config = {
      corpSecret: 'test_secret',
      agentId: 1,
      token: 'test_token',
      encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    };

    const account = wecomPlugin.resolveAccount(config);
    expect(account).toBeUndefined();
  });

  test('returns undefined for invalid encodingAESKey length', () => {
    const config = {
      corpId: 'wx_test_corp',
      corpSecret: 'test_secret',
      agentId: 1,
      token: 'test_token',
      encodingAESKey: 'too-short',
    };

    const account = wecomPlugin.resolveAccount(config);
    expect(account).toBeUndefined();
  });

  test('uses default port and path when not provided', () => {
    const config = {
      corpId: 'wx_test_corp',
      corpSecret: 'test_secret',
      agentId: 1,
      token: 'test_token',
      encodingAESKey: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    };

    const account = wecomPlugin.resolveAccount(config);
    expect(account).toBeDefined();
    expect(account!.webhookPort).toBe(9322);
    expect(account!.webhookPath).toBe('/wecom/webhook');
  });

  test('resolves $ENV_VAR syntax', () => {
    process.env.TEST_WECOM_CORP_ID = 'wx_env_corp';
    process.env.TEST_WECOM_SECRET = 'env_secret_123';
    process.env.TEST_WECOM_TOKEN = 'env_token_123';
    process.env.TEST_WECOM_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

    try {
      const config = {
        corpId: '$TEST_WECOM_CORP_ID',
        corpSecret: '$TEST_WECOM_SECRET',
        agentId: 1,
        token: '$TEST_WECOM_TOKEN',
        encodingAESKey: '$TEST_WECOM_AES_KEY',
      };

      const account = wecomPlugin.resolveAccount(config);
      expect(account).toBeDefined();
      expect(account!.corpId).toBe('wx_env_corp');
      expect(account!.corpSecret).toBe('env_secret_123');
      expect(account!.token).toBe('env_token_123');
    } finally {
      delete process.env.TEST_WECOM_CORP_ID;
      delete process.env.TEST_WECOM_SECRET;
      delete process.env.TEST_WECOM_TOKEN;
      delete process.env.TEST_WECOM_AES_KEY;
    }
  });
});

describe('sendText', () => {
  test('returns SendResult with ok:false on API error', async () => {
    // Create a minimal mock account with an api that will throw
    const account = {
      corpId: 'wx_test',
      corpSecret: 'secret',
      agentId: 1,
      token: 'token',
      encodingAESKey: 'key',
      api: {
        sendMarkdownMessage: async () => {
          throw new Error('Network error');
        },
      },
      webhookPort: 9322,
      webhookPath: '/wecom/webhook',
    } as unknown as WeComAccount;

    const result = await wecomPlugin.sendText(account, {
      accountId: 'wecom-bot-1',
      to: 'user_001',
      text: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
  });
});

describe('sendPausePrompt', () => {
  test('maps action styles to WeCom button styles', async () => {
    let capturedButtons: Array<{text: string; style: number; key: string}> = [];

    const account = {
      corpId: 'wx_test',
      corpSecret: 'secret',
      agentId: 1,
      token: 'token',
      encodingAESKey: 'key',
      api: {
        sendTemplateCard: async (
          _toUser: string,
          _title: string,
          _subtitle: string,
          buttons: Array<{text: string; style: number; key: string}>,
        ) => {
          capturedButtons = buttons;
          return {errcode: 0, errmsg: 'ok', msgid: 'msg_001'};
        },
      },
      webhookPort: 9322,
      webhookPath: '/wecom/webhook',
    } as unknown as WeComAccount;

    const result = await wecomPlugin.sendPausePrompt!(account, {
      accountId: 'wecom-bot-1',
      to: 'user_001',
      text: 'Approve this action?',
      pause: {id: 'pause_001'} as unknown as import('@shared/contracts/agent-types').PauseRequest,
      actions: [
        {id: 'approve', label: 'Approve', style: 'approve'},
        {id: 'reject', label: 'Reject', style: 'reject'},
        {id: 'edit', label: 'Edit', style: 'edit'},
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg_001');
    expect(capturedButtons).toEqual([
      {text: 'Approve', style: 1, key: 'approve'},
      {text: 'Reject', style: 3, key: 'reject'},
      {text: 'Edit', style: 2, key: 'edit'},
    ]);
  });
});
