import {createMiddleware, type BaseMiddleware, type BeforeModelContext} from '@core/middleware';
import {formatSummaryRecord} from '@core/middleware/summary/format';
import {readSummaryRecord, resolveSummaryContext, splitMessagesForSummary, trimMessagesInPlace, writeSummaryRecord} from '@core/middleware/summary/state';
import type {SummaryInput, SummaryOptions} from '@core/middleware/summary/types';

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_KEEP_LAST_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 6_000;

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
  } satisfies SummaryInput);

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
