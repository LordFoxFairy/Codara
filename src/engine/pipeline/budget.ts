import type {BaseMessage} from '@langchain/core/messages';
import type {AgentInputBudget} from '@shared/contracts/agent-types';
import type {ContextBudgetSnapshot} from '@shared/contracts/execution';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext} from '@engine/pipeline/types';

export type {ContextBudgetSnapshot} from '@shared/contracts/execution';

export interface ContextBudgetEstimateInput {
  systemMessage: string[];
  messages: BaseMessage[];
}

export type ContextBudgetEstimator = (input: ContextBudgetEstimateInput) => number;

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
    overBudget: estimatedInputTokens > availableInputTokens,
  };
}

export function estimateModelInputTokens(input: ContextBudgetEstimateInput): number {
  const systemTokens = input.systemMessage.reduce((total, content) => total + estimateTextTokens(content) + 4, 0);
  const messageTokens = input.messages.reduce((total, message) => total + estimateTextTokens(serializeMessageContent(message)) + 6, 0);
  return systemTokens + messageTokens;
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function serializeMessageContent(message: BaseMessage): string {
  const parts: string[] = [];
  const text = message.text.trim();

  if (text) {
    parts.push(text);
  }

  if ('tool_calls' in message && Array.isArray((message as {tool_calls?: unknown[]}).tool_calls)) {
    parts.push(JSON.stringify((message as {tool_calls?: unknown[]}).tool_calls));
  }

  if ('additional_kwargs' in message && (message as {additional_kwargs?: unknown}).additional_kwargs) {
    parts.push(JSON.stringify((message as {additional_kwargs?: unknown}).additional_kwargs));
  }

  return parts.join('\n');
}
