import {randomUUID} from 'node:crypto';
import {
  createInitialAgentState,
  injectResumePayload,
  mergeContext,
  normalizeAgentInput,
  readLatestPause,
  summarizeResult,
  type MutableAgentState,
} from '@core/agents/engine/state';
import {
  createAgentSnapshot,
  persistAgentCheckpoint,
  updateStateFromCheckpointRecord,
} from '@core/agents/engine/checkpoint';
import {assertNotRunning, assertReadyForInvoke, assertReadyForResume} from '@core/agents/engine/guards';
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
  AgentInvokeConfig,
  AgentResult,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentState,
  AgentStateSnapshot,
  CreateAgentOptions,
} from '@core/agents/contract/agent';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/contract/stream';
import {
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointInfo,
  type AgentCheckpointer,
} from '@core/checkpoint/state';
import type {HILPauseRequest, HILResumePayload} from '@core/middleware/hil';

/** `createAgent(...)` 返回的默认实现。 */
class AgentInstance implements Agent {
  private readonly runtime: AgentRuntime;
  private readonly threadId: string;
  private readonly checkpointer: AgentCheckpointer;
  private readonly state: MutableAgentState;

  constructor(options: CreateAgentOptions) {
    this.runtime = buildAgentRuntime(options);
    const checkpoint = options.checkpoint;
    this.threadId = checkpoint?.ref.threadId ?? options.threadId ?? randomUUID();
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
    this.state = createInitialAgentState(this.threadId, options.state, checkpoint);
  }

  getState(): AgentStateSnapshot {
    return createAgentSnapshot(this.threadId, this.state);
  }

  async invoke(input?: AgentInput, config: AgentInvokeConfig = {}): Promise<AgentResult> {
    assertReadyForInvoke(this.state);
    return this.execute(input, config, 'invoke');
  }

  async resume(payload: HILResumePayload, config: AgentResumeConfig = {}): Promise<AgentResult> {
    assertReadyForResume(this.state);
    const pause = this.state.pendingPause as HILPauseRequest;
    const context = injectResumePayload(config.context, pause, payload);
    return this.execute(config.input, {...config, context}, 'resume');
  }

  async reset(): Promise<void> {
    assertNotRunning(this.state);
    this.state.messages = [];
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
    payload: HILResumePayload,
    config: AgentResumeStreamConfig = {}
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    assertReadyForResume(this.state);
    const pause = this.state.pendingPause as HILPauseRequest;
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
    const run = createRunContext(loopState, {
      ...config,
      context: mergeContext(this.state.context, config.context),
    });

    try {
      this.runtime.pipeline.validateContext(run.context);
    } catch (error) {
      return createErrorResult(loopState, 0, `context validation failed: ${toError(error).message}`);
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
    const run = createRunContext(loopState, {
      ...config,
      context: mergeContext(this.state.context, config.context),
    });

    try {
      this.runtime.pipeline.validateContext(run.context);
    } catch (error) {
      return createErrorResult(loopState, 0, `context validation failed: ${toError(error).message}`);
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

    return {messages: [...this.state.messages]};
  }

  private async applyRunResult(
    result: AgentResult,
    startIndex: number,
    source: AgentCheckpointInfo['source'],
    checkpoint: boolean
  ): Promise<void> {
    this.state.lastResult = summarizeResult(result);
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
