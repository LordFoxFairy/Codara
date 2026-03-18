import type {Channel, ChannelMessage, ChannelRuntimeEvent, ChannelType} from '@shared/contracts/channel';
import type {PauseRequest, ResumePayload} from '@shared/contracts/agent-types';
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {PausePromptAction} from './types';

/**
 * Bridges the old Channel interface (used by ChannelRegistry/HIL middleware)
 * with the new ChannelPlugin system (used by Gateway).
 *
 * Each GatewayChannelBridge instance represents one active conversation
 * (one peer on one IM platform).
 */
export class GatewayChannelBridge implements Channel {
  readonly id: string;
  readonly type: ChannelType;

  private readonly pendingPauses = new Map<string, {resolve: (payload: ResumePayload) => void}>();

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

  async showPauseRequest(request: PauseRequest): Promise<ResumePayload> {
    const actions = buildPauseActions(request);
    const description = buildPauseDescription(request);

    // Register the pending pause BEFORE sending, so handlePauseResponse
    // can resolve it even if the user responds very quickly.
    const resultPromise = new Promise<ResumePayload>((resolve) => {
      this.pendingPauses.set(request.id, {resolve});

      // Auto-reject after 10 minutes
      setTimeout(() => {
        if (this.pendingPauses.has(request.id)) {
          this.pendingPauses.delete(request.id);
          resolve({decision: 'reject', reason: 'Timeout (10 min)'});
        }
      }, 10 * 60 * 1000);
    });

    if (this.plugin.sendPausePrompt) {
      await this.plugin.sendPausePrompt(this.account, {
        accountId: this.accountId,
        to: this.peerId,
        text: description,
        pause: request,
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
  handlePauseResponse(pauseId: string, decision: string): boolean {
    const pending = this.pendingPauses.get(pauseId);
    if (!pending) return false;
    this.pendingPauses.delete(pauseId);
    pending.resolve({decision: decision as 'approve' | 'reject' | 'edit'});
    return true;
  }

  /** Check whether this bridge has any pending pause requests. */
  hasPendingPauses(): boolean {
    return this.pendingPauses.size > 0;
  }

  emitEvent?(_event: ChannelRuntimeEvent): void {
    // Future: forward runtime events to IM as status messages
  }

  async dispose(): Promise<void> {
    for (const [, pending] of this.pendingPauses) {
      pending.resolve({decision: 'reject', reason: 'Channel disposed'});
    }
    this.pendingPauses.clear();
  }
}

// ── Helpers ──

function buildPauseActions(request: PauseRequest): PausePromptAction[] {
  const actions: PausePromptAction[] = [];

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

function buildPauseDescription(request: PauseRequest): string {
  const parts: string[] = [request.description ?? 'Agent \u8bf7\u6c42\u5ba1\u6279'];

  if (request.action) {
    parts.push(`\n\u5de5\u5177: ${request.action.toolName}`);
    if (request.action.toolArgs) {
      parts.push(`\n\u53c2\u6570: ${JSON.stringify(request.action.toolArgs).slice(0, 500)}`);
    }
  }

  return parts.join('');
}
