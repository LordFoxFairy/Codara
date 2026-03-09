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
import {z} from 'zod';
import type {AgentRuntimeContext, AgentRuntimeValues} from '@core/agents/contract/agent';
import type {AgentStateUpdate} from '@core/agents/command';

export interface MiddlewareRuntimeContext {
  /** 本次运行的有效上下文（持久上下文 + 调用时临时覆盖）。 */
  context: AgentRuntimeContext;
  /** 会随 agent checkpoint 一起持久化的上下文。 */
  agentContext?: AgentRuntimeContext;
}

export interface BaseExecutionContext {
  state: {
    messages: BaseMessage[];
    context?: AgentRuntimeContext;
    values?: AgentRuntimeValues;
  };
  /** `state.messages` 的快捷访问。 */
  messages: BaseMessage[];
  /** 运行时上下文。 */
  runtime: MiddlewareRuntimeContext;
  /** 在 wrapModelCall 中可追加系统消息。 */
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
  /** 可选持久 state schema（用于 middleware state 默认值和校验）。 */
  stateSchema?: z.ZodTypeAny;
  /** 可选 context 校验器（例如 zod schema）。 */
  contextSchema?: z.ZodTypeAny;
  /** middleware 注册的附加 tools。 */
  tools?: StructuredToolInterface[];
  /** 标记后不可通过 pipeline.remove 删除。 */
  required?: boolean;
  beforeAgent?: (context: BeforeAgentContext) => Promise<AgentStateUpdate | void> | AgentStateUpdate | void;
  beforeModel?: (context: BeforeModelContext) => Promise<AgentStateUpdate | void> | AgentStateUpdate | void;
  wrapModelCall?: (context: ModelCallContext, handler: ModelCallHandler) => Promise<AIMessage>;
  afterModel?: (context: AfterModelContext) => Promise<AgentStateUpdate | void> | AgentStateUpdate | void;
  wrapToolCall?: (context: ToolCallContext, handler: ToolCallHandler) => Promise<ToolMessage>;
  afterAgent?: (context: AfterAgentContext) => Promise<AgentStateUpdate | void> | AgentStateUpdate | void;
}

export function createMiddleware(config: BaseMiddleware): BaseMiddleware {
  const normalizedName = config.name.trim();
  if (!normalizedName) {
    throw new Error('Middleware name cannot be empty');
  }

  const hasAnyHook = Boolean(
    config.tools?.length ||
    config.stateSchema ||
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
