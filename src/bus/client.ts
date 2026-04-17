/**
 * BusClient — WebSocket client SDK for connecting to a remote CodaraBus server.
 *
 * Used by CLI `--connect` mode and other remote consumers that communicate
 * with the Codara server over WebSocket instead of HTTP+SSE.
 *
 * Message format:
 *   Client → Server: JSON-encoded BusRequest
 *   Server → Client: JSON-encoded BusEvent
 *
 * Streaming/one-shot dispatch lives in `./client-stream`; this file covers
 * connection lifecycle, event routing, and the public request API.
 */

import type {BusRequest, BusEvent} from './types';
import {
  awaitOneShotEvent,
  iterateBusEventStream,
  type BusEventListener,
  type PendingRequest,
} from './client-stream';

const REQUEST_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const DISCONNECT_TIMEOUT_MS = 3_000;

export class BusClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<BusEventListener>>();
  private pendingRequests = new Map<string, PendingRequest>();
  private connected = false;

  constructor(private url: string) {}

  // ── Connection ───────────────────────────────────────────────────

  /**
   * Connect to the bus server via WebSocket.
   * Resolves when the connection is open and the `client.joined` event is received.
   */
  async connect(_info: {name: string; type: 'cli' | 'desktop' | 'agent'}): Promise<void> {
    if (this.connected) return;

    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.url.replace(/^http/, 'ws');
      this.ws = new WebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error(`Connection to ${wsUrl} timed out`));
      }, CONNECT_TIMEOUT_MS);

      this.ws.onopen = () => {
        // The server registers us on connection; we wait for client.joined.
      };

      this.ws.onmessage = (msg) => {
        let event: BusEvent;
        try {
          event = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
        } catch {
          return;
        }

        // Handle the initial join confirmation.
        if (!this.connected && event.type === 'client.joined') {
          this.connected = true;
          clearTimeout(connectTimeout);
          resolve();
        }

        this.dispatch(event);
      };

      this.ws.onerror = (err) => {
        if (!this.connected) {
          clearTimeout(connectTimeout);
          reject(new Error(`WebSocket error: ${err instanceof Error ? err.message : 'connection failed'}`));
        }
      };

      this.ws.onclose = (ev) => {
        this.connected = false;
        clearTimeout(connectTimeout);

        // Reject all pending requests.
        for (const pending of this.pendingRequests.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`WebSocket closed (code: ${ev.code})`));
        }
        this.pendingRequests.clear();

        reject(new Error(`WebSocket closed before connected (code: ${ev.code})`));
      };
    });
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;

    return new Promise<void>((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connected = false;
        resolve();
        return;
      }

      this.ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        resolve();
      };

      this.ws.close(1000, 'Client disconnecting');

      // Safety: resolve after timeout if close event doesn't fire.
      setTimeout(() => {
        this.connected = false;
        this.ws = null;
        resolve();
      }, DISCONNECT_TIMEOUT_MS);
    });
  }

  // ── Streaming requests ───────────────────────────────────────────

  /** Send a chat message. Yields BusEvents until done/error. */
  async *chat(prompt: string, sessionId?: string): AsyncGenerator<BusEvent> {
    const requestId = crypto.randomUUID();
    const request: BusRequest = {
      type: 'chat',
      requestId,
      prompt,
      ...(sessionId ? {sessionId} : {}),
    };
    yield* this.streamRequest(request, requestId);
  }

  /** Resume a blocked review. Returns an async generator of BusEvents. */
  async *resume(sessionId: string, action: string, input?: string): AsyncGenerator<BusEvent> {
    const requestId = crypto.randomUUID();
    const request: BusRequest = {
      type: 'resume',
      requestId,
      sessionId,
      action,
      ...(input !== undefined ? {input} : {}),
    };
    yield* this.streamRequest(request, requestId);
  }

  // ── One-shot requests ────────────────────────────────────────────

  /** Execute a slash command. */
  async command(command: string): Promise<{output: string; ok: boolean}> {
    const event = await this.oneShotRequest(
      (requestId) => ({type: 'command', requestId, command}),
      'command.result',
    );
    const ev = event as BusEvent & Record<string, unknown>;
    return {output: ev.output as string, ok: ev.ok as boolean};
  }

  /** List sessions. */
  async listSessions(): Promise<unknown[]> {
    const event = await this.oneShotRequest(
      (requestId) => ({type: 'sessions.list', requestId}),
      'sessions.list.result',
    );
    return (event as BusEvent & Record<string, unknown>).sessions as unknown[];
  }

  /** Create a new session. Returns the new sessionId. */
  async createSession(cwd?: string): Promise<string> {
    const event = await this.oneShotRequest(
      (requestId) => ({type: 'sessions.create', requestId, ...(cwd ? {cwd} : {})}),
      'sessions.create.result',
    );
    return (event as BusEvent & Record<string, unknown>).sessionId as string;
  }

  /** Get server status. */
  async status(): Promise<unknown> {
    const event = await this.oneShotRequest(
      (requestId) => ({type: 'status', requestId}),
      'status.result',
    );
    return (event as BusEvent & Record<string, unknown>).data;
  }

  // ── Session subscription ─────────────────────────────────────────

  /**
   * Subscribe to a session's events on the server.
   * After calling this, events for the given session will be forwarded to
   * any listeners registered via `on()`.
   */
  subscribe(sessionId: string): void {
    this.send({type: 'subscribe', sessionId} as BusRequest);
  }

  // ── Event listeners ──────────────────────────────────────────────

  /** Listen for specific event types. Returns an unsubscribe function. */
  on(eventType: string, listener: BusEventListener): () => void {
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(eventType);
    };
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private send(request: BusRequest): void {
    if (!this.ws || !this.connected) {
      throw new Error('BusClient is not connected');
    }
    this.ws.send(JSON.stringify(request));
  }

  /**
   * Dispatch a received BusEvent to type-specific listeners and to any
   * pending one-shot request whose requestId matches an `error` event.
   */
  private dispatch(event: BusEvent): void {
    this.notifyListeners(event.type, event);
    this.notifyListeners('*', event);
    this.rejectPendingOnError(event);
  }

  private notifyListeners(key: string, event: BusEvent): void {
    const listeners = this.listeners.get(key);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // One listener throwing must not break others.
      }
    }
  }

  private rejectPendingOnError(event: BusEvent): void {
    if (!('requestId' in event) || !event.requestId || event.type !== 'error') return;
    const pending = this.pendingRequests.get(event.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(event.requestId);
    pending.reject(new Error((event as BusEvent & Record<string, unknown>).message as string ?? 'Unknown bus error'));
  }

  private oneShotRequest(
    build: (requestId: string) => BusRequest,
    expectedType: string,
  ): Promise<BusEvent> {
    const requestId = crypto.randomUUID();
    return awaitOneShotEvent({
      request: build(requestId),
      requestId,
      expectedType,
      timeoutMs: REQUEST_TIMEOUT_MS,
      send: (request) => this.send(request),
      on: (type, listener) => this.on(type, listener),
      pending: this.pendingRequests,
    });
  }

  private streamRequest(request: BusRequest, requestId: string): AsyncGenerator<BusEvent> {
    return iterateBusEventStream({
      request,
      requestId,
      send: (r) => this.send(r),
      on: (type, listener) => this.on(type, listener),
    });
  }
}
