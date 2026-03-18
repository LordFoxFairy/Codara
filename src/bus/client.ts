/**
 * BusClient — WebSocket client SDK for connecting to a remote CodaraBus server.
 *
 * Used by CLI `--connect` mode and other remote consumers that communicate
 * with the Codara server over WebSocket instead of HTTP+SSE.
 *
 * Message format:
 *   Client → Server: JSON-encoded BusRequest
 *   Server → Client: JSON-encoded BusEvent
 */

import type {BusRequest, BusEvent} from './types';

// ── Types ────────────────────────────────────────────────────────────

type EventListener = (event: BusEvent) => void;

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 60_000;

// ── BusClient ────────────────────────────────────────────────────────

export class BusClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventListener>>();
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
      }, 10_000);

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
        for (const [_id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`WebSocket closed (code: ${ev.code})`));
        }
        this.pendingRequests.clear();

        if (!this.connected) {
          reject(new Error(`WebSocket closed before connected (code: ${ev.code})`));
        }
      };
    });
  }

  // ── Streaming requests ───────────────────────────────────────────

  /**
   * Send a chat message. Returns an async generator of BusEvents.
   * Yields streaming events (token, thinking, tool_call, runtime_event, paused)
   * and returns when `done` or `error` is received.
   */
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

  /**
   * Resume a paused session. Returns an async generator of BusEvents.
   */
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
    const requestId = crypto.randomUUID();
    const event = await this.sendAndWait(
      {type: 'command', requestId, command},
      requestId,
      'command.result',
    );
    const ev = event as BusEvent & Record<string, unknown>;
    return {output: ev.output as string, ok: ev.ok as boolean};
  }

  /** List sessions. */
  async listSessions(): Promise<unknown[]> {
    const requestId = crypto.randomUUID();
    const event = await this.sendAndWait(
      {type: 'sessions.list', requestId},
      requestId,
      'sessions.list.result',
    );
    return (event as BusEvent & Record<string, unknown>).sessions as unknown[];
  }

  /** Create a new session. Returns the new sessionId. */
  async createSession(cwd?: string): Promise<string> {
    const requestId = crypto.randomUUID();
    const event = await this.sendAndWait(
      {type: 'sessions.create', requestId, ...(cwd ? {cwd} : {})},
      requestId,
      'sessions.create.result',
    );
    return (event as BusEvent & Record<string, unknown>).sessionId as string;
  }

  /** Get server status. */
  async status(): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const event = await this.sendAndWait(
      {type: 'status', requestId},
      requestId,
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

  /**
   * Listen for specific event types. Returns an unsubscribe function.
   *
   * @example
   * const off = client.on('token', (e) => process.stdout.write(e.text));
   * // later:
   * off();
   */
  on(eventType: string, listener: EventListener): () => void {
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

  // ── Disconnect ───────────────────────────────────────────────────

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
      }, 3_000);
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private send(request: BusRequest): void {
    if (!this.ws || !this.connected) {
      throw new Error('BusClient is not connected');
    }
    this.ws.send(JSON.stringify(request));
  }

  /**
   * Dispatch a received BusEvent to type-specific listeners and
   * to pending one-shot request handlers.
   */
  private dispatch(event: BusEvent): void {
    // Notify type-specific listeners.
    const typeListeners = this.listeners.get(event.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          listener(event);
        } catch {
          // Listener errors are silently swallowed to avoid breaking the dispatch loop.
        }
      }
    }

    // Notify wildcard listeners.
    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener(event);
        } catch {
          // Silently swallowed.
        }
      }
    }

    // Resolve pending one-shot requests.
    if ('requestId' in event && event.requestId) {
      const pending = this.pendingRequests.get(event.requestId);
      if (pending) {
        if (event.type === 'error') {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(event.requestId);
          pending.reject(new Error((event as BusEvent & Record<string, unknown>).message as string ?? 'Unknown bus error'));
        }
        // One-shot result types resolve in sendAndWait via the listener mechanism.
      }
    }
  }

  /**
   * Send a request and wait for a specific result event type.
   * Used for non-streaming one-shot requests (command, listSessions, etc.).
   */
  private sendAndWait(request: BusRequest, requestId: string, expectedType: string): Promise<BusEvent> {
    return new Promise<BusEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        off();
        reject(new Error(`Request timed out waiting for ${expectedType}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {resolve: resolve as (value: unknown) => void, reject, timer});

      // Listen for the specific result event.
      const off = this.on('*', (event) => {
        if ('requestId' in event && event.requestId === requestId) {
          if (event.type === expectedType) {
            clearTimeout(timer);
            this.pendingRequests.delete(requestId);
            off();
            resolve(event);
          } else if (event.type === 'error') {
            clearTimeout(timer);
            this.pendingRequests.delete(requestId);
            off();
            reject(new Error((event as BusEvent & Record<string, unknown>).message as string ?? 'Unknown bus error'));
          }
        }
      });

      try {
        this.send(request);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        off();
        reject(err);
      }
    });
  }

  /**
   * Send a streaming request and yield events as an async generator.
   * Used for chat() and resume() which produce a stream of events
   * until a `done` or `error` event is received.
   */
  private async *streamRequest(request: BusRequest, requestId: string): AsyncGenerator<BusEvent> {
    // Buffer incoming events and signal when new ones arrive.
    const buffer: BusEvent[] = [];
    let finished = false;
    let _error: Error | null = null;
    let notifyResolve: (() => void) | null = null;

    const notify = (): void => {
      if (notifyResolve) {
        const r = notifyResolve;
        notifyResolve = null;
        r();
      }
    };

    const waitForEvent = (): Promise<void> => {
      if (buffer.length > 0 || finished) return Promise.resolve();
      return new Promise<void>((r) => {
        notifyResolve = r;
      });
    };

    // Listen for events matching this requestId, plus session-scoped streaming events.
    const off = this.on('*', (event) => {
      // Check if this event belongs to our request.
      const hasRequestId = 'requestId' in event && event.requestId === requestId;
      const isStreamEvent =
        event.type === 'token' ||
        event.type === 'thinking' ||
        event.type === 'tool_call' ||
        event.type === 'runtime_event';

      if (!hasRequestId && !isStreamEvent) return;

      if (event.type === 'done' && hasRequestId) {
        buffer.push(event);
        finished = true;
        notify();
      } else if (event.type === 'error' && hasRequestId) {
        _error = new Error((event as BusEvent & Record<string, unknown>).message as string ?? 'Unknown bus error');
        buffer.push(event);
        finished = true;
        notify();
      } else {
        buffer.push(event);
        notify();
      }
    });

    try {
      this.send(request);

      while (true) {
        await waitForEvent();

        while (buffer.length > 0) {
          yield buffer.shift()!;
        }

        if (finished) break;
      }
    } finally {
      off();
    }
  }
}
