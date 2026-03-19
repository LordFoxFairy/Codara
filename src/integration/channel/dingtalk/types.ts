/**
 * DingTalk Robot API types.
 *
 * Based on the DingTalk outgoing webhook + sessionWebhook reply model.
 * DingTalk robots receive messages via webhook and reply via a per-message
 * sessionWebhook URL that expires (typically 2 hours).
 */

// ── Inbound (webhook payload from DingTalk) ──────────────────────────

export interface DingTalkWebhookMessage {
  msgtype: 'text' | 'richText' | 'picture' | string;
  text?: {content: string};
  msgId: string;
  createAt: string;
  conversationType: '1' | '2'; // 1=direct, 2=group
  conversationId: string;
  conversationTitle?: string;
  senderId: string;
  senderNick: string;
  senderCorpId?: string;
  isAdmin?: boolean;
  chatbotUserId: string;
  isInAtList?: boolean;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
}

// ── Outbound (reply via sessionWebhook) ──────────────────────────────

export interface DingTalkTextPayload {
  msgtype: 'text';
  text: {content: string};
}

export interface DingTalkMarkdownPayload {
  msgtype: 'markdown';
  markdown: {title: string; text: string};
}

export interface DingTalkActionCardButton {
  title: string;
  actionURL: string;
}

export interface DingTalkActionCardPayload {
  msgtype: 'actionCard';
  actionCard: {
    title: string;
    text: string;
    btnOrientation: '0' | '1'; // 0=vertical, 1=horizontal
    btns: DingTalkActionCardButton[];
  };
}

export type DingTalkOutboundPayload =
  | DingTalkTextPayload
  | DingTalkMarkdownPayload
  | DingTalkActionCardPayload;

// ── Session webhook storage ──────────────────────────────────────────

export interface SessionWebhookEntry {
  webhook: string;
  expiresAt: number;
}

// ── Account config ───────────────────────────────────────────────────

export interface DingTalkAccountConfig {
  /** HMAC-SHA256 secret for verifying inbound webhooks. */
  appSecret: string;
  /** Port for the webhook HTTP server. */
  webhookPort?: number;
  /** URL path for the webhook endpoint (default: /dingtalk/webhook). */
  webhookPath?: string;
  /** Base URL for action card callback buttons (required for HIL). */
  callbackBaseUrl?: string;
}
