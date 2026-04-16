/**
 * Cost tracking middleware.
 *
 * Records token usage from each model response into the session's CostTracker.
 * Runs in `afterModel` — the same stage where Claude Code's `addToTotalSessionCost()`
 * is called from the API response handler.
 *
 * The middleware reads `usage_metadata` from the LangChain AIMessage, which contains
 * `input_tokens` and `output_tokens` populated by the provider (Anthropic, OpenAI, etc.).
 *
 * The CostTracker instance is injected via `runtime.shared` to keep the middleware
 * stateless and the tracker lifecycle owned by the session/facade.
 */

import type {AIMessage} from '@langchain/core/messages';
import {createMiddleware} from '@core/pipeline-types';
import type {CostTracker} from '@observability/cost';

/** Well-known key used to store the CostTracker in middleware runtime.shared. */
export const COST_TRACKER_SHARED_KEY = 'costTracker';

export interface CostMiddlewareOptions {
  tracker: CostTracker;
}

/**
 * Extract token usage from a LangChain AIMessage's usage_metadata.
 * LangChain providers populate this with `input_tokens` / `output_tokens`
 * (and optionally cache tokens on Anthropic).
 */
function readTokenUsage(response: AIMessage): {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
} | undefined {
  const meta = response.usage_metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  const inputTokens =
    readFiniteNumber(meta, 'input_tokens') ??
    readFiniteNumber(meta, 'prompt_tokens') ??
    0;
  const outputTokens =
    readFiniteNumber(meta, 'output_tokens') ??
    readFiniteNumber(meta, 'completion_tokens') ??
    0;

  if (inputTokens === 0 && outputTokens === 0) return undefined;

  return {
    inputTokens,
    outputTokens,
    cacheReadInputTokens: readFiniteNumber(meta, 'cache_read_input_tokens') ?? 0,
    cacheCreationInputTokens: readFiniteNumber(meta, 'cache_creation_input_tokens') ?? 0,
  };
}

/**
 * Try to extract the model name from the AIMessage's response_metadata.
 * Providers typically include `model`, `model_name`, or `model_id` in response_metadata.
 */
function readModelName(response: AIMessage): string | undefined {
  const meta = response.response_metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;

  for (const key of ['model', 'model_name', 'model_id', 'modelId']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readFiniteNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createCostMiddleware(options: CostMiddlewareOptions) {
  const {tracker} = options;

  return createMiddleware({
    name: 'CostMiddleware',

    async beforeAgent(context) {
      // Inject tracker into runtime.shared so other middleware/tools can access it
      if (context.runtime.shared) {
        context.runtime.shared[COST_TRACKER_SHARED_KEY] = tracker;
      }
    },

    async afterModel(context) {
      const usage = readTokenUsage(context.response);
      if (!usage) return;

      const model = readModelName(context.response) ?? 'unknown';
      tracker.record({
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
      });
    },
  });
}
