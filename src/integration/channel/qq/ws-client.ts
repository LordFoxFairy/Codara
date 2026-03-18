/**
 * OneBot v11 WebSocket client.
 *
 * Connects to an OneBot-compatible server (NapCat/Lagrange) in reverse-WS mode
 * (Codara is the WS client). Handles request/response matching via echo IDs
 * and dispatches inbound events to a registered handler.
 */

import type {OneBotApiRequest, OneBotApiResponse, OneBotEvent, OneBotMessageSegment} from './types';

const API_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class OneBotWsClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string,
    {resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>}
  >();
  private eventHandler: ((event: OneBotEvent) => void) | null = null;
  private running = false;
  private reconnectAttempts = 0;

  constructor(
    private readonly url: string,
    private readonly accessToken?: string,
  ) {}

  /** Connect to the OneBot WebSocket server. */
  async connect(): Promise<void> {
    this.running = true;
    this.reconnectAttempts = 0;
    await this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.accessToken
        ? `${this.url}${this.url.includes('?') ? '&' : '?'}access_token=${this.accessToken}`
        : this.url;

      const ws = new WebSocket(wsUrl);

      ws.addEventListener('open', () => {
        this.ws = ws;
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(String(event.data));
      });

      ws.addEventListener('close', () => {
        this.ws = null;
        this.clearPendingRequests('WebSocket connection closed');
        if (this.running) {
          this.scheduleReconnect();
        }
      });

      ws.addEventListener('error', (err) => {
        if (!this.ws) {
          // Connection never established
          reject(new Error(`WebSocket connection failed: ${this.url}`));
        }
        // Otherwise, the close event will handle reconnect
      });
    });
  }

  private handleMessage(raw: string): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // Ignore malformed messages
    }

    // API response — has echo field matching a pending request
    if (typeof data.echo === 'string' && this.pendingRequests.has(data.echo)) {
      const pending = this.pendingRequests.get(data.echo)!;
      this.pendingRequests.delete(data.echo);
      clearTimeout(pending.timer);

      const response = data as unknown as OneBotApiResponse;
      if (response.status === 'ok') {
        pending.resolve(response.data);
      } else {
        pending.reject(new Error(`OneBot API error: retcode=${response.retcode}`));
      }
      return;
    }

    // Event — dispatch to handler
    if (data.post_type && this.eventHandler) {
      this.eventHandler(data as unknown as OneBotEvent);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[qq] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
      return;
    }
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.min(this.reconnectAttempts, 6);
    console.warn(`[qq] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (this.running) {
        this.doConnect().catch((err) => {
          console.error('[qq] Reconnect failed:', err);
        });
      }
    }, delay);
  }

  private clearPendingRequests(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /** Send an API request and wait for the response. */
  async callApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const echo = `codara-${++this.requestId}`;
    const request: OneBotApiRequest = {action, params, echo};

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`OneBot API timeout: ${action} (${API_TIMEOUT_MS}ms)`));
      }, API_TIMEOUT_MS);

      this.pendingRequests.set(echo, {resolve, reject, timer});
      this.ws!.send(JSON.stringify(request));
    });
  }

  /** Register a handler for incoming OneBot events. */
  onEvent(handler: (event: OneBotEvent) => void): void {
    this.eventHandler = handler;
  }

  /** Close the WebSocket connection. */
  async disconnect(): Promise<void> {
    this.running = false;
    this.clearPendingRequests('Client disconnecting');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Whether the client is currently connected. */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Convenience Methods ──────────────────────────────────────────────

  async sendPrivateMsg(userId: number, message: OneBotMessageSegment[]): Promise<number> {
    const result = await this.callApi('send_private_msg', {user_id: userId, message});
    return (result as {message_id: number}).message_id;
  }

  async sendGroupMsg(groupId: number, message: OneBotMessageSegment[]): Promise<number> {
    const result = await this.callApi('send_group_msg', {group_id: groupId, message});
    return (result as {message_id: number}).message_id;
  }
}
