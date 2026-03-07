import type {AgentRuntimeContext} from '@core/agents/types';
import type {CreateCodaraAgentOptions, LoadCodaraAgentOptions} from '@core/agents/codara';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {BaseMessage} from '@langchain/core/messages';

export interface CreateCodaraOptions
  extends Omit<CreateCodaraAgentOptions, 'threadId' | 'messages' | 'context' | 'checkpointer'> {
  threadId?: string;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  checkpointer?: AgentCheckpointer;
}

export interface CreateCodaraSessionOptions
  extends Omit<CreateCodaraAgentOptions, 'checkpointer'> {
  checkpointer?: AgentCheckpointer;
}

export interface LoadCodaraSessionOptions
  extends Omit<LoadCodaraAgentOptions, 'checkpointer'> {
  checkpointer?: AgentCheckpointer;
}
