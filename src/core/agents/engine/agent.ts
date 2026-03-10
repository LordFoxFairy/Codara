import {randomUUID} from 'node:crypto';
import {
  createInitialAgentState,
  cloneValues,
  summarizeResult,
  type MutableAgentState,
} from '@core/agents/engine/state';
import {
  injectResumePayload,
  mergeContext,
  normalizeAgentInput,
  readLatestPause,
} from '@core/agents/engine/runtime-input';
import {
  createAgentState,
  persistAgentCheckpoint,
  updateStateFromCheckpointRecord,
} from '@core/agents/engine/checkpoint';
import {assertNotRunning, assertReadyForInvoke, assertReadyForResume} from '@core/agents/engine/lifecycle';
import {
  createRunContext,
  runAfterHook,
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
  CreateAgentOptions,
} from '@core/agents/contract/agent';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/contract/stream';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
  type AgentCheckpointer,
} from '@core/checkpoint/state';
import type {PauseRequest, ResumePayload} from '@core/agents/contract/pause';
import {formatErrorMessage} from '@core/shared/errors';

/** `createAgent(...)` 返回的默认实现。 */
class AgentInstance implements Agent {
  private readonly runtime: AgentRuntime;
  private readonly threadId: string;
  private readonly checkpointer: AgentCheckpointer;
  private readonly inputBudget: AgentInputBudget | undefined;
  private readonly state: MutableAgentState;

  constructor(options: CreateAgentOptions) {
    this.runtime = buildAgentRuntime(options);
    const checkpoint = options.checkpoint;
    this.threadId = checkpoint?.ref.threadId ?? options.threadId ?? randomUUID();
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
    this.inputBudget = options.inputBudget;
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
    return createAgentState(this.threadId, this.state);
  }

  async compactConversation(
    config: Pick<AgentInvokeConfig, 'context' | 'inputBudget'> & {
      instructions?: string;
    } = {}
  ): Promise<AgentState> {
    assertNotRunning(this.state);
    const manualCompactContext = mergeContext(config.context ?? {}, {
      codara: {
        forceCompactConversation: true,
        ...(config.instructions ? {compactInstructions: config.instructions} : {}),
      },
    });
    const state = createAgentState(this.threadId, this.state);
    const run = createRunContext(state, this.state.context, this.state.values, {
      context: mergeContext(this.state.context, manualCompactContext),
      inputBudget: config.inputBudget ?? this.inputBudget,
      recursionLimit: 1,
    });

    // 合并持久化上下文和临时上下文
    const effectiveContext = mergeContext(run.state.context, run.runtimeContext);

    const context = {
      state: run.state,
      messages: run.state.messages,
      runtime: {
        context: effectiveContext,
        agentContext: effectiveContext,
        shared: run.shared,
      },
      systemMessage: [],
      runId: run.runId,
      turn: 1,
      maxTurns: 1,
      requestId: `${run.runId}:compact`,
      inputBudget: run.inputBudget,
    };

    this.runtime.pipeline.validateContext(effectiveContext);
    await this.runtime.pipeline.beforeAgent(context);
    await this.runtime.pipeline.beforeModel(context);

    this.state.messages = [...context.state.messages];
    this.state.context = mergeContext({}, context.state.context);
    this.state.values = this.runtime.pipeline.normalizeValues(cloneValues(context.state.values));
    this.state.pendingPause = context.state.pendingPause;
    this.state.status = this.state.pendingPause ? 'paused' : 'idle';
    this.touch();
    await this.persistCheckpoint('manual');

    return createAgentState(this.threadId, this.state);
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
    const loopState = this.prepareLoop(input);
    const startIndex = this.state.messages.length;
    const run = createRunContext(loopState, this.state.context, this.state.values, {
      ...config,
      context: mergeContext(this.state.context, config.context),
      inputBudget: config.inputBudget ?? this.inputBudget,
    });

    try {
      this.runtime.pipeline.validateContext(run.runtimeContext);
    } catch (error) {
      return createErrorResult(loopState, 0, formatErrorMessage(error, 'context validation failed'));
    }

    const beforeRunResult = await runBeforeHook(run, config);
    if (beforeRunResult) {
      return beforeRunResult;
    }

    const loopResult = await runLoop(run, this.runtime);
    const result = await runAfterHook(run, loopResult, config);
    this.state.messages = [...result.state.messages];
    await this.applyRunResult(result, startIndex, source, config.checkpoint ?? true);
    return result;
  }

  private async *executeStream(
    input: AgentInput,
    config: AgentStreamConfig,
    source: AgentCheckpointInfo['source']
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const loopState = this.prepareLoop(input);
    const startIndex = this.state.messages.length;
    const run = createRunContext(loopState, this.state.context, this.state.values, {
      ...config,
      context: mergeContext(this.state.context, config.context),
      inputBudget: config.inputBudget ?? this.inputBudget,
    });

    try {
      this.runtime.pipeline.validateContext(run.runtimeContext);
    } catch (error) {
      return createErrorResult(loopState, 0, formatErrorMessage(error, 'context validation failed'));
    }

    const beforeRunResult = await runBeforeHook(run, config);
    if (beforeRunResult) {
      return beforeRunResult;
    }

    const stream = createStreamWriter(config);
    const execution = (async () => {
      await stream.emitValues(run.state.messages);
      const loopResult = await streamLoop(run, this.runtime, stream);
      const result = await runAfterHook(run, loopResult, config);
      this.state.messages = [...result.state.messages];
      await this.applyRunResult(result, startIndex, source, config.checkpoint ?? true);
      stream.finish(result);
      return result;
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

  private prepareLoop(input: AgentInput): AgentState {
    const appendedInput = normalizeAgentInput(input);
    if (appendedInput.length > 0) {
      this.state.messages.push(...appendedInput);
    }

    this.state.status = 'running';
    this.touch();

    return createAgentState(this.threadId, this.state);
  }

  private async applyRunResult(
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    checkpoint: boolean
  ): Promise<void> {
    this.state.lastResult = summarizeResult(result);
    this.state.context = mergeContext({}, result.state.context);
    this.state.values = this.runtime.pipeline.normalizeValues(cloneValues(result.state.values));
    this.state.pendingPause = readLatestPause(this.state.messages.slice(startIndex));
    this.state.status = this.state.pendingPause ? 'paused' : 'idle';
    this.touch();

    if (checkpoint) {
      await this.persistCheckpoint(source, result);
    }
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

function createErrorResult(state: AgentState, turns: number, message: string): AgentResult {
  return {
    reason: 'error',
    state,
    turns,
    error: new Error(message),
  };
}
