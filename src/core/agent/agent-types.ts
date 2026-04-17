import type {BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMiddleware} from '@core/pipeline-types';
import type {AgentCheckpoint, AgentCheckpointer} from '@state/checkpoint/agent';
import type {AgentLifecycleHooks} from '@hooks/types';
import type {
  AgentContextPreparer,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentType,
  ToolErrorHandler,
} from '@shared/agent-types';

// Re-export all shared agent types for backward compatibility
export type {
  Agent,
  AgentContextPreparer,
  AgentExecutionMetadata,
  AgentFinishReason,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentMessagesInput,
  AgentPreparationContext,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentState,
  AgentStatus,
  AgentStreamConfig,
  AgentStreamCustomChunk,
  AgentStreamMode,
  AgentStreamOutput,
  AgentType,
  ReviewActionDescriptor,
  ReviewDecision,
  ReviewRequest,
  ReviewSpec,
  ReviewToolMessagePayload,
  ReviewUIActionOption,
  ReviewUIConfig,
  ReviewUIFormConfig,
  ReviewUIFormOption,
  ReviewUIFormTab,
  ReviewResumePayload,
  ToolErrorHandler,
} from '@shared/agent-types';

export interface CreateAgentOptions {
  model: BaseChatModel;
  agentType?: AgentType;
  tools?: StructuredToolInterface[];
  handleToolErrors?: ToolErrorHandler;
  middleware?: BaseMiddleware[];
  sessionId?: string;
  checkpointer?: AgentCheckpointer;
  checkpoint?: AgentCheckpoint;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  systemMessage?: string[];
  runtimeShared?: Record<string, unknown>;
  inputBudget?: AgentInputBudget;
  prepareContext?: AgentContextPreparer;
  lifecycle?: AgentLifecycleHooks;
}
