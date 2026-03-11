import {AIMessage, HumanMessage, type BaseMessage} from '@langchain/core/messages';
import {z} from 'zod';
import type {AgentState} from '@core/agents';
import type {SessionMetadata} from '@core/sessions/types';
import {readMessageText} from '@core/support/messages';

const usageMetadataSchema = z.object({
  input_tokens: z.number().finite().optional(),
  prompt_tokens: z.number().finite().optional(),
  output_tokens: z.number().finite().optional(),
  completion_tokens: z.number().finite().optional(),
  total_tokens: z.number().finite().optional(),
}).loose();

const contextBudgetSchema = z.object({
  maxInputTokens: z.number().finite(),
  availableInputTokens: z.number().finite(),
  estimatedInputTokens: z.number().finite(),
  overBudget: z.boolean().optional(),
}).loose();

const responseMetadataSchema = z.object({
  codara: z.object({
    contextBudget: contextBudgetSchema.optional(),
  }).loose().optional(),
}).loose();

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
  const lastText = readMessageText(lastMessage);
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

    const parsed = usageMetadataSchema.safeParse(message.usage_metadata);
    if (!parsed.success) {
      continue;
    }

    const prompt = parsed.data.input_tokens ?? parsed.data.prompt_tokens ?? 0;
    const completion = parsed.data.output_tokens ?? parsed.data.completion_tokens ?? 0;
    const total = parsed.data.total_tokens ?? (prompt + completion);

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

    const parsed = responseMetadataSchema.safeParse(message.response_metadata);
    const snapshot = parsed.success ? parsed.data.codara?.contextBudget : undefined;
    if (!snapshot) {
      continue;
    }

    return {
      maxInputTokens: snapshot.maxInputTokens,
      availableInputTokens: snapshot.availableInputTokens,
      estimatedInputTokens: snapshot.estimatedInputTokens,
      usagePercent: snapshot.availableInputTokens > 0
        ? Math.round((snapshot.estimatedInputTokens / snapshot.availableInputTokens) * 1000) / 10
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

  return left.type === right.type
    && left.id === right.id
    && left.name === right.name
    && JSON.stringify(left.content) === JSON.stringify(right.content)
    && JSON.stringify((left as AIMessage).tool_calls ?? null) === JSON.stringify((right as AIMessage).tool_calls ?? null);
}
