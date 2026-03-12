import type {AIMessage, AIMessageChunk, BaseMessage, ToolMessage} from '@langchain/core/messages';
import {AIMessageChunk as AIMessageChunkClass} from '@langchain/core/messages';
import type {
  AgentResult,
  AgentStreamConfig,
  AgentStreamMode,
  AgentStreamOutput,
} from '../models/agent';
import type {HILToolMessagePayload} from '@core/middleware/hil';

export interface AgentStreamWriter {
  stream: AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  emitMessages(input: {runId: string; sessionId: string; requestId: string; turn: number; chunk: AIMessageChunk}): Promise<void>;
  emitModelUpdate(message: AIMessage): Promise<void>;
  emitToolUpdate(message: ToolMessage): Promise<void>;
  emitValues(messages: BaseMessage[]): Promise<void>;
  emitCustom(input: {runId: string; turn: number; payload: HILToolMessagePayload}): Promise<void>;
  finish(result: AgentResult): void;
  fail(error: unknown): void;
}

export function createStreamWriter(config: AgentStreamConfig | undefined): AgentStreamWriter {
  const modes = normalizeModes(config?.streamMode);
  const stream = createAsyncStream<AgentStreamOutput, AgentResult>();
  const push = (
    mode: AgentStreamMode,
    chunk: AIMessageChunk | {messages: BaseMessage[]} | {model: {messages: [AIMessage]}} | {tools: {messages: [ToolMessage]}} | {type: 'hil_event'; runId: string; turn: number; payload: HILToolMessagePayload},
  ) => {
    stream.push(modes.length === 1 ? chunk : [mode, chunk]);
  };

  return {
    stream: stream.iterator,
    async emitMessages(input) {
      if (!modes.includes('messages')) {
        return;
      }

      push('messages', new AIMessageChunkClass({
          content: input.chunk.content,
          ...(input.chunk.id ? {id: input.chunk.id} : {}),
          ...(input.chunk.name ? {name: input.chunk.name} : {}),
          ...(input.chunk.tool_calls ? {tool_calls: input.chunk.tool_calls} : {}),
          ...(input.chunk.invalid_tool_calls ? {invalid_tool_calls: input.chunk.invalid_tool_calls} : {}),
          ...(input.chunk.usage_metadata ? {usage_metadata: input.chunk.usage_metadata} : {}),
            ...(input.chunk.additional_kwargs ? {additional_kwargs: input.chunk.additional_kwargs} : {}),
          response_metadata: {
            ...(input.chunk.response_metadata ?? {}),
            runId: input.runId,
            sessionId: input.sessionId,
            requestId: input.requestId,
            turn: input.turn,
          },
        }));
    },
    async emitModelUpdate(message) {
      if (modes.includes('updates')) {
        push('updates', {model: {messages: [message]}});
      }
    },
    async emitToolUpdate(message) {
      if (modes.includes('updates')) {
        push('updates', {tools: {messages: [message]}});
      }
    },
    async emitValues(messages) {
      if (modes.includes('values')) {
        push('values', {messages: [...messages]});
      }
    },
    async emitCustom(input) {
      if (modes.includes('custom')) {
        push('custom', {type: 'hil_event', runId: input.runId, turn: input.turn, payload: input.payload});
      }
    },
    finish: stream.finish,
    fail: stream.fail,
  };
}

function createAsyncStream<T, TReturn>() {
  const items: Array<IteratorResult<T, TReturn>> = [];
  const waiters: Array<{
    resolve: (value: IteratorResult<T, TReturn>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  let error: Error | undefined;

  const shift = () => items.shift() as IteratorResult<T, TReturn> | undefined;
  const deliver = (item: IteratorResult<T, TReturn>) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(item);
    } else {
      items.push(item);
    }
  };

  return {
    iterator: {
      async next(): Promise<IteratorResult<T, TReturn>> {
        const item = shift();
        if (item) {
          return item;
        }
        if (error) {
          throw error;
        }
        return new Promise((resolve, reject) => waiters.push({resolve, reject}));
      },
      async return(result: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>> {
        const resolved = await result;
        deliver({done: true, value: resolved});
        return {done: true, value: resolved};
      },
      async throw(reason: unknown): Promise<never> {
        error = reason instanceof Error ? reason : new Error(String(reason));
        while (waiters.length > 0) {
          waiters.shift()?.reject(error);
        }
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      async [Symbol.asyncDispose](): Promise<void> {
        return;
      },
    },
    push(value: T) {
      deliver({done: false, value});
    },
    finish(result: TReturn) {
      deliver({done: true, value: result});
    },
    fail(reason: unknown) {
      error = reason instanceof Error ? reason : new Error(String(reason));
      while (waiters.length > 0) {
        waiters.shift()?.reject(error);
      }
    },
  };
}

function normalizeModes(streamMode: AgentStreamConfig['streamMode']): AgentStreamMode[] {
  const modes: AgentStreamMode[] = streamMode === undefined
    ? ['updates']
    : Array.isArray(streamMode)
      ? streamMode
      : [streamMode];
  return Array.from(new Set(modes));
}
