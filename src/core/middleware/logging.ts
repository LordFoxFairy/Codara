import {createMiddleware, type BaseExecutionContext, type ToolCallContext} from '@core/middleware/types';

export type MiddlewareLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type MiddlewareLogEvent = 'stage_start' | 'stage_end' | 'stage_error';

export interface MiddlewareLogRecord {
  timestamp: string;
  level: MiddlewareLogLevel;
  middleware: string;
  stage: 'beforeAgent' | 'beforeModel' | 'wrapModelCall' | 'afterModel' | 'wrapToolCall' | 'afterAgent';
  event: MiddlewareLogEvent;
  runId: string;
  turn: number;
  requestId: string;
  durationMs?: number;
  toolName?: string;
  toolCallId?: string;
  toolIndex?: number;
  resultReason?: 'continue' | 'complete' | 'error';
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
      emit(buildBaseRecord('info', 'afterModel', 'stage_end', context, {durationMs: Date.now() - startedAt}));
    },

    async wrapToolCall(context, handler) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'wrapToolCall', 'stage_start', context, toolDetails(context)));

      try {
        const toolMessage = await handler(context);
        emit(buildBaseRecord('info', 'wrapToolCall', 'stage_end', context, {
          ...toolDetails(context),
          durationMs: Date.now() - startedAt,
        }));
        return toolMessage;
      } catch (error) {
        emit(buildErrorRecord('wrapToolCall', context, error, startedAt, toolDetails(context)));
        throw error;
      }
    },

    async afterAgent(context) {
      const startedAt = Date.now();
      emit(buildBaseRecord('debug', 'afterAgent', 'stage_start', context, {
        resultReason: context.result.reason,
      }));
      emit(buildBaseRecord('info', 'afterAgent', 'stage_end', context, {
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
    return {
      timestamp: new Date().toISOString(),
      level,
      middleware: middlewareName,
      stage,
      event,
      runId: context.runId,
      turn: context.turn,
      requestId: context.requestId,
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

function toolDetails(context: ToolCallContext): Pick<MiddlewareLogRecord, 'toolName' | 'toolCallId' | 'toolIndex'> {
  return {
    toolName: context.toolCall.name,
    toolCallId: normalizeToolCallId(context),
    toolIndex: context.toolIndex,
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

function defaultLogSink(record: MiddlewareLogRecord): void {
  // Keep default output machine-readable for log aggregation.
  console.log(JSON.stringify(record));
}
