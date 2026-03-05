/**
 * 中间件管道。
 *
 * 职责：
 * - 管理中间件注册表（use/list/has/get/remove）
 * - 调度 6 个中间件阶段
 * - 执行 contextSchema 校验
 */

import type {AIMessage, ToolMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext} from '@core/agents/types';
import {
  type AfterAgentContext,
  type AfterModelContext,
  type BaseMiddleware,
  type BeforeAgentContext,
  type BeforeModelContext,
  createMiddleware,
  type ModelCallContext,
  type ModelCallHandler,
  type ToolCallContext,
  type ToolCallHandler
} from '@core/middleware/types';
import {assertNoDuplicateNames, runSimpleStage, runWrappedStage} from '@core/middleware/execution';

export class MiddlewarePipeline {
  private readonly middlewares: BaseMiddleware[];

  constructor(middlewares: BaseMiddleware[] = []) {
    this.middlewares = middlewares.map((middleware) => createMiddleware(middleware));
    assertNoDuplicateNames(this.middlewares);
  }

  use(middleware: BaseMiddleware): void {
    const normalized = createMiddleware(middleware);
    if (this.middlewares.some((item) => item.name === normalized.name)) {
      throw new Error(`Duplicate middleware name: ${normalized.name}`);
    }
    this.middlewares.push(normalized);
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

  /** 删除中间件；若 middleware 标记为 required 则抛错。 */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex((middleware) => middleware.name === name);
    if (index < 0) {
      return false;
    }

    const middleware = this.middlewares[index];
    if (middleware.required) {
      throw new Error(`Cannot remove required middleware: ${name}`);
    }

    this.middlewares.splice(index, 1);
    return true;
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

  async beforeAgent(context: BeforeAgentContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'beforeAgent', context, (middleware) => middleware.beforeAgent);
  }

  async beforeModel(context: BeforeModelContext): Promise<void> {
    await runSimpleStage(this.middlewares, 'beforeModel', context, (middleware) => middleware.beforeModel);
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
    await runSimpleStage(this.middlewares, 'afterModel', context, (middleware) => middleware.afterModel);
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
    await runSimpleStage(this.middlewares, 'afterAgent', context, (middleware) => middleware.afterAgent);
  }
}
