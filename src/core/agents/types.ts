import type {BaseMessage, ToolCall, ToolMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/middleware';

export type AgentRuntimeContext = Record<string, unknown>;

/** Agent 运行时状态（最小合同） */
export interface AgentState {
  messages: BaseMessage[];
}

/** Agent 完成原因 */
export type AgentFinishReason = 'complete' | 'error' | 'max_turns';

/** Agent 执行结果 */
export interface AgentResult {
  reason: AgentFinishReason;
  state: AgentState;
  turns: number;
  error?: Error;
}

/** 工具错误处理策略。 */
export type ToolErrorHandler =
  | boolean
  | ((error: unknown, toolCall: ToolCall) => ToolMessage | void | Promise<ToolMessage | void>);

/** invoke 级 hook 上下文。 */
export interface AgentHookContext {
  state: AgentState;
  runId: string;
  maxTurns: number;
}

/** invoke 级 hooks（loop 外执行）。 */
export interface AgentHooks {
  /** invoke 前置。 */
  beforeRun?: (context: AgentHookContext) => Promise<void> | void;
  /** invoke 后置。 */
  afterRun?: (context: AgentHookContext & {result: AgentResult}) => Promise<void> | void;
}

/** Agent 构造参数 */
export interface AgentRunnerParams {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  /** 工具执行失败处理：true=返回 ToolMessage，false=抛错，function=自定义。 */
  handleToolErrors?: ToolErrorHandler;
  /** turn 中间件（按注册顺序）。 */
  middlewares?: BaseMiddleware[];
}

/** Agent 调用配置 */
export interface AgentInvokeConfig {
  /** 最大循环轮次，默认 25。 */
  recursionLimit?: number;
  /** 运行时上下文。 */
  context?: AgentRuntimeContext;
  /** invoke 前置 hook。 */
  beforeRun?: AgentHooks['beforeRun'];
  /** invoke 后置 hook。 */
  afterRun?: AgentHooks['afterRun'];
}
