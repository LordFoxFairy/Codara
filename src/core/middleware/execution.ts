/**
 * Middleware Execution Engine - 中间件执行引擎
 *
 * 职责：
 * - 实现责任链模式的顺序执行算法（runSimpleStage）
 * - 实现洋葱模型的嵌套执行算法（runWrappedStage）
 * - 统一错误处理和包装
 *
 * 设计原则：
 * - 执行算法与业务逻辑分离
 * - 错误包装保留原始 cause 链
 * - 防止 next() 重入调用
 */

import type {BaseMiddleware} from '@core/middleware/types';

export type MiddlewareStageName =
  | 'beforeAgent'
  | 'beforeModel'
  | 'wrapModelCall'
  | 'afterModel'
  | 'wrapToolCall'
  | 'afterAgent';

/**
 * 中间件执行错误
 * 包含中间件名称、阶段和原始错误信息
 */
export class MiddlewareError extends Error {
  constructor(
    public readonly middlewareName: string,
    public readonly stage: MiddlewareStageName,
    public readonly cause: Error
  ) {
    super(`Middleware "${middlewareName}" failed in ${stage}: ${cause.message}`);
    this.name = 'MiddlewareError';

    // 保留原始堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiddlewareError);
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createStageError(middlewareName: string, stage: MiddlewareStageName, error: unknown): MiddlewareError {
  const sourceError = toError(error);
  return new MiddlewareError(middlewareName, stage, sourceError);
}

export function assertNoDuplicateNames(middlewares: BaseMiddleware[]): void {
  const seen = new Set<string>();
  for (const middleware of middlewares) {
    if (seen.has(middleware.name)) {
      throw new Error(`Duplicate middleware name: ${middleware.name}`);
    }
    seen.add(middleware.name);
  }
}

type SimpleStageHook<TContext> = (context: TContext) => Promise<void> | void;
type WrappedStageHook<TContext, TResult> = (
  context: TContext,
  handler: (request?: TContext) => Promise<TResult>
) => Promise<TResult>;

export async function runSimpleStage<TContext>(
  middlewares: BaseMiddleware[],
  stage: MiddlewareStageName,
  context: TContext,
  pickHook: (
    middleware: BaseMiddleware
  ) => SimpleStageHook<TContext> | undefined
): Promise<void> {
  for (const middleware of middlewares) {
    const hook = pickHook(middleware);
    if (!hook) {
      continue;
    }

    try {
      await hook(context);
    } catch (error) {
      throw createStageError(middleware.name, stage, error);
    }
  }
}

export async function runWrappedStage<TContext, TResult>(
  middlewares: BaseMiddleware[],
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
