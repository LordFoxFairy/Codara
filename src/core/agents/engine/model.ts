import {AIMessage, AIMessageChunk} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentState, CreateAgentOptions} from '../contract/agent';

/** Agent 运行时消费的最小模型契约。 */
export interface AgentModel {
  invoke(messages: AgentState['messages']): Promise<AIMessage>;
  stream(messages: AgentState['messages']): AsyncGenerator<AIMessageChunk>;
}

/** 将外部聊天模型适配为 agent 运行时可消费的接口。 */
export function buildAgentModel(
  model: CreateAgentOptions['model'],
  tools: StructuredToolInterface[]
): AgentModel {
  const runnable = tools.length === 0 ? model : bindModelTools(model, tools);

  return {
    async invoke(messages: AgentState['messages']) {
      const message = await runnable.invoke(messages);
      if (!AIMessage.isInstance(message)) {
        throw new Error(`Model must return AIMessage, received: ${readMessageType(message)}`);
      }
      return message;
    },
    async *stream(messages: AgentState['messages']) {
      if ('stream' in runnable && typeof runnable.stream === 'function') {
        const iterable = await runnable.stream(messages);
        for await (const message of iterable) {
          yield toMessageChunk(message);
        }
        return;
      }

      const fallback = await runnable.invoke(messages);
      if (!AIMessage.isInstance(fallback)) {
        throw new Error(`Model must return AIMessage, received: ${readMessageType(fallback)}`);
      }
      yield toMessageChunk(fallback);
    },
  };
}

export function toMessageChunk(message: unknown): AIMessageChunk {
  if (AIMessageChunk.isInstance(message)) {
    return message;
  }

  if (!AIMessage.isInstance(message)) {
    throw new Error(`Model stream must yield AIMessage or AIMessageChunk, received: ${readMessageType(message)}`);
  }

  return new AIMessageChunk({
    content: message.content,
    ...(message.id ? {id: message.id} : {}),
    ...(message.name ? {name: message.name} : {}),
    ...(message.tool_calls ? {tool_calls: message.tool_calls} : {}),
    ...(message.invalid_tool_calls ? {invalid_tool_calls: message.invalid_tool_calls} : {}),
    ...(message.usage_metadata ? {usage_metadata: message.usage_metadata} : {}),
    ...(message.additional_kwargs ? {additional_kwargs: message.additional_kwargs} : {}),
    ...(message.response_metadata ? {response_metadata: message.response_metadata} : {}),
  });
}

export function chunkToMessage(chunk: AIMessageChunk): AIMessage {
  return new AIMessage({
    content: chunk.content,
    ...(chunk.id ? {id: chunk.id} : {}),
    ...(chunk.name ? {name: chunk.name} : {}),
    ...(chunk.tool_calls ? {tool_calls: chunk.tool_calls} : {}),
    ...(chunk.invalid_tool_calls ? {invalid_tool_calls: chunk.invalid_tool_calls} : {}),
    ...(chunk.usage_metadata ? {usage_metadata: chunk.usage_metadata} : {}),
    ...(chunk.additional_kwargs ? {additional_kwargs: chunk.additional_kwargs} : {}),
    ...(chunk.response_metadata ? {response_metadata: chunk.response_metadata} : {}),
  });
}

function bindModelTools(
  model: CreateAgentOptions['model'],
  tools: StructuredToolInterface[]
): {invoke: (messages: AgentState['messages']) => Promise<unknown>} {
  if (!('bindTools' in model) || typeof model.bindTools !== 'function') {
    throw new Error('Model does not support bindTools; cannot attach tools.');
  }

  return model.bindTools(tools);
}

function readMessageType(message: unknown): string {
  if (message && typeof message === 'object' && '_getType' in message && typeof message._getType === 'function') {
    return String(message._getType());
  }
  return typeof message;
}
