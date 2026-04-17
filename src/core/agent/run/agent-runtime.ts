import {AIMessage, AIMessageChunk, BaseMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {mergeContext} from '../command';
import type {
  AgentContextPreparer,
  AgentInputBudget,
  AgentRuntimeContext,
  AgentState,
  CreateAgentOptions,
  ToolErrorHandler,
} from '../agent-types';
import type {AgentLifecycleHooks} from '@hooks/types';
import {MiddlewarePipeline} from '@core/pipeline';
import type {BaseExecutionContext, MiddlewareRuntimeShared} from '@core/pipeline-types';
import {deepClone} from '@shared/clone';

// ── Public model types ──────────────────────────────────────────────────────

export interface AgentModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
  stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk>;
}

export interface AgentRuntime {
  model: AgentModel;
  tools: Map<string, StructuredToolInterface>;
  pipeline: MiddlewarePipeline;
  handleToolErrors: ToolErrorHandler;
  systemMessage: string[];
  runtimeShared: MiddlewareRuntimeShared;
  prepareContext?: AgentContextPreparer;
  lifecycle?: AgentLifecycleHooks;
}

export interface AgentRunContext {
  state: AgentState;
  runId: string;
  maxTurns: number;
  runtimeContext: AgentRuntimeContext;
  shared: MiddlewareRuntimeShared;
  inputBudget?: AgentInputBudget;
  signal?: AbortSignal;
}

// ── Abort helpers ───────────────────────────────────────────────────────────

/** Check if signal is aborted; if so throw an AbortError for the loop to catch. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Agent run aborted');
    error.name = 'AbortError';
    throw error;
  }
}

// ── Turn context ────────────────────────────────────────────────────────────

export async function createTurnContext(
  run: AgentRunContext,
  runtime: AgentRuntime,
  turn: number,
  requestId: string,
): Promise<BaseExecutionContext> {
  const context: BaseExecutionContext = {
    state: run.state,
    messages: run.state.messages,
    runtime: {
      context: mergeContext(run.state.context, run.runtimeContext),
      runtimeContext: run.runtimeContext,
      shared: run.shared,
    },
    systemMessage: [...runtime.systemMessage],
    execution: {
      sessionId: run.state.sessionId,
      runId: run.runId,
      turn,
      maxTurns: run.maxTurns,
      requestId,
    },
    inputBudget: run.inputBudget,
  };
  await runtime.prepareContext?.(context);
  await runtime.pipeline.beforeAgent(context);
  await runtime.pipeline.beforeModel(context);
  return context;
}

// ── Runtime builder ─────────────────────────────────────────────────────────

export function buildRuntime(options: CreateAgentOptions): AgentRuntime {
  const pipeline = new MiddlewarePipeline(options.middleware ? [...options.middleware] : []);
  const tools = [...(options.tools ?? []), ...pipeline.getTools()];
  const registry = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    if (registry.has(tool.name)) continue;
    registry.set(tool.name, tool);
  }

  const runnable = (() => {
    if (tools.length === 0) return options.model;
    if (!('bindTools' in options.model) || typeof options.model.bindTools !== 'function') {
      throw new Error('Model does not support bindTools; cannot attach tools.');
    }
    return options.model.bindTools(tools);
  })();

  return {
    model: {
      async invoke(messages) {
        return ensureAIMessage(await runnable.invoke(messages), 'Model must return AIMessage');
      },
      async *stream(messages) {
        if ('stream' in runnable && typeof runnable.stream === 'function') {
          for await (const chunk of await runnable.stream(messages)) {
            if (!AIMessageChunk.isInstance(chunk) && !AIMessage.isInstance(chunk)) continue;
            yield toMessageChunk(chunk);
          }
          return;
        }
        yield toMessageChunk(await runnable.invoke(messages));
      },
    },
    tools: registry,
    pipeline,
    handleToolErrors: options.handleToolErrors ?? true,
    systemMessage: [...(options.systemMessage ?? [])],
    runtimeShared: deepClone(options.runtimeShared ?? {}),
    prepareContext: options.prepareContext,
    lifecycle: options.lifecycle,
  };
}

// ── Message chunk helpers ───────────────────────────────────────────────────

export function toMessageChunk(message: unknown): AIMessageChunk {
  if (AIMessageChunk.isInstance(message)) return message;
  const normalized = ensureAIMessage(message, 'Model stream must yield AIMessage or AIMessageChunk');
  return new AIMessageChunk({
    content: normalized.content,
    ...(normalized.id ? {id: normalized.id} : {}),
    ...(normalized.name ? {name: normalized.name} : {}),
    ...(normalized.tool_calls ? {tool_calls: normalized.tool_calls} : {}),
    ...(normalized.invalid_tool_calls ? {invalid_tool_calls: normalized.invalid_tool_calls} : {}),
    ...(normalized.usage_metadata ? {usage_metadata: normalized.usage_metadata} : {}),
    ...(normalized.additional_kwargs ? {additional_kwargs: normalized.additional_kwargs} : {}),
    ...(normalized.response_metadata ? {response_metadata: normalized.response_metadata} : {}),
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

function ensureAIMessage(message: unknown, prefix: string): AIMessage {
  if (AIMessage.isInstance(message)) return message;
  throw new Error(`${prefix}, received: ${readMessageType(message)}`);
}

function readMessageType(message: unknown): string {
  if (AIMessageChunk.isInstance(message) || BaseMessage.isInstance(message)) return message.type;
  if (message && typeof message === 'object' && 'type' in message && typeof (message as {type?: unknown}).type === 'string') {
    return (message as {type: string}).type;
  }
  return typeof message;
}
