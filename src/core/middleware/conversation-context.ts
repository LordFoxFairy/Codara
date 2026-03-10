import {createMiddleware, type BaseMiddleware} from '@core/middleware/types';
import {refreshContextBudget, type ContextBudgetEstimator} from '@core/middleware/context-budget';
import {
  compactSummaryIfNeeded,
  normalizeSummaryOptions,
  type SummaryOptions,
} from '@core/middleware/summary';

export interface ConversationContextMiddlewareOptions {
  summary?: false | SummaryOptions;
  estimateTokens?: ContextBudgetEstimator;
}

/**
 * Codara conversation lifecycle middleware.
 *
 * It intentionally keeps input-budget refresh and optional summary compaction
 * in one stage so the default runtime no longer relies on two separate
 * middleware entries being ordered correctly.
 */
export function createConversationContextMiddleware(
  options: ConversationContextMiddlewareOptions = {},
): BaseMiddleware {
  const estimateTokens = options.estimateTokens;
  const summary = options.summary ? normalizeSummaryOptions(options.summary) : undefined;

  return createMiddleware({
    name: 'ConversationContextMiddleware',
    async beforeModel(context) {
      refreshContextBudget(context, estimateTokens);

      if (summary) {
        await compactSummaryIfNeeded(context, summary);
      }

      return undefined;
    },
  });
}
