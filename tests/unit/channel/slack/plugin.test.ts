import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {slackPlugin} from '@channels/slack/plugin';

function mockFetch(response: unknown) {
  return mock(() =>
    Promise.resolve({
      json: () => Promise.resolve(response),
    } as Response),
  ) as unknown as typeof fetch & ReturnType<typeof mock>;
}

describe('slackPlugin', () => {
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
      const account = slackPlugin.resolveAccount({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        allowChannels: ['C123'],
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('xoxb-test');
      expect(account!.appToken).toBe('xapp-test');
      expect(account!.allowChannels).toEqual(['C123']);
    });

    test('resolves env var tokens with $ prefix', () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-env';
      process.env.SLACK_APP_TOKEN = 'xapp-env';

      const account = slackPlugin.resolveAccount({
        botToken: '$SLACK_BOT_TOKEN',
        appToken: '$SLACK_APP_TOKEN',
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('xoxb-env');
      expect(account!.appToken).toBe('xapp-env');
    });

    test('throws when referenced env var is not set', () => {
      delete process.env.MISSING_SLACK_TOKEN;

      expect(() =>
        slackPlugin.resolveAccount({
          botToken: '$MISSING_SLACK_TOKEN',
          appToken: 'xapp-test',
        }),
      ).toThrow('Environment variable "MISSING_SLACK_TOKEN" is not set');
    });

    test('returns undefined for invalid config', () => {
      const account = slackPlugin.resolveAccount({});
      expect(account).toBeUndefined();
    });

    test('returns undefined for missing appToken', () => {
      const account = slackPlugin.resolveAccount({botToken: 'xoxb-test'});
      expect(account).toBeUndefined();
    });
  });

  describe('sendText', () => {
    test('sends message to channel', async () => {
      const fetchMock = mockFetch({ok: true, ts: '1617243423.000100', channel: 'C123'});
      globalThis.fetch = fetchMock;

      const account = slackPlugin.resolveAccount({botToken: 'xoxb-test', appToken: 'xapp-test'})!;
      const result = await slackPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'C123',
        text: 'Hello Slack!',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('1617243423.000100');
    });

    test('sends message with thread_ts', async () => {
      const fetchMock = mockFetch({ok: true, ts: '1617243423.000200', channel: 'C123'});
      globalThis.fetch = fetchMock;

      const account = slackPlugin.resolveAccount({botToken: 'xoxb-test', appToken: 'xapp-test'})!;
      await slackPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'C123',
        text: 'Thread reply',
        threadId: '1617243400.000000',
      });

      const call0 = fetchMock.mock.calls[0] as unknown[];
      const body = JSON.parse((call0[1] as RequestInit).body as string);
      expect(body.thread_ts).toBe('1617243400.000000');
    });

    test('returns error on API failure', async () => {
      globalThis.fetch = mockFetch({ok: false, error: 'channel_not_found'});

      const account = slackPlugin.resolveAccount({botToken: 'xoxb-test', appToken: 'xapp-test'})!;
      const result = await slackPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'C999',
        text: 'test',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('channel_not_found');
    });
  });

  describe('capabilities', () => {
    test('has correct capabilities', () => {
      expect(slackPlugin.id).toBe('slack');
      expect(slackPlugin.name).toBe('Slack');
      expect(slackPlugin.capabilities.textLimit).toBe(40000);
      expect(slackPlugin.capabilities.streaming).toBe(false);
      expect(slackPlugin.capabilities.threads).toBe(true);
      expect(slackPlugin.capabilities.media).toBe(true);
      expect(slackPlugin.capabilities.chatTypes).toEqual(['direct', 'group', 'channel']);
    });
  });

  describe('sendReviewPrompt', () => {
    test('sends message with Block Kit buttons', async () => {
      const fetchMock = mockFetch({ok: true, ts: '1617243423.000300', channel: 'C123'});
      globalThis.fetch = fetchMock;

      const account = slackPlugin.resolveAccount({botToken: 'xoxb-test', appToken: 'xapp-test'})!;
      const result = await slackPlugin.sendReviewPrompt!(account, {
        accountId: 'bot-1',
        to: 'C123',
        text: 'Approve this action?',
        review: {id: 'review-1', description: 'Run command'} as unknown as import('@shared/agent-types').ReviewRequest,
        actions: [
          {id: 'approve', label: 'Approve', style: 'approve'},
          {id: 'reject', label: 'Reject', style: 'reject'},
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('1617243423.000300');

      const call0p = fetchMock.mock.calls[0] as unknown[];
      const body = JSON.parse((call0p[1] as RequestInit).body as string);
      expect(body.blocks).toHaveLength(2);
      expect(body.blocks[0].type).toBe('section');
      expect(body.blocks[0].text.type).toBe('mrkdwn');
      expect(body.blocks[1].type).toBe('actions');
      expect(body.blocks[1].elements).toHaveLength(2);
      expect(body.blocks[1].elements[0]).toEqual({
        type: 'button',
        text: {type: 'plain_text', text: 'Approve'},
        action_id: 'approve:review-1',
        style: 'primary',
      });
      expect(body.blocks[1].elements[1]).toEqual({
        type: 'button',
        text: {type: 'plain_text', text: 'Reject'},
        action_id: 'reject:review-1',
        style: 'danger',
      });
    });
  });
});
