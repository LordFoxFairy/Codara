/**
 * Review Channel Adapter — bridges review middleware with the Channel system.
 *
 * Creates review middleware option overrides that route review requests
 * through the ChannelRegistry instead of the default CLI interaction.
 */

import type {ReviewRequest, ReviewResumePayload} from '@shared/agent-types';
import type {ReviewMiddlewareOptions} from '@core/middleware/review';
import type {ChannelRegistry} from './registry';
import type {ToolCallContext} from '@core/pipeline/types';

/**
 * Create review middleware options that route review requests through the ChannelRegistry.
 *
 * Usage:
 * ```ts
 * const reviewOptions = {
 *   ...baseReviewOptions,
 *   ...createChannelReviewOptions(registry),
 * };
 * const middleware = createReviewMiddleware(reviewOptions);
 * ```
 */
export function createChannelReviewOptions(
  registry: ChannelRegistry,
): Pick<ReviewMiddlewareOptions, 'onPause' | 'resolveResume'> {
  return {
    async onPause(request: ReviewRequest, _context: ToolCallContext) {
      const channel = registry.resolveChannel(request);
      if (channel?.emitEvent) {
        try {
          channel.emitEvent({
            id: request.id,
            kind: 'review',
            phase: 'start',
            status: 'pending',
            label: request.description,
            detail: `${request.action.toolName}(${JSON.stringify(request.action.toolArgs)})`,
          });
        } catch { /* best-effort event forwarding */ }
      }
    },

    async resolveResume(request: ReviewRequest, _context: ToolCallContext): Promise<ReviewResumePayload | undefined> {
      const channel = registry.resolveChannel(request);
      if (!channel) {
        // No channel available — return undefined to let review middleware
        // fall through to its default review behavior (emit review ToolMessage).
        return undefined;
      }
      return channel.showReviewRequest(request);
    },
  };
}
