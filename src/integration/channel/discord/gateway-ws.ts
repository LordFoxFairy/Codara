/**
 * Discord Gateway WebSocket client.
 *
 * Handles IDENTIFY, heartbeat, reconnect with resume, and event dispatch.
 * Reference: https://discord.com/developers/docs/topics/gateway
 */

import type {
  GatewayPayload,
  GatewayHelloData,
  GatewayReadyData,
  DiscordMessage,
  DiscordInteraction,
} from './types';
import {GatewayOpcode, GatewayIntents} from './types';

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface DiscordGatewayOptions {
  botToken: string;
  onMessageCreate?: (message: DiscordMessage) => void;
  onInteractionCreate?: (interaction: DiscordInteraction) => void;
}

export class DiscordGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked = true;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private running = false;
  private reconnectAttempts = 0;

  private readonly botToken: string;
  private onMessageCreate: ((message: DiscordMessage) => void) | null = null;
  private onInteractionCreate: ((interaction: DiscordInteraction) => void) | null = null;

  constructor(options: DiscordGatewayOptions) {
    this.botToken = options.botToken;
    this.onMessageCreate = options.onMessageCreate ?? null;
    this.onInteractionCreate = options.onInteractionCreate ?? null;
  }

  /** Connect to the Discord Gateway. */
  async connect(): Promise<void> {
    this.running = true;
    this.reconnectAttempts = 0;
    await this.doConnect(GATEWAY_URL);
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
        const payload = this.parsePayload(String(event.data));
        if (!payload) return;

        this.handlePayload(payload);

        // Resolve once we receive READY or RESUMED
        if (!resolved && payload.op === GatewayOpcode.DISPATCH && (payload.t === 'READY' || payload.t === 'RESUMED')) {
          resolved = true;
          resolve();
        }
      });

      ws.addEventListener('close', () => {
        this.stopHeartbeat();
        this.ws = null;
        if (this.running) {
          this.scheduleReconnect();
        }
      });

      ws.addEventListener('error', () => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Discord Gateway connection failed: ${url}`));
        }
      });
    });
  }

  private parsePayload(raw: string): GatewayPayload | null {
    try {
      return JSON.parse(raw) as GatewayPayload;
    } catch {
      return null;
    }
  }

  private handlePayload(payload: GatewayPayload): void {
    // Track sequence number for heartbeat and resume
    if (payload.s !== null) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case GatewayOpcode.HELLO: {
        const data = payload.d as GatewayHelloData;
        this.startHeartbeat(data.heartbeat_interval);

        // IDENTIFY or RESUME
        if (this.sessionId) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case GatewayOpcode.HEARTBEAT_ACK:
        this.heartbeatAcked = true;
        break;

      case GatewayOpcode.HEARTBEAT:
        // Server requests immediate heartbeat
        this.sendHeartbeat();
        break;

      case GatewayOpcode.RECONNECT:
        // Server wants us to reconnect
        this.ws?.close();
        break;

      case GatewayOpcode.INVALID_SESSION: {
        const resumable = payload.d as boolean;
        if (!resumable) {
          // Cannot resume — reset session and re-identify
          this.sessionId = null;
          this.sequence = null;
          this.resumeGatewayUrl = null;
        }
        // Close and reconnect
        this.ws?.close();
        break;
      }

      case GatewayOpcode.DISPATCH:
        this.handleDispatch(payload);
        break;
    }
  }

  private handleDispatch(payload: GatewayPayload): void {
    switch (payload.t) {
      case 'READY': {
        const data = payload.d as GatewayReadyData;
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        break;
      }

      case 'MESSAGE_CREATE': {
        const message = payload.d as DiscordMessage;
        // Ignore messages from bots (including self)
        if (message.author.bot) return;
        this.onMessageCreate?.(message);
        break;
      }

      case 'INTERACTION_CREATE': {
        const interaction = payload.d as DiscordInteraction;
        this.onInteractionCreate?.(interaction);
        break;
      }
    }
  }

  private sendIdentify(): void {
    const intents =
      GatewayIntents.GUILDS |
      GatewayIntents.GUILD_MESSAGES |
      GatewayIntents.DIRECT_MESSAGES |
      GatewayIntents.MESSAGE_CONTENT;

    this.send({
      op: GatewayOpcode.IDENTIFY,
      d: {
        token: this.botToken,
        intents,
        properties: {os: 'linux', browser: 'codara', device: 'codara'},
      },
      s: null,
      t: null,
    });
  }

  private sendResume(): void {
    this.send({
      op: GatewayOpcode.RESUME,
      d: {
        token: this.botToken,
        session_id: this.sessionId,
        seq: this.sequence,
      },
      s: null,
      t: null,
    });
  }

  private sendHeartbeat(): void {
    this.send({
      op: GatewayOpcode.HEARTBEAT,
      d: this.sequence,
      s: null,
      t: null,
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAcked = true;

    // First heartbeat after jitter
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      if (!this.running) return;
      this.sendHeartbeat();

      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAcked) {
          // Missed ACK — zombie connection, reconnect
          console.warn('[discord] Heartbeat ACK missed, reconnecting');
          this.ws?.close();
          return;
        }
        this.heartbeatAcked = false;
        this.sendHeartbeat();
      }, intervalMs);
    }, jitter);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[discord] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 6);
    console.warn(`[discord] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.running) {
        const url = this.resumeGatewayUrl
          ? `${this.resumeGatewayUrl}?v=10&encoding=json`
          : GATEWAY_URL;
        this.doConnect(url).catch((err) => {
          console.error('[discord] Reconnect failed:', err);
        });
      }
    }, delay);
  }

  /** Disconnect from the Discord Gateway. */
  async disconnect(): Promise<void> {
    this.running = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.sequence = null;
    this.resumeGatewayUrl = null;
  }

  /** Whether the client is currently connected. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
