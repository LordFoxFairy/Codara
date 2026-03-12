import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import type {AgentInputBudget, AgentState} from '@core/agents';
import {estimateModelInputTokens} from '@core/middleware/budget';
import type {ModelInfo} from '@core/provider';
import {readMessageText} from '@core/shared/messages';
import type {SessionMetadata} from '@core/sessions/session';

export function createSessionMetadata(
  createdAt: string,
  restored?: Partial<SessionMetadata>,
  provided?: Partial<SessionMetadata>,
): SessionMetadata {
  return {
    messageCount: 0,
    lastActivity: createdAt,
    ...cloneSessionMetadata(restored),
    ...cloneSessionMetadata(provided),
  };
}

export function forkSessionMetadata(
  metadata: SessionMetadata,
  sessionId: string,
  threadId: string,
): Partial<SessionMetadata> {
  const cloned = cloneSessionMetadata(metadata);
  delete cloned.usage;
  return {...cloned, forkedFromSessionId: sessionId, forkedFromThreadId: threadId};
}

export function syncSessionMetadata(
  metadata: SessionMetadata,
  agentState: AgentState,
  options: {
    inputBudget?: AgentInputBudget;
    previousMessages?: readonly BaseMessage[];
    collectUsage?: boolean;
  } = {},
) {
  metadata.messageCount = agentState.messages.length;

  const lastText = readMessageText(agentState.messages.at(-1));
  if (lastText) {
    metadata.lastMessage = lastText.slice(0, 200);
  } else {
    delete metadata.lastMessage;
  }

  if (!metadata.title) {
    const firstHuman = agentState.messages.find(HumanMessage.isInstance);
    const title = readMessageText(firstHuman);
    if (title) {
      metadata.title = title.slice(0, 80);
    }
  }

  const contextWindow = readContextWindow(agentState.messages, options.inputBudget);
  if (contextWindow) {
    metadata.contextWindow = contextWindow;
  } else {
    delete metadata.contextWindow;
  }

  if (!options.collectUsage) {
    return;
  }

  const usage = readUsageTelemetry(agentState.messages, options.previousMessages);
  if (!usage) {
    return;
  }

  const current = metadata.usage ?? {modelCalls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0};
  current.modelCalls += usage.modelCalls;
  current.promptTokens += usage.promptTokens;
  current.completionTokens += usage.completionTokens;
  current.totalTokens += usage.totalTokens;
  current.lastPromptTokens = usage.lastPromptTokens;
  current.lastCompletionTokens = usage.lastCompletionTokens;
  current.lastTotalTokens = usage.lastTotalTokens;
  metadata.usage = current;
}

export function deriveSessionInputBudget(
  modelInfo: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'> | undefined,
): AgentInputBudget | undefined {
  if (!modelInfo?.contextWindow) {
    return undefined;
  }
  return {
    maxInputTokens: modelInfo.contextWindow,
    ...(typeof modelInfo.maxOutputTokens === 'number' ? {reservedTokens: modelInfo.maxOutputTokens} : {}),
  };
}

function cloneSessionMetadata(metadata: Partial<SessionMetadata> | undefined): Partial<SessionMetadata> {
  if (!metadata) {
    return {};
  }
  return {
    ...metadata,
    ...(metadata.tags ? {tags: [...metadata.tags]} : {}),
    ...(metadata.usage ? {usage: {...metadata.usage}} : {}),
    ...(metadata.contextWindow ? {contextWindow: {...metadata.contextWindow}} : {}),
  };
}

function readUsageTelemetry(
  currentMessages: readonly BaseMessage[],
  previousMessages?: readonly BaseMessage[],
): SessionMetadata['usage'] | undefined {
  const start = previousMessages && previousMessages.length > 0
    ? findLastMessageIndex(currentMessages, previousMessages.at(-1)) + 1
    : 0;

  let modelCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let lastPromptTokens: number | undefined;
  let lastCompletionTokens: number | undefined;
  let lastTotalTokens: number | undefined;

  for (const message of currentMessages.slice(start)) {
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const prompt = readFiniteNumber(message.usage_metadata, 'input_tokens')
      ?? readFiniteNumber(message.usage_metadata, 'prompt_tokens')
      ?? 0;
    const completion = readFiniteNumber(message.usage_metadata, 'output_tokens')
      ?? readFiniteNumber(message.usage_metadata, 'completion_tokens')
      ?? 0;
    const total = readFiniteNumber(message.usage_metadata, 'total_tokens') ?? (prompt + completion);

    if (prompt === 0 && completion === 0 && total === 0) {
      continue;
    }

    modelCalls += 1;
    promptTokens += prompt;
    completionTokens += completion;
    totalTokens += total;
    lastPromptTokens = prompt;
    lastCompletionTokens = completion;
    lastTotalTokens = total;
  }

  return modelCalls === 0 ? undefined : {
    modelCalls,
    promptTokens,
    completionTokens,
    totalTokens,
    ...(lastPromptTokens !== undefined ? {lastPromptTokens} : {}),
    ...(lastCompletionTokens !== undefined ? {lastCompletionTokens} : {}),
    ...(lastTotalTokens !== undefined ? {lastTotalTokens} : {}),
  };
}

function readContextWindow(
  messages: BaseMessage[],
  inputBudget?: AgentInputBudget,
): SessionMetadata['contextWindow'] | undefined {
  const maxInputTokens = inputBudget?.maxInputTokens ?? 0;
  if (messages.length === 0 || maxInputTokens < 1) {
    return undefined;
  }

  const availableInputTokens = Math.max(0, maxInputTokens - Math.max(0, inputBudget?.reservedTokens ?? 0));
  const estimatedInputTokens = estimateModelInputTokens({systemMessage: [], messages});
  return {
    maxInputTokens,
    availableInputTokens,
    estimatedInputTokens,
    usagePercent: availableInputTokens > 0 ? Math.round((estimatedInputTokens / availableInputTokens) * 1000) / 10 : 0,
    overBudget: estimatedInputTokens > availableInputTokens,
  };
}

function readFiniteNumber(
  usage: unknown,
  key: 'input_tokens' | 'prompt_tokens' | 'output_tokens' | 'completion_tokens' | 'total_tokens',
): number | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findLastMessageIndex(messages: readonly BaseMessage[], target: BaseMessage | undefined): number {
  if (!target) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (
      current.type === target.type &&
      current.id === target.id &&
      current.name === target.name &&
      JSON.stringify(current.content) === JSON.stringify(target.content) &&
      JSON.stringify((current as AIMessage).tool_calls ?? null) === JSON.stringify((target as AIMessage).tool_calls ?? null)
    ) {
      return index;
    }
  }

  return -1;
}
