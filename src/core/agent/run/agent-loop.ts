import {randomUUID} from 'node:crypto';
import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {mergeContext} from '../models/command';
import {
  applyAgentStateSnapshot,
  cloneAgentValues,
  createInitialAgentState,
  restoreCheckpointMetadata,
  summarizeResult,
  toAgentState,
  toCheckpointInfo,
  toCheckpointState,
  type MutableAgentState,
} from '../models/state';
import {createStreamWriter} from './stream';
import {finishTurn, runAgentTurn, runTools} from './turn';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentState,
  AgentStatus,
  AgentStreamConfig,
  AgentStreamOutput,
  AgentContextPreparer,
  CreateAgentOptions,
  ReviewRequest,
  ReviewResumePayload,
  ToolErrorHandler,
} from '../models/agent';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
} from '@durability/checkpoint/agent';
import type {BaseExecutionContext, MiddlewareRuntimeShared} from '@core/pipeline/types';
import {MiddlewarePipeline} from '@core/pipeline/pipeline';
import {deepClone} from '@shared/clone';
import {formatErrorMessage} from './errors';
import {parseReviewToolMessagePayload} from '@core/middleware/review';
import type {AgentLifecycleHooks} from '@observability/hook/types';

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

export function readLatestReview(messages: BaseMessage[]): ReviewRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }
    const payload = parseReviewToolMessagePayload(message.content);
    if (payload?.type === 'review_pause') {
      return deepClone(payload.request);
    }
  }
}

function findPauseMessageIndex(messages: BaseMessage[], review: ReviewRequest): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }
    const payload = parseReviewToolMessagePayload(message.content);
    if (payload?.type !== 'review_pause') {
      continue;
    }
    if (payload.request.id === review.id) {
      return index;
    }
  }
  return -1;
}

export function injectReviewResumePayload(
  context: AgentRuntimeContext | undefined,
  review: ReviewRequest,
  payload: ReviewResumePayload,
): AgentRuntimeContext {
  const root = recordSchema.catch({}).parse(mergeContext({}, context));
  const currentReviewContext = recordSchema.catch({}).parse(root.review);
  const resumes = recordSchema.catch({}).parse(currentReviewContext.resumes);
  root.review = {
    ...currentReviewContext,
    currentReview: deepClone(review),
    resume: payload,
    resumes: {...resumes, [review.id]: payload, [review.action.toolCallId]: payload},
  };
  return root;
}

export function createRunContext(
  state: AgentState,
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget'> = {},
  runtimeShared: MiddlewareRuntimeShared = {},
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
    shared: deepClone(runtimeShared),
    inputBudget: config.inputBudget,
  };
}

export function createAgent(options: CreateAgentOptions): Agent {
  const runtime = buildRuntime(options);
  const checkpoint = options.checkpoint;
  const sessionId = checkpoint?.ref.sessionId ?? options.sessionId ?? randomUUID();
  const checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const inputBudget = options.inputBudget;
  const state = createInitialAgentState(
    sessionId,
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
      sessionId,
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
    options: {clearPendingReview?: boolean} = {},
  ): AgentRunContext => {
    const runState = toAgentState(state);
    const appended = normalizeAgentInput(input);
    if (appended.length) {
      runState.messages.push(...appended);
    }
    if (options.clearPendingReview) {
      runState.pendingReview = undefined;
    }
    runState.status = 'running';
    return createRunContext(runState, {...config, inputBudget: config.inputBudget ?? inputBudget}, runtime.runtimeShared);
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
      pendingReview: readLatestReview(result.state.messages.slice(startIndex)),
    });
    state.status = state.pendingReview ? 'paused' : 'idle';
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

  const runPreflight = async (
    run: AgentRunContext,
    lifecycle: {status: AgentStatus; updatedAt: string},
    config: {beforeRun?: AgentInvokeConfig['beforeRun']},
    failurePrefix: string,
  ): Promise<AgentResult | undefined> => {
    try {
      runtime.pipeline.validateContext(mergeContext(run.state.context, run.runtimeContext));
      const beforeRunResult = await runBeforeHook(run, config);
      return beforeRunResult ? abortPreflight(lifecycle, beforeRunResult) : undefined;
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, failurePrefix)));
    }
  };

  const finalizeRun = async (
    run: AgentRunContext,
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    config?: {afterRun?: AgentInvokeConfig['afterRun']; checkpoint?: boolean},
  ): Promise<AgentResult> => {
    return applyRunResult(
      await runAfterHook(run, result, config),
      startIndex,
      source,
      config?.checkpoint ?? true,
    );
  };

  const executeStreaming = async function* (
    config: AgentStreamConfig | AgentResumeStreamConfig,
    executeWithStream: (stream: ReturnType<typeof createStreamWriter>) => Promise<AgentResult>,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const stream = createStreamWriter(config);
    const execution = executeWithStream(stream).catch((error) => {
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
  };

  const createResumeRun = (
    review: ReviewRequest,
    payload: ReviewResumePayload,
    config: Pick<AgentResumeConfig, 'context' | 'recursionLimit' | 'inputBudget'>,
  ): AgentRunContext => {
    return createRunContext(
      toAgentState(state),
      {
        inputBudget: config.inputBudget ?? inputBudget,
        recursionLimit: config.recursionLimit,
        context: injectReviewResumePayload(config.context, review, payload),
      },
      runtime.runtimeShared,
    );
  };

  const createPausedToolCall = (review: ReviewRequest): ToolCall => ({
    id: review.action.toolCallId,
    name: review.action.toolName,
    args: review.action.toolArgs ?? {},
  });

  const appendRunInput = async (
    run: AgentRunContext,
    input: AgentInput,
    stream?: ReturnType<typeof createStreamWriter>,
  ): Promise<void> => {
    const appended = normalizeAgentInput(input);
    if (appended.length === 0) {
      return;
    }

    run.state.messages.push(...appended);
    if (stream) {
      await stream.emitValues(run.state.messages);
    }
  };

  const continueFromPausedTool = async (
    run: AgentRunContext,
    review: ReviewRequest,
    input: AgentInput,
    stream?: ReturnType<typeof createStreamWriter>,
  ): Promise<AgentResult> => {
    run.state.pendingReview = undefined;
    const toolContext = await createTurnContext(run, runtime, 1, `${run.runId}:resume-tool`);
    await runTools(run, runtime, toolContext, [createPausedToolCall(review)], stream);
    await appendRunInput(run, input, stream);

    if (run.state.pendingReview) {
      await finishTurn(runtime, toolContext, {reason: 'complete', turns: 1});
      return {reason: 'complete', state: run.state, turns: 1};
    }

    await finishTurn(runtime, toolContext, {reason: 'continue', turns: 1});
    return runLoop(run, runtime, stream, 2);
  };

  const prepareResumeRun = (
    run: AgentRunContext,
    review: ReviewRequest,
  ): number => {
    const pauseMessageIndex = findPauseMessageIndex(run.state.messages, review);
    if (pauseMessageIndex >= 0) {
      run.state.messages.splice(pauseMessageIndex, 1);
      return pauseMessageIndex;
    }
    return run.state.messages.length;
  };

  const execute = async (
    input: AgentInput,
    config: AgentInvokeConfig,
    source: AgentCheckpointInfo['source'],
  ): Promise<AgentResult> => {
    const startIndex = state.messages.length;
    const run = createRun(input, config, {clearPendingReview: source === 'resume'});
    const lifecycle = enterRunningState();

    const preflightResult = await runPreflight(run, lifecycle, config, 'run failed');
    if (preflightResult) {
      return preflightResult;
    }

    try {
      return finalizeRun(run, await runLoop(run, runtime), startIndex, source, config);
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
    const run = createRun(input, config, {clearPendingReview: source === 'resume'});
    const lifecycle = enterRunningState();

    const preflightResult = await runPreflight(run, lifecycle, config, 'stream failed');
    if (preflightResult) {
      return preflightResult;
    }

    try {
      return yield* executeStreaming(config, async (stream) => {
        await stream.emitValues(run.state.messages);
        const finalized = await finalizeRun(run, await runLoop(run, runtime, stream), startIndex, source, config);
        stream.finish(finalized);
        return finalized;
      });
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'stream failed')));
    }
  };

  const resumeReviewdTool = async (
    payload: ReviewResumePayload,
    config: AgentResumeConfig,
  ): Promise<AgentResult> => {
    const pause = state.pendingReview as ReviewRequest;
    const run = createResumeRun(pause, payload, config);
    const startIndex = prepareResumeRun(run, pause);
    const lifecycle = enterRunningState();

    const preflightResult = await runPreflight(run, lifecycle, config, 'resume failed');
    if (preflightResult) {
      return preflightResult;
    }

    try {
      return finalizeRun(run, await continueFromPausedTool(run, pause, config.input), startIndex, 'resume', config);
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'resume failed')));
    }
  };

  const resumeReviewdToolStream = async function* (
    payload: ReviewResumePayload,
    config: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const pause = state.pendingReview as ReviewRequest;
    const run = createResumeRun(pause, payload, config);
    const startIndex = prepareResumeRun(run, pause);
    const lifecycle = enterRunningState();

    const preflightResult = await runPreflight(run, lifecycle, config, 'resume failed');
    if (preflightResult) {
      return preflightResult;
    }

    try {
      return yield* executeStreaming(config, async (stream) => {
        await stream.emitValues(run.state.messages);
        const finalized = await finalizeRun(
          run,
          await continueFromPausedTool(run, pause, config.input, stream),
          startIndex,
          'resume',
          config,
        );
        stream.finish(finalized);
        return finalized;
      });
    } catch (error) {
      return abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'resume failed')));
    }
  };

  return {
    getState() {
      return toAgentState(state);
    },

    async invoke(input, config = {}) {
      assertReadyForInvoke(state);
      return execute(input, config, 'invoke');
    },

    async resume(payload, config = {}) {
      assertReadyForResume(state);
      if (config.resumeMode !== 'model') {
        return resumeReviewdTool(payload, config);
      }
      const pause = state.pendingReview as ReviewRequest;
      return execute(
        config.input,
        {...config, context: injectReviewResumePayload(config.context, pause, payload)},
        'resume',
      );
    },

    async reset() {
      assertNotRunning(state);
      state.messages = [];
      state.values = runtime.pipeline.createInitialValues();
      state.pendingReview = undefined;
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
      if (config.resumeMode !== 'model') {
        return yield* resumeReviewdToolStream(payload, config);
      }
      const pause = state.pendingReview as ReviewRequest;
      return yield* executeStream(
        config.input,
        {...config, context: injectReviewResumePayload(config.context, pause, payload)},
        'resume',
      );
    },
  };
}

async function runLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream?: ReturnType<typeof createStreamWriter>,
  startTurn = 1,
): Promise<AgentResult> {
  for (let turn = startTurn; turn <= run.maxTurns; turn += 1) {
    try {
      if ((await runAgentTurn(run, runtime, turn, stream)) === 'complete') {
        // Invoke Stop hook — if vetoed, inject messages and continue loop
        if (runtime.lifecycle) {
          try {
            const stopResult = await runtime.lifecycle.onStop({
              hookEvent: 'Stop',
              sessionId: run.state.sessionId,
              reason: 'complete',
              reachedMaxTurns: false,
              turns: turn,
              lastMessage: getLastAIMessagePreview(run.state.messages),
              timestamp: new Date().toISOString(),
            });
            if (stopResult.vetoed) {
              // Inject system messages and continue the loop
              for (const msg of stopResult.systemMessages) {
                run.state.messages.push(new HumanMessage({content: `[system] ${msg}`}));
              }
              continue;
            }
          } catch {
            // Fail-open: if hook errors, allow stop
          }
        }
        return {reason: 'complete', state: run.state, turns: turn};
      }
    } catch (error) {
      return {reason: 'error', state: run.state, turns: turn, error: error instanceof Error ? error : new Error(String(error))};
    }
  }

  // Max turns reached — also invoke Stop hook but don't veto (already at limit)
  if (runtime.lifecycle) {
    try {
      await runtime.lifecycle.onStop({
        hookEvent: 'Stop',
        sessionId: run.state.sessionId,
        reason: 'complete',
        reachedMaxTurns: true,
        turns: run.maxTurns,
        lastMessage: getLastAIMessagePreview(run.state.messages),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Fail-open
    }
  }

  return {reason: 'max_turns', state: run.state, turns: run.maxTurns};
}

function getLastAIMessagePreview(messages: BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(messages[i])) {
      const content = messages[i]!.content;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      return text.slice(0, 200);
    }
  }
  return undefined;
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
    systemMessage: [...(options.systemMessage ?? [])],
    runtimeShared: deepClone(options.runtimeShared ?? {}),
    prepareContext: options.prepareContext,
    lifecycle: options.lifecycle,
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
  if (state.status !== 'paused' || !state.pendingReview) {
    throw new Error('Agent is not paused; resume(...) is only valid after a review pause.');
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
