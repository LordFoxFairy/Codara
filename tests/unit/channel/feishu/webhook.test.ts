import {describe, test, expect} from 'bun:test';
import {verifySignature, normalizeFeishuMessage} from '@channels/feishu/webhook';
import type {FeishuEvent, FeishuMessageEvent} from '@channels/feishu/types';
import {createHash} from 'node:crypto';

describe('verifySignature', () => {
  const encryptKey = 'test-encrypt-key';

  test('returns true for valid signature', () => {
    const timestamp = '1700000000';
    const nonce = 'abc123';
    const body = '{"event":"data"}';

    const expected = createHash('sha256')
      .update(timestamp + nonce + encryptKey + body)
      .digest('hex');

    expect(verifySignature(timestamp, nonce, encryptKey, body, expected)).toBe(true);
  });

  test('returns false for invalid signature', () => {
    expect(verifySignature('ts', 'nonce', encryptKey, 'body', 'bad-signature')).toBe(false);
  });

  test('returns false when any parameter differs', () => {
    const timestamp = '1700000000';
    const nonce = 'abc123';
    const body = '{"event":"data"}';

    const validSig = createHash('sha256')
      .update(timestamp + nonce + encryptKey + body)
      .digest('hex');

    // Different body
    expect(verifySignature(timestamp, nonce, encryptKey, '{"event":"other"}', validSig)).toBe(false);
    // Different timestamp
    expect(verifySignature('9999999999', nonce, encryptKey, body, validSig)).toBe(false);
  });
});

function makeFeishuEvent(messageOverrides: Partial<FeishuMessageEvent['message']> = {}): {
  event: FeishuEvent;
  messageEvent: FeishuMessageEvent;
} {
  const messageEvent: FeishuMessageEvent = {
    sender: {
      sender_id: {open_id: 'ou_user123', user_id: 'uid456'},
      sender_type: 'user',
    },
    message: {
      message_id: 'om_msg001',
      chat_id: 'oc_chat001',
      chat_type: 'p2p',
      message_type: 'text',
      content: '{"text":"Hello Codara"}',
      create_time: '1700000000000',
      ...messageOverrides,
    },
  };

  const event: FeishuEvent = {
    schema: '2.0',
    header: {
      event_id: 'evt_001',
      event_type: 'im.message.receive_v1',
      create_time: '1700000000000',
      token: 'verify-token',
      app_id: 'cli_app001',
      tenant_key: 'tenant_001',
    },
    event: messageEvent,
  };

  return {event, messageEvent};
}

describe('normalizeFeishuMessage', () => {
  const accountId = 'feishu-bot-1';

  test('normalizes p2p message', () => {
    const {event, messageEvent} = makeFeishuEvent();
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.channel).toBe('feishu');
    expect(result.accountId).toBe('feishu-bot-1');
    expect(result.messageId).toBe('om_msg001');
    expect(result.sender.id).toBe('ou_user123');
    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('oc_chat001');
    expect(result.text).toBe('Hello Codara');
    expect(result.timestamp).toBe(1700000000000);
  });

  test('normalizes group message', () => {
    const {event, messageEvent} = makeFeishuEvent({chat_type: 'group'});
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.peer.kind).toBe('group');
  });

  test('extracts text from JSON content', () => {
    const {event, messageEvent} = makeFeishuEvent({
      content: '{"text":"Hello from JSON"}',
    });
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.text).toBe('Hello from JSON');
  });

  test('falls back to raw content when JSON parsing fails', () => {
    const {event, messageEvent} = makeFeishuEvent({
      content: 'plain text fallback',
    });
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.text).toBe('plain text fallback');
  });

  test('uses open_id as sender id by default', () => {
    const {event, messageEvent} = makeFeishuEvent();
    messageEvent.sender.sender_id = {open_id: 'ou_abc', user_id: 'uid_xyz'};

    const result = normalizeFeishuMessage(event, messageEvent, accountId);
    expect(result.sender.id).toBe('ou_abc');
  });

  test('falls back to user_id when open_id is missing', () => {
    const {event, messageEvent} = makeFeishuEvent();
    messageEvent.sender.sender_id = {user_id: 'uid_xyz'};

    const result = normalizeFeishuMessage(event, messageEvent, accountId);
    expect(result.sender.id).toBe('uid_xyz');
  });

  test('falls back to unknown when no sender id', () => {
    const {event, messageEvent} = makeFeishuEvent();
    messageEvent.sender.sender_id = {};

    const result = normalizeFeishuMessage(event, messageEvent, accountId);
    expect(result.sender.id).toBe('unknown');
  });

  test('includes threadId from root_id', () => {
    const {event, messageEvent} = makeFeishuEvent({root_id: 'om_root001'});
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.threadId).toBe('om_root001');
  });

  test('includes replyToId from parent_id', () => {
    const {event, messageEvent} = makeFeishuEvent({parent_id: 'om_parent001'});
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.replyToId).toBe('om_parent001');
  });

  test('preserves raw event', () => {
    const {event, messageEvent} = makeFeishuEvent();
    const result = normalizeFeishuMessage(event, messageEvent, accountId);

    expect(result.raw).toBe(event);
  });

  test('uses Date.now() when create_time is missing', () => {
    const {event, messageEvent} = makeFeishuEvent({create_time: undefined});
    const before = Date.now();
    const result = normalizeFeishuMessage(event, messageEvent, accountId);
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });
});
