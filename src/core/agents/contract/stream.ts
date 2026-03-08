import type {AIMessage, AIMessageChunk, BaseMessage, ToolMessage} from '@langchain/core/messages';
import type {AgentInvokeConfig, AgentRuntimeContext} from '@core/agents/contract/agent';
import type {HILToolMessagePayload} from '@core/middleware/hil';

/**
 * Agent stream modes（对齐 LangChain 标准）
 *
 * - `messages`: 返回 AIMessageChunk，对齐 LangChain model.stream()
 * - `values`: 返回完整 state，对齐 LangGraph streamMode="values"
 * - `updates`: 返回增量更新，对齐 LangGraph streamMode="updates"
 * - `custom`: 自定义事件（如 HIL 暂停）
 */
export type AgentStreamMode = 'values' | 'updates' | 'messages' | 'custom';

/**
 * Messages stream mode 直接返回 AIMessageChunk（对齐 LangChain 标准）
 *
 * 使用方式：
 * ```typescript
 * for await (const chunk of agent.stream('hello', {streamMode: 'messages'})) {
 *   console.log(chunk.content);  // 直接访问，像 LangChain
 *   console.log(chunk.response_metadata.runId);  // 我们的扩展
 * }
 * ```
 *
 * metadata (runId, turn) 会注入到 chunk.response_metadata 中
 */
export type AgentStreamMessagesChunk = AIMessageChunk;

/**
 * Values stream mode 返回完整 state（对齐 LangGraph）
 *
 * 包含当前所有 messages，适合需要完整上下文的场景
 */
export type AgentStreamValuesChunk = {
  messages: BaseMessage[];
};

/**
 * Updates stream mode 返回增量更新（对齐 LangGraph）
 *
 * 只包含新增的 message，分为 model 和 tools 两类
 */
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

/**
 * Custom stream mode 用于自定义事件
 *
 * 目前用于 HIL (Human-in-the-Loop) 暂停事件
 */
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
