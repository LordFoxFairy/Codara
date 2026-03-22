/**
 * SSE Channel — implements the Channel interface over Server-Sent Events.
 *
 * Review requests are sent as SSE `review_required` events. Resumes arrive via
 * an external HTTP endpoint (POST /api/resume) that calls `resolveResume()`.
 */

import type {
  Channel,
  ChannelMessage,
  ChannelRuntimeEvent,
} from '@shared/contracts/channel';
import type {ReviewRequest, ReviewResumePayload} from '@shared/contracts/agent-types';

/** Default timeout for pending review requests (10 minutes). */
export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

export interface SSEChannelOptions {
  /** Channel instance id. */
  id?: string;
  /** SSE send function — writes an SSE frame to the connected client. */
  send: (event: {event: string; data: unknown; id?: string}) => void;
  /** Timeout for pending review requests in ms. Default: 10 minutes. */
  reviewTimeoutMs?: number;
}

interface PendingReview {
  request: ReviewRequest;
  resolve: (payload: ReviewResumePayload) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * A Channel implementation backed by SSE for outbound events
 * and a promise-based resume resolver for inbound responses.
 *
 * Lifecycle:
 * 1. Client connects via SSE → server creates SSEChannel
 * 2. review middleware pauses → `showReviewRequest()` sends SSE `review_required` event
 * 3. Client responds via POST → server calls `resolveResume(requestId, payload)`
 * 4. Promise resolves → review middleware continues
 */
export class SSEChannel implements Channel {
  readonly id: string;
  readonly type = 'web' as const;

  private readonly send: SSEChannelOptions['send'];
  private readonly reviewTimeoutMs: number;
  private readonly pendingReviews = new Map<string, PendingReview>();
  private disposed = false;

  constructor(options: SSEChannelOptions) {
    this.id = options.id ?? `sse-${crypto.randomUUID().slice(0, 8)}`;
    this.reviewTimeoutMs = options.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
    this.send = options.send;
  }

  async sendMessage(message: ChannelMessage): Promise<void> {
    if (this.disposed) return;
    try {
      this.send({event: 'message', data: message});
    } catch { /* client may have disconnected */ }
  }

  async showReviewRequest(request: ReviewRequest): Promise<ReviewResumePayload> {
    if (this.disposed) {
      return {decision: 'reject', reason: 'Channel disposed'};
    }

    // Send the review request as an SSE event
    try {
      this.send({
        event: 'review_required',
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
      throw new Error('Failed to send review request — SSE connection may be closed');
    }

    // Wait for the resume to come in via resolveResume(), with timeout
    return new Promise<ReviewResumePayload>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingReviews.has(request.id)) {
          this.pendingReviews.delete(request.id);
          resolve({decision: 'reject', reason: 'Review request timed out'});
        }
      }, this.reviewTimeoutMs);
      this.pendingReviews.set(request.id, {request, resolve, timer});
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
   * Resolves the pending review promise so the review middleware can continue.
   *
   * @returns true if the review was found and resolved, false otherwise.
   */
  resolveResume(requestId: string, payload: ReviewResumePayload): boolean {
    const pending = this.pendingReviews.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingReviews.delete(requestId);
    pending.resolve(payload);
    return true;
  }

  /** Check if there are any pending (unresolved) review requests. */
  hasPendingReviews(): boolean {
    return this.pendingReviews.size > 0;
  }

  /** Get all pending review request ids. */
  getPendingReviewIds(): string[] {
    return [...this.pendingReviews.keys()];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    // Resolve all pending reviews with a rejection-like payload
    for (const [id, pending] of this.pendingReviews) {
      clearTimeout(pending.timer);
      pending.resolve({decision: 'reject', reason: 'Channel disposed'});
      this.pendingReviews.delete(id);
    }
  }
}
