import {describe, test, expect} from 'bun:test';
import {
  computeSignature,
  verifySignature,
  decryptMessage,
  encryptMessage,
  parseMessageXml,
  extractEncryptFromXml,
} from '@integration/channel/wecom/crypto';
import {createHash, randomBytes} from 'node:crypto';

describe('computeSignature', () => {
  test('produces SHA1 of sorted concatenation', () => {
    const token = 'test-token';
    const timestamp = '1348831860';
    const nonce = 'abc123';
    const encrypt = 'encrypted-content';

    const arr = [token, timestamp, nonce, encrypt].sort();
    const expected = createHash('sha1').update(arr.join('')).digest('hex');

    expect(computeSignature(token, timestamp, nonce, encrypt)).toBe(expected);
  });
});

describe('verifySignature', () => {
  test('returns true for valid signature', () => {
    const token = 'test-token';
    const timestamp = '1348831860';
    const nonce = 'abc123';
    const encrypt = 'encrypted-content';

    const arr = [token, timestamp, nonce, encrypt].sort();
    const sig = createHash('sha1').update(arr.join('')).digest('hex');

    expect(verifySignature(token, timestamp, nonce, encrypt, sig)).toBe(true);
  });

  test('returns false for invalid signature', () => {
    expect(verifySignature('token', 'ts', 'nonce', 'enc', 'bad-sig')).toBe(false);
  });

  test('returns false when any parameter differs', () => {
    const token = 'test-token';
    const timestamp = '1348831860';
    const nonce = 'abc123';
    const encrypt = 'encrypted-content';

    const arr = [token, timestamp, nonce, encrypt].sort();
    const sig = createHash('sha1').update(arr.join('')).digest('hex');

    expect(verifySignature(token, '9999999999', nonce, encrypt, sig)).toBe(false);
    expect(verifySignature(token, timestamp, 'other-nonce', encrypt, sig)).toBe(false);
  });
});

describe('encrypt/decrypt round-trip', () => {
  // Generate a valid 43-char base64 encodingAESKey (decodes to 32 bytes)
  const rawKey = randomBytes(32);
  const encodingAESKey = rawKey.toString('base64').slice(0, 43);
  const corpId = 'wx1234567890abcdef';

  test('encrypt then decrypt returns original message', () => {
    const original = '<xml><Content>Hello World</Content></xml>';
    const encrypted = encryptMessage(encodingAESKey, corpId, original);
    const decrypted = decryptMessage(encodingAESKey, encrypted);

    expect(decrypted).toBe(original);
  });

  test('works with empty message', () => {
    const original = '';
    const encrypted = encryptMessage(encodingAESKey, corpId, original);
    const decrypted = decryptMessage(encodingAESKey, encrypted);

    expect(decrypted).toBe(original);
  });

  test('works with unicode content', () => {
    const original = '<xml><Content>你好世界</Content></xml>';
    const encrypted = encryptMessage(encodingAESKey, corpId, original);
    const decrypted = decryptMessage(encodingAESKey, encrypted);

    expect(decrypted).toBe(original);
  });

  test('works with long message', () => {
    const original = 'A'.repeat(2048);
    const encrypted = encryptMessage(encodingAESKey, corpId, original);
    const decrypted = decryptMessage(encodingAESKey, encrypted);

    expect(decrypted).toBe(original);
  });

  test('different encryptions produce different ciphertext (due to random prefix)', () => {
    const original = 'test message';
    const enc1 = encryptMessage(encodingAESKey, corpId, original);
    const enc2 = encryptMessage(encodingAESKey, corpId, original);

    expect(enc1).not.toBe(enc2);
    // But both decrypt to the same thing
    expect(decryptMessage(encodingAESKey, enc1)).toBe(original);
    expect(decryptMessage(encodingAESKey, enc2)).toBe(original);
  });
});

describe('parseMessageXml', () => {
  test('parses CDATA fields', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[CorpID]]></ToUserName>
      <FromUserName><![CDATA[UserId]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[hello]]></Content>
      <MsgId>1234567890123456</MsgId>
      <AgentID>1</AgentID>
    </xml>`;

    const result = parseMessageXml(xml);

    expect(result.ToUserName).toBe('CorpID');
    expect(result.FromUserName).toBe('UserId');
    expect(result.CreateTime).toBe('1348831860');
    expect(result.MsgType).toBe('text');
    expect(result.Content).toBe('hello');
    expect(result.MsgId).toBe('1234567890123456');
    expect(result.AgentID).toBe('1');
  });

  test('parses template card event', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[CorpID]]></ToUserName>
      <FromUserName><![CDATA[UserId]]></FromUserName>
      <CreateTime>1348831860</CreateTime>
      <MsgType><![CDATA[event]]></MsgType>
      <Event><![CDATA[template_card_event]]></Event>
      <EventKey><![CDATA[approve]]></EventKey>
      <TaskId><![CDATA[task_001]]></TaskId>
      <AgentID>1</AgentID>
    </xml>`;

    const result = parseMessageXml(xml);

    expect(result.MsgType).toBe('event');
    expect(result.Event).toBe('template_card_event');
    expect(result.EventKey).toBe('approve');
    expect(result.TaskId).toBe('task_001');
  });

  test('handles plain text values (no CDATA)', () => {
    const xml = '<xml><CreateTime>12345</CreateTime><AgentID>1</AgentID></xml>';
    const result = parseMessageXml(xml);

    expect(result.CreateTime).toBe('12345');
    expect(result.AgentID).toBe('1');
  });
});

describe('extractEncryptFromXml', () => {
  test('extracts Encrypt field from callback XML', () => {
    const xml = `<xml>
      <ToUserName><![CDATA[CorpID]]></ToUserName>
      <AgentID><![CDATA[1]]></AgentID>
      <Encrypt><![CDATA[abc123encrypted]]></Encrypt>
    </xml>`;

    expect(extractEncryptFromXml(xml)).toBe('abc123encrypted');
  });

  test('returns undefined when no Encrypt field', () => {
    const xml = '<xml><Content>hello</Content></xml>';
    expect(extractEncryptFromXml(xml)).toBeUndefined();
  });
});
