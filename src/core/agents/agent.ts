import {randomUUID} from 'node:crypto';
import {HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import {createAgentRunner, type AgentRunner} from '@core/agents/runner';
import type {AgentInvokeConfig, AgentResult, AgentRunnerParams, AgentRuntimeContext} from '@core/agents/types';
import type {AgentStreamConfig, AgentStreamOutput} from '@core/agents/stream';
import {
  AgentCheckpoint,
  AgentCheckpointer,
  AgentCheckpointInfo,
  AgentCheckpointStatus,
  AgentInstanceState,
  AgentResultSummary,
  createAgentMemoryCheckpointer,
} from '@core/checkpoint/state';
import {parseHILToolMessagePayload, type HILPauseRequest, type HILResumePayload} from '@core/middleware/hil';

export type AgentInput = string | BaseMessage | BaseMessage[];

export interface CreateAgentOptions extends AgentRunnerParams {
  threadId?: string;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  checkpointer?: AgentCheckpointer;
}

export interface RestoreAgentOptions extends AgentRunnerParams {
  checkpoint: AgentCheckpoint;
  checkpointer?: AgentCheckpointer;
}

export interface LoadAgentOptions extends AgentRunnerParams {
  threadId: string;
  checkpointer: AgentCheckpointer;
}

export interface AgentRunConfig extends Omit<AgentInvokeConfig, 'context'> {
  context?: AgentRuntimeContext;
  checkpoint?: boolean;
}

export interface AgentResumeConfig extends Omit<AgentRunConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
}

export interface AgentResumeStreamConfig extends Omit<AgentStreamConfig, 'context'> {
  input?: AgentInput;
  context?: AgentRuntimeContext;
}

interface AgentMutableState {
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  status: AgentInstanceState['status'];
  pendingPause?: HILPauseRequest;
  lastResult?: AgentResultSummary;
  checkpointId?: string;
  step: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stateful agent host for terminal-style usage.
 * It keeps the runtime-facing state machine around the existing AgentRunner and
 * persists stable boundaries through a checkpoint chain keyed by `threadId`.
 */
export class Agent {
  private readonly runner: AgentRunner;
  private readonly threadId: string;
  private readonly checkpointer: AgentCheckpointer;
  private readonly state: AgentMutableState;

  constructor(options: CreateAgentOptions, checkpoint?: AgentCheckpoint) {
    this.runner = createAgentRunner(options);
    this.threadId = checkpoint?.ref.threadId ?? options.threadId ?? randomUUID();
    this.checkpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

    const now = new Date().toISOString();
    const restoredCheckpointState = checkpoint?.state;
    const restoredCheckpointInfo = checkpoint?.info;
    this.state = {
      messages: [...(restoredCheckpointState?.messages ?? options.messages ?? [])],
      context: cloneContext(restoredCheckpointState?.context ?? options.context ?? {}),
      status: deriveRuntimeStatus(restoredCheckpointState?.pendingPause, restoredCheckpointInfo?.status),
      pendingPause: restoredCheckpointState?.pendingPause
        ? clonePause(restoredCheckpointState.pendingPause)
        : undefined,
      lastResult: restoredCheckpointInfo ? summarizeCheckpointInfo(restoredCheckpointInfo) : undefined,
      checkpointId: checkpoint?.ref.checkpointId,
      step: restoredCheckpointInfo?.step ?? 0,
      createdAt: now,
      updatedAt: restoredCheckpointInfo?.createdAt ?? now,
    };
  }

  getState(): AgentInstanceState {
    return {
      threadId: this.threadId,
      checkpointId: this.state.checkpointId,
      messages: [...this.state.messages],
      context: cloneContext(this.state.context),
      status: this.state.status,
      ...(this.state.pendingPause ? {pendingPause: clonePause(this.state.pendingPause)} : {}),
      ...(this.state.lastResult ? {lastResult: {...this.state.lastResult}} : {}),
      step: this.state.step,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }

  updateContext(patch: AgentRuntimeContext): void {
    this.assertNotClosed();
    this.state.context = mergeContext(this.state.context, patch);
    this.touch();
  }

  replaceContext(nextContext: AgentRuntimeContext): void {
    this.assertNotClosed();
    this.state.context = cloneContext(nextContext);
    this.touch();
  }

  async invoke(input?: AgentInput, config: AgentRunConfig = {}): Promise<AgentResult> {
    this.assertReadyForInvoke();
    return this.run(input, config, 'invoke');
  }

  async *stream(
    input?: AgentInput,
    config: AgentStreamConfig = {}
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    this.assertReadyForInvoke();
    return yield* this.runStream(input, config, 'invoke');
  }

  async resume(resumePayload: HILResumePayload, config: AgentResumeConfig = {}): Promise<AgentResult> {
    this.assertReadyForResume();
    const pause = this.state.pendingPause as HILPauseRequest;
    const context = injectResumePayload(config.context, pause, resumePayload);
    return this.run(config.input, {...config, context}, 'resume');
  }

  async *resumeStream(
    resumePayload: HILResumePayload,
    config: AgentResumeStreamConfig = {}
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    this.assertReadyForResume();
    const pause = this.state.pendingPause as HILPauseRequest;
    const context = injectResumePayload(config.context, pause, resumePayload);
    return yield* this.runStream(config.input, {...config, context}, 'resume');
  }

  async saveCheckpoint(): Promise<AgentCheckpoint> {
    return this.persistCheckpoint('manual');
  }

  async deleteCheckpoints(): Promise<void> {
    await this.checkpointer.deleteThread(this.threadId);
    this.state.checkpointId = undefined;
    this.state.step = 0;
  }

  async reset(): Promise<void> {
    this.assertNotRunning();
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

    this.assertNotRunning();
    this.state.status = 'closed';
    this.touch();
    await this.persistCheckpoint('dispose');
  }

  private async run(
    input: AgentInput | undefined,
    config: AgentRunConfig,
    source: 'invoke' | 'resume'
  ): Promise<AgentResult> {
    const appendedInput = normalizeAgentInput(input);

    if (appendedInput.length > 0) {
      this.state.messages.push(...appendedInput);
    }

    const runStartIndex = this.state.messages.length;
    this.state.status = 'running';
    this.touch();

    const result = await this.runner.invoke(
      {messages: this.state.messages},
      {
        ...config,
        context: mergeContext(this.state.context, config.context),
      }
    );
    await this.applyRunResult(result, runStartIndex, source, config.checkpoint ?? true);
    return result;
  }

  private async *runStream(
    input: AgentInput | undefined,
    config: AgentStreamConfig,
    source: 'invoke' | 'resume'
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
    const appendedInput = normalizeAgentInput(input);

    if (appendedInput.length > 0) {
      this.state.messages.push(...appendedInput);
    }

    const runStartIndex = this.state.messages.length;
    this.state.status = 'running';
    this.touch();

    const stream = this.runner.stream(
      {messages: this.state.messages},
      {
        ...config,
        context: mergeContext(this.state.context, config.context),
      }
    );

    let result: AgentResult | undefined;
    while (true) {
      const next = await stream.next();
      if (next.done) {
        result = next.value;
        break;
      }
      yield next.value;
    }

    await this.applyRunResult(result, runStartIndex, source, config.checkpoint ?? true);
    return result;
  }

  private async persistCheckpoint(
    source: AgentCheckpointInfo['source'],
    result?: AgentResult
  ): Promise<AgentCheckpoint> {
    const record = await this.checkpointer.put({
      threadId: this.threadId,
      ...(this.state.checkpointId ? {parentCheckpointId: this.state.checkpointId} : {}),
      state: {
        messages: [...this.state.messages],
        context: cloneContext(this.state.context),
        ...(this.state.pendingPause ? {pendingPause: clonePause(this.state.pendingPause)} : {}),
      },
      info: {
        source,
        status: toCheckpointStatus(this.state.status, result),
        ...(result?.reason ? {reason: result.reason} : {}),
        ...(result ? {turns: result.turns} : {}),
        ...(result?.error ? {errorMessage: result.error.message} : {}),
        step: this.state.step + 1,
        createdAt: new Date().toISOString(),
      },
    });

    this.state.checkpointId = record.ref.checkpointId;
    this.state.step = record.info.step;
    this.state.updatedAt = record.info.createdAt;
    return record;
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }

  private async applyRunResult(
    result: AgentResult,
    runStartIndex: number,
    source: 'invoke' | 'resume',
    checkpoint: boolean
  ): Promise<void> {
    this.state.lastResult = summarizeResult(result);
    this.state.pendingPause = readLatestPause(this.state.messages.slice(runStartIndex));
    this.state.status = this.state.pendingPause ? 'paused' : 'idle';
    this.touch();

    if (checkpoint) {
      await this.persistCheckpoint(source, result);
    }
  }

  private assertReadyForInvoke(): void {
    this.assertNotClosed();
    this.assertNotRunning();

    if (this.state.status === 'paused') {
      throw new Error('Agent is paused; call resume(...) or reset() before invoking again.');
    }
  }

  private assertReadyForResume(): void {
    this.assertNotClosed();
    this.assertNotRunning();

    if (this.state.status !== 'paused' || !this.state.pendingPause) {
      throw new Error('Agent is not paused; resume(...) is only valid after a HIL pause.');
    }
  }

  private assertNotClosed(): void {
    if (this.state.status === 'closed') {
      throw new Error('Agent is closed.');
    }
  }

  private assertNotRunning(): void {
    if (this.state.status === 'running') {
      throw new Error('Agent is currently running.');
    }
  }
}

export function createAgent(options: CreateAgentOptions): Agent {
  return new Agent(options);
}

export function restoreAgent(options: RestoreAgentOptions): Agent {
  return new Agent(options, options.checkpoint);
}

export async function loadAgent(options: LoadAgentOptions): Promise<Agent | undefined> {
  const checkpoint = await options.checkpointer.getLatest(options.threadId);
  if (!checkpoint) {
    return undefined;
  }

  return restoreAgent({
    ...options,
    checkpoint,
  });
}

function normalizeAgentInput(input: AgentInput | undefined): BaseMessage[] {
  if (input === undefined) {
    return [];
  }

  if (typeof input === 'string') {
    const content = input.trim();
    return content ? [new HumanMessage(content)] : [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

function summarizeResult(result: AgentResult): AgentResultSummary {
  return {
    reason: result.reason,
    turns: result.turns,
    ...(result.error ? {errorMessage: result.error.message} : {}),
  };
}

function summarizeCheckpointInfo(info: AgentCheckpointInfo): AgentResultSummary | undefined {
  if (!info.reason && info.turns === undefined && !info.errorMessage) {
    return undefined;
  }

  return {
    reason: info.reason ?? 'complete',
    turns: info.turns ?? 0,
    ...(info.errorMessage ? {errorMessage: info.errorMessage} : {}),
  };
}

function readLatestPause(messages: BaseMessage[]): HILPauseRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    const payload = parseHILToolMessagePayload(message.content);
    if (payload?.type === 'hil_pause') {
      return clonePause(payload.request);
    }
  }

  return undefined;
}

function injectResumePayload(
  context: AgentRuntimeContext | undefined,
  pause: HILPauseRequest,
  payload: HILResumePayload
): AgentRuntimeContext {
  const nextContext = mergeContext({}, context);
  const root = ensureRecord(nextContext);
  const rawHil = ensureRecord(root.hil);
  const rawResumes = ensureRecord(rawHil.resumes);

  root.hil = {
    ...rawHil,
    resumes: {
      ...rawResumes,
      [pause.id]: payload,
      [pause.action.toolCallId]: payload,
    },
  };

  return root;
}

function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides) {
    return cloneContext(base);
  }

  const merged: AgentRuntimeContext = cloneContext(base);
  for (const [key, value] of Object.entries(cloneContext(overrides))) {
    const previous = merged[key];
    if (isPlainRecord(previous) && isPlainRecord(value)) {
      merged[key] = {...previous, ...value};
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function cloneContext(context: AgentRuntimeContext): AgentRuntimeContext {
  try {
    return structuredClone(context);
  } catch {
    return {...context};
  }
}

function clonePause(pause: HILPauseRequest): HILPauseRequest {
  return structuredClone(pause);
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deriveRuntimeStatus(
  pendingPause: HILPauseRequest | undefined,
  checkpointStatus: AgentCheckpointStatus | undefined
): AgentInstanceState['status'] {
  if (checkpointStatus === 'closed') {
    return 'closed';
  }
  if (pendingPause) {
    return 'paused';
  }
  return 'idle';
}

function toCheckpointStatus(
  runtimeStatus: AgentInstanceState['status'],
  result: AgentResult | undefined
): AgentCheckpointStatus {
  if (runtimeStatus === 'paused') {
    return 'paused';
  }
  if (runtimeStatus === 'closed') {
    return 'closed';
  }
  if (result?.reason === 'error') {
    return 'error';
  }
  return 'idle';
}
