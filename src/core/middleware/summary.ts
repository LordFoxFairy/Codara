import {SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext} from '@core/agents';
import {readExecutionMetadata, type BeforeModelContext} from '@core/middleware';
import {
  estimateModelInputTokens,
  refreshContextBudget,
  type ContextBudgetEstimator,
} from '@core/middleware/context-budget';

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_KEEP_LAST_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_COMPACT_THRESHOLD_RATIO = 0.95;
const CODARA_KEY = 'codara';
const SUMMARY_KEY = 'summary';
const SUMMARY_HEADER = '# Conversation Summary';
const SUMMARY_INTRO = 'The following summary captures earlier conversation context that has been compacted.';

/** 摘要记录。 */
export interface SummaryRecord {
  content: string;
  updatedAt: string;
  summarizedMessages: number;
}

/** 传给摘要器的输入。 */
export interface SummaryInput {
  previousSummary?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  instructions?: string;
  threadId?: string;
  turn: number;
}

/** 摘要生成函数。 */
export type SummaryGenerator = (input: SummaryInput) => Promise<string> | string;

/** Conversation summary compaction 配置。 */
export interface SummaryOptions {
  summarize: SummaryGenerator;
  maxMessages?: number;
  keepLastMessages?: number;
  maxChars?: number;
  maxInputTokens?: number;
  compactThresholdRatio?: number;
  estimateTokens?: ContextBudgetEstimator;
}

/** 从当前消息状态中读取已持久化的摘要记录。 */
export function readSummaryRecord(messages: BaseMessage[]): SummaryRecord | undefined {
  const summaryMessage = readSummaryMessage(messages);
  if (!summaryMessage) {
    return undefined;
  }

  const metadata = readSummaryMetadata(summaryMessage);
  if (metadata) {
    return metadata;
  }

  const content = parseSummaryVisibleContent(summaryMessage.content);
  if (!content) {
    return undefined;
  }

  return {
    content,
    updatedAt: new Date().toISOString(),
    summarizedMessages: 0,
  };
}

export async function compactSummaryIfNeeded(
  context: BeforeModelContext,
  options: Required<SummaryOptions>,
  execution: {
    force?: boolean;
  } = {},
): Promise<void> {
  const executionMeta = readExecutionMetadata(context);

  while (shouldCompactHistory(context, options, execution.force === true)) {
    const summaryState = splitSummaryState(context.state.messages);
    const recentStart = resolveRecentStart(summaryState.conversationMessages, options.keepLastMessages);
    const olderMessages = summaryState.conversationMessages.slice(0, recentStart);
    if (olderMessages.length === 0) {
      return;
    }

    const nextSummary = await options.summarize({
      previousSummary: summaryState.summary?.content,
      messages: olderMessages,
      context: context.runtime.context,
      instructions: readCompactInstructions(context.runtime.context),
      threadId: executionMeta.threadId,
      turn: executionMeta.turn,
    });

    const summaryMessage = createSummaryMessage({
      content: nextSummary,
      updatedAt: new Date().toISOString(),
      summarizedMessages: (summaryState.summary?.summarizedMessages ?? 0) + olderMessages.length,
    }, options.maxChars);
    if (!summaryMessage) {
      return;
    }

    const recentMessages = summaryState.conversationMessages.slice(recentStart);
    context.state.messages = [
      ...summaryState.leadingSystemMessages,
      summaryMessage,
      ...recentMessages,
    ];
    context.messages.length = 0;
    context.messages.push(...context.state.messages);
    refreshContextBudget(context, options.estimateTokens);
  }
}

export function normalizeSummaryOptions(options: SummaryOptions): Required<SummaryOptions> {
  return normalizeOptions(options);
}

function splitSummaryState(messages: BaseMessage[]): {
  leadingSystemMessages: SystemMessage[];
  summary?: SummaryRecord;
  conversationMessages: BaseMessage[];
} {
  const leadingSystemMessages: SystemMessage[] = [];
  let index = 0;

  while (index < messages.length && isMessageType(messages[index], 'system')) {
    leadingSystemMessages.push(messages[index] as SystemMessage);
    index += 1;
  }

  let summary: SummaryRecord | undefined;
  const preservedSystemMessages: SystemMessage[] = [];

  for (const message of leadingSystemMessages) {
    const record = readSummaryRecord([message]);
    if (!summary && record) {
      summary = record;
      continue;
    }
    preservedSystemMessages.push(message);
  }

  return {
    leadingSystemMessages: preservedSystemMessages,
    summary,
    conversationMessages: messages.slice(index),
  };
}

function resolveRecentStart(messages: BaseMessage[], keepLastMessages: number): number {
  let start = Math.max(0, messages.length - keepLastMessages);

  while (start > 0 && isMessageType(messages[start], 'tool')) {
    start -= 1;
  }

  return start;
}

function readSummaryMessage(messages: BaseMessage[]): SystemMessage | undefined {
  for (const message of messages) {
    if (!isMessageType(message, 'system')) {
      break;
    }

    if (parseSummaryVisibleContent(message.content) || readSummaryMetadata(message)) {
      return message as SystemMessage;
    }
  }

  return undefined;
}

function createSummaryMessage(record: SummaryRecord, maxChars: number): SystemMessage | undefined {
  const trimmed = record.content.trim();
  if (!trimmed) {
    return undefined;
  }

  const truncated = trimmed.length > maxChars;
  const visibleContent = truncated ? `${trimmed.slice(0, maxChars)}\n\n[truncated]` : trimmed;

  return new SystemMessage({
    content: [
      SUMMARY_HEADER,
      '',
      SUMMARY_INTRO,
      '',
      visibleContent,
    ].join('\n'),
    additional_kwargs: {
      [CODARA_KEY]: {
        [SUMMARY_KEY]: {
          content: trimmed,
          updatedAt: record.updatedAt,
          summarizedMessages: record.summarizedMessages,
        },
      },
    },
  });
}

function parseSummaryVisibleContent(content: unknown): string | undefined {
  if (typeof content !== 'string') {
    return undefined;
  }

  const prefix = `${SUMMARY_HEADER}\n\n${SUMMARY_INTRO}\n\n`;
  if (!content.startsWith(prefix)) {
    return undefined;
  }

  const summary = content.slice(prefix.length).trim();
  return summary || undefined;
}

function readSummaryMetadata(message: BaseMessage): SummaryRecord | undefined {
  const additional = 'additional_kwargs' in message
    ? asRecord((message as {additional_kwargs?: unknown}).additional_kwargs)
    : {};
  const codara = asRecord(additional[CODARA_KEY]);
  const summary = asRecord(codara[SUMMARY_KEY]);
  const content = typeof summary.content === 'string' ? summary.content.trim() : '';
  if (!content) {
    return undefined;
  }

  return {
    content,
    updatedAt: typeof summary.updatedAt === 'string' ? summary.updatedAt : new Date().toISOString(),
    summarizedMessages: typeof summary.summarizedMessages === 'number' ? summary.summarizedMessages : 0,
  };
}

function isMessageType(message: BaseMessage | undefined, type: string): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  if ('type' in message && typeof (message as {type?: unknown}).type === 'string') {
    return (message as {type: string}).type === type;
  }

  return type === 'system' ? SystemMessage.isInstance(message) : false;
}

function normalizeOptions(options: SummaryOptions): Required<SummaryOptions> {
  if (typeof options.summarize !== 'function') {
    throw new Error('Summary summary configuration requires a summarize function');
  }

  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const keepLastMessages = options.keepLastMessages ?? DEFAULT_KEEP_LAST_MESSAGES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxInputTokens = options.maxInputTokens ?? 0;
  const compactThresholdRatio = options.compactThresholdRatio ?? DEFAULT_COMPACT_THRESHOLD_RATIO;
  const estimateTokens = options.estimateTokens ?? estimateModelInputTokens;

  if (maxMessages < 2) {
    throw new Error('Summary configuration maxMessages must be at least 2');
  }
  if (keepLastMessages < 1) {
    throw new Error('Summary configuration keepLastMessages must be at least 1');
  }
  if (keepLastMessages >= maxMessages) {
    throw new Error('Summary configuration keepLastMessages must be smaller than maxMessages');
  }
  if (maxChars < 1) {
    throw new Error('Summary configuration maxChars must be positive');
  }
  if (maxInputTokens < 0) {
    throw new Error('Summary configuration maxInputTokens must be zero or positive');
  }
  if (compactThresholdRatio <= 0 || compactThresholdRatio > 1) {
    throw new Error('Summary configuration compactThresholdRatio must be between 0 and 1');
  }

  return {
    summarize: options.summarize,
    maxMessages,
    keepLastMessages,
    maxChars,
    maxInputTokens,
    compactThresholdRatio,
    estimateTokens,
  };
}

function shouldCompactHistory(
  context: BeforeModelContext,
  options: Required<SummaryOptions>,
  force = false,
): boolean {
  const summaryState = splitSummaryState(context.state.messages);
  if (force) {
    return summaryState.conversationMessages.length > options.keepLastMessages;
  }

  if (summaryState.conversationMessages.length > options.maxMessages) {
    return true;
  }

  const maxInputTokens = options.maxInputTokens > 0
    ? options.maxInputTokens
    : (context.inputBudget?.maxInputTokens ?? 0);

  if (maxInputTokens < 1) {
    return false;
  }

  const estimate = context.budget?.estimatedInputTokens ?? options.estimateTokens({
    systemMessage: context.systemMessage,
    messages: context.state.messages,
  });
  const availableInputTokens = context.budget?.availableInputTokens
    ?? Math.max(0, maxInputTokens - (context.inputBudget?.reservedTokens ?? 0));
  const compactTriggerTokens = Math.max(1, Math.floor(availableInputTokens * options.compactThresholdRatio));

  return estimate >= compactTriggerTokens;
}

function readCompactInstructions(context: Record<string, unknown>): string | undefined {
  const codara = asRecord(context[CODARA_KEY]);
  const instructions = codara.compactInstructions;
  return typeof instructions === 'string' && instructions.trim()
    ? instructions.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? {...(value as Record<string, unknown>)} : {};
}
