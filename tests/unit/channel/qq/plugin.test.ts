import {describe, test, expect, beforeEach, afterEach} from 'bun:test';
import {qqPlugin, normalizeOneBotMessage, type QQAccount} from '@channels/qq/plugin';
import type {OneBotMessageEvent} from '@channels/qq/types';

describe('qqPlugin', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = {...process.env};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── resolveAccount ─────────────────────────────────────────────────

  describe('resolveAccount', () => {
    test('resolves valid config', () => {
      const account = qqPlugin.resolveAccount({
        wsUrl: 'ws://127.0.0.1:3001',
        allowUsers: ['12345'],
      });

      expect(account).toBeDefined();
      expect(account!.wsUrl).toBe('ws://127.0.0.1:3001');
      expect(account!.allowUsers).toEqual(['12345']);
    });

    test('resolves env var with $ prefix for wsUrl', () => {
      process.env.QQ_WS_URL = 'ws://env-host:3001';

      const account = qqPlugin.resolveAccount({
        wsUrl: '$QQ_WS_URL',
      });

      expect(account).toBeDefined();
      expect(account!.wsUrl).toBe('ws://env-host:3001');
    });

    test('resolves env var with $ prefix for accessToken', () => {
      process.env.QQ_TOKEN = 'secret-token';

      const account = qqPlugin.resolveAccount({
        wsUrl: 'ws://127.0.0.1:3001',
        accessToken: '$QQ_TOKEN',
      });

      expect(account).toBeDefined();
      expect(account!.accessToken).toBe('secret-token');
    });

    test('throws when referenced env var is not set', () => {
      delete process.env.MISSING_URL;

      expect(() => qqPlugin.resolveAccount({wsUrl: '$MISSING_URL'})).toThrow(
        'Environment variable "MISSING_URL" is not set',
      );
    });

    test('returns undefined for missing wsUrl', () => {
      expect(qqPlugin.resolveAccount({})).toBeUndefined();
    });

    test('returns undefined for empty wsUrl', () => {
      expect(qqPlugin.resolveAccount({wsUrl: ''})).toBeUndefined();
    });

    test('resolves groupPolicy', () => {
      const account = qqPlugin.resolveAccount({
        wsUrl: 'ws://127.0.0.1:3001',
        groupPolicy: {requireMention: true},
      });

      expect(account).toBeDefined();
      expect(account!.groupPolicy?.requireMention).toBe(true);
    });

    test('passes through selfId', () => {
      const account = qqPlugin.resolveAccount({
        wsUrl: 'ws://127.0.0.1:3001',
        selfId: '987654321',
      });

      expect(account).toBeDefined();
      expect(account!.selfId).toBe('987654321');
    });
  });

  // ── normalizeOneBotMessage ─────────────────────────────────────────

  describe('normalizeOneBotMessage', () => {
    test('normalizes private message', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 12345,
        user_id: 111222333,
        message: [{type: 'text', data: {text: 'hello world'}}],
        raw_message: 'hello world',
        sender: {user_id: 111222333, nickname: '张三'},
        time: 1617243423,
        self_id: 987654321,
      };

      const msg = normalizeOneBotMessage(event, 'qq-bot-1');

      expect(msg.channel).toBe('qq');
      expect(msg.accountId).toBe('qq-bot-1');
      expect(msg.messageId).toBe('12345');
      expect(msg.sender.id).toBe('111222333');
      expect(msg.sender.name).toBe('张三');
      expect(msg.peer.kind).toBe('direct');
      expect(msg.peer.id).toBe('111222333');
      expect(msg.text).toBe('hello world');
      expect(msg.timestamp).toBe(1617243423000);
    });

    test('normalizes group message', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        message_id: 67890,
        user_id: 111222333,
        group_id: 100200300,
        message: [{type: 'text', data: {text: 'group hello'}}],
        raw_message: 'group hello',
        sender: {user_id: 111222333, nickname: '张三', card: '群名片'},
        time: 1617243500,
        self_id: 987654321,
      };

      const msg = normalizeOneBotMessage(event, 'qq-bot-1');

      expect(msg.peer.kind).toBe('group');
      expect(msg.peer.id).toBe('group:100200300');
      expect(msg.sender.name).toBe('群名片'); // card takes precedence over nickname
      expect(msg.text).toBe('group hello');
    });

    test('uses nickname when card is empty', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'group',
        sub_type: 'normal',
        message_id: 1,
        user_id: 111,
        group_id: 200,
        message: [{type: 'text', data: {text: 'test'}}],
        raw_message: 'test',
        sender: {user_id: 111, nickname: 'NickName', card: ''},
        time: 1000,
        self_id: 999,
      };

      const msg = normalizeOneBotMessage(event, 'bot');
      // Empty string is falsy, so nickname should be used
      expect(msg.sender.name).toBe('NickName');
    });

    test('extracts text from multiple segments', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 1,
        user_id: 111,
        message: [
          {type: 'text', data: {text: 'hello '}},
          {type: 'face', data: {id: '1'}},
          {type: 'text', data: {text: 'world'}},
        ],
        raw_message: 'hello [face]world',
        sender: {user_id: 111, nickname: 'Test'},
        time: 1000,
        self_id: 999,
      };

      const msg = normalizeOneBotMessage(event, 'bot');
      expect(msg.text).toBe('hello world');
    });

    test('extracts image media URLs', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 1,
        user_id: 111,
        message: [
          {type: 'text', data: {text: 'look:'}},
          {type: 'image', data: {url: 'https://example.com/img.jpg', file: 'abc.jpg'}},
        ],
        raw_message: 'look:[image]',
        sender: {user_id: 111, nickname: 'Test'},
        time: 1000,
        self_id: 999,
      };

      const msg = normalizeOneBotMessage(event, 'bot');
      expect(msg.mediaUrls).toEqual(['https://example.com/img.jpg']);
    });

    test('extracts reply ID from reply segments', () => {
      const event: OneBotMessageEvent = {
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        message_id: 1,
        user_id: 111,
        message: [
          {type: 'reply', data: {id: '9999'}},
          {type: 'text', data: {text: 'replying'}},
        ],
        raw_message: '[reply]replying',
        sender: {user_id: 111, nickname: 'Test'},
        time: 1000,
        self_id: 999,
      };

      const msg = normalizeOneBotMessage(event, 'bot');
      expect(msg.replyToId).toBe('9999');
    });
  });

  // ── capabilities ───────────────────────────────────────────────────

  describe('capabilities', () => {
    test('has correct capabilities', () => {
      expect(qqPlugin.id).toBe('qq');
      expect(qqPlugin.name).toBe('QQ');
      expect(qqPlugin.capabilities.textLimit).toBe(4500);
      expect(qqPlugin.capabilities.streaming).toBe(false);
      expect(qqPlugin.capabilities.threads).toBe(false);
      expect(qqPlugin.capabilities.media).toBe(true);
      expect(qqPlugin.capabilities.chatTypes).toEqual(['direct', 'group']);
    });
  });

  // ── sendText ───────────────────────────────────────────────────────

  describe('sendText', () => {
    test('returns error when client is not connected', async () => {
      const account: QQAccount = {wsUrl: 'ws://localhost:3001'};
      const result = await qqPlugin.sendText(account, {
        accountId: 'bot-1',
        to: '12345',
        text: 'hello',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('WebSocket client not connected');
    });
  });

  // ── sendTyping ─────────────────────────────────────────────────────

  describe('sendTyping', () => {
    test('is a no-op (does not throw)', async () => {
      const account: QQAccount = {wsUrl: 'ws://localhost:3001'};
      // Should not throw
      await qqPlugin.sendTyping!(account, {
        accountId: 'bot-1',
        to: '12345',
        text: '',
      });
    });
  });
});
