/**
 * 中间件管道。
 *
 * 职责：
 * - 管理中间件注册表（use/list/has/get/remove）
 * - 调度 6 个中间件阶段
 * - 执行 contextSchema 校验
 */

import type {AIMessage, ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {applyAgentStateUpdate} from '@core/agents/models/command';
import type {AgentRuntimeContext} from '@core/agents/models/agent';
import {
  type AfterAgentContext,
  type AfterModelContext,
  type BaseExecutionContext,
  type BaseMiddleware,
  type BeforeAgentContext,
  type BeforeModelContext,
  createMiddleware,
  type ModelCallContext,
  type ModelCallHandler,
  type ToolCallContext,
  type ToolCallHandler
} from '@core/middleware/types';

const recordSchema = z.record(z.string(), z.unknown());

export class MiddlewarePipeline {
  private readonly middlewares: ReadonlyArray<BaseMiddleware>;

  constructor(middlewares: BaseMiddleware[] = []) {
    const normalized = middlewares.map((middleware) => createMiddleware(middleware));
    assertNoDuplicateNames(normalized);
    this.middlewares = Object.freeze(normalized);
  }

  list(): ReadonlyArray<Readonly<BaseMiddleware>> {
    return Object.freeze([...this.middlewares]) as ReadonlyArray<Readonly<BaseMiddleware>>;
  }

  has(name: string): boolean {
    return this.middlewares.some((middleware) => middleware.name === name);
  }

  get(name: string): Readonly<BaseMiddleware> | undefined {
    const middleware = this.middlewares.find((middleware) => middleware.name === name);
    return middleware as Readonly<BaseMiddleware> | undefined;
  }

  validateContext(context: AgentRuntimeContext): void {
    for (const middleware of this.middlewares) {
      const schema = middleware.contextSchema;
      if (!schema) {
        continue;
      }

      const parsed = schema.safeParse(context);
      if (!parsed.success) {
        throw new Error(`Middleware "${middleware.name}" context validation failed: ${parsed.error.message}`);
      }
    }
  }

  getTools(): ReadonlyArray<StructuredToolInterface> {
    return this.middlewares.flatMap((middleware) => middleware.tools ?? []);
  }

  createInitialValues(seed: Record<string, unknown> = {}): Record<string, unknown> {
    const defaults = this.middlewares.reduce<Record<string, unknown>>((values, middleware) => {
      const schema = middleware.stateSchema;
      if (!schema) {
        return values;
      }

      const parsed = schema.safeParse({});
      const defaults = parsed.success ? recordSchema.safeParse(parsed.data) : {success: false} as const;
      if (!defaults.success) {
        return values;
      }

      return {...values, ...defaults.data};
    }, {});

    return this.normalizeValues({...defaults, ...cloneRecord(seed)});
  }

  normalizeValues(values: Record<string, unknown> = {}): Record<string, unknown> {
    let normalized = cloneRecord(values);

    for (const middleware of this.middlewares) {
      const schema = middleware.stateSchema;
      if (!schema) {
        continue;
      }

      const parsed = schema.safeParse(normalized);
      if (!parsed.success) {
        throw new Error(`Middleware "${middleware.name}" state validation failed: ${parsed.error.message}`);
      }

      const nextState = recordSchema.safeParse(parsed.data);
      if (!nextState.success) {
        continue;
      }

      normalized = {
        ...normalized,
        ...nextState.data,
      };
    }

    return normalized;
  }

  async beforeAgent(context: BeforeAgentContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'beforeAgent', context, (middleware) => middleware.beforeAgent, (stageContext, update) =>
      this.applyUpdate(stageContext, update)
    );
  }

  async beforeModel(context: BeforeModelContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'beforeModel', context, (middleware) => middleware.beforeModel, (stageContext, update) =>
      this.applyUpdate(stageContext, update)
    );
  }

  wrapModelCall(context: ModelCallContext, handler: ModelCallHandler): Promise<AIMessage> {
    return runWrappedStage(
      this.middlewares,
      'wrapModelCall',
      context,
      handler,
      (middleware) => middleware.wrapModelCall
    );
  }

  async afterModel(context: AfterModelContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'afterModel', context, (middleware) => middleware.afterModel, (stageContext, update) =>
      this.applyUpdate(stageContext, update)
    );
  }

  wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
    return runWrappedStage(
      this.middlewares,
      'wrapToolCall',
      context,
      handler,
      (middleware) => middleware.wrapToolCall
    );
  }

  async afterAgent(context: AfterAgentContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'afterAgent', context, (middleware) => middleware.afterAgent, (stageContext, update) =>
      this.applyUpdate(stageContext, update)
    );
  }

  private applyUpdate(
    context: BaseExecutionContext,
    update: Parameters<typeof applyAgentStateUpdate>[1]
  ): void {
    applyAgentStateUpdate(context.state, update, context.runtime);

    if (update?.values) {
      context.state.values = this.normalizeValues(context.state.values ?? {});
    }
  }
}

type MiddlewareStageName =
  | 'beforeAgent'
  | 'beforeModel'
  | 'wrapModelCall'
  | 'afterModel'
  | 'wrapToolCall'
  | 'afterAgent';

class MiddlewareError extends Error {
  constructor(
    public readonly middlewareName: string,
    public readonly stage: MiddlewareStageName,
    public readonly cause: Error
  ) {
    super(`Middleware "${middlewareName}" failed in ${stage}: ${cause.message}`);
    this.name = 'MiddlewareError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiddlewareError);
    }
  }
}

function assertNoDuplicateNames(middlewares: ReadonlyArray<BaseMiddleware>): void {
  const seen = new Set<string>();
  for (const middleware of middlewares) {
    if (seen.has(middleware.name)) {
      throw new Error(`Duplicate middleware name: ${middleware.name}`);
    }
    seen.add(middleware.name);
  }
}

type SimpleStageHook<TContext, TUpdate> = (context: TContext) => Promise<TUpdate | void> | TUpdate | void;
type WrappedStageHook<TContext, TResult> = (
  context: TContext,
  handler: (request?: TContext) => Promise<TResult>
) => Promise<TResult>;

async function runSimpleStage<TContext, TUpdate>(
  middlewares: ReadonlyArray<BaseMiddleware>,
  stage: MiddlewareStageName,
  context: TContext,
  pickHook: (
    middleware: BaseMiddleware
  ) => SimpleStageHook<TContext, TUpdate> | undefined,
  applyUpdate?: (context: TContext, update: TUpdate) => void
): Promise<void> {
  for (const middleware of middlewares) {
    const hook = pickHook(middleware);
    if (!hook) {
      continue;
    }

    try {
      const update = await hook(context);
      if (update !== undefined && applyUpdate) {
        applyUpdate(context, update);
      }
    } catch (error) {
      throw createStageError(middleware.name, stage, error);
    }
  }
}

async function runWrappedStage<TContext, TResult>(
  middlewares: ReadonlyArray<BaseMiddleware>,
  stage: MiddlewareStageName,
  context: TContext,
  baseHandler: (request?: TContext) => Promise<TResult>,
  pickHook: (
    middleware: BaseMiddleware
  ) => WrappedStageHook<TContext, TResult> | undefined
): Promise<TResult> {
  const wrappers: Array<{
    middleware: BaseMiddleware;
    hook: WrappedStageHook<TContext, TResult>;
  }> = [];

  for (const middleware of middlewares) {
    const hook = pickHook(middleware);
    if (hook) {
      wrappers.push({middleware, hook});
    }
  }

  const dispatch = async (index: number, request?: TContext): Promise<TResult> => {
    const current = wrappers[index];
    if (!current) {
      return baseHandler(request ?? context);
    }

    try {
      let nextRunning = false;
      return await current.hook(request ?? context, async (nextRequest?: TContext) => {
        if (nextRunning) {
          throw new Error(`Pipeline violation: next() called concurrently in ${current.middleware.name}`);
        }
        nextRunning = true;
        try {
          return await dispatch(index + 1, nextRequest ?? request);
        } finally {
          nextRunning = false;
        }
      });
    } catch (error) {
      throw createStageError(current.middleware.name, stage, error);
    }
  };

  return dispatch(0, context);
}

function createStageError(middlewareName: string, stage: MiddlewareStageName, error: unknown): MiddlewareError {
  const sourceError = error instanceof Error ? error : new Error(String(error));
  return new MiddlewareError(middlewareName, stage, sourceError);
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return {...value};
  }
}
