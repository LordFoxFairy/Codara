/**
 * Middleware 类型定义。
 *
 * 该文件只负责类型边界与最小工厂校验：
 * - BaseMiddleware: 定义 6 个 hook 的可选签名
 * - *Context: 定义每个阶段可读取的数据
 * - createMiddleware: 仅校验 name 非空、且至少声明一个 hook
 */

import type {AIMessage, BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {ZodType} from 'zod';
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
  contextSchema?: ZodType<unknown>;
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
