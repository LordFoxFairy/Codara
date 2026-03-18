/**
 * Slack Socket Mode WebSocket client.
 *
 * Connects via apps.connections.open, handles acknowledgement of envelopes,
 * dispatches message events and interactive payloads.
 *
 * Reference: https://api.slack.com/apis/connections/socket
 */

import type {
  SlackSocketEnvelope,
  SlackEventsApiPayload,
  SlackMessageEvent,
  SlackInteractivePayload,
} from './types';

const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface SlackSocketModeOptions {
  appToken: string;
  onMessage?: (event: SlackMessageEvent) => void;
  onInteraction?: (payload: SlackInteractivePayload) => void;
}

export class SlackSocketModeClient {
  private ws: WebSocket | null = null;
  private running = false;
  private reconnectAttempts = 0;

  private readonly appToken: string;
  private onMessage: ((event: SlackMessageEvent) => void) | null = null;
  private onInteraction: ((payload: SlackInteractivePayload) => void) | null = null;

  constructor(options: SlackSocketModeOptions) {
    this.appToken = options.appToken;
    this.onMessage = options.onMessage ?? null;
    this.onInteraction = options.onInteraction ?? null;
  }

  /** Connect to Slack via Socket Mode. */
  async connect(): Promise<void> {
    this.running = true;
    this.reconnectAttempts = 0;
    const url = await this.getSocketUrl();
    await this.doConnect(url);
  }

  /** Obtain a WebSocket URL via apps.connections.open. */
  private async getSocketUrl(): Promise<string> {
    const res = await fetch('https://slack.com/api/apps.connections.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = (await res.json()) as {ok: boolean; url?: string; error?: string};
    if (!data.ok || !data.url) {
      throw new Error(`Slack apps.connections.open failed: ${data.error ?? 'no url'}`);
    }
    return data.url;
  }

  private doConnect(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let resolved = false;

      ws.addEventListener('open', () => {
        this.ws = ws;
        this.reconnectAttempts = 0;
      });

      ws.addEventListener('message', (event) => {
        const envelope = this.parseEnvelope(String(event.data));
        if (!envelope) return;

        // Resolve on hello
        if (envelope.type === 'hello' && !resolved) {
          resolved = true;
          resolve();
          return;
        }

        this.handleEnvelope(envelope);
      });

      ws.addEventListener('close', () => {
        this.ws = null;
        if (this.running) {
          this.scheduleReconnect();
        }
      });

      ws.addEventListener('error', () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Slack Socket Mode connection failed'));
        }
      });
    });
  }

  private parseEnvelope(raw: string): SlackSocketEnvelope | null {
    try {
      return JSON.parse(raw) as SlackSocketEnvelope;
    } catch {
      return null;
    }
  }

  private handleEnvelope(envelope: SlackSocketEnvelope): void {
    // Always ACK first
    this.ack(envelope.envelope_id);

    if (envelope.type === 'disconnect') {
      // Server requests reconnect
      this.ws?.close();
      return;
    }

    if (envelope.type === 'events_api') {
      const payload = envelope.payload as SlackEventsApiPayload;
      if (payload.event?.type === 'message') {
        const event = payload.event as SlackMessageEvent;
        // Ignore bot messages (subtype or bot_id)
        if (event.subtype || event.bot_id) return;
        this.onMessage?.(event);
      }
      return;
    }

    if (envelope.type === 'interactive') {
      const payload = envelope.payload as SlackInteractivePayload;
      if (payload.type === 'block_actions') {
        this.onInteraction?.(payload);
      }
    }
  }

  /** Acknowledge an envelope by sending back its envelope_id. */
  private ack(envelopeId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({envelope_id: envelopeId}));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[slack] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 6);
    console.warn(`[slack] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(async () => {
      if (!this.running) return;
      try {
        const url = await this.getSocketUrl();
        await this.doConnect(url);
      } catch (err) {
        console.error('[slack] Reconnect failed:', err);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /** Disconnect from Slack Socket Mode. */
  async disconnect(): Promise<void> {
    this.running = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Whether the client is currently connected. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
