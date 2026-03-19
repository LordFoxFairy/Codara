/**
 * HIL Channel Adapter — bridges HIL middleware with the Channel system.
 *
 * Creates HIL middleware option overrides that route pause requests
 * through the ChannelRegistry instead of the default CLI interaction.
 */

import type {PauseRequest, ResumePayload} from '@shared/contracts/agent-types';
import type {HILMiddlewareOptions} from '@core/middleware/hil';
import type {ChannelRegistry} from './registry';
import type {ToolCallContext} from '@core/pipeline/types';

/**
 * Create HIL middleware options that route pauses through the ChannelRegistry.
 *
 * Usage:
 * ```ts
 * const hilOptions = {
 *   ...baseHilOptions,
 *   ...createChannelHILOptions(registry),
 * };
 * const middleware = createHILMiddleware(hilOptions);
 * ```
 */
export function createChannelHILOptions(
  registry: ChannelRegistry,
): Pick<HILMiddlewareOptions, 'onPause' | 'resolveResume'> {
  return {
    async onPause(request: PauseRequest, _context: ToolCallContext) {
      const channel = registry.resolveChannel(request);
      if (channel?.emitEvent) {
        try {
          channel.emitEvent({
            id: request.id,
            kind: 'hil',
            phase: 'start',
            status: 'paused',
            label: request.description,
            detail: `${request.action.toolName}(${JSON.stringify(request.action.toolArgs)})`,
          });
        } catch { /* best-effort event forwarding */ }
      }
    },

    async resolveResume(request: PauseRequest, _context: ToolCallContext): Promise<ResumePayload | undefined> {
      const channel = registry.resolveChannel(request);
      if (!channel) {
        // No channel available — return undefined to let HIL middleware
        // fall through to its default pause behavior (emit pause ToolMessage).
        return undefined;
      }
      return channel.showPauseRequest(request);
    },
  };
}
