import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import type {AgentState} from '@core/agents';
import type {ContextBudgetSnapshot} from '@core/middleware/context-budget';
import type {SessionMetadata} from '@core/sessions/types';

const CODARA_KEY = 'codara';
const CONTEXT_BUDGET_KEY = 'contextBudget';

export interface SessionUsageTotals {
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  lastPromptTokens?: number;
  lastCompletionTokens?: number;
  lastTotalTokens?: number;
}

export interface SessionContextWindowTelemetry {
  maxInputTokens: number;
  availableInputTokens: number;
  estimatedInputTokens: number;
  usagePercent: number;
  overBudget: boolean;
}

export function buildSessionTelemetryPatch(
  state: AgentState,
  previousState?: Pick<AgentState, 'messages'>,
): Pick<SessionMetadata, 'usage' | 'contextWindow'> {
  const latestUsage = readLatestUsageTotals(readNewMessages(state.messages, previousState?.messages));
  const latestContext = readLatestContextWindow(state.messages);

  return {
    ...(latestUsage ? {usage: latestUsage} : {}),
    ...(latestContext ? {contextWindow: latestContext} : {}),
  };
}

export function mergeSessionTelemetry(
  metadata: SessionMetadata,
  patch: Pick<SessionMetadata, 'usage' | 'contextWindow'>,
): void {
  if (patch.usage) {
    const usage = metadata.usage ?? {
      modelCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    usage.modelCalls += patch.usage.modelCalls;
    usage.promptTokens += patch.usage.promptTokens;
    usage.completionTokens += patch.usage.completionTokens;
    usage.totalTokens += patch.usage.totalTokens;
    usage.lastPromptTokens = patch.usage.lastPromptTokens;
    usage.lastCompletionTokens = patch.usage.lastCompletionTokens;
    usage.lastTotalTokens = patch.usage.lastTotalTokens;
    metadata.usage = usage;
  }

  if (patch.contextWindow) {
    metadata.contextWindow = patch.contextWindow;
  }
}

export function attachContextBudgetMetadata(
  message: AIMessage,
  budget: ContextBudgetSnapshot | undefined,
): AIMessage {
  if (!budget) {
    return message;
  }

  const responseMetadata = asRecord(message.response_metadata);
  const codara = asRecord(responseMetadata[CODARA_KEY]);

  return new AIMessage({
    content: message.content,
    ...(message.id ? {id: message.id} : {}),
    ...(message.name ? {name: message.name} : {}),
    ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
    ...(message.invalid_tool_calls ? {invalid_tool_calls: message.invalid_tool_calls} : {}),
    ...(message.usage_metadata ? {usage_metadata: message.usage_metadata} : {}),
    ...(message.additional_kwargs ? {additional_kwargs: message.additional_kwargs} : {}),
    response_metadata: {
      ...responseMetadata,
      [CODARA_KEY]: {
        ...codara,
        [CONTEXT_BUDGET_KEY]: budget,
      },
    },
  });
}

function readLatestUsageTotals(messages: BaseMessage[]): SessionUsageTotals | undefined {
  let modelCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let lastPromptTokens: number | undefined;
  let lastCompletionTokens: number | undefined;
  let lastTotalTokens: number | undefined;

  for (const message of messages) {
    if (!AIMessage.isInstance(message) || !message.usage_metadata) {
      continue;
    }

    const usage = asRecord(message.usage_metadata);
    const prompt = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens) ?? 0;
    const completion = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens) ?? 0;
    const total = readNumber(usage.total_tokens) ?? (prompt + completion);

    modelCalls += 1;
    promptTokens += prompt;
    completionTokens += completion;
    totalTokens += total;
    lastPromptTokens = prompt;
    lastCompletionTokens = completion;
    lastTotalTokens = total;
  }

  if (modelCalls === 0) {
    return undefined;
  }

  return {
    modelCalls,
    promptTokens,
    completionTokens,
    totalTokens,
    lastPromptTokens,
    lastCompletionTokens,
    lastTotalTokens,
  };
}

function readLatestContextWindow(messages: BaseMessage[]): SessionContextWindowTelemetry | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const responseMetadata = asRecord(message.response_metadata);
    const codara = asRecord(responseMetadata[CODARA_KEY]);
    const budget = asRecord(codara[CONTEXT_BUDGET_KEY]);
    const maxInputTokens = readNumber(budget.maxInputTokens);
    const availableInputTokens = readNumber(budget.availableInputTokens);
    const estimatedInputTokens = readNumber(budget.estimatedInputTokens);

    if (
      maxInputTokens === undefined
      || availableInputTokens === undefined
      || estimatedInputTokens === undefined
    ) {
      continue;
    }

    return {
      maxInputTokens,
      availableInputTokens,
      estimatedInputTokens,
      usagePercent: availableInputTokens > 0
        ? Math.round((estimatedInputTokens / availableInputTokens) * 1000) / 10
        : 0,
      overBudget: budget.overBudget === true,
    };
  }

  return undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? {...(value as Record<string, unknown>)}
    : {};
}

function readNewMessages(messages: BaseMessage[], previousMessages: BaseMessage[] | undefined): BaseMessage[] {
  if (!previousMessages || previousMessages.length === 0) {
    return messages;
  }

  const anchor = previousMessages[previousMessages.length - 1];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messagesMatch(messages[index], anchor)) {
      return messages.slice(index + 1);
    }
  }

  return messages;
}

function messagesMatch(left: BaseMessage | undefined, right: BaseMessage | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return readMessageType(left) === readMessageType(right)
    && left.id === right.id
    && left.name === right.name
    && JSON.stringify(left.content) === JSON.stringify(right.content)
    && JSON.stringify((left as AIMessage).tool_calls ?? null) === JSON.stringify((right as AIMessage).tool_calls ?? null);
}

function readMessageType(message: BaseMessage): string | undefined {
  const candidate = message as BaseMessage & {
    getType?: () => string;
    _getType?: () => string;
    type?: string;
  };

  if (typeof candidate.getType === 'function') {
    return candidate.getType();
  }

  if (typeof candidate._getType === 'function') {
    return candidate._getType();
  }

  return candidate.type;
}
