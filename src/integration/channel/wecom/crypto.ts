import {createHash, createDecipheriv, createCipheriv, randomBytes} from 'node:crypto';
import type {WeComMessageEvent} from './types';

/**
 * Compute WeCom callback signature.
 *
 * WeCom signs: SHA1(sort([token, timestamp, nonce, encrypt]))
 */
export function computeSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const arr = [token, timestamp, nonce, encrypt].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

/**
 * Verify WeCom callback signature matches expected.
 */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  expected: string,
): boolean {
  return computeSignature(token, timestamp, nonce, encrypt) === expected;
}

/**
 * Decrypt a WeCom AES-256-CBC encrypted message.
 *
 * @param encodingAESKey - Base64 encoded AES key (43 chars, needs '=' padding)
 * @param encrypted - Base64 encoded encrypted content
 * @returns Decrypted XML message string
 */
export function decryptMessage(encodingAESKey: string, encrypted: string): string {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()]);
  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - padLen);
  // Format: 16 random bytes + 4 bytes msg length (big-endian) + msg content + corpid
  const msgLen = decrypted.readUInt32BE(16);
  return decrypted.subarray(20, 20 + msgLen).toString('utf8');
}

/**
 * Encrypt a message for WeCom using AES-256-CBC.
 *
 * @param encodingAESKey - Base64 encoded AES key (43 chars, needs '=' padding)
 * @param corpId - Corp ID appended after the message
 * @param message - Plain text message to encrypt
 * @returns Base64 encoded encrypted string
 */
export function encryptMessage(encodingAESKey: string, corpId: string, message: string): string {
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = aesKey.subarray(0, 16);
  const random = randomBytes(16);
  const msgBuf = Buffer.from(message, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length);
  const corpBuf = Buffer.from(corpId, 'utf8');
  const plaintext = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  // PKCS7 padding to 32-byte blocks
  const blockSize = 32;
  const padLen = blockSize - (plaintext.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  const padded = Buffer.concat([plaintext, padding]);
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

/**
 * Parse WeCom message XML using simple regex extraction.
 *
 * Handles CDATA and plain text values in XML tags.
 * No external XML parser dependency needed.
 */
export function parseMessageXml(xml: string): WeComMessageEvent {
  const result: Record<string, string> = {};

  // Match <TagName><![CDATA[value]]></TagName>
  const cdataPattern = /<(\w+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = cdataPattern.exec(xml)) !== null) {
    result[match[1]] = match[2];
  }

  // Match <TagName>value</TagName> (plain text, skip already matched and nested xml)
  const plainPattern = /<(\w+)>([^<]+)<\/\1>/g;
  while ((match = plainPattern.exec(xml)) !== null) {
    if (!(match[1] in result)) {
      result[match[1]] = match[2];
    }
  }

  // Parsed from XML via regex — required fields (ToUserName, FromUserName, CreateTime, MsgType)
  // may be absent if the XML is malformed. Callers must handle gracefully.
  return result as unknown as WeComMessageEvent;
}

/**
 * Extract the Encrypt field from outer WeCom callback XML.
 */
export function extractEncryptFromXml(xml: string): string | undefined {
  const match = /<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/s.exec(xml);
  return match?.[1];
}
