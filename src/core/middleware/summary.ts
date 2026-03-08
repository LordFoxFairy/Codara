import type {BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext} from '@core/agents';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext} from '@core/middleware';

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_KEEP_LAST_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 6_000;
const CODARA_KEY = 'codara';
const SUMMARY_KEY = 'summary';

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
  threadId?: string;
  turn: number;
}

/** 摘要生成函数。 */
export type SummaryGenerator = (input: SummaryInput) => Promise<string> | string;

/** SummaryMiddleware 配置。 */
export interface SummaryOptions {
  summarize: SummaryGenerator;
  maxMessages?: number;
  keepLastMessages?: number;
  maxChars?: number;
}

/** 创建对话摘要中间件。 */
export function createSummaryMiddleware(options: SummaryOptions): BaseMiddleware {
  const normalized = normalizeOptions(options);

  return createMiddleware({
    name: 'SummaryMiddleware',
    beforeModel: async (context) => {
      await maybeCompactHistory(context, normalized);
      injectSummary(context, normalized.maxChars);
    },
  });
}

/** 读取当前运行时中的摘要记录。 */
export function readSummaryRecord(context: AgentRuntimeContext): SummaryRecord | undefined {
  const codara = asRecord(context[CODARA_KEY]);
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

/** 将摘要记录写回运行时上下文。 */
export function writeSummaryRecord(context: AgentRuntimeContext, record: SummaryRecord): void {
  const codara = asRecord(context[CODARA_KEY]);
  context[CODARA_KEY] = {
    ...codara,
    [SUMMARY_KEY]: {
      content: record.content,
      updatedAt: record.updatedAt,
      summarizedMessages: record.summarizedMessages,
    },
  };
}

function splitMessagesForSummary(messages: BaseMessage[], keepLastMessages: number): BaseMessage[] {
  if (messages.length <= keepLastMessages) {
    return [];
  }
  return messages.slice(0, Math.max(0, messages.length - keepLastMessages));
}

function trimMessagesInPlace(messages: BaseMessage[], keepLastMessages: number): void {
  if (messages.length <= keepLastMessages) {
    return;
  }
  const removeCount = Math.max(0, messages.length - keepLastMessages);
  messages.splice(0, removeCount);
}

function resolveSummaryContext(
  agentContext: AgentRuntimeContext | undefined,
  runtimeContext: AgentRuntimeContext,
): AgentRuntimeContext {
  return agentContext ?? runtimeContext;
}

async function maybeCompactHistory(context: BeforeModelContext, options: Required<SummaryOptions>): Promise<void> {
  if (context.state.messages.length <= options.maxMessages) {
    return;
  }

  const olderMessages = splitMessagesForSummary(context.state.messages, options.keepLastMessages);
  if (olderMessages.length === 0) {
    return;
  }

  const summaryContext = resolveSummaryContext(context.runtime.agentContext, context.runtime.context);
  const previous = readSummaryRecord(summaryContext);
  const nextSummary = await options.summarize({
    previousSummary: previous?.content,
    messages: olderMessages,
    context: context.runtime.context,
    threadId: readThreadId(context.runtime.context),
    turn: context.turn,
  });

  const content = nextSummary.trim();
  if (!content) {
    return;
  }

  writeSummaryRecord(summaryContext, {
    content,
    updatedAt: new Date().toISOString(),
    summarizedMessages: olderMessages.length,
  });
  trimMessagesInPlace(context.state.messages, options.keepLastMessages);
}

function injectSummary(context: BeforeModelContext, maxChars: number): void {
  const summary = readSummaryRecord(resolveSummaryContext(context.runtime.agentContext, context.runtime.context));
  if (!summary) {
    return;
  }

  const formatted = formatSummaryRecord(summary, maxChars);
  if (formatted) {
    context.systemMessage.push(formatted);
  }
}

function formatSummaryRecord(record: SummaryRecord, maxChars: number): string {
  const trimmed = record.content.trim();
  if (!trimmed) {
    return '';
  }

  const truncated = trimmed.length > maxChars;
  const content = truncated ? `${trimmed.slice(0, maxChars)}\n\n[truncated]` : trimmed;

  return [
    '# Conversation Summary',
    '',
    'The following summary captures earlier conversation context that has been compacted.',
    '',
    content,
  ].join('\n');
}

function normalizeOptions(options: SummaryOptions): Required<SummaryOptions> {
  if (typeof options.summarize !== 'function') {
    throw new Error('SummaryMiddleware requires a summarize function');
  }

  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const keepLastMessages = options.keepLastMessages ?? DEFAULT_KEEP_LAST_MESSAGES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (maxMessages < 2) {
    throw new Error('SummaryMiddleware maxMessages must be at least 2');
  }
  if (keepLastMessages < 1) {
    throw new Error('SummaryMiddleware keepLastMessages must be at least 1');
  }
  if (keepLastMessages >= maxMessages) {
    throw new Error('SummaryMiddleware keepLastMessages must be smaller than maxMessages');
  }
  if (maxChars < 1) {
    throw new Error('SummaryMiddleware maxChars must be positive');
  }

  return {
    summarize: options.summarize,
    maxMessages,
    keepLastMessages,
    maxChars,
  };
}

function readThreadId(context: Record<string, unknown>): string | undefined {
  const value = context.threadId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? {...(value as Record<string, unknown>)} : {};
}
