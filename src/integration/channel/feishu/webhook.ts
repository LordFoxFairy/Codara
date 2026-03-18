import {createHash} from 'node:crypto';
import type {InboundMessage, StopHandle} from '@gateway/types';
import type {FeishuEvent, FeishuMessageEvent, FeishuUrlVerificationEvent} from './types';

export interface FeishuWebhookOptions {
  port: number;
  path: string;
  encryptKey?: string;
  verifyToken?: string;
  accountId: string;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCardAction?: (actionId: string, actionValue: unknown, userId: string) => void;
}

/**
 * Verify Feishu webhook request signature.
 *
 * Feishu computes: SHA256(timestamp + nonce + encryptKey + body)
 */
export function verifySignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  body: string,
  signature: string,
): boolean {
  const computed = createHash('sha256')
    .update(timestamp + nonce + encryptKey + body)
    .digest('hex');
  return computed === signature;
}

/**
 * Normalize a Feishu message event into Codara's InboundMessage format.
 */
export function normalizeFeishuMessage(
  event: FeishuEvent,
  messageEvent: FeishuMessageEvent,
  accountId: string,
): InboundMessage {
  const senderId =
    messageEvent.sender.sender_id.open_id ??
    messageEvent.sender.sender_id.user_id ??
    messageEvent.sender.sender_id.union_id ??
    'unknown';

  const peerKind: 'direct' | 'group' = messageEvent.message.chat_type === 'p2p' ? 'direct' : 'group';

  // Parse content JSON — Feishu sends content as JSON string e.g. '{"text":"hello"}'
  let text = '';
  try {
    const content = JSON.parse(messageEvent.message.content);
    text = content.text ?? '';
  } catch {
    text = messageEvent.message.content;
  }

  return {
    channel: 'feishu',
    accountId,
    messageId: messageEvent.message.message_id,
    sender: {
      id: senderId,
      name: undefined, // Feishu events don't include sender name directly
    },
    peer: {
      kind: peerKind,
      id: messageEvent.message.chat_id,
    },
    text,
    replyToId: messageEvent.message.parent_id ?? undefined,
    threadId: messageEvent.message.root_id ?? undefined,
    timestamp: messageEvent.message.create_time
      ? Number(messageEvent.message.create_time)
      : Date.now(),
    raw: event,
  };
}

function isUrlVerification(event: unknown): event is {challenge: string; token: string; type: 'url_verification'} {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    (event as Record<string, unknown>).type === 'url_verification'
  );
}

function isMessageEvent(event: FeishuEvent): event is FeishuEvent & {event: FeishuMessageEvent} {
  return event.header?.event_type === 'im.message.receive_v1';
}

/**
 * Start a Feishu webhook HTTP server using Bun.serve.
 *
 * Handles:
 * 1. URL verification challenge
 * 2. Signature verification (when encryptKey is configured)
 * 3. im.message.receive_v1 events → InboundMessage normalization
 * 4. Card action callbacks
 */
export function startFeishuWebhook(options: FeishuWebhookOptions): StopHandle {
  const {port, path, encryptKey, verifyToken, accountId, onMessage, onCardAction} = options;

  // Dedup: Feishu may retry events; track seen event_ids
  const seenEventIds = new Set<string>();
  const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes

  const server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname !== path || req.method !== 'POST') {
        return new Response('Not Found', {status: 404});
      }

      const rawBody = await req.text();

      // Signature verification (if encryptKey is configured)
      if (encryptKey) {
        const timestamp = req.headers.get('X-Lark-Request-Timestamp') ?? '';
        const nonce = req.headers.get('X-Lark-Request-Nonce') ?? '';
        const signature = req.headers.get('X-Lark-Signature') ?? '';

        if (signature && !verifySignature(timestamp, nonce, encryptKey, rawBody, signature)) {
          return new Response('Invalid Signature', {status: 403});
        }
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return new Response('Bad Request', {status: 400});
      }

      // URL verification challenge
      if (isUrlVerification(body)) {
        if (verifyToken && (body as FeishuUrlVerificationEvent).token !== verifyToken) {
          return new Response('Invalid Token', {status: 403});
        }
        return Response.json({challenge: body.challenge});
      }

      const feishuEvent = body as FeishuEvent;

      // Dedup by event_id
      const eventId = feishuEvent.header?.event_id;
      if (eventId) {
        if (seenEventIds.has(eventId)) {
          return Response.json({code: 0, msg: 'ok'});
        }
        seenEventIds.add(eventId);
        setTimeout(() => seenEventIds.delete(eventId), DEDUP_TTL_MS);
      }

      // Card action callback (interactive card button press)
      if (feishuEvent.header?.event_type === 'card.action.trigger') {
        const actionEvent = feishuEvent.event as unknown as Record<string, unknown>;
        const action = actionEvent.action as Record<string, unknown> | undefined;
        const operator = actionEvent.operator as Record<string, unknown> | undefined;
        if (action && onCardAction) {
          const actionValue = action.value;
          const userId = (operator?.open_id as string) ?? 'unknown';
          onCardAction(String(action.tag ?? ''), actionValue, userId);
        }
        return Response.json({code: 0, msg: 'ok'});
      }

      // Message event
      if (isMessageEvent(feishuEvent)) {
        const inbound = normalizeFeishuMessage(feishuEvent, feishuEvent.event, accountId);
        if (inbound.text) {
          onMessage(inbound).catch((err) => {
            console.error('[feishu] Error processing message:', err);
          });
        }
      }

      return Response.json({code: 0, msg: 'ok'});
    },
  });

  return {
    async stop() {
      server.stop(true);
      seenEventIds.clear();
    },
  };
}
