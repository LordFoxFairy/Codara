import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {discordPlugin, type DiscordAccount} from '@integration/channel/discord/plugin';

function mockFetch(response: unknown, status = 200) {
  return mock(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    } as Response),
  );
}

describe('discordPlugin', () => {
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
      const account = discordPlugin.resolveAccount({
        botToken: 'my-discord-token',
        allowGuilds: ['guild-1'],
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('my-discord-token');
      expect(account!.allowGuilds).toEqual(['guild-1']);
    });

    test('resolves env var token with $ prefix', () => {
      process.env.MY_DISCORD_TOKEN = 'env-discord-token';

      const account = discordPlugin.resolveAccount({
        botToken: '$MY_DISCORD_TOKEN',
      });

      expect(account).toBeDefined();
      expect(account!.botToken).toBe('env-discord-token');
    });

    test('throws when referenced env var is not set', () => {
      delete process.env.MISSING_DISCORD_TOKEN;

      expect(() =>
        discordPlugin.resolveAccount({botToken: '$MISSING_DISCORD_TOKEN'}),
      ).toThrow('Environment variable "MISSING_DISCORD_TOKEN" is not set');
    });

    test('returns undefined for invalid config', () => {
      const account = discordPlugin.resolveAccount({});
      expect(account).toBeUndefined();
    });

    test('returns undefined for empty botToken', () => {
      const account = discordPlugin.resolveAccount({botToken: ''});
      expect(account).toBeUndefined();
    });
  });

  describe('sendText', () => {
    test('sends message to channel', async () => {
      const fetchMock = mockFetch({id: 'msg-99', channel_id: 'ch-1'});
      globalThis.fetch = fetchMock;

      const account = discordPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await discordPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'ch-1',
        text: 'Hello Discord!',
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('msg-99');
    });

    test('returns error on API failure', async () => {
      globalThis.fetch = mockFetch({message: 'Forbidden'}, 403);

      const account = discordPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await discordPlugin.sendText(account, {
        accountId: 'bot-1',
        to: 'ch-1',
        text: 'test',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Forbidden');
    });
  });

  describe('sendTyping', () => {
    test('triggers typing indicator', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({ok: true, status: 204} as Response),
      );

      const account = discordPlugin.resolveAccount({botToken: 'test-token'})!;
      await discordPlugin.sendTyping!(account, {
        accountId: 'bot-1',
        to: 'ch-1',
        text: '',
      });

      const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/channels/ch-1/typing');
    });
  });

  describe('capabilities', () => {
    test('has correct capabilities', () => {
      expect(discordPlugin.id).toBe('discord');
      expect(discordPlugin.name).toBe('Discord');
      expect(discordPlugin.capabilities.textLimit).toBe(2000);
      expect(discordPlugin.capabilities.streaming).toBe(false);
      expect(discordPlugin.capabilities.threads).toBe(true);
      expect(discordPlugin.capabilities.media).toBe(true);
      expect(discordPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
    });
  });

  describe('sendPausePrompt', () => {
    test('sends message with button components', async () => {
      const fetchMock = mockFetch({id: 'msg-200', channel_id: 'ch-1'});
      globalThis.fetch = fetchMock;

      const account = discordPlugin.resolveAccount({botToken: 'test-token'})!;
      const result = await discordPlugin.sendPausePrompt!(account, {
        accountId: 'bot-1',
        to: 'ch-1',
        text: 'Approve this action?',
        pause: {id: 'pause-1', description: 'Run command'} as any,
        actions: [
          {id: 'approve', label: 'Approve', style: 'approve'},
          {id: 'reject', label: 'Reject', style: 'reject'},
        ],
      });

      expect(result.ok).toBe(true);
      expect(result.messageId).toBe('msg-200');

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.components).toHaveLength(1);
      expect(body.components[0].type).toBe(1); // ACTION_ROW
      expect(body.components[0].components).toHaveLength(2);
      expect(body.components[0].components[0]).toEqual({
        type: 2,
        style: 3, // SUCCESS
        label: 'Approve',
        custom_id: 'approve:pause-1',
      });
      expect(body.components[0].components[1]).toEqual({
        type: 2,
        style: 4, // DANGER
        label: 'Reject',
        custom_id: 'reject:pause-1',
      });
    });
  });
});
