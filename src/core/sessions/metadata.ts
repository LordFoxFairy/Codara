import {AIMessage, type BaseMessage} from '@langchain/core/messages';
import type {AgentState} from '@core/agents';
import type {SessionMetadata} from '@core/sessions/types';

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

export function cloneSessionMetadata(
  metadata: Partial<SessionMetadata> | undefined,
): Partial<SessionMetadata> {
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

export function cloneForkSessionMetadata(
  metadata: Partial<SessionMetadata> | undefined,
): Partial<SessionMetadata> {
  const cloned = cloneSessionMetadata(metadata);
  delete cloned.usage;
  return cloned;
}

export function touchSessionMetadata(metadata: SessionMetadata, updatedAt: string): void {
  metadata.lastActivity = updatedAt;
}

export function updateSessionMetadataFromAgentState(
  metadata: SessionMetadata,
  agentState: AgentState,
): void {
  metadata.messageCount = agentState.messages.length;

  const lastMessage = agentState.messages[agentState.messages.length - 1];
  const lastText = readMessageText(lastMessage?.content);
  if (lastText) {
    metadata.lastMessage = lastText.slice(0, 200);
  } else {
    delete metadata.lastMessage;
  }

  if (!metadata.title) {
    const firstHuman = agentState.messages.find((message) => isMessageType(message, 'human'));
    const title = readMessageText(firstHuman?.content);
    if (title) {
      metadata.title = title.slice(0, 80);
    }
  }

  const currentContextWindow = readLatestContextWindow(agentState.messages);
  if (currentContextWindow) {
    metadata.contextWindow = currentContextWindow;
  } else {
    delete metadata.contextWindow;
  }
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

  void patch.contextWindow;
}

function readMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') {
        return [];
      }

      if ('type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string') {
        return [part.text];
      }

      return [];
    })
    .join('\n')
    .trim() || undefined;
}

function isMessageType(message: unknown, expected: string): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if ('_getType' in message && typeof message._getType === 'function') {
    return message._getType() === expected;
  }

  if ('type' in message && typeof message.type === 'string') {
    return message.type === expected;
  }

  return false;
}

function readLatestUsageTotals(messages: BaseMessage[]): SessionMetadata['usage'] | undefined {
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
    ...(lastPromptTokens !== undefined ? {lastPromptTokens} : {}),
    ...(lastCompletionTokens !== undefined ? {lastCompletionTokens} : {}),
    ...(lastTotalTokens !== undefined ? {lastTotalTokens} : {}),
  };
}

function readLatestContextWindow(
  messages: BaseMessage[],
): SessionMetadata['contextWindow'] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const responseMetadata = asRecord(message.response_metadata);
    const codara = asRecord(responseMetadata.codara);
    const snapshot = asRecord(codara.contextBudget);
    const maxInputTokens = readNumber(snapshot.maxInputTokens);
    const availableInputTokens = readNumber(snapshot.availableInputTokens);
    const estimatedInputTokens = readNumber(snapshot.estimatedInputTokens);

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
      overBudget: snapshot.overBudget === true,
    };
  }

  return undefined;
}

function readNewMessages(
  current: readonly BaseMessage[],
  previous?: readonly BaseMessage[],
): BaseMessage[] {
  if (!previous || previous.length === 0) {
    return [...current];
  }

  const anchor = previous[previous.length - 1];
  for (let index = current.length - 1; index >= 0; index -= 1) {
    if (messagesMatch(current[index], anchor)) {
      return current.slice(index + 1);
    }
  }

  return [...current];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
