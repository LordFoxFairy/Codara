/**
 * Middleware Pipeline - 中间件管道系统
 *
 * 设计模式：
 * 1. 责任链模式（Chain of Responsibility）
 *    - before/after hooks 按注册顺序依次执行
 *    - 每个中间件处理请求的一部分，然后传递给下一个
 *
 * 2. 洋葱模型（Onion Model）
 *    - wrap hooks 采用嵌套调用模式
 *    - 外层中间件包裹内层，形成 outer -> inner -> handler -> inner -> outer 的执行流
 *    - 支持短路：中间件可以不调用 next() 直接返回结果
 *
 * 3. 工厂模式（Factory Pattern）
 *    - createMiddleware 工厂函数规范化中间件定义
 *    - 统一验证和初始化逻辑
 *
 * 生命周期顺序（与 LangChain 对齐）：
 * beforeAgent -> beforeModel -> wrapModelCall -> afterModel -> wrapToolCall -> afterAgent
 *
 * 特性：
 * - 中间件名称唯一性保证
 * - required 标记防止误删关键中间件
 * - 阶段错误包装（包含 cause 链）
 * - 防止 next() 多次调用的保护机制
 */

import type {AIMessage, ToolMessage} from '@langchain/core/messages';
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

/**
 * MiddlewarePipeline 管理和执行中间件链
 *
 * 职责：
 * - 中间件注册和管理（use/remove/list）
 * - 生命周期 hooks 调度
 * - 错误传播和包装
 */
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

  /**
   * 获取所有中间件列表（只读）
   * @returns 中间件列表的只读副本
   */
  list(): ReadonlyArray<Readonly<BaseMiddleware>> {
    return this.middlewares as ReadonlyArray<Readonly<BaseMiddleware>>;
  }

  /**
   * 检查是否存在指定名称的中间件
   * @param name 中间件名称
   * @returns 是否存在
   */
  has(name: string): boolean {
    return this.middlewares.some((middleware) => middleware.name === name);
  }

  /**
   * 获取指定名称的中间件
   * @param name 中间件名称
   * @returns 中间件实例，不存在则返回 undefined
   */
  get(name: string): Readonly<BaseMiddleware> | undefined {
    const middleware = this.middlewares.find((middleware) => middleware.name === name);
    return middleware as Readonly<BaseMiddleware> | undefined;
  }

  /**
   * 移除指定名称的中间件
   * @param name 中间件名称
   * @returns 是否成功移除（false 表示中间件不存在）
   * @throws {Error} 如果尝试移除 required 中间件
   */
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
