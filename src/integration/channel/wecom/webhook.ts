import type {InboundMessage, StopHandle} from '@gateway/types';
import type {WeComMessageEvent} from './types';
import {verifySignature, decryptMessage, parseMessageXml, extractEncryptFromXml} from './crypto';

export interface WeComWebhookOptions {
  port: number;
  path: string;
  token: string;
  encodingAESKey: string;
  corpId: string;
  accountId: string;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCardAction?: (eventKey: string, taskId: string, userId: string) => void;
}

/**
 * Normalize a decrypted WeCom message event into Codara's InboundMessage format.
 */
export function normalizeWeComMessage(
  event: WeComMessageEvent,
  accountId: string,
  raw: unknown,
): InboundMessage {
  return {
    channel: 'wecom',
    accountId,
    messageId: event.MsgId ?? `${event.FromUserName}-${event.CreateTime}`,
    sender: {
      id: event.FromUserName,
    },
    peer: {
      // WeCom doesn't distinguish in the message XML; treat as direct by default
      kind: 'direct',
      id: event.FromUserName,
    },
    text: event.Content ?? '',
    timestamp: event.CreateTime ? Number(event.CreateTime) * 1000 : Date.now(),
    raw,
  };
}

/**
 * Start a WeCom webhook HTTP server using Bun.serve.
 *
 * Handles:
 * 1. GET — URL verification (decrypt echostr, return plain text)
 * 2. POST — Message callback (verify signature, decrypt, parse, normalize)
 *    - text messages → InboundMessage
 *    - template_card_event → onCardAction callback
 */
export function startWeComWebhook(options: WeComWebhookOptions): StopHandle {
  const {port, path, token, encodingAESKey, corpId, accountId, onMessage, onCardAction} = options;

  // Dedup: WeCom may retry events; track seen MsgIds
  const seenMsgIds = new Set<string>();
  const DEDUP_TTL_MS = 5 * 60 * 1000;

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(path)) {
        return new Response('Not Found', {status: 404});
      }

      const msgSignature = url.searchParams.get('msg_signature') ?? '';
      const timestamp = url.searchParams.get('timestamp') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';

      // GET: URL verification
      if (req.method === 'GET') {
        const echostr = url.searchParams.get('echostr') ?? '';

        if (!verifySignature(token, timestamp, nonce, echostr, msgSignature)) {
          return new Response('Invalid Signature', {status: 403});
        }

        try {
          const decrypted = decryptMessage(encodingAESKey, echostr);
          return new Response(decrypted, {
            headers: {'Content-Type': 'text/plain'},
          });
        } catch {
          return new Response('Decrypt Failed', {status: 400});
        }
      }

      // POST: Message callback
      if (req.method === 'POST') {
        const rawBody = await req.text();

        // Extract Encrypt field from outer XML
        const encrypted = extractEncryptFromXml(rawBody);
        if (!encrypted) {
          return new Response('Bad Request: missing Encrypt', {status: 400});
        }

        // Verify signature
        if (!verifySignature(token, timestamp, nonce, encrypted, msgSignature)) {
          return new Response('Invalid Signature', {status: 403});
        }

        // Decrypt inner message
        let decryptedXml: string;
        try {
          decryptedXml = decryptMessage(encodingAESKey, encrypted);
        } catch {
          return new Response('Decrypt Failed', {status: 400});
        }

        // Parse inner XML
        const event = parseMessageXml(decryptedXml);

        // Dedup by MsgId
        const msgId = event.MsgId;
        if (msgId) {
          if (seenMsgIds.has(msgId)) {
            return new Response('success');
          }
          seenMsgIds.add(msgId);
          setTimeout(() => seenMsgIds.delete(msgId), DEDUP_TTL_MS);
        }

        // Handle template card event (HIL button press)
        if (event.MsgType === 'event' && event.Event === 'template_card_event') {
          if (onCardAction && event.EventKey && event.TaskId) {
            onCardAction(event.EventKey, event.TaskId, event.FromUserName);
          }
          return new Response('success');
        }

        // Handle text messages
        if (event.MsgType === 'text' && event.Content) {
          const inbound = normalizeWeComMessage(event, accountId, {xml: decryptedXml, event});
          onMessage(inbound).catch((err) => {
            console.error('[wecom] Error processing message:', err);
          });
        }

        return new Response('success');
      }

      return new Response('Method Not Allowed', {status: 405});
    },
  });

  return {
    async stop() {
      server.stop(true);
      seenMsgIds.clear();
    },
  };
}
