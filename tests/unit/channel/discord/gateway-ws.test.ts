import {describe, test, expect} from 'bun:test';
import {normalizeDiscordMessage} from '@integration/channel/discord/plugin';
import type {DiscordMessage} from '@integration/channel/discord/types';

describe('normalizeDiscordMessage', () => {
  test('normalizes guild message', () => {
    const msg: DiscordMessage = {
      id: 'msg-1',
      channel_id: 'ch-1',
      guild_id: 'guild-1',
      author: {id: 'user-1', username: 'alice', discriminator: '0'},
      content: 'hello world',
      timestamp: '2025-01-01T00:00:00Z',
      referenced_message: null,
    };

    const result = normalizeDiscordMessage(msg, 'bot-1');

    expect(result.channel).toBe('discord');
    expect(result.accountId).toBe('bot-1');
    expect(result.messageId).toBe('msg-1');
    expect(result.sender).toEqual({id: 'user-1', name: 'alice', username: 'alice'});
    expect(result.peer).toEqual({kind: 'group', id: 'ch-1', name: undefined});
    expect(result.text).toBe('hello world');
    expect(result.replyToId).toBeUndefined();
    expect(result.timestamp).toBe(new Date('2025-01-01T00:00:00Z').getTime());
  });

  test('normalizes DM (no guild_id)', () => {
    const msg: DiscordMessage = {
      id: 'msg-2',
      channel_id: 'dm-ch-1',
      author: {id: 'user-2', username: 'bob', discriminator: '0'},
      content: 'private message',
      timestamp: '2025-06-15T12:00:00Z',
    };

    const result = normalizeDiscordMessage(msg, 'bot-1');

    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('dm-ch-1');
  });

  test('normalizes message with reply reference', () => {
    const msg: DiscordMessage = {
      id: 'msg-3',
      channel_id: 'ch-1',
      guild_id: 'guild-1',
      author: {id: 'user-1', username: 'alice', discriminator: '0'},
      content: 'reply text',
      timestamp: '2025-01-01T00:00:00Z',
      referenced_message: {
        id: 'msg-original',
        channel_id: 'ch-1',
        guild_id: 'guild-1',
        author: {id: 'user-2', username: 'bob', discriminator: '0'},
        content: 'original',
        timestamp: '2025-01-01T00:00:00Z',
      },
    };

    const result = normalizeDiscordMessage(msg, 'bot-1');

    expect(result.replyToId).toBe('msg-original');
  });
});
