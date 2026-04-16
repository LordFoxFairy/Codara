/**
 * @module gateway/channel-bridge
 *
 * Adapts the ChannelPlugin (gateway-level) to the Channel interface
 * (used by ChannelRegistry and review middleware). One bridge instance
 * represents a single active conversation (one peer, one IM platform).
 *
 * Handles review request presentation (inline buttons or text fallback)
 * and resolves review responses from user interactions.
 */

import type {Channel, ChannelMessage, ChannelRuntimeEvent, ChannelType} from '@shared/channel-types';
import type {ReviewRequest, ReviewResumePayload} from '@shared/agent-types';
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {ReviewPromptAction} from './types';
export class GatewayChannelBridge implements Channel {
  readonly id: string;
  readonly type: ChannelType;

  private readonly pendingReviews = new Map<string, {resolve: (payload: ReviewResumePayload) => void}>();

  constructor(
    private readonly plugin: ChannelPlugin,
    private readonly account: unknown,
    private readonly peerId: string,
    private readonly accountId: string,
    channelType: ChannelType,
  ) {
    this.id = `gateway:${channelType}:${accountId}:${peerId}`;
    this.type = channelType;
  }

  async sendMessage(message: ChannelMessage): Promise<void> {
    await this.plugin.sendText(this.account, {
      accountId: this.accountId,
      to: this.peerId,
      text: message.content,
    });
  }

  async showReviewRequest(request: ReviewRequest): Promise<ReviewResumePayload> {
    const actions = buildReviewActions(request);
    const description = buildReviewDescription(request);

    // Register the pending review BEFORE sending, so handleReviewResponse
    // can resolve it even if the user responds very quickly.
    const resultPromise = new Promise<ReviewResumePayload>((resolve) => {
      this.pendingReviews.set(request.id, {resolve});

      // Auto-reject after 10 minutes.
      setTimeout(() => {
        if (this.pendingReviews.has(request.id)) {
          this.pendingReviews.delete(request.id);
          resolve({decision: 'reject', reason: 'Timeout (10 min)'});
        }
      }, 10 * 60 * 1000);
    });

    if (this.plugin.sendReviewPrompt) {
      await this.plugin.sendReviewPrompt(this.account, {
        accountId: this.accountId,
        to: this.peerId,
        text: description,
        review: request,
        actions,
      });
    } else {
      // Fallback: send as plain text with action labels
      const actionLabels = actions.map((a) => a.label).join(' / ');
      await this.plugin.sendText(this.account, {
        accountId: this.accountId,
        to: this.peerId,
        text: `${description}\n\n${actionLabels}`,
      });
    }

    return resultPromise;
  }

  /** Called by Gateway when the user clicks a button or replies with a decision. */
  handleReviewResponse(reviewId: string, decision: string): boolean {
    const pending = this.pendingReviews.get(reviewId);
    if (!pending) return false;
    this.pendingReviews.delete(reviewId);
    pending.resolve({decision: decision as 'approve' | 'reject' | 'edit'});
    return true;
  }

  /** Check whether this bridge has any pending review requests. */
  hasPendingReviews(): boolean {
    return this.pendingReviews.size > 0;
  }

  emitEvent?(_event: ChannelRuntimeEvent): void {
    // Future: forward runtime events to IM as status messages
  }

  async dispose(): Promise<void> {
    for (const [, pending] of this.pendingReviews) {
      pending.resolve({decision: 'reject', reason: 'Channel disposed'});
    }
    this.pendingReviews.clear();
  }
}

// ── Helpers ──

function buildReviewActions(request: ReviewRequest): ReviewPromptAction[] {
  const actions: ReviewPromptAction[] = [];

  if (request.review?.allowedDecisions) {
    for (const decision of request.review.allowedDecisions) {
      if (decision === 'approve') {
        actions.push({id: 'approve', label: '\u2705 \u6279\u51c6', style: 'approve'});
      } else if (decision === 'reject') {
        actions.push({id: 'reject', label: '\u274c \u62d2\u7edd', style: 'reject'});
      } else if (decision === 'edit') {
        actions.push({id: 'edit', label: '\u270f\ufe0f \u7f16\u8f91', style: 'edit'});
      }
    }
  }

  if (actions.length === 0) {
    actions.push(
      {id: 'approve', label: '\u2705 \u6279\u51c6', style: 'approve'},
      {id: 'reject', label: '\u274c \u62d2\u7edd', style: 'reject'},
    );
  }

  return actions;
}

function buildReviewDescription(request: ReviewRequest): string {
  const parts: string[] = [request.description ?? 'Agent \u8bf7\u6c42\u5ba1\u6279'];

  if (request.action) {
    parts.push(`\n\u5de5\u5177: ${request.action.toolName}`);
    if (request.action.toolArgs) {
      parts.push(`\n\u53c2\u6570: ${JSON.stringify(request.action.toolArgs).slice(0, 500)}`);
    }
  }

  return parts.join('');
}
