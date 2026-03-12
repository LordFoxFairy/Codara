import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import type {AIMessage, ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {readLatestAssistantText, readMessageText} from '@core/shared/messages';
import {
  createMiddleware,
  readExecutionMetadata,
  type AfterAgentContext,
  type AfterModelContext,
  type BaseExecutionContext,
  type ToolCallContext,
} from '@core/middleware/types';

export type MiddlewareLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type MiddlewareLogEvent = 'stage_start' | 'stage_end' | 'stage_error';

export interface MiddlewareLogRecord {
  timestamp: string;
  level: MiddlewareLogLevel;
  middleware: string;
  stage: 'beforeAgent' | 'beforeModel' | 'wrapModelCall' | 'afterModel' | 'wrapToolCall' | 'afterAgent';
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

const LEVEL_PRIORITY: Record<MiddlewareLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LEVEL: MiddlewareLogLevel = 'info';
const responseMetadataSchema = z.record(z.string(), z.unknown());

/**
 * Built-in structured logging middleware.
 */
export function createLoggingMiddleware(options: LoggingMiddlewareOptions = {}) {
  const enabled = options.enabled ?? true;
  const minLevel = options.level ?? DEFAULT_LEVEL;
  const middlewareName = normalizeName(options.name);
  const sink = options.logger ?? defaultLogSink;

  const shouldLog = (level: MiddlewareLogLevel) => {
    return enabled && LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
  };

  const emit = (record: MiddlewareLogRecord) => {
    if (!shouldLog(record.level)) {
      return;
    }
    sink(record);
  };

  return createMiddleware({
    name: middlewareName,

    async beforeAgent(context) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'beforeAgent', 'stage_start', context));
      emit(buildBaseRecord('info', 'beforeAgent', 'stage_end', context, {durationMs: Date.now() - startedAt}));
    },

    async beforeModel(context) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'beforeModel', 'stage_start', context));
      emit(buildBaseRecord('info', 'beforeModel', 'stage_end', context, {durationMs: Date.now() - startedAt}));
    },

    async wrapModelCall(context, handler) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'wrapModelCall', 'stage_start', context));

      try {
        const response = await handler(context);
        emit(buildBaseRecord('info', 'wrapModelCall', 'stage_end', context, {
          ...modelResponseDetails(response),
          durationMs: Date.now() - startedAt,
        }));
        return response;
      } catch (error) {
        emit(buildErrorRecord('wrapModelCall', context, error, startedAt));
        throw error;
      }
    },

    async afterModel(context) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'afterModel', 'stage_start', context));
      emit(buildBaseRecord('info', 'afterModel', 'stage_end', context, {
        ...afterModelDetails(context),
        durationMs: Date.now() - startedAt,
      }));
    },

    async wrapToolCall(context, handler) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'wrapToolCall', 'stage_start', context, toolDetails(context)));

      try {
        const toolMessage = await handler(context);
        emit(buildBaseRecord('info', 'wrapToolCall', 'stage_end', context, {
          ...toolDetails(context),
          ...toolOutcomeDetails(toolMessage),
          durationMs: Date.now() - startedAt,
        }));
        return toolMessage;
      } catch (error) {
        emit(buildErrorRecord('wrapToolCall', context, error, startedAt, {
          ...toolDetails(context),
        }));
        throw error;
      }
    },

    async afterAgent(context) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'afterAgent', 'stage_start', context, {
        resultReason: context.result.reason,
      }));
      emit(buildBaseRecord('info', 'afterAgent', 'stage_end', context, {
        ...afterAgentDetails(context),
        durationMs: Date.now() - startedAt,
        resultReason: context.result.reason,
      }));
    },
  });

  function buildBaseRecord(
    level: MiddlewareLogLevel,
    stage: MiddlewareLogRecord['stage'],
    event: MiddlewareLogEvent,
    context: BaseExecutionContext,
    extra: Partial<MiddlewareLogRecord> = {},
  ): MiddlewareLogRecord {
    const execution = readExecutionMetadata(context);

    return {
      timestamp: new Date().toISOString(),
      level,
      middleware: middlewareName,
      stage,
      event,
      sessionId: execution.sessionId,
      runId: execution.runId,
      turn: execution.turn,
      requestId: execution.requestId,
      ...extra,
    };
  }

  function buildErrorRecord(
    stage: MiddlewareLogRecord['stage'],
    context: BaseExecutionContext,
    error: unknown,
    startedAt: number,
    extra: Partial<MiddlewareLogRecord> = {},
  ): MiddlewareLogRecord {
    return buildBaseRecord('error', stage, 'stage_error', context, {
      ...extra,
      durationMs: Date.now() - startedAt,
      errorName: toErrorName(error),
      errorMessage: toErrorMessage(error),
    });
  }
}

function toolDetails(
  context: ToolCallContext,
): Pick<MiddlewareLogRecord, 'toolName' | 'toolCallId' | 'toolIndex' | 'toolArgsText'> {
  const toolArgsText = serializeForLog(context.toolCall.args);
  return {
    toolName: context.toolCall.name,
    toolCallId: normalizeToolCallId(context),
    toolIndex: context.toolIndex,
    ...(toolArgsText ? {toolArgsText} : {}),
  };
}

function normalizeToolCallId(context: ToolCallContext): string {
  const id = context.toolCall.id;
  if (typeof id === 'string' && id.trim()) {
    return id;
  }
  return `tool_${context.toolIndex}`;
}

function normalizeName(name: string | undefined): string {
  const normalized = name?.trim();
  return normalized || 'LoggingMiddleware';
}

/**
 * Protocol-aware middleware can expose stable observability fields through
 * `response_metadata`. Logging stores those metadata verbatim for downstream
 * consumers instead of re-shaping protocol fields.
 */
function toolOutcomeDetails(
  message: ToolMessage,
): Pick<MiddlewareLogRecord, 'toolStatus' | 'toolMetadata' | 'toolContent' | 'toolArtifactType'> {
  const toolContent = serializeForLog(message.content);
  const details: Pick<MiddlewareLogRecord, 'toolStatus' | 'toolMetadata' | 'toolContent' | 'toolArtifactType'> = {
    toolStatus: message.status === 'error' ? 'error' : 'success',
    ...(toolContent ? {toolContent} : {}),
    ...(message.artifact !== undefined ? {toolArtifactType: describeArtifact(message.artifact)} : {}),
  };

  const parsed = responseMetadataSchema.safeParse(message.response_metadata);
  const metadata = parsed.success ? parsed.data : undefined;
  if (!metadata) {
    return details;
  }

  details.toolMetadata = metadata;

  return details;
}

function modelResponseDetails(response: AIMessage): Pick<MiddlewareLogRecord, 'responseText' | 'responseToolCallCount' | 'responseToolNames'> {
  const responseText = readMessageText(response);
  const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];

  return {
    ...(responseText ? {responseText} : {}),
    ...(toolCalls.length > 0 ? {
      responseToolCallCount: toolCalls.length,
      responseToolNames: toolCalls.map((toolCall) => toolCall.name).filter((name): name is string => Boolean(name)),
    } : {}),
  };
}

function afterModelDetails(context: AfterModelContext): Pick<MiddlewareLogRecord, 'responseText' | 'responseToolCallCount' | 'responseToolNames'> {
  return modelResponseDetails(context.response);
}

function afterAgentDetails(
  context: AfterAgentContext,
): Pick<MiddlewareLogRecord, 'messageCount' | 'lastAssistantText'> {
  const lastAssistantText = readLatestAssistantText(context.state.messages);
  return {
    messageCount: context.state.messages.length,
    ...(lastAssistantText ? {lastAssistantText} : {}),
  };
}

function toErrorName(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return 'Error';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function describeArtifact(artifact: unknown): string {
  if (artifact === null) {
    return 'null';
  }
  if (Array.isArray(artifact)) {
    return 'array';
  }
  if (artifact instanceof Error) {
    return artifact.name || 'Error';
  }
  if (typeof artifact === 'object' && artifact && 'constructor' in artifact) {
    const constructorName = (artifact as {constructor?: {name?: string}}).constructor?.name;
    return constructorName || 'object';
  }
  return typeof artifact;
}

function serializeForLog(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const text = typeof value === 'string'
    ? value
    : Array.isArray(value) || typeof value === 'object'
      ? safeJsonStringify(value)
      : String(value);

  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function defaultLogSink(record: MiddlewareLogRecord): void {
  // Keep default output machine-readable for log aggregation.
  console.log(JSON.stringify(record));
}

export function createDailySessionFileLogSink(options: {rootDir: string}): MiddlewareLogSink {
  const rootDir = path.resolve(options.rootDir);

  return (record) => {
    const filePath = resolveDailySessionLogPath(rootDir, record.sessionId, record.timestamp);
    mkdirSync(path.dirname(filePath), {recursive: true});
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  };
}

function resolveDailySessionLogPath(rootDir: string, sessionId: string, timestamp: string): string {
  const day = normalizeLogDay(timestamp);
  const sessionSegments = normalizeSessionLogSegments(sessionId);
  return path.join(rootDir, ...sessionSegments, 'logs', `${day}.log`);
}

function normalizeLogDay(timestamp: string): string {
  const day = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'unknown-date';
}

function normalizeSessionLogSegments(sessionId: string): string[] {
  const segments = sessionId
    .split(/[\\/]+/)
    .map((segment) => sanitizeLogPathSegment(segment.trim()))
    .filter(Boolean);

  return segments.length > 0 ? segments : ['unknown-session'];
}

function sanitizeLogPathSegment(segment: string): string {
  if (!segment || segment === '.' || segment === '..') {
    return '_';
  }

  const sanitized = segment.replace(/[<>:"|?*\u0000-\u001F]/g, '_');
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return '_';
  }
  return sanitized;
}
