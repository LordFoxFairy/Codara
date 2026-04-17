import {describe, test, expect} from 'bun:test';
import {normalizeWeComMessage} from '@channels/wecom/webhook';
import {
  computeSignature,
  encryptMessage,
  decryptMessage,
  parseMessageXml,
} from '@channels/wecom/crypto';
import type {WeComMessageEvent} from '@channels/wecom/types';
import {randomBytes} from 'node:crypto';

describe('normalizeWeComMessage', () => {
  const accountId = 'wecom-bot-1';

  function makeEvent(overrides: Partial<WeComMessageEvent> = {}): WeComMessageEvent {
    return {
      ToUserName: 'wx_corp_id',
      FromUserName: 'user_001',
      CreateTime: '1348831860',
      MsgType: 'text',
      Content: 'hello',
      MsgId: '1234567890123456',
      AgentID: '1',
      ...overrides,
    };
  }

  test('normalizes text message', () => {
    const event = makeEvent();
    const result = normalizeWeComMessage(event, accountId, event);

    expect(result.channel).toBe('wecom');
    expect(result.accountId).toBe('wecom-bot-1');
    expect(result.messageId).toBe('1234567890123456');
    expect(result.sender.id).toBe('user_001');
    expect(result.peer.kind).toBe('direct');
    expect(result.peer.id).toBe('user_001');
    expect(result.text).toBe('hello');
    expect(result.timestamp).toBe(1348831860000);
  });

  test('generates messageId from sender+time when MsgId is missing', () => {
    const event = makeEvent({MsgId: undefined});
    const result = normalizeWeComMessage(event, accountId, event);

    expect(result.messageId).toBe('user_001-1348831860');
  });

  test('uses Date.now() when CreateTime is missing', () => {
    const event = makeEvent({CreateTime: undefined as unknown as string});
    const before = Date.now();
    const result = normalizeWeComMessage(event, accountId, event);
    const after = Date.now();

    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  test('handles empty content', () => {
    const event = makeEvent({Content: undefined});
    const result = normalizeWeComMessage(event, accountId, event);

    expect(result.text).toBe('');
  });

  test('preserves raw event', () => {
    const event = makeEvent();
    const rawObj = {xml: '<xml>...</xml>', event};
    const result = normalizeWeComMessage(event, accountId, rawObj);

    expect(result.raw).toBe(rawObj);
  });
});

describe('URL verification flow', () => {
  const token = 'test-token';
  const rawKey = randomBytes(32);
  const encodingAESKey = rawKey.toString('base64').slice(0, 43);
  const corpId = 'wx_test_corp_id';

  test('signature + decrypt echostr round-trip', () => {
    const echostr = 'random_echo_string_12345';
    const encrypted = encryptMessage(encodingAESKey, corpId, echostr);
    const timestamp = '1348831860';
    const nonce = 'abc123';

    // Compute signature the same way WeCom would
    const signature = computeSignature(token, timestamp, nonce, encrypted);

    // Verify the signature
    const arr = [token, timestamp, nonce, encrypted].sort();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {createHash} = require('node:crypto');
    const expected = createHash('sha1').update(arr.join('')).digest('hex');
    expect(signature).toBe(expected);

    // Decrypt echostr
    const decrypted = decryptMessage(encodingAESKey, encrypted);
    expect(decrypted).toBe(echostr);
  });
});

describe('message decryption + normalization flow', () => {
  const rawKey = randomBytes(32);
  const encodingAESKey = rawKey.toString('base64').slice(0, 43);
  const corpId = 'wx_test_corp_id';

  test('encrypt XML → decrypt → parse → normalize', () => {
    const innerXml = `<xml>
<ToUserName><![CDATA[${corpId}]]></ToUserName>
<FromUserName><![CDATA[user_test_001]]></FromUserName>
<CreateTime>1700000000</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[Hello from WeCom]]></Content>
<MsgId>9876543210</MsgId>
<AgentID>1</AgentID>
</xml>`;

    // Encrypt the inner XML (simulating what WeCom would send)
    const encrypted = encryptMessage(encodingAESKey, corpId, innerXml);

    // Decrypt
    const decrypted = decryptMessage(encodingAESKey, encrypted);
    expect(decrypted).toBe(innerXml);

    // Parse
    const event = parseMessageXml(decrypted);
    expect(event.MsgType).toBe('text');
    expect(event.Content).toBe('Hello from WeCom');
    expect(event.FromUserName).toBe('user_test_001');

    // Normalize
    const inbound = normalizeWeComMessage(event, 'wecom-bot-1', {xml: decrypted, event});
    expect(inbound.channel).toBe('wecom');
    expect(inbound.text).toBe('Hello from WeCom');
    expect(inbound.sender.id).toBe('user_test_001');
    expect(inbound.messageId).toBe('9876543210');
    expect(inbound.timestamp).toBe(1700000000000);
  });

  test('template card event decrypt + parse', () => {
    const innerXml = `<xml>
<ToUserName><![CDATA[${corpId}]]></ToUserName>
<FromUserName><![CDATA[user_approver]]></FromUserName>
<CreateTime>1700000000</CreateTime>
<MsgType><![CDATA[event]]></MsgType>
<Event><![CDATA[template_card_event]]></Event>
<EventKey><![CDATA[approve]]></EventKey>
<TaskId><![CDATA[task_abc_123]]></TaskId>
<AgentID>1</AgentID>
</xml>`;

    const encrypted = encryptMessage(encodingAESKey, corpId, innerXml);
    const decrypted = decryptMessage(encodingAESKey, encrypted);
    const event = parseMessageXml(decrypted);

    expect(event.MsgType).toBe('event');
    expect(event.Event).toBe('template_card_event');
    expect(event.EventKey).toBe('approve');
    expect(event.TaskId).toBe('task_abc_123');
    expect(event.FromUserName).toBe('user_approver');
  });
});
