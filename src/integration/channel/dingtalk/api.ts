/**
 * DingTalk Robot API client.
 *
 * DingTalk robots reply via a per-message `sessionWebhook` URL included in
 * each inbound webhook payload. Unlike Telegram, there is no persistent bot API.
 * Session webhooks expire (typically 2 hours), so we maintain a per-conversation
 * store and refuse sends when the webhook has expired.
 */

import type {
  DingTalkOutboundPayload,
  DingTalkMarkdownPayload,
  DingTalkActionCardPayload,
  DingTalkActionCardButton,
  SessionWebhookEntry,
} from './types';

export class DingTalkApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(`DingTalk API error ${statusCode}: ${detail}`);
    this.name = 'DingTalkApiError';
  }
}

/**
 * Manages sessionWebhook storage and sends outbound messages.
 */
export class DingTalkApi {
  /** Map<conversationId, SessionWebhookEntry> */
  private readonly sessions = new Map<string, SessionWebhookEntry>();

  /** Store or update the sessionWebhook for a conversation. */
  setSession(conversationId: string, webhook: string, expiresAt: number): void {
    this.sessions.set(conversationId, {webhook, expiresAt});
  }

  /** Get the active sessionWebhook for a conversation, or undefined if expired/missing. */
  getSession(conversationId: string): string | undefined {
    const entry = this.sessions.get(conversationId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.sessions.delete(conversationId);
      return undefined;
    }
    return entry.webhook;
  }

  /** Send an arbitrary DingTalk outbound payload to the given sessionWebhook. */
  async send(sessionWebhook: string, payload: DingTalkOutboundPayload): Promise<void> {
    const res = await fetch(sessionWebhook, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'no body');
      throw new DingTalkApiError(res.status, body);
    }
  }

  /** Send a markdown message to a conversation. */
  async sendMarkdown(conversationId: string, title: string, text: string): Promise<void> {
    const webhook = this.getSession(conversationId);
    if (!webhook) {
      throw new DingTalkApiError(0, `No active sessionWebhook for conversation "${conversationId}"`);
    }
    const payload: DingTalkMarkdownPayload = {
      msgtype: 'markdown',
      markdown: {title, text},
    };
    await this.send(webhook, payload);
  }

  /** Send an ActionCard (for review buttons) to a conversation. */
  async sendActionCard(
    conversationId: string,
    title: string,
    text: string,
    buttons: DingTalkActionCardButton[],
  ): Promise<void> {
    const webhook = this.getSession(conversationId);
    if (!webhook) {
      throw new DingTalkApiError(0, `No active sessionWebhook for conversation "${conversationId}"`);
    }
    const payload: DingTalkActionCardPayload = {
      msgtype: 'actionCard',
      actionCard: {
        title,
        text,
        btnOrientation: '1',
        btns: buttons,
      },
    };
    await this.send(webhook, payload);
  }

  /** Remove expired sessions (housekeeping). */
  pruneExpiredSessions(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [id, entry] of this.sessions) {
      if (now >= entry.expiresAt) {
        this.sessions.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  /** Clear all sessions (used on shutdown). */
  clearSessions(): void {
    this.sessions.clear();
  }
}
