import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentContextPreparer,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentType,
  Agent,
  ToolErrorHandler,
} from './models/agent';
import type {BaseMiddleware, MiddlewareRuntimeShared} from '@engine/pipeline/types';
import type {AgentCheckpointer, AgentCheckpoint} from '@engine/checkpoint/agent';
import type {AgentLifecycleHooks} from '@engine/hook/types';
import {createAgent} from './run/agent-loop';

/**
 * Model resolver — accepts sync, async, or factory patterns.
 * Unifies the different model resolution approaches used across the codebase.
 */
export type ModelResolver =
  | BaseChatModel
  | Promise<BaseChatModel>
  | (() => BaseChatModel | Promise<BaseChatModel>);

export interface BootstrapAgentOptions {
  model: ModelResolver;
  agentType: AgentType;
  tools?: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  systemMessage?: string[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  runtimeShared?: MiddlewareRuntimeShared;
  checkpointer?: AgentCheckpointer;
  checkpoint?: AgentCheckpoint;
  sessionId?: string;
  inputBudget?: AgentInputBudget;
  prepareContext?: AgentContextPreparer;
  handleToolErrors?: ToolErrorHandler;
  lifecycle?: AgentLifecycleHooks;
  messages?: import('@langchain/core/messages').BaseMessage[];
}

/**
 * Resolve a ModelResolver to a concrete BaseChatModel.
 */
export async function resolveModel(model: ModelResolver): Promise<BaseChatModel> {
  if (typeof model === 'function') {
    return await model();
  }
  return await model;
}

/**
 * Bootstrap an agent with unified model resolution.
 *
 * This is the SINGLE entry point for agent creation.
 * Used by Session, Task delegation, and Team runtime.
 */
export async function bootstrapAgent(options: BootstrapAgentOptions): Promise<Agent> {
  const model = await resolveModel(options.model);
  return createAgent({
    model,
    agentType: options.agentType,
    tools: options.tools,
    middleware: options.middleware,
    systemMessage: options.systemMessage,
    context: options.context,
    values: options.values,
    runtimeShared: options.runtimeShared,
    checkpointer: options.checkpointer,
    checkpoint: options.checkpoint,
    sessionId: options.sessionId,
    inputBudget: options.inputBudget,
    prepareContext: options.prepareContext,
    handleToolErrors: options.handleToolErrors,
    lifecycle: options.lifecycle,
    messages: options.messages,
  });
}
