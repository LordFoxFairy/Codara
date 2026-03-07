import type {AIMessage, AIMessageChunk, BaseMessage, ToolMessage} from '@langchain/core/messages';
import type {AgentInvokeConfig, AgentRuntimeContext} from '@core/agents/types';
import type {HILToolMessagePayload} from '@core/middleware/hil';

export type AgentStreamMode = 'values' | 'updates' | 'messages' | 'custom';

export interface AgentStreamMessagesMetadata {
  runId: string;
  turn: number;
}

export type AgentStreamMessagesChunk = [AIMessageChunk, AgentStreamMessagesMetadata];

export type AgentStreamValuesChunk = {
  messages: BaseMessage[];
};

export type AgentStreamUpdatesChunk =
  | {
      model: {
        messages: [AIMessage];
      };
    }
  | {
      tools: {
        messages: [ToolMessage];
      };
    };

export interface AgentStreamCustomChunk {
  type: 'hil_event';
  runId: string;
  turn: number;
  payload: HILToolMessagePayload;
}

export interface AgentStreamChunkMap {
  values: AgentStreamValuesChunk;
  updates: AgentStreamUpdatesChunk;
  messages: AgentStreamMessagesChunk;
  custom: AgentStreamCustomChunk;
}

export interface AgentStreamEnvelope<TMode extends AgentStreamMode = AgentStreamMode> {
  mode: TMode;
  chunk: AgentStreamChunkMap[TMode];
}

export type AgentStreamOutput =
  | AgentStreamChunkMap[AgentStreamMode]
  | [AgentStreamMode, AgentStreamChunkMap[AgentStreamMode]];

export interface AgentStreamConfig extends Omit<AgentInvokeConfig, 'context'> {
  context?: AgentRuntimeContext;
  checkpoint?: boolean;
  streamMode?: AgentStreamMode | AgentStreamMode[];
}
