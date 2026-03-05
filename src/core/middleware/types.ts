/**
 * Middleware Type Definitions - 中间件类型定义
 *
 * 核心概念：
 * - BaseMiddleware: 中间件接口，定义 6 个生命周期 hooks
 * - Context Types: 各阶段的上下文类型（包含 state/runId/turn 等）
 * - Handler Types: wrap hooks 的处理器类型
 *
 * 生命周期 Hooks：
 * 1. beforeAgent: 每轮开始前执行
 * 2. beforeModel: 模型调用前执行
 * 3. wrapModelCall: 包裹模型调用（洋葱模型）
 * 4. afterModel: 模型调用后执行
 * 5. wrapToolCall: 包裹工具调用（洋葱模型）
 * 6. afterAgent: 每轮结束后执行（无论成功/失败）
 *
 * 设计特性：
 * - 与 LangChain 生命周期对齐
 * - 支持 required 标记防止误删
 * - 工厂函数统一验证和规范化
 */

import type {AIMessage, BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {ZodTypeAny} from 'zod';
import type {AgentRuntimeContext} from '@core/agents/types';

export interface MiddlewareRuntimeContext {
  context: AgentRuntimeContext;
}

export interface BaseExecutionContext {
  state: {
    messages: BaseMessage[];
  };
  /** LangChain 风格快捷访问：等价于 state.messages */
  messages: BaseMessage[];
  /** LangChain 风格 runtime 上下文 */
  runtime: MiddlewareRuntimeContext;
  /** 可在 wrapModelCall 中追加系统消息 */
  systemMessage: string[];
  runId: string;
  turn: number;
  maxTurns: number;
  requestId: string;
}

export type BeforeAgentContext = BaseExecutionContext;
export type BeforeModelContext = BaseExecutionContext;
export type ModelCallContext = BaseExecutionContext;

export interface AfterModelContext extends BaseExecutionContext {
  response: AIMessage;
}

export interface ToolCallContext extends BaseExecutionContext {
  toolCall: ToolCall;
  toolIndex: number;
  tool?: StructuredToolInterface;
}

export interface AgentRunSummary {
  reason: 'continue' | 'complete' | 'error';
  turns: number;
  error?: Error;
}

export interface AfterAgentContext extends BaseExecutionContext {
  result: AgentRunSummary;
}

export type ModelCallHandler = (request?: ModelCallContext) => Promise<AIMessage>;
export type ToolCallHandler = (request?: ToolCallContext) => Promise<ToolMessage>;

export interface BaseMiddleware {
  name: string;
  /** 可选 context 校验器（例如 zod schema） */
  contextSchema?: ZodTypeAny;
  /** Required middleware cannot be removed from pipeline */
  required?: boolean;
  beforeAgent?: (context: BeforeAgentContext) => Promise<void> | void;
  beforeModel?: (context: BeforeModelContext) => Promise<void> | void;
  wrapModelCall?: (context: ModelCallContext, handler: ModelCallHandler) => Promise<AIMessage>;
  afterModel?: (context: AfterModelContext) => Promise<void> | void;
  wrapToolCall?: (context: ToolCallContext, handler: ToolCallHandler) => Promise<ToolMessage>;
  afterAgent?: (context: AfterAgentContext) => Promise<void> | void;
}

export function createMiddleware(config: BaseMiddleware): BaseMiddleware {
  const normalizedName = config.name.trim();
  if (!normalizedName) {
    throw new Error('Middleware name cannot be empty');
  }

  const hasAnyHook = Boolean(
    config.beforeAgent ||
    config.beforeModel ||
    config.wrapModelCall ||
    config.afterModel ||
    config.wrapToolCall ||
    config.afterAgent
  );

  if (!hasAnyHook) {
    throw new Error(`Middleware "${normalizedName}" must define at least one lifecycle hook`);
  }

  return Object.freeze({
    ...config,
    name: normalizedName
  });
}
