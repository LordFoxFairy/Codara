import {randomUUID} from 'node:crypto';
import {
  applyAgentStateSnapshot,
  createInitialAgentState,
  cloneValues,
  hasEquivalentCheckpointState,
  summarizeResult,
  type MutableAgentState,
} from '@core/agents/engine/state';
import {
  injectResumePayload,
  normalizeAgentInput,
  readLatestPause,
} from '@core/agents/engine/runtime-input';
import {
  createAgentState,
  persistAgentCheckpoint,
  updateStateFromCheckpointRecord,
} from '@core/agents/engine/checkpoint';
import {
  createRunContext,
  resolveEffectiveContext,
  runAfterHook,
  runBeforeModelStage,
  runBeforeHook,
  runLoop,
  streamLoop,
  type AgentRuntime,
} from '@core/agents/loop/run';
import {buildAgentRuntime} from '@core/agents/engine/runtime';
import {createStreamWriter} from '@core/agents/engine/stream-writer';
import type {
  Agent,
  AgentInput,
  AgentInputBudget,
  AgentInvokeConfig,
  AgentResult,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentState,
  AgentStatus,
  CreateAgentOptions,
} from '@core/agents/contract/agent';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/contract/stream';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
  type AgentCheckpointer,
} from '@core/checkpoint';
import type {PauseRequest, ResumePayload} from '@core/agents/contract/pause';
import {formatErrorMessage} from '@core/support/errors';
import {
  compactSummaryIfNeeded,
  normalizeSummaryOptions,
  type SummaryOptions,
} from '@core/middleware/conversation';

/** `createAgent(...)` 返回的默认实现。 */
class AgentInstance implements Agent {
  private readonly runtime: AgentRuntime;
  private readonly threadId: string;
  private readonly checkpointer: AgentCheckpointer;
  private readonly inputBudget: AgentInputBudget | undefined;
  private readonly summary: Required<SummaryOptions> | undefined;
  private readonly state: MutableAgentState;

  constructor(options: CreateAgentOptions) {
    this.runtime = buildAgentRuntime(options);
    const checkpoint = options.checkpoint;
    this.threadId = checkpoint?.ref.threadId ?? options.threadId ?? randomUUID();
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
    this.inputBudget = options.inputBudget;
    this.summary = options.summary ? normalizeSummaryOptions(options.summary) : undefined;
    const initialValues = this.runtime.pipeline.createInitialValues(checkpoint?.state.values ?? options.values ?? {});
    this.state = createInitialAgentState(
      this.threadId,
      {
        agentType: options.agentType,
        ...(options.messages ? {messages: options.messages} : {}),
        ...(options.context ? {context: options.context} : {}),
        values: initialValues,
      },
      checkpoint
    );
  }

  getState(): AgentState {
    return createAgentState(this.state);
  }

  async compactConversation(
    config: Pick<AgentInvokeConfig, 'context' | 'inputBudget'> & {
      instructions?: string;
    } = {}
  ): Promise<AgentState> {
    assertNotRunning(this.state);
    const baselineState = createAgentState(this.state);
    const run = createRunContext(createAgentState(this.state), {
      context: config.context,
      inputBudget: config.inputBudget ?? this.inputBudget,
      recursionLimit: 1,
    });
    const lifecycle = this.enterRunningState();
    const effectiveContext = resolveEffectiveContext(run);

    try {
      this.runtime.pipeline.validateContext(effectiveContext);
    } catch (error) {
      const result = this.abortPreflight(
        lifecycle,
        createErrorResult(run.state, 0, formatErrorMessage(error, 'context validation failed'))
      );
      throw result.error;
    }

    let context;
    try {
      context = await runBeforeModelStage(run, this.runtime, 1, `${run.runId}:compact`);
      if (this.summary) {
        await compactSummaryIfNeeded(context, this.summary, {
          force: true,
          ...(config.instructions ? {instructions: config.instructions} : {}),
        });
      }
    } catch (error) {
      const result = this.abortPreflight(lifecycle, createErrorResult(run.state, 0, toErrorMessage(error)));
      throw result.error;
    }

    const compactedState = {
      agentType: baselineState.agentType,
      messages: context.state.messages,
      context: context.state.context ?? {},
      values: context.state.values ?? {},
    };

    if (hasEquivalentCheckpointState(baselineState, compactedState)) {
      this.state.status = baselineState.status;
      this.state.updatedAt = lifecycle.updatedAt;
      return baselineState;
    }

    applyAgentStateSnapshot(this.state, {
      messages: compactedState.messages,
      context: compactedState.context,
      values: this.runtime.pipeline.normalizeValues(cloneValues(compactedState.values)),
      pendingPause: this.state.pendingPause,
    });
    this.state.status = this.state.pendingPause ? 'paused' : 'idle';
    this.touch();
    await this.persistCheckpoint('manual');
    return createAgentState(this.state);
  }

  async invoke(input?: AgentInput, config: AgentInvokeConfig = {}): Promise<AgentResult> {
    assertReadyForInvoke(this.state);
    return this.execute(input, config, 'invoke');
  }

  async resume(payload: ResumePayload, config: AgentResumeConfig = {}): Promise<AgentResult> {
    assertReadyForResume(this.state);
    const pause = this.state.pendingPause as PauseRequest;
    const context = injectResumePayload(config.context, pause, payload);
    return this.execute(config.input, {...config, context}, 'resume');
  }

  async reset(): Promise<void> {
    assertNotRunning(this.state);
    this.state.messages = [];
    this.state.values = this.runtime.pipeline.createInitialValues();
    this.state.pendingPause = undefined;
    this.state.lastResult = undefined;
    this.state.status = 'idle';
    this.touch();
    await this.persistCheckpoint('reset');
  }

  async dispose(): Promise<void> {
    if (this.state.status === 'closed') {
      return;
    }

    assertNotRunning(this.state);
    this.state.status = 'closed';
    this.touch();
    await this.persistCheckpoint('dispose');
  }

  async *stream(
    input?: AgentInput,
    config: AgentStreamConfig = {}
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    assertReadyForInvoke(this.state);
    return yield* this.executeStream(input, config, 'invoke');
  }

  async *resumeStream(
    payload: ResumePayload,
    config: AgentResumeStreamConfig = {}
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    assertReadyForResume(this.state);
    const pause = this.state.pendingPause as PauseRequest;
    const context = injectResumePayload(config.context, pause, payload);
    return yield* this.executeStream(config.input, {...config, context}, 'resume');
  }

  private async execute(
    input: AgentInput,
    config: AgentInvokeConfig,
    source: AgentCheckpointInfo['source']
  ): Promise<AgentResult> {
    const runState = this.createPendingRunState(input);
    const startIndex = this.state.messages.length;
    const run = createRunContext(runState, {
      ...config,
      context: config.context,
      inputBudget: config.inputBudget ?? this.inputBudget,
    });
    const lifecycle = this.enterRunningState();

    try {
      this.runtime.pipeline.validateContext(resolveEffectiveContext(run));
    } catch (error) {
      return this.abortPreflight(
        lifecycle,
        createErrorResult(runState, 0, formatErrorMessage(error, 'context validation failed'))
      );
    }

    const beforeRunResult = await runBeforeHook(run, config);
    if (beforeRunResult) {
      return this.abortPreflight(lifecycle, beforeRunResult);
    }

    const loopResult = await runLoop(run, this.runtime);
    const result = await runAfterHook(run, loopResult, config);
    return this.applyRunResult(result, startIndex, source, config.checkpoint ?? true);
  }

  private async *executeStream(
    input: AgentInput,
    config: AgentStreamConfig,
    source: AgentCheckpointInfo['source']
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const runState = this.createPendingRunState(input);
    const startIndex = this.state.messages.length;
    const run = createRunContext(runState, {
      ...config,
      context: config.context,
      inputBudget: config.inputBudget ?? this.inputBudget,
    });
    const lifecycle = this.enterRunningState();

    try {
      this.runtime.pipeline.validateContext(resolveEffectiveContext(run));
    } catch (error) {
      return this.abortPreflight(
        lifecycle,
        createErrorResult(runState, 0, formatErrorMessage(error, 'context validation failed'))
      );
    }

    const beforeRunResult = await runBeforeHook(run, config);
    if (beforeRunResult) {
      return this.abortPreflight(lifecycle, beforeRunResult);
    }

    const stream = createStreamWriter(config);
    const execution = (async () => {
      await stream.emitValues(run.state.messages);
      const loopResult = await streamLoop(run, this.runtime, stream);
      const result = await runAfterHook(run, loopResult, config);
      const finalized = await this.applyRunResult(result, startIndex, source, config.checkpoint ?? true);
      stream.finish(finalized);
      return finalized;
    })().catch((error) => {
      stream.fail(error);
      throw error;
    });

    try {
      while (true) {
        const next = await stream.stream.next();
        if (next.done) {
          return next.value;
        }
        yield next.value;
      }
    } finally {
      await execution.catch(() => undefined);
    }
  }

  private createPendingRunState(input: AgentInput): AgentState {
    const pendingState = createAgentState(this.state);
    const appendedInput = normalizeAgentInput(input);
    if (appendedInput.length > 0) {
      pendingState.messages.push(...appendedInput);
    }

    pendingState.status = 'running';
    return pendingState;
  }

  private enterRunningState(): RunLifecycleSnapshot {
    const snapshot: RunLifecycleSnapshot = {
      status: this.state.status,
      updatedAt: this.state.updatedAt,
    };
    this.state.status = 'running';
    this.touch();
    return snapshot;
  }

  private abortPreflight(snapshot: RunLifecycleSnapshot, result: AgentResult): AgentResult {
    this.state.status = snapshot.status;
    this.state.updatedAt = snapshot.updatedAt;
    return {
      ...result,
      state: createAgentState(this.state),
    };
  }

  private async applyRunResult(
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    checkpoint: boolean
  ): Promise<AgentResult> {
    this.state.lastResult = summarizeResult(result);
    applyAgentStateSnapshot(this.state, {
      messages: result.state.messages,
      context: result.state.context,
      values: this.runtime.pipeline.normalizeValues(cloneValues(result.state.values)),
      pendingPause: readLatestPause(result.state.messages.slice(startIndex)),
    });
    this.state.status = this.state.pendingPause ? 'paused' : 'idle';
    this.touch();

    if (checkpoint) {
      await this.persistCheckpoint(source, result);
    }

    return {
      ...result,
      state: createAgentState(this.state),
    };
  }

  private async persistCheckpoint(source: AgentCheckpointInfo['source'], result?: AgentResult): Promise<AgentCheckpoint> {
    const record = await persistAgentCheckpoint(this.checkpointer, this.threadId, this.state, source, result);
    updateStateFromCheckpointRecord(this.state, record);
    return record;
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }
}

export function createAgent(options: CreateAgentOptions): Agent {
  return new AgentInstance(options);
}

function assertReadyForInvoke(state: MutableAgentState): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status === 'paused') {
    throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
  }
}

function assertReadyForResume(state: MutableAgentState): void {
  assertNotClosed(state);
  assertNotRunning(state);

  if (state.status !== 'paused' || !state.pendingPause) {
    throw new Error('Agent is not paused; resume(...) is only valid after a HIL pause.');
  }
}

function assertNotRunning(state: MutableAgentState): void {
  if (state.status === 'running') {
    throw new Error('Agent is currently running.');
  }
}

function assertNotClosed(state: MutableAgentState): void {
  if (state.status === 'closed') {
    throw new Error('Agent is closed.');
  }
}

function createErrorResult(state: AgentState, turns: number, message: string): AgentResult {
  return {
    reason: 'error',
    state,
    turns,
    error: new Error(message),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunLifecycleSnapshot {
  status: AgentStatus;
  updatedAt: string;
}
