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

export async function runSimpleStage<TContext>(
  middlewares: BaseMiddleware[],
  stage: MiddlewareStageName,
  context: TContext,
  pickHook: (middleware: BaseMiddleware) => ((context: TContext) => Promise<void> | void) | undefined
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
  baseHandler: () => Promise<TResult>,
  pickHook: (
    middleware: BaseMiddleware
  ) => ((context: TContext, handler: () => Promise<TResult>) => Promise<TResult>) | undefined
): Promise<TResult> {
  const wrappers: Array<{
    middleware: BaseMiddleware;
    hook: (context: TContext, handler: () => Promise<TResult>) => Promise<TResult>;
  }> = [];

  for (const middleware of middlewares) {
    const hook = pickHook(middleware);
    if (hook) {
      wrappers.push({middleware, hook});
    }
  }

  let cursor = -1;

  const dispatch = async (index: number): Promise<TResult> => {
    if (index <= cursor) {
      const previous = wrappers[index - 1]?.middleware.name ?? `middleware[${index - 1}]`;
      throw new Error(`Pipeline violation: next() called multiple times in ${previous}`);
    }
    cursor = index;

    const current = wrappers[index];
    if (!current) {
      return baseHandler();
    }

    try {
      return await current.hook(context, () => dispatch(index + 1));
    } catch (error) {
      throw createStageError(current.middleware.name, stage, error);
    }
  };

  return dispatch(0);
}
