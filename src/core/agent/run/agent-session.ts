import {randomUUID} from 'node:crypto';
import {type ToolCall} from '@langchain/core/messages';
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
import {finishTurn, runTools} from './turn';
import {runLoop} from './agent-loop';
import {buildRuntime, createTurnContext, type AgentRunContext, type AgentRuntime} from './agent-runtime';
import {
  createRunContext,
  findPauseMessageIndex,
  injectReviewResumePayload,
  normalizeAgentInput,
  readLatestReview,
} from './agent-input';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentState,
  AgentStatus,
  AgentStreamConfig,
  AgentStreamOutput,
  CreateAgentOptions,
  ReviewRequest,
  ReviewResumePayload,
} from '../agent-types';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
} from '@state/checkpoint/agent';
import {formatErrorMessage} from '@shared/errors';

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
