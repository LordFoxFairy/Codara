import type {AgentInputBudget} from '@shared/agent-types';
import type {ContextBudgetSnapshot} from '@shared/execution-types';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext} from '@core/pipeline-types';
import {estimateModelInputTokens, type TokenEstimator, type TokenEstimateInput} from '@shared/token-estimate';

export type {ContextBudgetSnapshot} from '@shared/execution-types';
export {estimateModelInputTokens} from '@shared/token-estimate';

export type ContextBudgetEstimateInput = TokenEstimateInput;
export type ContextBudgetEstimator = TokenEstimator;

export interface BudgetMiddlewareOptions {
  estimateTokens?: ContextBudgetEstimator;
}

export function createBudgetMiddleware(
  options: BudgetMiddlewareOptions = {},
): BaseMiddleware {
  const estimateTokens = options.estimateTokens ?? estimateModelInputTokens;

  return createMiddleware({
    name: 'BudgetMiddleware',
    async beforeModel(context) {
      context.budget = refreshContextBudget(context, estimateTokens);
      return undefined;
    },
  });
}

export function refreshContextBudget(
  context: Pick<BeforeModelContext, 'systemMessage' | 'state' | 'inputBudget' | 'budget'>,
  estimateTokens: ContextBudgetEstimator = estimateModelInputTokens,
): ContextBudgetSnapshot | undefined {
  const snapshot = createContextBudgetSnapshot(context.inputBudget, {
    systemMessage: context.systemMessage,
    messages: context.state.messages,
  }, estimateTokens);

  context.budget = snapshot;
  return snapshot;
}

export function createContextBudgetSnapshot(
  inputBudget: AgentInputBudget | undefined,
  input: ContextBudgetEstimateInput,
  estimateTokens: ContextBudgetEstimator = estimateModelInputTokens,
): ContextBudgetSnapshot | undefined {
  const maxInputTokens = inputBudget?.maxInputTokens ?? 0;
  if (maxInputTokens < 1) {
    return undefined;
  }

  const reservedTokens = Math.max(0, inputBudget?.reservedTokens ?? 0);
  const availableInputTokens = Math.max(0, maxInputTokens - reservedTokens);
  const estimatedInputTokens = estimateTokens(input);

  return {
    maxInputTokens,
    reservedTokens,
    availableInputTokens,
    estimatedInputTokens,
    usagePercent: availableInputTokens > 0
      ? Math.round((estimatedInputTokens / availableInputTokens) * 100)
      : 0,
    overBudget: estimatedInputTokens > availableInputTokens,
  };
}

// estimateModelInputTokens and helpers are now in @shared/token-estimate
