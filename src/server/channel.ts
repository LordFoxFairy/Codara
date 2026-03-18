/**
 * SSE Channel — implements the Channel interface over Server-Sent Events.
 *
 * Pause requests are sent as SSE `paused` events. Resumes arrive via
 * an external HTTP endpoint (POST /api/resume) that calls `resolveResume()`.
 */

import type {
  Channel,
  ChannelMessage,
  ChannelRuntimeEvent,
} from '@shared/contracts/channel';
import type {PauseRequest, ResumePayload} from '@shared/contracts/agent-types';

/** Default timeout for pending pause requests (10 minutes). */
export const DEFAULT_PAUSE_TIMEOUT_MS = 10 * 60 * 1000;

export interface SSEChannelOptions {
  /** Channel instance id. */
  id?: string;
  /** SSE send function — writes an SSE frame to the connected client. */
  send: (event: {event: string; data: unknown; id?: string}) => void;
  /** Timeout for pending pause requests in ms. Default: 10 minutes. */
  pauseTimeoutMs?: number;
}

interface PendingPause {
  request: PauseRequest;
  resolve: (payload: ResumePayload) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A Channel implementation backed by SSE for outbound events
 * and a promise-based resume resolver for inbound responses.
 *
 * Lifecycle:
 * 1. Client connects via SSE → server creates SSEChannel
 * 2. HIL middleware pauses → `showPauseRequest()` sends SSE `paused` event
 * 3. Client responds via POST → server calls `resolveResume(requestId, payload)`
 * 4. Promise resolves → HIL middleware continues
 */
export class SSEChannel implements Channel {
  readonly id: string;
  readonly type = 'web' as const;

  private readonly send: SSEChannelOptions['send'];
  private readonly pauseTimeoutMs: number;
  private readonly pendingPauses = new Map<string, PendingPause>();
  private disposed = false;

  constructor(options: SSEChannelOptions) {
    this.id = options.id ?? `sse-${crypto.randomUUID().slice(0, 8)}`;
    this.pauseTimeoutMs = options.pauseTimeoutMs ?? DEFAULT_PAUSE_TIMEOUT_MS;
    this.send = options.send;
  }

  async sendMessage(message: ChannelMessage): Promise<void> {
    if (this.disposed) return;
    try {
      this.send({event: 'message', data: message});
    } catch { /* client may have disconnected */ }
  }

  async showPauseRequest(request: PauseRequest): Promise<ResumePayload> {
    if (this.disposed) {
      return {decision: 'reject', reason: 'Channel disposed'};
    }

    // Send the pause as an SSE event
    try {
      this.send({
        event: 'paused',
        data: {
          id: request.id,
          description: request.description,
          action: request.action,
          review: request.review,
          ui: request.ui,
          channel: request.channel,
        },
        id: request.id,
      });
    } catch {
      throw new Error('Failed to send pause request — SSE connection may be closed');
    }

    // Wait for the resume to come in via resolveResume(), with timeout
    return new Promise<ResumePayload>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingPauses.has(request.id)) {
          this.pendingPauses.delete(request.id);
          resolve({decision: 'reject', reason: 'Pause request timed out'});
        }
      }, this.pauseTimeoutMs);
      this.pendingPauses.set(request.id, {request, resolve, timer});
    });
  }

  emitEvent(event: ChannelRuntimeEvent): void {
    if (this.disposed) return;
    try {
      this.send({event: 'runtime_event', data: event, id: event.id});
    } catch { /* best-effort */ }
  }

  /**
   * Called by the HTTP endpoint (POST /api/resume) when the client responds.
   * Resolves the pending pause promise so the HIL middleware can continue.
   *
   * @returns true if the pause was found and resolved, false otherwise.
   */
  resolveResume(requestId: string, payload: ResumePayload): boolean {
    const pending = this.pendingPauses.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingPauses.delete(requestId);
    pending.resolve(payload);
    return true;
  }

  /** Check if there are any pending (unresolved) pause requests. */
  hasPendingPauses(): boolean {
    return this.pendingPauses.size > 0;
  }

  /** Get all pending pause request ids. */
  getPendingPauseIds(): string[] {
    return [...this.pendingPauses.keys()];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // Resolve all pending pauses with a rejection-like payload
    for (const [id, pending] of this.pendingPauses) {
      clearTimeout(pending.timer);
      pending.resolve({decision: 'reject', reason: 'Channel disposed'});
      this.pendingPauses.delete(id);
    }
  }
}
