/**
 * DingTalk Webhook Receiver — HTTP server for inbound robot messages.
 *
 * 1. Listens on configured port/path
 * 2. Verifies HMAC-SHA256 signature (timestamp + secret)
 * 3. Parses DingTalk message payload
 * 4. Normalizes to InboundMessage
 * 5. Stores sessionWebhook for later outbound replies
 * 6. Calls onMessage callback
 */

import {createHmac} from 'node:crypto';
import type {InboundMessage, StopHandle} from '@gateway/types';
import type {DingTalkWebhookMessage} from './types';
import type {DingTalkApi} from './api';

/** Maximum allowed timestamp skew (5 minutes). */
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export interface DingTalkWebhookOptions {
  accountId: string;
  appSecret: string;
  api: DingTalkApi;
  port: number;
  path: string;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onPauseCallback?: (action: string, id: string) => void;
  callbackBaseUrl?: string;
}

/**
 * Verify DingTalk webhook HMAC-SHA256 signature.
 *
 * DingTalk sends `timestamp` and `sign` headers. The signature is computed as:
 *   base64(hmac-sha256(secret, timestamp + "\n" + secret))
 */
export function verifyDingTalkSignature(
  timestamp: string,
  sign: string,
  secret: string,
): boolean {
  // Reject if timestamp is too old/future
  const ts = Number(timestamp);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_SKEW_MS) return false;

  const stringToSign = timestamp + '\n' + secret;
  const expected = createHmac('sha256', secret).update(stringToSign).digest('base64');
  return expected === sign;
}

/**
 * Normalize a DingTalk webhook message into Codara's InboundMessage format.
 */
export function normalizeDingTalkMessage(
  msg: DingTalkWebhookMessage,
  accountId: string,
): InboundMessage {
  const peerKind = msg.conversationType === '1' ? 'direct' as const : 'group' as const;
  const text = msg.text?.content?.trim() ?? '';

  return {
    channel: 'dingtalk',
    accountId,
    messageId: msg.msgId,
    sender: {
      id: msg.senderId,
      name: msg.senderNick,
    },
    peer: {
      kind: peerKind,
      id: msg.conversationId,
      name: msg.conversationTitle,
    },
    text,
    timestamp: Number(msg.createAt),
    raw: msg,
  };
}

/**
 * Start the DingTalk webhook HTTP server.
 *
 * Returns a StopHandle to gracefully shut down the server.
 */
export function startDingTalkWebhook(options: DingTalkWebhookOptions): StopHandle {
  const {accountId, appSecret, api, port, path, onMessage, onPauseCallback, callbackBaseUrl} = options;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Handle HIL action card callback
      if (callbackBaseUrl && url.pathname === `${path}/callback`) {
        const action = url.searchParams.get('action');
        const id = url.searchParams.get('id');
        if (action && id && onPauseCallback) {
          onPauseCallback(action, id);
        }
        return new Response('OK', {status: 200});
      }

      // Only accept POST to the configured webhook path
      if (req.method !== 'POST' || url.pathname !== path) {
        return new Response('Not Found', {status: 404});
      }

      // Verify signature
      const timestamp = req.headers.get('timestamp') ?? '';
      const sign = req.headers.get('sign') ?? '';

      if (!verifyDingTalkSignature(timestamp, sign, appSecret)) {
        return new Response('Forbidden', {status: 403});
      }

      // Parse body
      let body: DingTalkWebhookMessage;
      try {
        body = (await req.json()) as DingTalkWebhookMessage;
      } catch {
        return new Response('Bad Request', {status: 400});
      }

      // Store sessionWebhook for outbound replies
      api.setSession(
        body.conversationId,
        body.sessionWebhook,
        body.sessionWebhookExpiredTime,
      );

      // Normalize and dispatch
      const inbound = normalizeDingTalkMessage(body, accountId);
      if (inbound.text) {
        // Fire-and-forget — errors are logged, not returned to DingTalk
        onMessage(inbound).catch((err) => {
          console.error('[dingtalk] onMessage error:', err);
        });
      }

      // DingTalk expects a 200 response to acknowledge the webhook
      return Response.json({msgtype: 'empty'});
    },
  });

  console.log(`[dingtalk] Webhook server listening on :${port}${path}`);

  return {
    async stop() {
      server.stop(true);
      api.clearSessions();
    },
  };
}
