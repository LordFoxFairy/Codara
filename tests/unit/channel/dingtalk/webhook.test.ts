import {describe, it, expect} from 'bun:test';
import {verifyDingTalkSignature, normalizeDingTalkMessage} from '@channels/dingtalk/webhook';
import {createHmac} from 'node:crypto';
import type {DingTalkWebhookMessage} from '@channels/dingtalk/types';

describe('verifyDingTalkSignature', () => {
  const secret = 'test-secret-key';

  function makeValidSignature(timestamp: string): string {
    const stringToSign = timestamp + '\n' + secret;
    return createHmac('sha256', secret).update(stringToSign).digest('base64');
  }

  it('accepts a valid signature with current timestamp', () => {
    const timestamp = String(Date.now());
    const sign = makeValidSignature(timestamp);
    expect(verifyDingTalkSignature(timestamp, sign, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const timestamp = String(Date.now());
    expect(verifyDingTalkSignature(timestamp, 'invalid-sign', secret)).toBe(false);
  });

  it('rejects a stale timestamp (>5 minutes old)', () => {
    const staleTimestamp = String(Date.now() - 6 * 60 * 1000);
    const sign = makeValidSignature(staleTimestamp);
    expect(verifyDingTalkSignature(staleTimestamp, sign, secret)).toBe(false);
  });

  it('rejects a future timestamp (>5 minutes ahead)', () => {
    const futureTimestamp = String(Date.now() + 6 * 60 * 1000);
    const sign = makeValidSignature(futureTimestamp);
    expect(verifyDingTalkSignature(futureTimestamp, sign, secret)).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(verifyDingTalkSignature('not-a-number', 'sign', secret)).toBe(false);
  });
});

describe('normalizeDingTalkMessage', () => {
  const accountId = 'test-account';

  function makeWebhookMessage(overrides?: Partial<DingTalkWebhookMessage>): DingTalkWebhookMessage {
    return {
      msgtype: 'text',
      text: {content: 'hello world'},
      msgId: 'msg-001',
      createAt: '1617243423000',
      conversationType: '1',
      conversationId: 'cid-123',
      senderId: 'user-456',
      senderNick: 'Zhang San',
      chatbotUserId: 'bot-789',
      sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=xxx',
      sessionWebhookExpiredTime: Date.now() + 7200000,
      ...overrides,
    };
  }

  it('normalizes a direct message', () => {
    const msg = makeWebhookMessage({conversationType: '1'});
    const result = normalizeDingTalkMessage(msg, accountId);

    expect(result.channel).toBe('dingtalk');
    expect(result.accountId).toBe(accountId);
    expect(result.messageId).toBe('msg-001');
    expect(result.sender.id).toBe('user-456');
    expect(result.sender.name).toBe('Zhang San');
    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('cid-123');
    expect(result.text).toBe('hello world');
    expect(result.timestamp).toBe(1617243423000);
    expect(result.raw).toBe(msg);
  });

  it('normalizes a group message', () => {
    const msg = makeWebhookMessage({
      conversationType: '2',
      conversationTitle: 'Test Group',
    });
    const result = normalizeDingTalkMessage(msg, accountId);

    expect(result.peer.kind).toBe('group');
    expect(result.peer.name).toBe('Test Group');
  });

  it('trims whitespace from text content', () => {
    const msg = makeWebhookMessage({text: {content: '  hello  '}});
    const result = normalizeDingTalkMessage(msg, accountId);
    expect(result.text).toBe('hello');
  });

  it('handles missing text content gracefully', () => {
    const msg = makeWebhookMessage({text: undefined});
    const result = normalizeDingTalkMessage(msg, accountId);
    expect(result.text).toBe('');
  });
});
