import {createMiddleware, type BaseMiddleware} from '@core/middleware/types';
import {refreshContextBudget, type ContextBudgetEstimator} from '@core/middleware/context-budget';
import {
  compactSummaryIfNeeded,
  normalizeSummaryOptions,
  type SummaryOptions,
} from '@core/middleware/summary';

const CODARA_KEY = 'codara';
const FORCE_COMPACT_KEY = 'forceCompactConversation';

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
        await compactSummaryIfNeeded(context, summary, {
          force: readForceCompactFlag(context.runtime.context),
        });
      }

      return undefined;
    },
  });
}

function readForceCompactFlag(context: Record<string, unknown>): boolean {
  const codara = context[CODARA_KEY];
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return false;
  }

  return (codara as Record<string, unknown>)[FORCE_COMPACT_KEY] === true;
}
