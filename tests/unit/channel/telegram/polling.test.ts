import {describe, test, expect} from 'bun:test';
import {normalizeTelegramMessage} from '@channels/telegram/polling';
import type {TelegramMessage} from '@channels/telegram/types';

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 1,
    date: 1700000000,
    chat: {id: 123, type: 'private'},
    from: {id: 456, is_bot: false, first_name: 'Alice', username: 'alice'},
    text: 'Hello, world!',
    ...overrides,
  };
}

describe('normalizeTelegramMessage', () => {
  const accountId = 'bot-1';

  test('normalizes private message', () => {
    const msg = makeMessage();
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.channel).toBe('telegram');
    expect(result.accountId).toBe('bot-1');
    expect(result.messageId).toBe('1');
    expect(result.sender.id).toBe('456');
    expect(result.sender.name).toBe('Alice');
    expect(result.sender.username).toBe('alice');
    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('123');
    expect(result.text).toBe('Hello, world!');
    expect(result.timestamp).toBe(1700000000000);
  });

  test('normalizes group message', () => {
    const msg = makeMessage({
      chat: {id: -100123, type: 'group', title: 'Dev Group'},
    });
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.peer.kind).toBe('group');
    expect(result.peer.id).toBe('-100123');
    expect(result.peer.name).toBe('Dev Group');
  });

  test('normalizes supergroup message', () => {
    const msg = makeMessage({
      chat: {id: -100456, type: 'supergroup', title: 'Big Group'},
    });
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.peer.kind).toBe('group');
  });

  test('normalizes channel post', () => {
    const msg = makeMessage({
      chat: {id: -100789, type: 'channel', title: 'News'},
    });
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.peer.kind).toBe('channel');
  });

  test('uses caption when text is missing', () => {
    const msg = makeMessage({text: undefined, caption: 'Photo caption'});
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.text).toBe('Photo caption');
  });

  test('defaults to empty text when neither text nor caption exists', () => {
    const msg = makeMessage({text: undefined, caption: undefined});
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.text).toBe('');
  });

  test('includes reply_to_message id', () => {
    const replyMsg = makeMessage({message_id: 99});
    const msg = makeMessage({reply_to_message: replyMsg});
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.replyToId).toBe('99');
  });

  test('handles missing from field', () => {
    const msg = makeMessage({from: undefined});
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.sender.id).toBe('unknown');
    expect(result.sender.name).toBeUndefined();
    expect(result.sender.username).toBeUndefined();
  });

  test('preserves raw message', () => {
    const msg = makeMessage();
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.raw).toBe(msg);
  });

  test('converts date (seconds) to timestamp (milliseconds)', () => {
    const msg = makeMessage({date: 1609459200}); // 2021-01-01 00:00:00 UTC
    const result = normalizeTelegramMessage(msg, accountId);

    expect(result.timestamp).toBe(1609459200000);
  });
});
