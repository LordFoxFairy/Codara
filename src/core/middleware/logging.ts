import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import type {AIMessage, ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {readLatestAssistantText, readMessageText} from '@shared/messages';
import {
  createMiddleware,
  readExecutionMetadata,
  type AfterAgentContext,
  type AfterModelContext,
  type BaseExecutionContext,
  type ToolCallContext,
} from '@core/pipeline-types';

export type MiddlewareLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type MiddlewareLogEvent = 'stage_start' | 'stage_end' | 'stage_error';

export interface MiddlewareLogRecord {
  timestamp: string;
  level: MiddlewareLogLevel;
  middleware: string;
  stage: 'beforeAgent' | 'beforeModel' | 'wrapModelCall' | 'afterModel' | 'wrapToolCall' | 'assistantMessage' | 'toolMessage' | 'afterAgent';
  event: MiddlewareLogEvent;
  sessionId: string;
  runId: string;
  turn: number;
  requestId: string;
  durationMs?: number;
  toolName?: string;
  toolCallId?: string;
  toolIndex?: number;
  toolArgsText?: string;
  toolStatus?: 'success' | 'error';
  toolContent?: string;
  toolArtifactType?: string;
  toolMetadata?: Record<string, unknown>;
  messageType?: 'assistant' | 'tool';
  messageText?: string;
  resultReason?: 'continue' | 'complete' | 'error';
  responseText?: string;
  responseToolCallCount?: number;
  responseToolNames?: string[];
  messageCount?: number;
  lastAssistantText?: string;
  errorName?: string;
  errorMessage?: string;
}

export type MiddlewareLogSink = (record: MiddlewareLogRecord) => void;

export interface LoggingMiddlewareOptions {
  enabled?: boolean;
  level?: MiddlewareLogLevel;
  logger?: MiddlewareLogSink;
  name?: string;
}

const LEVEL_PRIORITY: Record<MiddlewareLogLevel, number> = {debug: 10, info: 20, warn: 30, error: 40};
const DEFAULT_LEVEL: MiddlewareLogLevel = 'info';
const responseMetadataSchema = z.record(z.string(), z.unknown());

/** Built-in structured logging middleware. */
export function createLoggingMiddleware(options: LoggingMiddlewareOptions = {}) {
  const enabled = options.enabled ?? true;
  const minLevel = options.level ?? DEFAULT_LEVEL;
  const middlewareName = options.name?.trim() || 'LoggingMiddleware';
  const sink = options.logger ?? ((r: MiddlewareLogRecord) => console.log(JSON.stringify(r)));

  const shouldLog = (level: MiddlewareLogLevel) => enabled && LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
  const emit = (record: MiddlewareLogRecord) => { if (shouldLog(record.level)) sink(record); };

  return createMiddleware({
    name: middlewareName,

    async beforeAgent(context) {
      const startedAt = Date.now();
      emit(baseRecord('debug', 'beforeAgent', 'stage_start', context));
      emit(baseRecord('info', 'beforeAgent', 'stage_end', context, {durationMs: Date.now() - startedAt}));
    },

    async beforeModel(context) {
      const startedAt = Date.now();
      emit(baseRecord('debug', 'beforeModel', 'stage_start', context));
      emit(baseRecord('info', 'beforeModel', 'stage_end', context, {durationMs: Date.now() - startedAt}));
    },

    async wrapModelCall(context, handler) {
      const startedAt = Date.now();
      emit(baseRecord('debug', 'wrapModelCall', 'stage_start', context));
      try {
        const response = await handler(context);
        emit(baseRecord('info', 'wrapModelCall', 'stage_end', context, {
          ...responseDetails(response), durationMs: Date.now() - startedAt,
        }));
        return response;
      } catch (error) {
        emit(errorRecord('wrapModelCall', context, error, startedAt));
        throw error;
      }
    },

    async afterModel(context) {
      const startedAt = Date.now();
      emit(baseRecord('debug', 'afterModel', 'stage_start', context));
      emit(baseRecord('info', 'afterModel', 'stage_end', context, {
        ...responseDetails(context.response), durationMs: Date.now() - startedAt,
      }));
      const text = readMessageText(context.response);
      if (text) emit(baseRecord('info', 'assistantMessage', 'stage_end', context, {messageType: 'assistant', messageText: text}));
    },

    async wrapToolCall(context, handler) {
      const startedAt = Date.now();
      const tool = toolDetails(context);
      emit(baseRecord('debug', 'wrapToolCall', 'stage_start', context, tool));
      try {
        const toolMessage = await handler(context);
        const outcome = toolOutcomeDetails(toolMessage);
        const toolContent = serializeForLog(toolMessage.content);
        emit(baseRecord('info', 'wrapToolCall', 'stage_end', context, {...tool, ...outcome, durationMs: Date.now() - startedAt}));
        emit(baseRecord('info', 'toolMessage', 'stage_end', context, {...tool, ...outcome, messageType: 'tool', ...(toolContent ? {messageText: toolContent} : {})}));
        return toolMessage;
      } catch (error) {
        emit(errorRecord('wrapToolCall', context, error, startedAt, tool));
        throw error;
      }
    },

    async afterAgent(context) {
      const startedAt = Date.now();
      const lastText = readLatestAssistantText(context.state.messages);
      emit(baseRecord('debug', 'afterAgent', 'stage_start', context, {resultReason: context.result.reason}));
      emit(baseRecord('info', 'afterAgent', 'stage_end', context, {
        messageCount: context.state.messages.length,
        ...(lastText ? {lastAssistantText: lastText} : {}),
        durationMs: Date.now() - startedAt,
        resultReason: context.result.reason,
      }));
    },
  });

  function baseRecord(
    level: MiddlewareLogLevel, stage: MiddlewareLogRecord['stage'],
    event: MiddlewareLogEvent, context: BaseExecutionContext,
    extra: Partial<MiddlewareLogRecord> = {},
  ): MiddlewareLogRecord {
    const exec = readExecutionMetadata(context);
    return {
      timestamp: new Date().toISOString(), level, middleware: middlewareName, stage, event,
      sessionId: exec.sessionId, runId: exec.runId, turn: exec.turn, requestId: exec.requestId,
      ...extra,
    };
  }

  function errorRecord(
    stage: MiddlewareLogRecord['stage'], context: BaseExecutionContext,
    error: unknown, startedAt: number, extra: Partial<MiddlewareLogRecord> = {},
  ): MiddlewareLogRecord {
    return baseRecord('error', stage, 'stage_error', context, {
      ...extra, durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? (error.name || 'Error') : 'Error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Helpers ──

function toolDetails(context: ToolCallContext): Pick<MiddlewareLogRecord, 'toolName' | 'toolCallId' | 'toolIndex' | 'toolArgsText'> {
  const toolArgsText = serializeForLog(context.toolCall.args);
  const id = context.toolCall.id;
  return {
    toolName: context.toolCall.name,
    toolCallId: typeof id === 'string' && id.trim() ? id : `tool_${context.toolIndex}`,
    toolIndex: context.toolIndex,
    ...(toolArgsText ? {toolArgsText} : {}),
  };
}

function toolOutcomeDetails(message: ToolMessage): Pick<MiddlewareLogRecord, 'toolStatus' | 'toolMetadata' | 'toolContent' | 'toolArtifactType'> {
  const toolContent = serializeForLog(message.content);
  const details: Pick<MiddlewareLogRecord, 'toolStatus' | 'toolMetadata' | 'toolContent' | 'toolArtifactType'> = {
    toolStatus: message.status === 'error' ? 'error' : 'success',
    ...(toolContent ? {toolContent} : {}),
    ...(message.artifact !== undefined ? {toolArtifactType: describeArtifact(message.artifact)} : {}),
  };
  const parsed = responseMetadataSchema.safeParse(message.response_metadata);
  if (parsed.success) details.toolMetadata = parsed.data;
  return details;
}

function responseDetails(response: AIMessage): Pick<MiddlewareLogRecord, 'responseText' | 'responseToolCallCount' | 'responseToolNames'> {
  const responseText = readMessageText(response);
  const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
  return {
    ...(responseText ? {responseText} : {}),
    ...(toolCalls.length > 0 ? {
      responseToolCallCount: toolCalls.length,
      responseToolNames: toolCalls.map((tc) => tc.name).filter((n): n is string => Boolean(n)),
    } : {}),
  };
}

function describeArtifact(artifact: unknown): string {
  if (artifact === null) return 'null';
  if (Array.isArray(artifact)) return 'array';
  if (artifact instanceof Error) return artifact.name || 'Error';
  if (typeof artifact === 'object' && artifact) return (artifact as {constructor?: {name?: string}}).constructor?.name || 'object';
  return typeof artifact;
}

function serializeForLog(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value
    : (Array.isArray(value) || typeof value === 'object') ? safeStringify(value) : String(value);
  const trimmed = text.trim();
  return trimmed || undefined;
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ── File log sink ──

export function createDailySessionFileLogSink(options: {rootDir: string}): MiddlewareLogSink {
  const rootDir = path.resolve(options.rootDir);
  return (record) => {
    const day = record.timestamp.slice(0, 10);
    const daySegment = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'unknown-date';
    const sessionSegments = record.sessionId
      .split(/[\\/]+/)
      .map((s) => sanitizePathSegment(s.trim()))
      .filter(Boolean);
    const filePath = path.join(rootDir, ...(sessionSegments.length > 0 ? sessionSegments : ['unknown-session']), 'logs', `${daySegment}.log`);
    mkdirSync(path.dirname(filePath), {recursive: true});
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  };
}

function sanitizePathSegment(segment: string): string {
  if (!segment || segment === '.' || segment === '..') return '_';
  const sanitized = segment.replace(/[\x00-\x1f<>:"|?*]/g, '_');
  return (!sanitized || sanitized === '.' || sanitized === '..') ? '_' : sanitized;
}
