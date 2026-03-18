import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {
  AgentInputBudget,
  AgentRuntimeContext,
  AgentRuntimeValues,
} from '@shared/contracts/agent-types';
import {estimateModelInputTokens} from '@engine/pipeline/budget';
import {
  createMiddleware,
  readExecutionMetadata,
  type BaseMiddleware,
  type BeforeModelContext,
  type MiddlewareRuntimeShared,
} from '@engine/pipeline/types';

const KEEP_LAST_MESSAGES = 2;
const AUTO_COMPACT_THRESHOLD = 0.80;

export interface SummaryInput {
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  instructions?: string;
  sessionId?: string;
  turn: number;
}

export type SummaryGenerator = (input: SummaryInput) => Promise<string> | string;

export interface SummarySettings {
  summarize?: SummaryGenerator;
}

export interface SummaryOptions {
  summarize: SummaryGenerator;
}

export interface SummaryMiddlewareOptions {
  summary: false | SummarySettings;
}

export interface SummaryExecutionOptions {
  force?: boolean;
  instructions?: string;
}

export interface SummaryCompactionInput {
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  systemMessage: string[];
  runtimeShared?: MiddlewareRuntimeShared;
  sessionId: string;
  requestId: string;
  inputBudget?: AgentInputBudget;
  instructions?: string;
}

export function createSummaryMiddleware(options: SummaryMiddlewareOptions): BaseMiddleware | undefined {
  if (!options.summary) {
    return undefined;
  }

  const summary = resolveSummaryOptions(options.summary);
  return createMiddleware({
    name: 'SummaryMiddleware',
    async beforeModel(context) {
      await compactSummaryIfNeeded(context, summary);
      return undefined;
    },
  });
}

export async function compactConversationWithSummary(
  input: SummaryCompactionInput,
  summary: SummaryOptions,
): Promise<{
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
} | undefined> {
  const context = createSummaryContext(input);
  const changed = await compactSummaryIfNeeded(context, summary, {
    force: true,
    instructions: input.instructions,
  });

  if (!changed) {
    return undefined;
  }

  return {
    messages: context.state.messages,
    context: input.context,
    values: input.values,
  };
}

async function compactSummaryIfNeeded(
  context: BeforeModelContext,
  options: SummaryOptions,
  execution: SummaryExecutionOptions = {},
): Promise<boolean> {
  const {systemMessages, conversationMessages} = splitMessages(context.state.messages);
  if (!shouldCompact(conversationMessages, context, execution.force === true)) {
    return false;
  }

  const retainedStart = findRetainedStart(conversationMessages);
  const compactedMessages = conversationMessages.slice(0, retainedStart);
  if (compactedMessages.length === 0) {
    return false;
  }

  const executionMeta = readExecutionMetadata(context);
  const summary = (await options.summarize({
    messages: compactedMessages,
    context: context.runtime.context,
    instructions: execution.instructions,
    sessionId: executionMeta.sessionId,
    turn: executionMeta.turn,
  })).trim();

  if (!summary) {
    return false;
  }

  const nextMessages = [
    ...systemMessages,
    new AIMessage(`Summary:\n${summary}`),
    ...conversationMessages.slice(retainedStart),
  ];
  context.state.messages = nextMessages;
  context.messages = nextMessages;
  return true;
}

export function resolveSummaryOptions(
  options: SummarySettings,
  defaultSummarize?: SummaryGenerator,
): SummaryOptions {
  const summarize = options.summarize ?? defaultSummarize;
  if (typeof summarize !== 'function') {
    throw new Error('Summary configuration requires a summarize function');
  }

  return {summarize};
}

export function createModelSummaryGenerator(model: BaseChatModel): SummaryGenerator {
  return async (input) => {
    const response = await model.invoke([
      new SystemMessage([
        'You compress earlier conversation context for a coding agent.',
        'Preserve requirements, decisions, constraints, unresolved questions, TODOs, file paths, commands, errors, and approvals.',
        'Return concise plain text only.',
      ].join(' ')),
      new HumanMessage(buildSummaryPrompt(input)),
    ]);

    const summary = response.text.trim();
    if (!summary) {
      throw new Error('Summary model returned an empty summary.');
    }
    return summary;
  };
}

function createSummaryContext(input: SummaryCompactionInput): BeforeModelContext {
  return {
    state: {
      messages: input.messages,
      context: input.context,
      values: input.values,
    },
    messages: input.messages,
    runtime: {
      context: input.context,
      runtimeContext: {},
      ...(input.runtimeShared ? {shared: input.runtimeShared} : {}),
    },
    systemMessage: [...input.systemMessage],
    execution: {
      sessionId: input.sessionId,
      runId: input.requestId,
      turn: 1,
      maxTurns: 1,
      requestId: input.requestId,
    },
    inputBudget: input.inputBudget,
  };
}

function splitMessages(messages: BaseMessage[]): {
  systemMessages: SystemMessage[];
  conversationMessages: BaseMessage[];
} {
  const systemMessages: SystemMessage[] = [];
  let index = 0;

  while (index < messages.length && SystemMessage.isInstance(messages[index])) {
    systemMessages.push(messages[index] as SystemMessage);
    index += 1;
  }

  return {
    systemMessages,
    conversationMessages: messages.slice(index),
  };
}

function findRetainedStart(messages: BaseMessage[]): number {
  let start = Math.max(0, messages.length - KEEP_LAST_MESSAGES);
  while (start > 0 && ToolMessage.isInstance(messages[start])) {
    start -= 1;
  }
  return start;
}

function shouldCompact(
  conversationMessages: BaseMessage[],
  context: BeforeModelContext,
  force: boolean,
): boolean {
  if (force) {
    return conversationMessages.length > KEEP_LAST_MESSAGES;
  }

  if (conversationMessages.length <= KEEP_LAST_MESSAGES) {
    return false;
  }

  const maxInputTokens = context.inputBudget?.maxInputTokens ?? 0;
  if (maxInputTokens < 1) {
    return false;
  }

  const usedTokens = estimateModelInputTokens({
    systemMessage: context.systemMessage,
    messages: context.state.messages,
  });
  const availableTokens = Math.max(0, maxInputTokens - Math.max(0, context.inputBudget?.reservedTokens ?? 0));
  return usedTokens >= Math.max(1, Math.floor(availableTokens * AUTO_COMPACT_THRESHOLD));
}

function buildSummaryPrompt(input: SummaryInput): string {
  const sections = [
    input.instructions ? `Additional instructions:\n${input.instructions.trim()}` : undefined,
    `Execution:\n- sessionId: ${input.sessionId ?? 'unknown'}\n- turn: ${input.turn}`,
    `Durable context:\n${Object.keys(input.context).length > 0 ? JSON.stringify(input.context, null, 2) : '{}'}`,
    `Messages to compact:\n${formatMessages(input.messages)}`,
  ].filter((value): value is string => Boolean(value));

  return [
    'Summarize the older conversation context for future turns.',
    'Keep the output factual and compact.',
    ...sections,
  ].join('\n\n');
}

function formatMessages(messages: BaseMessage[]): string {
  return messages.map((message, index) => [
    `[${index + 1}] ${message.type}`,
    message.text.trim() || '(empty)',
  ].join('\n')).join('\n\n');
}
