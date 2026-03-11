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
import type {AgentRuntimeContext} from '@core/agents/contract/agent';
import {applyAgentStateUpdate} from '@core/agents/command';
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
import {assertNoDuplicateNames, runSimpleStage, runWrappedStage} from '@core/middleware/execution';

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
      if (!parsed.success || !isPlainRecord(parsed.data)) {
        return values;
      }

      return {...values, ...parsed.data};
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

      if (!isPlainRecord(parsed.data)) {
        continue;
      }

      normalized = {
        ...normalized,
        ...parsed.data,
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return {...value};
  }
}
