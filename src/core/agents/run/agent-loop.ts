import {randomUUID} from 'node:crypto';
import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {mergeContext} from '../models/command';
import {
  applyAgentStateSnapshot,
  cloneAgentValues,
  createInitialAgentState,
  hasEquivalentCheckpointState,
  restoreCheckpointMetadata,
  summarizeResult,
  toAgentState,
  toCheckpointInfo,
  toCheckpointState,
  type MutableAgentState,
} from '../models/state';
import {createStreamWriter} from './stream';
import {runAgentTurn} from './turn';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentState,
  AgentStatus,
  AgentStreamConfig,
  AgentStreamOutput,
  AgentTurnContextPreparer,
  CreateAgentOptions,
  PauseRequest,
  ResumePayload,
  ToolErrorHandler,
} from '../models/agent';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
} from '@core/checkpoint';
import {compactSummaryIfNeeded, normalizeSummaryOptions} from '@core/middleware/conversation';
import {type BaseExecutionContext, type MiddlewareRuntimeShared} from '@core/middleware';
import {MiddlewarePipeline} from '@core/middleware/pipeline';
import {deepClone} from '@core/support/clone';
import {formatErrorMessage} from '@core/support/errors';
import {parseHILToolMessagePayload} from '@core/middleware/hil';

const DEFAULT_RECURSION_LIMIT = 25;
const recordSchema = z.record(z.string(), z.unknown());

export interface AgentModel {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
  stream(messages: BaseMessage[]): AsyncGenerator<AIMessageChunk>;
}

export interface AgentRuntime {
  model: AgentModel;
  tools: Map<string, StructuredToolInterface>;
  pipeline: MiddlewarePipeline;
  handleToolErrors: ToolErrorHandler;
  prepareTurnContext?: AgentTurnContextPreparer;
}

export interface AgentRunContext {
  state: AgentState;
  runId: string;
  maxTurns: number;
  runtimeContext: AgentRuntimeContext;
  shared: MiddlewareRuntimeShared;
  inputBudget?: AgentInputBudget;
}

export function normalizeAgentInput(input: AgentInput): BaseMessage[] {
  if (input === undefined) {
    return [];
  }
  if (isMessagesInput(input)) {
    return [...(input as {messages: BaseMessage[]}).messages];
  }
  if (typeof input === 'string') {
    return input.trim() ? [new HumanMessage(input.trim())] : [];
  }
  return Array.isArray(input) ? [...input] : [input];
}

function isMessagesInput(input: AgentInput): input is {messages: BaseMessage[]} {
  return typeof input === 'object' && input !== null && 'messages' in input && Array.isArray((input as {messages?: unknown}).messages);
}

export function readLatestPause(messages: BaseMessage[]): PauseRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }
    const payload = parseHILToolMessagePayload(message.content);
    if (payload?.type === 'hil_pause') {
      return deepClone(payload.request);
    }
  }
}

export function injectResumePayload(
  context: AgentRuntimeContext | undefined,
  pause: PauseRequest,
  payload: ResumePayload,
): AgentRuntimeContext {
  const root = recordSchema.catch({}).parse(mergeContext({}, context));
  const hil = recordSchema.catch({}).parse(root.hil);
  const resumes = recordSchema.catch({}).parse(hil.resumes);
  root.hil = {
    ...hil,
    currentPause: deepClone(pause),
    resume: payload,
    resumes: {...resumes, [pause.id]: payload, [pause.action.toolCallId]: payload},
  };
  return root;
}

export function createRunContext(
  state: AgentState,
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget'> = {},
): AgentRunContext {
  const maxTurns = config.recursionLimit ?? DEFAULT_RECURSION_LIMIT;
  if (maxTurns < 1) {
    throw new Error('recursionLimit must be at least 1');
  }
  return {
    state,
    runId: randomUUID(),
    maxTurns,
    runtimeContext: deepClone(config.context ?? {}),
    shared: {},
    inputBudget: config.inputBudget,
  };
}

export function createAgent(options: CreateAgentOptions): Agent {
  const runtime = buildRuntime(options);
  const checkpoint = options.checkpoint;
  const threadId = checkpoint?.ref.threadId ?? options.threadId ?? randomUUID();
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const inputBudget = options.inputBudget;
  const summary = options.summary ? normalizeSummaryOptions(options.summary) : undefined;
  const state = createInitialAgentState(
    threadId,
    {
      agentType: options.agentType,
      ...(options.messages ? {messages: options.messages} : {}),
      ...(options.context ? {context: options.context} : {}),
      values: runtime.pipeline.createInitialValues(checkpoint?.state.values ?? options.values ?? {}),
    },
    checkpoint,
  );

  const touch = () => {
    state.updatedAt = new Date().toISOString();
  };

  const persistCheckpoint = async (source: AgentCheckpointInfo['source'], result?: AgentResult): Promise<AgentCheckpoint> => {
    const record = await checkpointer.put({
      threadId,
      ...(state.checkpointId ? {parentCheckpointId: state.checkpointId} : {}),
      state: toCheckpointState(state),
      info: toCheckpointInfo(state, source, result),
    });
    restoreCheckpointMetadata(state, record);
    return record;
  };

  const enterRunningState = () => {
    const snapshot = {status: state.status, updatedAt: state.updatedAt};
    state.status = 'running';
    touch();
    return snapshot;
  };

  const abortPreflight = (snapshot: {status: AgentStatus; updatedAt: string}, result: AgentResult): AgentResult => {
    state.status = snapshot.status;
    state.updatedAt = snapshot.updatedAt;
    return {...result, state: toAgentState(state)};
  };

  const createRun = (
    input: AgentInput,
    config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget'>,
  ): AgentRunContext => {
    const runState = toAgentState(state);
    const appended = normalizeAgentInput(input);
    if (appended.length) {
      runState.messages.push(...appended);
    }
    runState.status = 'running';
    return createRunContext(runState, {...config, inputBudget: config.inputBudget ?? inputBudget});
  };

  const applyRunResult = async (
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    shouldCheckpoint: boolean,
  ): Promise<AgentResult> => {
    state.lastResult = summarizeResult(result);
    applyAgentStateSnapshot(state, {
      messages: result.state.messages,
      context: result.state.context,
      values: runtime.pipeline.normalizeValues(cloneAgentValues(result.state.values)),
      pendingPause: readLatestPause(result.state.messages.slice(startIndex)),
    });
    state.status = state.pendingPause ? 'paused' : 'idle';
    touch();
    if (shouldCheckpoint) {
      await persistCheckpoint(source, result);
    }
    return {...result, state: toAgentState(state)};
  };

  const runBeforeHook = async (run: AgentRunContext, config?: {beforeRun?: AgentInvokeConfig['beforeRun']}): Promise<AgentResult | undefined> => {
    try {
      if (!config?.beforeRun) {
        return undefined;
      }
      await config.beforeRun({state: run.state, runId: run.runId, maxTurns: run.maxTurns});
      return undefined;
    } catch (error) {
      return {reason: 'error', state: run.state, turns: 0, error: new Error(formatErrorMessage(error, 'beforeRun failed'))};
    }
  };

  const runAfterHook = async (
    run: AgentRunContext,
    result: AgentResult,
    config?: {afterRun?: AgentInvokeConfig['afterRun']},
  ): Promise<AgentResult> => {
    try {
      if (!config?.afterRun) {
        return result;
      }
      await config.afterRun({state: run.state, runId: run.runId, maxTurns: run.maxTurns, result});
      return result;
    } catch (error) {
      return result.reason === 'error'
        ? result
        : {reason: 'error', state: run.state, turns: result.turns, error: new Error(formatErrorMessage(error, 'afterRun failed'))};
    }
  };

  const execute = async (
    input: AgentInput,
    config: AgentInvokeConfig,
    source: AgentCheckpointInfo['source'],
  ): Promise<AgentResult> => {
    const startIndex = state.messages.length;
    const run = createRun(input, config);
    const lifecycle = enterRunningState();

    try {
      runtime.pipeline.validateContext(mergeContext(run.state.context, run.runtimeContext));
      const beforeRunResult = await runBeforeHook(run, config);
      if (beforeRunResult) {
        return abortPreflight(lifecycle, beforeRunResult);
      }
      return applyRunResult(
        await runAfterHook(run, await runLoop(run, runtime), config),
        startIndex,
        source,
        config.checkpoint ?? true,
      );
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'run failed')));
    }
  };

  const executeStream = async function* (
    input: AgentInput,
    config: AgentStreamConfig,
    source: AgentCheckpointInfo['source'],
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const startIndex = state.messages.length;
    const run = createRun(input, config);
    const lifecycle = enterRunningState();

    try {
      runtime.pipeline.validateContext(mergeContext(run.state.context, run.runtimeContext));
      const beforeRunResult = await runBeforeHook(run, config);
      if (beforeRunResult) {
        return abortPreflight(lifecycle, beforeRunResult);
      }

      const stream = createStreamWriter(config);
      const execution = (async () => {
        await stream.emitValues(run.state.messages);
        const result = await runAfterHook(run, await runLoop(run, runtime, stream), config);
        const finalized = await applyRunResult(result, startIndex, source, config.checkpoint ?? true);
        stream.finish(finalized);
        return finalized;
      })().catch((error) => {
        stream.fail(error);
        throw error;
      });

      try {
        for await (const chunk of stream.stream) {
          yield chunk;
        }
        return await execution;
      } finally {
        await execution.catch(() => undefined);
      }
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'stream failed')));
    }
  };

  return {
    getState() {
      return toAgentState(state);
    },

    async compactConversation(config = {}) {
      assertNotRunning(state);
      const baseline = toAgentState(state);
      const run = createRunContext(toAgentState(state), {
        context: config.context,
        inputBudget: config.inputBudget ?? inputBudget,
        recursionLimit: 1,
      });
      const lifecycle = enterRunningState();

      try {
        runtime.pipeline.validateContext(mergeContext(run.state.context, run.runtimeContext));
        const context = await createTurnContext(run, runtime, 1, `${run.runId}:compact`);
        if (summary) {
          await compactSummaryIfNeeded(context, summary, {
            force: true,
            ...(config.instructions ? {instructions: config.instructions} : {}),
          });
        }

        const compacted = {
          agentType: baseline.agentType,
          messages: context.state.messages,
          context: context.state.context ?? {},
          values: context.state.values ?? {},
        };

        if (hasEquivalentCheckpointState(baseline, compacted)) {
          state.status = baseline.status;
          state.updatedAt = lifecycle.updatedAt;
          return baseline;
        }

        applyAgentStateSnapshot(state, {
          messages: compacted.messages,
          context: compacted.context,
          values: runtime.pipeline.normalizeValues(cloneAgentValues(compacted.values)),
          pendingPause: state.pendingPause,
        });
        state.status = state.pendingPause ? 'paused' : 'idle';
        touch();
        await persistCheckpoint('manual');
        return toAgentState(state);
      } catch (error) {
        throw abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'compact failed'))).error;
      }
    },

    async invoke(input, config = {}) {
      assertReadyForInvoke(state);
      return execute(input, config, 'invoke');
    },

    async resume(payload, config = {}) {
      assertReadyForResume(state);
      return execute(
        config.input,
        {...config, context: injectResumePayload(config.context, state.pendingPause as PauseRequest, payload)},
        'resume',
      );
    },

    async reset() {
      assertNotRunning(state);
      state.messages = [];
      state.values = runtime.pipeline.createInitialValues();
      state.pendingPause = undefined;
      state.lastResult = undefined;
      state.status = 'idle';
      touch();
      await persistCheckpoint('reset');
    },

    async dispose() {
      if (state.status === 'closed') {
        return;
      }
      assertNotRunning(state);
      state.status = 'closed';
      touch();
      await persistCheckpoint('dispose');
    },

    async *stream(input, config = {}) {
      assertReadyForInvoke(state);
      return yield* executeStream(input, config, 'invoke');
    },

    async *resumeStream(payload, config = {}) {
      assertReadyForResume(state);
      return yield* executeStream(
        config.input,
        {...config, context: injectResumePayload(config.context, state.pendingPause as PauseRequest, payload)},
        'resume',
      );
    },
  };
}

async function runLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream?: ReturnType<typeof createStreamWriter>,
): Promise<AgentResult> {
  for (let turn = 1; turn <= run.maxTurns; turn += 1) {
    try {
      if ((await runAgentTurn(run, runtime, turn, stream)) === 'complete') {
        return {reason: 'complete', state: run.state, turns: turn};
      }
    } catch (error) {
      return {reason: 'error', state: run.state, turns: turn, error: error instanceof Error ? error : new Error(String(error))};
    }
  }
  return {reason: 'max_turns', state: run.state, turns: run.maxTurns};
}

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
    systemMessage: [],
    execution: {
      threadId: run.state.threadId,
      runId: run.runId,
      turn,
      maxTurns: run.maxTurns,
      requestId,
    },
    inputBudget: run.inputBudget,
  };
  await runtime.prepareTurnContext?.(context);
  await runtime.pipeline.beforeAgent(context);
  await runtime.pipeline.beforeModel(context);
  return context;
}

function buildRuntime(options: CreateAgentOptions): AgentRuntime {
  const pipeline = new MiddlewarePipeline(options.middleware ? [...options.middleware] : []);
  const tools = [...(options.tools ?? []), ...pipeline.getTools()];
  const registry = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    if (registry.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }

  const runnable = (() => {
    if (tools.length === 0) {
      return options.model;
    }
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
    prepareTurnContext: options.prepareTurnContext,
  };
}

export function toMessageChunk(message: unknown): AIMessageChunk {
  if (AIMessageChunk.isInstance(message)) {
    return message;
  }
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
  if (AIMessage.isInstance(message)) {
    return message;
  }
  throw new Error(`${prefix}, received: ${readMessageType(message)}`);
}

function readMessageType(message: unknown): string {
  if (AIMessageChunk.isInstance(message) || BaseMessage.isInstance(message)) {
    return message.type;
  }
  if (message && typeof message === 'object' && 'type' in message && typeof (message as {type?: unknown}).type === 'string') {
    return (message as {type: string}).type;
  }
  return typeof message;
}

function assertReadyForInvoke(state: MutableAgentState): void {
  assertUsable(state);
  if (state.status === 'paused') {
    throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
  }
}

function assertReadyForResume(state: MutableAgentState): void {
  assertUsable(state);
  if (state.status !== 'paused' || !state.pendingPause) {
    throw new Error('Agent is not paused; resume(...) is only valid after a HIL pause.');
  }
}

function assertUsable(state: MutableAgentState): void {
  if (state.status === 'running') {
    throw new Error('Agent is currently running.');
  }
  if (state.status === 'closed') {
    throw new Error('Agent is closed.');
  }
}

function assertNotRunning(state: MutableAgentState): void {
  if (state.status === 'running') {
    throw new Error('Agent is currently running.');
  }
}

function createErrorResult(state: AgentState, turns: number, message: string): AgentResult {
  return {reason: 'error', state, turns, error: new Error(message)};
}
