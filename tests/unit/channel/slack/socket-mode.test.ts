import {describe, test, expect} from 'bun:test';
import {normalizeSlackMessage} from '@integration/channel/slack/plugin';
import type {SlackMessageEvent} from '@integration/channel/slack/types';

describe('normalizeSlackMessage', () => {
  test('normalizes channel message', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C123456',
      user: 'U789',
      text: 'hello world',
      ts: '1617243423.000100',
    };

    const result = normalizeSlackMessage(event, 'bot-1');

    expect(result.channel).toBe('slack');
    expect(result.accountId).toBe('bot-1');
    expect(result.messageId).toBe('1617243423.000100');
    expect(result.sender).toEqual({id: 'U789'});
    expect(result.peer).toEqual({kind: 'group', id: 'C123456'});
    expect(result.text).toBe('hello world');
    expect(result.threadId).toBeUndefined();
    expect(result.timestamp).toBe(Math.floor(1617243423.0001 * 1000));
  });

  test('normalizes DM (channel starting with D)', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'D987654',
      user: 'U111',
      text: 'private msg',
      ts: '1617243500.000100',
    };

    const result = normalizeSlackMessage(event, 'bot-1');

    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('D987654');
  });

  test('normalizes threaded message', () => {
    const event: SlackMessageEvent = {
      type: 'message',
      channel: 'C123456',
      user: 'U789',
      text: 'thread reply',
      ts: '1617243423.000200',
      thread_ts: '1617243400.000000',
    };

    const result = normalizeSlackMessage(event, 'bot-1');

    expect(result.threadId).toBe('1617243400.000000');
  });
});
