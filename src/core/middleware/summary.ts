import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import {z} from 'zod';
import type {AgentRuntimeContext} from '@core/agents';
import {
  createContextBudgetSnapshot,
  estimateModelInputTokens,
  type ContextBudgetEstimator,
} from '@core/middleware/budget';
import {createMiddleware, readExecutionMetadata, type BaseMiddleware, type BeforeModelContext} from '@core/middleware/types';

const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_KEEP_LAST_MESSAGES = 12;
const DEFAULT_MAX_CHARS = 6_000;
const DEFAULT_COMPACT_THRESHOLD_RATIO = 0.95;
const CODARA_KEY = 'codara';
const SUMMARY_KEY = 'summary';
const SUMMARY_HEADER = '# Conversation Summary';
const SUMMARY_INTRO = 'The following summary captures earlier conversation context that has been compacted.';

const summaryMetadataSchema = z.object({
  content: z.string().trim().min(1),
  updatedAt: z.string().optional(),
  summarizedMessages: z.number().optional(),
}).loose();

const additionalSummarySchema = z.object({
  codara: z.object({
    summary: summaryMetadataSchema.optional(),
  }).loose().optional(),
}).loose();

export interface SummaryRecord {
  content: string;
  updatedAt: string;
  summarizedMessages: number;
}

export interface SummaryInput {
  previousSummary?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  instructions?: string;
  threadId?: string;
  turn: number;
}

export type SummaryGenerator = (input: SummaryInput) => Promise<string> | string;

export interface SummarySettings {
  summarize?: SummaryGenerator;
  maxMessages?: number;
  keepLastMessages?: number;
  maxChars?: number;
  maxInputTokens?: number;
  compactThresholdRatio?: number;
  estimateTokens?: ContextBudgetEstimator;
}

export interface SummaryOptions extends SummarySettings {
  summarize: SummaryGenerator;
}

export interface SummaryMiddlewareOptions {
  summary: false | SummaryOptions;
}

export interface SummaryExecutionOptions {
  force?: boolean;
  instructions?: string;
}

export function createSummaryMiddleware(
  options: SummaryMiddlewareOptions,
): BaseMiddleware | undefined {
  if (!options.summary) {
    return undefined;
  }

  const summary = normalizeSummaryOptions(options.summary);
  return createMiddleware({
    name: 'SummaryMiddleware',
    async beforeModel(context) {
      await compactSummaryIfNeeded(context, summary);
      return undefined;
    },
  });
}

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
  execution: SummaryExecutionOptions = {},
): Promise<boolean> {
  const executionMeta = readExecutionMetadata(context);
  let changed = false;

  while (shouldCompactHistory(context, options, execution.force === true)) {
    const summaryState = splitSummaryState(context.state.messages);
    const recentStart = resolveRecentStart(summaryState.conversationMessages, options.keepLastMessages);
    const olderMessages = summaryState.conversationMessages.slice(0, recentStart);
    if (olderMessages.length === 0) {
      return changed;
    }

    const nextSummary = await options.summarize({
      previousSummary: summaryState.summary?.content,
      messages: olderMessages,
      context: context.runtime.context,
      instructions: execution.instructions,
      threadId: executionMeta.threadId,
      turn: executionMeta.turn,
    });

    const summaryMessage = createSummaryMessage({
      content: nextSummary,
      updatedAt: new Date().toISOString(),
      summarizedMessages: (summaryState.summary?.summarizedMessages ?? 0) + olderMessages.length,
    }, options.maxChars);
    if (!summaryMessage) {
      return changed;
    }

    const recentMessages = summaryState.conversationMessages.slice(recentStart);
    context.state.messages = [
      ...summaryState.leadingSystemMessages,
      summaryMessage,
      ...recentMessages,
    ];
    context.messages.length = 0;
    context.messages.push(...context.state.messages);
    context.budget = createContextBudgetSnapshot(context.inputBudget, {
      systemMessage: context.systemMessage,
      messages: context.state.messages,
    }, options.estimateTokens);
    changed = true;
  }

  return changed;
}

export function normalizeSummaryOptions(options: SummaryOptions): Required<SummaryOptions> {
  return resolveSummaryOptions(options);
}

export function resolveSummaryOptions(
  options: SummarySettings,
  defaultSummarize?: SummaryGenerator,
): Required<SummaryOptions> {
  const summarize = options.summarize ?? defaultSummarize;
  if (typeof summarize !== 'function') {
    throw new Error('Summary configuration requires a summarize function');
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
    summarize,
    maxMessages,
    keepLastMessages,
    maxChars,
    maxInputTokens,
    compactThresholdRatio,
    estimateTokens,
  };
}

export function createModelSummaryGenerator(model: BaseChatModel): SummaryGenerator {
  return async (input) => {
    const response = await model.invoke([
      new SystemMessage([
        'You compress earlier conversation context for a coding agent.',
        'Preserve requirements, decisions, constraints, unresolved questions, TODOs, file paths, commands, errors, and approvals.',
        'Return concise plain text only.',
      ].join(' ')),
      new HumanMessage(renderSummaryPrompt(input)),
    ]);

    const summary = stringifyContent(response.content).trim();
    if (!summary) {
      throw new Error('Summary model returned an empty summary.');
    }
    return summary;
  };
}

function splitSummaryState(messages: BaseMessage[]): {
  leadingSystemMessages: SystemMessage[];
  summary?: SummaryRecord;
  conversationMessages: BaseMessage[];
} {
  const leadingSystemMessages: SystemMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!SystemMessage.isInstance(message)) {
      break;
    }

    leadingSystemMessages.push(message);
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

  while (start > 0 && ToolMessage.isInstance(messages[start])) {
    start -= 1;
  }

  return start;
}

function readSummaryMessage(messages: BaseMessage[]): SystemMessage | undefined {
  for (const message of messages) {
    if (!SystemMessage.isInstance(message)) {
      break;
    }

    if (parseSummaryVisibleContent(message.content) || readSummaryMetadata(message)) {
      return message;
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
  const parsed = additionalSummarySchema.safeParse(message.additional_kwargs);
  const summary = parsed.success ? parsed.data.codara?.summary : undefined;
  if (!summary) {
    return undefined;
  }

  return {
    content: summary.content,
    updatedAt: summary.updatedAt ?? new Date().toISOString(),
    summarizedMessages: summary.summarizedMessages ?? 0,
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

function renderSummaryPrompt(input: SummaryInput): string {
  const sections = [
    input.instructions ? `Additional instructions:\n${input.instructions.trim()}` : undefined,
    input.previousSummary ? `Previous summary:\n${input.previousSummary.trim()}` : undefined,
    `Execution:\n- threadId: ${input.threadId ?? 'unknown'}\n- turn: ${input.turn}`,
    `Durable context:\n${stringifyContext(input.context)}`,
    `Messages to compact:\n${renderMessages(input.messages)}`,
  ].filter((value): value is string => Boolean(value));

  return [
    'Summarize the older conversation context for future turns.',
    'Keep the output factual and compact.',
    ...sections,
  ].join('\n\n');
}

function renderMessages(messages: BaseMessage[]): string {
  return messages.map((message, index) => {
    const content = stringifyContent(message.content);
    const extras: string[] = [];

    if ('tool_calls' in message && Array.isArray((message as {tool_calls?: unknown[]}).tool_calls)) {
      extras.push(`tool_calls=${JSON.stringify((message as {tool_calls?: unknown[]}).tool_calls)}`);
    }
    if ('additional_kwargs' in message && (message as {additional_kwargs?: unknown}).additional_kwargs) {
      extras.push(`additional_kwargs=${JSON.stringify((message as {additional_kwargs?: unknown}).additional_kwargs)}`);
    }

    return [
      `[${index + 1}] ${message.getType()}`,
      content || '(empty)',
      ...extras,
    ].join('\n');
  }).join('\n\n');
}

function stringifyContext(context: AgentRuntimeContext): string {
  return Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : '{}';
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
        return item.text;
      }
      return JSON.stringify(item);
    }).join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}
