import type {AIMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentRuntimeContext, AgentState, ToolErrorHandler} from '@core/agents/types';
import type {MiddlewarePipeline} from '@core/middleware';

/** Loop 运行时上下文（每次 invoke 一份） */
export interface AgentLoopRuntime {
  state: AgentState;
  runId: string;
  maxTurns: number;
  context: AgentRuntimeContext;
}

/** Loop 使用的模型最小契约。 */
export interface AgentModel {
  invoke(messages: AgentState['messages']): Promise<AIMessage>;
}

/** Loop 执行依赖（由 runner 门面装配） */
export interface LoopExecutionDeps {
  model: AgentModel;
  tools: Map<string, StructuredToolInterface>;
  pipeline: MiddlewarePipeline;
  handleToolErrors: ToolErrorHandler;
}
