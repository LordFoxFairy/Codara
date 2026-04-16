import {randomUUID} from 'node:crypto';
import {AIMessage, AIMessageChunk, BaseMessage, HumanMessage, ToolMessage, type ToolCall} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {mergeContext} from '../command';
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
} from '../state';
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
} from '../agent-types';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
} from '@durability/checkpoint/agent';
import {MIDDLEWARE_NAMES, type BaseExecutionContext, type MiddlewareRuntimeShared} from '@core/pipeline-types';
import {MiddlewarePipeline} from '@core/pipeline';
import {deepClone} from '@shared/clone';
import {formatErrorMessage} from '@shared/errors';
import {cheapDrainMessages, compactMessages, isContextWindowExhausted} from './compact';
import {
  computeRetryDelay,
  createRecoveryState,
  extractRetryAfter,
  isMaxOutputTokensError,
  isRateLimitError,
  isTransientError,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
  resetPerTurnFlags,
} from './error-recovery';
import {createTokenBudgetState, shouldAutoCompact, shouldStopContinuation, estimateMessagesTokenCount} from './token-budget';
import {parseReviewToolMessagePayload} from '@core/middleware/review';
import type {AgentLifecycleHooks} from '@observability/hook/types';

const DEFAULT_RECURSION_LIMIT = 25;
const recordSchema = z.record(z.string(), z.unknown());

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

// ── Input normalization ─────────────────────────────────────────────────────

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

// ── Review helpers (pure functions) ─────────────────────────────────────────

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

// ── RunContext factory ───────────────────────────────────────────────────────

export function createRunContext(
  state: AgentState,
  config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget' | 'signal'> = {},
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
    signal: config.signal,
  };
}

// ── AgentSession — the class that replaces the createAgent closure ──────────

/**
 * Encapsulates all mutable agent state and run orchestration.
 * Replaces the former 400-line `createAgent` closure with explicit state.
 */
class AgentSession {
  private readonly runtime: AgentRuntime;
  private readonly checkpointer: ReturnType<typeof createAgentMemoryCheckpointer>;
  private readonly sessionId: string;
  private readonly state: MutableAgentState;
  private readonly defaultInputBudget?: AgentInputBudget;
  private internalAbortController?: AbortController;

  constructor(options: CreateAgentOptions) {
    this.runtime = buildRuntime(options);
    const checkpoint = options.checkpoint;
    this.sessionId = checkpoint?.ref.sessionId ?? options.sessionId ?? randomUUID();
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
    this.defaultInputBudget = options.inputBudget;

    this.state = createInitialAgentState(
      this.sessionId,
      {
        agentType: options.agentType,
        ...(options.messages ? {messages: options.messages} : {}),
        ...(options.context ? {context: options.context} : {}),
        values: this.runtime.pipeline.createInitialValues(checkpoint?.state.values ?? options.values ?? {}),
      },
      checkpoint,
    );
  }

  // ── State accessors ─────────────────────────────────────────────────────

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }

  private async persistCheckpoint(source: AgentCheckpointInfo['source'], result?: AgentResult): Promise<AgentCheckpoint> {
    const record = await this.checkpointer.put({
      sessionId: this.sessionId,
      ...(this.state.checkpointId ? {parentCheckpointId: this.state.checkpointId} : {}),
      state: toCheckpointState(this.state),
      info: toCheckpointInfo(this.state, source, result),
    });
    restoreCheckpointMetadata(this.state, record);
    return record;
  }

  // ── Lifecycle guards ────────────────────────────────────────────────────

  private enterRunningState(): {status: AgentStatus; updatedAt: string} {
    const snapshot = {status: this.state.status, updatedAt: this.state.updatedAt};
    this.state.status = 'running';
    this.touch();
    return snapshot;
  }

  private abortPreflight(snapshot: {status: AgentStatus; updatedAt: string}, result: AgentResult): AgentResult {
    this.state.status = snapshot.status;
    this.state.updatedAt = snapshot.updatedAt;
    return {...result, state: toAgentState(this.state)};
  }

  // ── Run creation ────────────────────────────────────────────────────────

  private createRun(
    input: AgentInput,
    config: Pick<AgentInvokeConfig, 'recursionLimit' | 'context' | 'inputBudget' | 'signal'>,
    options: {clearPendingReview?: boolean} = {},
  ): AgentRunContext {
    const runState = toAgentState(this.state);
    const appended = normalizeAgentInput(input);
    if (appended.length) {
      runState.messages.push(...appended);
    }
    if (options.clearPendingReview) {
      runState.pendingReview = undefined;
    }
    runState.status = 'running';

    this.internalAbortController = new AbortController();
    const signal = combineAbortSignals(this.internalAbortController.signal, config.signal);

    return createRunContext(runState, {...config, inputBudget: config.inputBudget ?? this.defaultInputBudget, signal}, this.runtime.runtimeShared);
  }

  private createResumeRun(
    review: ReviewRequest,
    payload: ReviewResumePayload,
    config: Pick<AgentResumeConfig, 'context' | 'recursionLimit' | 'inputBudget' | 'signal'>,
  ): AgentRunContext {
    this.internalAbortController = new AbortController();
    const signal = combineAbortSignals(this.internalAbortController.signal, config.signal);

    return createRunContext(
      toAgentState(this.state),
      {
        inputBudget: config.inputBudget ?? this.defaultInputBudget,
        recursionLimit: config.recursionLimit,
        context: injectReviewResumePayload(config.context, review, payload),
        signal,
      },
      this.runtime.runtimeShared,
    );
  }

  // ── Result finalization ─────────────────────────────────────────────────

  private async applyRunResult(
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    shouldCheckpoint: boolean,
  ): Promise<AgentResult> {
    this.state.lastResult = summarizeResult(result);
    applyAgentStateSnapshot(this.state, {
      messages: result.state.messages,
      context: result.state.context,
      values: this.runtime.pipeline.normalizeValues(cloneAgentValues(result.state.values)),
      pendingReview: readLatestReview(result.state.messages.slice(startIndex)),
    });
    this.state.status = this.state.pendingReview ? 'paused' : 'idle';
    this.touch();
    if (shouldCheckpoint) {
      await this.persistCheckpoint(source, result);
    }
    return {...result, state: toAgentState(this.state)};
  }

  // ── Hook orchestration ──────────────────────────────────────────────────

  private async runBeforeHook(run: AgentRunContext, config?: {beforeRun?: AgentInvokeConfig['beforeRun']}): Promise<AgentResult | undefined> {
    try {
      if (!config?.beforeRun) return undefined;
      await config.beforeRun({state: run.state, runId: run.runId, maxTurns: run.maxTurns});
      return undefined;
    } catch (error) {
      return {reason: 'error', state: run.state, turns: 0, error: new Error(formatErrorMessage(error, 'beforeRun failed'))};
    }
  }

  private async runAfterHook(
    run: AgentRunContext,
    result: AgentResult,
    config?: {afterRun?: AgentInvokeConfig['afterRun']},
  ): Promise<AgentResult> {
    try {
      if (!config?.afterRun) return result;
      await config.afterRun({state: run.state, runId: run.runId, maxTurns: run.maxTurns, result});
      return result;
    } catch (error) {
      return result.reason === 'error'
        ? result
        : {reason: 'error', state: run.state, turns: result.turns, error: new Error(formatErrorMessage(error, 'afterRun failed'))};
    }
  }

  private async runPreflight(
    run: AgentRunContext,
    lifecycle: {status: AgentStatus; updatedAt: string},
    config: {beforeRun?: AgentInvokeConfig['beforeRun']},
    failurePrefix: string,
  ): Promise<AgentResult | undefined> {
    try {
      this.runtime.pipeline.validateContext(mergeContext(run.state.context, run.runtimeContext));
      const beforeRunResult = await this.runBeforeHook(run, config);
      return beforeRunResult ? this.abortPreflight(lifecycle, beforeRunResult) : undefined;
    } catch (error) {
      return this.abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, failurePrefix)));
    }
  }

  private async finalizeRun(
    run: AgentRunContext,
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    config?: {afterRun?: AgentInvokeConfig['afterRun']; checkpoint?: boolean},
  ): Promise<AgentResult> {
    return this.applyRunResult(
      await this.runAfterHook(run, result, config),
      startIndex,
      source,
      config?.checkpoint ?? true,
    );
  }

  // ── Streaming wrapper ───────────────────────────────────────────────────

  private async *executeStreaming(
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
  }

  // ── Review resume helpers ───────────────────────────────────────────────

  private prepareResumeRun(run: AgentRunContext, review: ReviewRequest): number {
    const pauseMessageIndex = findPauseMessageIndex(run.state.messages, review);
    if (pauseMessageIndex >= 0) {
      run.state.messages.splice(pauseMessageIndex, 1);
      return pauseMessageIndex;
    }
    return run.state.messages.length;
  }

  private async appendRunInput(
    run: AgentRunContext,
    input: AgentInput,
    stream?: ReturnType<typeof createStreamWriter>,
  ): Promise<void> {
    const appended = normalizeAgentInput(input);
    if (appended.length === 0) return;
    run.state.messages.push(...appended);
    if (stream) {
      await stream.emitValues(run.state.messages);
    }
  }

  private async continueFromPausedTool(
    run: AgentRunContext,
    review: ReviewRequest,
    input: AgentInput,
    stream?: ReturnType<typeof createStreamWriter>,
  ): Promise<AgentResult> {
    run.state.pendingReview = undefined;
    const toolContext = await createTurnContext(run, this.runtime, 1, `${run.runId}:resume-tool`);
    const pausedToolCall: ToolCall = {
      id: review.action.toolCallId,
      name: review.action.toolName,
      args: review.action.toolArgs ?? {},
    };
    await runTools(run, this.runtime, toolContext, [pausedToolCall], stream);
    await this.appendRunInput(run, input, stream);

    if (run.state.pendingReview) {
      await finishTurn(this.runtime, toolContext, {reason: 'complete', turns: 1});
      return {reason: 'complete', state: run.state, turns: 1};
    }

    await finishTurn(this.runtime, toolContext, {reason: 'continue', turns: 1});
    return runLoop(run, this.runtime, stream, 2);
  }

  // ── Core execution paths ────────────────────────────────────────────────

  private async execute(
    input: AgentInput,
    config: AgentInvokeConfig,
    source: AgentCheckpointInfo['source'],
  ): Promise<AgentResult> {
    const startIndex = this.state.messages.length;
    const run = this.createRun(input, config, {clearPendingReview: source === 'resume'});
    const lifecycle = this.enterRunningState();

    const preflightResult = await this.runPreflight(run, lifecycle, config, 'run failed');
    if (preflightResult) return preflightResult;

    try {
      return this.finalizeRun(run, await runLoop(run, this.runtime), startIndex, source, config);
    } catch (error) {
      return this.abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'run failed')));
    }
  }

  private async *executeStream(
    input: AgentInput,
    config: AgentStreamConfig,
    source: AgentCheckpointInfo['source'],
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const startIndex = this.state.messages.length;
    const run = this.createRun(input, config, {clearPendingReview: source === 'resume'});
    const lifecycle = this.enterRunningState();

    const preflightResult = await this.runPreflight(run, lifecycle, config, 'stream failed');
    if (preflightResult) return preflightResult;

    try {
      return yield* this.executeStreaming(config, async (stream) => {
        await stream.emitValues(run.state.messages);
        const finalized = await this.finalizeRun(run, await runLoop(run, this.runtime, stream), startIndex, source, config);
        stream.finish(finalized);
        return finalized;
      });
    } catch (error) {
      return this.abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'stream failed')));
    }
  }

  private async resumeReviewedTool(
    payload: ReviewResumePayload,
    config: AgentResumeConfig,
  ): Promise<AgentResult> {
    const pause = this.state.pendingReview as ReviewRequest;
    const run = this.createResumeRun(pause, payload, config);
    const startIndex = this.prepareResumeRun(run, pause);
    const lifecycle = this.enterRunningState();

    const preflightResult = await this.runPreflight(run, lifecycle, config, 'resume failed');
    if (preflightResult) return preflightResult;

    try {
      return this.finalizeRun(run, await this.continueFromPausedTool(run, pause, config.input), startIndex, 'resume', config);
    } catch (error) {
      return this.abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'resume failed')));
    }
  }

  private async *resumeReviewedToolStream(
    payload: ReviewResumePayload,
    config: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const pause = this.state.pendingReview as ReviewRequest;
    const run = this.createResumeRun(pause, payload, config);
    const startIndex = this.prepareResumeRun(run, pause);
    const lifecycle = this.enterRunningState();

    const preflightResult = await this.runPreflight(run, lifecycle, config, 'resume failed');
    if (preflightResult) return preflightResult;

    try {
      return yield* this.executeStreaming(config, async (stream) => {
        await stream.emitValues(run.state.messages);
        const finalized = await this.finalizeRun(
          run,
          await this.continueFromPausedTool(run, pause, config.input, stream),
          startIndex,
          'resume',
          config,
        );
        stream.finish(finalized);
        return finalized;
      });
    } catch (error) {
      return this.abortPreflight(lifecycle, createErrorResult(run.state, 0, formatErrorMessage(error, 'resume failed')));
    }
  }

  // ── Public Agent interface ──────────────────────────────────────────────

  toAgent(): Agent {
    // Capture `this` for generator functions (can't use arrow syntax with generators)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const session = this;

    return {
      getState: () => toAgentState(session.state),

      invoke: async (input, config = {}) => {
        assertReadyForInvoke(session.state);
        return session.execute(input, config, 'invoke');
      },

      resume: async (payload, config = {}) => {
        assertReadyForResume(session.state);
        if (config.resumeMode !== 'model') {
          return session.resumeReviewedTool(payload, config);
        }
        const pause = session.state.pendingReview as ReviewRequest;
        return session.execute(
          config.input,
          {...config, context: injectReviewResumePayload(config.context, pause, payload)},
          'resume',
        );
      },

      reset: async () => {
        assertNotRunning(session.state);
        session.state.messages = [];
        session.state.values = session.runtime.pipeline.createInitialValues();
        session.state.pendingReview = undefined;
        session.state.lastResult = undefined;
        session.state.status = 'idle';
        session.touch();
        await session.persistCheckpoint('reset');
      },

      dispose: async () => {
        if (session.state.status === 'closed') return;
        assertNotRunning(session.state);
        session.state.status = 'closed';
        session.touch();
        await session.persistCheckpoint('dispose');
      },

      async *stream(input, config = {}) {
        assertReadyForInvoke(session.state);
        return yield* session.executeStream(input, config, 'invoke');
      },

      async *resumeStream(payload, config = {}) {
        assertReadyForResume(session.state);
        if (config.resumeMode !== 'model') {
          return yield* session.resumeReviewedToolStream(payload, config);
        }
        const pause = session.state.pendingReview as ReviewRequest;
        return yield* session.executeStream(
          config.input,
          {...config, context: injectReviewResumePayload(config.context, pause, payload)},
          'resume',
        );
      },

      abort: () => {
        if (session.state.status !== 'running' || !session.internalAbortController) return;
        session.internalAbortController.abort('abort');
      },
    };
  }
}

// ── Factory (preserves the public API) ──────────────────────────────────────

export function createAgent(options: CreateAgentOptions): Agent {
  return new AgentSession(options).toAgent();
}

// ── Abort signal combiner ───────────────────────────────────────────────────

function combineAbortSignals(internal: AbortSignal, external?: AbortSignal): AbortSignal {
  if (!external) return internal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([internal, external]);
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(internal.aborted ? internal.reason : external.reason);
  };
  if (internal.aborted || external.aborted) {
    onAbort();
  } else {
    internal.addEventListener('abort', onAbort, {once: true});
    external.addEventListener('abort', onAbort, {once: true});
  }
  return controller.signal;
}

/** Check if signal is aborted; if so throw an AbortError for the loop to catch. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Agent run aborted');
    error.name = 'AbortError';
    throw error;
  }
}

// ── Agent loop ──────────────────────────────────────────────────────────────

async function runLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream?: ReturnType<typeof createStreamWriter>,
  startTurn = 1,
): Promise<AgentResult> {
  const keepRecentTurns = run.inputBudget?.keepRecentTurns ?? 3;
  const maxCompactionAttempts = run.inputBudget?.maxCompactionAttempts ?? 3;
  const contextWindow = run.inputBudget?.maxInputTokens ?? 128_000;
  const budget = createTokenBudgetState(contextWindow);
  const summaryHandlesCompaction = runtime.pipeline.has(MIDDLEWARE_NAMES.Summary);
  const recovery = createRecoveryState();

  for (let turn = startTurn; turn <= run.maxTurns; turn += 1) {
    if (run.signal?.aborted) {
      return {reason: 'aborted', state: run.state, turns: turn - startTurn};
    }

    resetPerTurnFlags(recovery);

    // Proactive auto-compact (skip when SummaryMiddleware handles it)
    budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
    if (!summaryHandlesCompaction && shouldAutoCompact(budget) && recovery.compactionAttempts < maxCompactionAttempts) {
      recovery.compactionAttempts += 1;
      run.state.messages = compactMessages(run.state.messages, {keepRecentTurns});
      budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
    }

    // Budget exhaustion check (skip on first turn)
    if (budget.continuationCount > 0 && shouldStopContinuation(budget)) {
      return {reason: 'budget_exhausted', state: run.state, turns: turn - startTurn};
    }

    try {
      run.state.messages = [...run.state.messages];
      const preEstimate = budget.estimatedUsed;
      const turnResult = await runAgentTurn(run, runtime, turn, stream);

      // Post-turn budget tracking
      const newEstimate = estimateMessagesTokenCount(run.state.messages);
      budget.lastDeltaTokens = newEstimate - preEstimate;
      budget.estimatedUsed = newEstimate;
      budget.continuationCount += 1;
      recovery.cumulativeTokensUsed += (newEstimate - preEstimate);

      if (turnResult.reason !== 'complete') {
        continue;
      }

      // Invoke Stop hook — if vetoed, inject messages and continue loop
      const vetoed = await invokeStopHook(runtime, run, turn, false);
      if (vetoed) {
        continue;
      }

      return {
        reason: 'complete',
        state: run.state,
        turns: turn,
        ...(turnResult.launchedSubagentBatchIds?.length
          ? {launchedSubagentBatchIds: turnResult.launchedSubagentBatchIds}
          : {}),
      };
    } catch (error) {
      const recovered = await handleTurnError(error, run, recovery, budget, keepRecentTurns, maxCompactionAttempts);
      if (recovered === 'continue') {
        continue;
      }
      return recovered;
    }
  }

  // Max turns reached
  await invokeStopHook(runtime, run, run.maxTurns, true);
  return {reason: 'max_turns', state: run.state, turns: run.maxTurns};
}

// ── Stop hook helper ────────────────────────────────────────────────────────

/**
 * Invoke the Stop lifecycle hook. Returns true if the hook vetoed (and
 * messages were injected), false otherwise.
 */
async function invokeStopHook(
  runtime: AgentRuntime,
  run: AgentRunContext,
  turn: number,
  reachedMaxTurns: boolean,
): Promise<boolean> {
  if (!runtime.lifecycle) return false;
  try {
    const stopResult = await runtime.lifecycle.onStop({
      hookEvent: 'Stop',
      sessionId: run.state.sessionId,
      reason: 'complete',
      reachedMaxTurns,
      turns: turn,
      lastMessage: getLastAIMessagePreview(run.state.messages),
      timestamp: new Date().toISOString(),
    });
    if (!reachedMaxTurns && stopResult.vetoed) {
      for (const msg of stopResult.systemMessages) {
        run.state.messages.push(new HumanMessage({content: `[system] ${msg}`}));
      }
      return true;
    }
  } catch (err) {
    // Fail-open: if hook errors, allow stop. Log for observability.
    if (process.env.DEBUG) console.warn('[agent] Stop hook error (fail-open):', err);
  }
  return false;
}

// ── Error recovery pipeline ─────────────────────────────────────────────────

type TurnRecovery = 'continue' | AgentResult;

/**
 * Multi-stage error recovery. Returns 'continue' to retry the turn,
 * or an AgentResult to terminate the loop.
 *
 * Stages (aligned with Claude Code query.ts):
 * 0. Abort
 * 1. Max output tokens → continuation prompt
 * 2. Context window exhaustion → cheap drain → full compact
 * 3. Rate limit → exponential backoff
 * 4. Transient → single retry
 * 5. Unrecoverable → error result
 */
async function handleTurnError(
  error: unknown,
  run: AgentRunContext,
  recovery: ReturnType<typeof createRecoveryState>,
  budget: ReturnType<typeof createTokenBudgetState>,
  keepRecentTurns: number,
  maxCompactionAttempts: number,
): Promise<TurnRecovery> {
  // Stage 0: Abort
  if (error instanceof Error && error.name === 'AbortError') {
    return {reason: 'aborted', state: run.state, turns: 0};
  }

  // Stage 1: Max output tokens
  if (isMaxOutputTokensError(error) && recovery.maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
    recovery.maxOutputTokensRecoveryCount += 1;
    run.state.messages.push(new HumanMessage({
      content:
        'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
        'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
    }));
    return 'continue';
  }

  // Stage 2: Context window exhaustion
  if (isContextWindowExhausted(error)) {
    // 2a: Cheap drain
    if (!recovery.cheapDrainAttempted) {
      recovery.cheapDrainAttempted = true;
      const drainResult = cheapDrainMessages(run.state.messages, keepRecentTurns);
      if (drainResult.freedCount > 0) {
        run.state.messages = drainResult.messages;
        budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
        return 'continue';
      }
    }
    // 2b: Full compaction
    if (recovery.compactionAttempts < maxCompactionAttempts) {
      recovery.compactionAttempts += 1;
      run.state.messages = compactMessages(run.state.messages, {keepRecentTurns});
      budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
      return 'continue';
    }
  }

  // Stage 3: Rate limit → exponential backoff with jitter
  if (isRateLimitError(error) && recovery.rateLimitAttempt < 3) {
    recovery.rateLimitAttempt += 1;
    const retryAfterMs = extractRetryAfter(error);
    const delay = computeRetryDelay(recovery.rateLimitAttempt, retryAfterMs);
    await new Promise(resolve => setTimeout(resolve, delay));
    return 'continue';
  }

  // Stage 4: Transient API error → single retry per turn
  if (isTransientError(error) && !recovery.transientRetried) {
    recovery.transientRetried = true;
    return 'continue';
  }

  // Stage 5: Unrecoverable
  return {reason: 'error', state: run.state, turns: 0, error: error instanceof Error ? error : new Error(String(error))};
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

function buildRuntime(options: CreateAgentOptions): AgentRuntime {
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

// ── State assertions ────────────────────────────────────────────────────────

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
  if (state.status === 'running') throw new Error('Agent is currently running.');
  if (state.status === 'closed') throw new Error('Agent is closed.');
}

function assertNotRunning(state: MutableAgentState): void {
  if (state.status === 'running') throw new Error('Agent is currently running.');
}

function createErrorResult(state: AgentState, turns: number, message: string): AgentResult {
  return {reason: 'error', state, turns, error: new Error(message)};
}
