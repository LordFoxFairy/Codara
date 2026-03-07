import type {AIMessage, AIMessageChunk, BaseMessage, ToolMessage} from '@langchain/core/messages';
import type {AgentResult} from '@core/agents/types';
import type {
  AgentStreamConfig,
  AgentStreamEnvelope,
  AgentStreamMode,
  AgentStreamOutput,
  AgentStreamValuesChunk,
} from '@core/agents/stream';
import type {HILToolMessagePayload} from '@core/middleware/hil';

interface QueueItem<T, TReturn> {
  done: boolean;
  value?: T;
  result?: TReturn;
}

type QueueResolver<T, TReturn> = {
  resolve: (value: IteratorResult<T, TReturn>) => void;
  reject: (reason?: unknown) => void;
};

class AsyncResultQueue<T, TReturn> implements AsyncGenerator<T, TReturn, void> {
  private readonly items: Array<QueueItem<T, TReturn>> = [];
  private readonly waiters: Array<QueueResolver<T, TReturn>> = [];
  private finished = false;
  private error?: Error;

  push(value: T): void {
    if (this.finished) {
      return;
    }
    this.enqueue({done: false, value});
  }

  complete(result: TReturn): void {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.enqueue({done: true, result});
  }

  fail(error: unknown): void {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.error = error instanceof Error ? error : new Error(String(error));

    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift() as QueueResolver<T, TReturn>;
      waiter.reject(this.error);
    }
  }

  async next(): Promise<IteratorResult<T, TReturn>> {
    if (this.items.length > 0) {
      return this.toIteratorResult(this.items.shift() as QueueItem<T, TReturn>);
    }

    if (this.error) {
      throw this.error;
    }

    return new Promise<IteratorResult<T, TReturn>>((resolve, reject) => {
      this.waiters.push({resolve, reject});
    });
  }

  async return(result: TReturn): Promise<IteratorResult<T, TReturn>> {
    this.complete(result);
    return {done: true, value: result};
  }

  async throw(error: unknown): Promise<IteratorResult<T, TReturn>> {
    this.fail(error);
    throw error;
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, TReturn, void> {
    return this;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.finished) {
      this.complete(undefined as TReturn);
    }
  }

  private enqueue(item: QueueItem<T, TReturn>): void {
    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift() as QueueResolver<T, TReturn>;
      waiter.resolve(this.toIteratorResult(item));
      return;
    }

    this.items.push(item);
  }

  private toIteratorResult(item: QueueItem<T, TReturn>): IteratorResult<T, TReturn> {
    if (item.done) {
      return {done: true, value: item.result as TReturn};
    }

    return {done: false, value: item.value as T};
  }
}

export interface AgentStreamController {
  stream: AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  emitMessages(input: {runId: string; turn: number; chunk: AIMessageChunk}): Promise<void>;
  emitModelUpdate(message: AIMessage): Promise<void>;
  emitToolUpdate(message: ToolMessage): Promise<void>;
  emitValues(messages: BaseMessage[]): Promise<void>;
  emitCustom(input: {runId: string; turn: number; payload: HILToolMessagePayload}): Promise<void>;
  finish(result: AgentResult): void;
  fail(error: unknown): void;
}

export function createStreamController(config: AgentStreamConfig | undefined): AgentStreamController {
  const modes = normalizeModes(config?.streamMode);
  const queue = new AsyncResultQueue<AgentStreamOutput, AgentResult>();

  const pushEnvelope = <TMode extends AgentStreamMode>(
    envelope: AgentStreamEnvelope<TMode>
  ) => {
    if (modes.length <= 1) {
      queue.push(envelope.chunk);
      return;
    }

    queue.push([envelope.mode, envelope.chunk]);
  };

  return {
    stream: queue,
    async emitMessages(input) {
      if (!modes.includes('messages')) {
        return;
      }

      pushEnvelope({
        mode: 'messages',
        chunk: [input.chunk, {runId: input.runId, turn: input.turn}],
      });
    },
    async emitModelUpdate(message) {
      if (!modes.includes('updates')) {
        return;
      }

      pushEnvelope({
        mode: 'updates',
        chunk: {
          model: {
            messages: [message],
          },
        },
      });
    },
    async emitToolUpdate(message) {
      if (!modes.includes('updates')) {
        return;
      }

      pushEnvelope({
        mode: 'updates',
        chunk: {
          tools: {
            messages: [message],
          },
        },
      });
    },
    async emitValues(messages) {
      if (!modes.includes('values')) {
        return;
      }

      const chunk: AgentStreamValuesChunk = {
        messages: [...messages],
      };

      pushEnvelope({
        mode: 'values',
        chunk,
      });
    },
    async emitCustom(input) {
      if (!modes.includes('custom')) {
        return;
      }

      pushEnvelope({
        mode: 'custom',
        chunk: {
          type: 'hil_event',
          runId: input.runId,
          turn: input.turn,
          payload: input.payload,
        },
      });
    },
    finish(result) {
      queue.complete(result);
    },
    fail(error) {
      queue.fail(error);
    },
  };
}

export function normalizeModes(streamMode: AgentStreamConfig['streamMode']): AgentStreamMode[] {
  const normalized: AgentStreamMode[] =
    streamMode === undefined ? ['updates'] : Array.isArray(streamMode) ? streamMode : [streamMode];
  return Array.from(new Set(normalized));
}
