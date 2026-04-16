import {HumanMessage} from '@langchain/core/messages';
import type {AgentResumeStreamConfig, AgentStreamOutput, ReviewRequest} from '@core/agent';
import type {Agent, ReviewResumePayload} from '@core/agent/agent-types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentResult} from '@shared/agent-types';
import type {ApprovalRecord, ApprovalStore} from '@durability/approval-store';
import {bootstrapSubagent, createSubagentResult} from '@capability/subagent/bootstrap';
import {mergeSubagentRunRecoveryMetadata} from '@capability/subagent/review-metadata';
import type {ChildToolActivityCallback} from '@observability/events';
import type {CodaraRuntimeEventListener, EmitRuntimeEventInput} from '@observability/events';
import type {SubagentCompletionContinuation, SubagentRunRecord, SubagentRunStore} from '@capability/subagent/types';
import type {SubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {SubagentResult} from '@shared/subagent-result';
import type {TaskRegistry} from '@capability/task/task-registry';
import type {AgentTaskState} from '@capability/task/task-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SubagentLaunchInput {
  runId: string;
  parentSessionId: string;
  batchId: string;
  batchExpectedCount: number;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  prompt: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export interface SubagentRunManager {
  launch(input: SubagentLaunchInput): Promise<SubagentRunLaunchResult>;
  waitForCompletion(parentSessionId: string, batchIds: readonly string[]): Promise<SubagentCompletionContinuation | undefined>;
  registerRecoveryBuilder(builder: SubagentRecoveryBuilder): void;
  setOnAgentEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void;
  recordActivity(runId: string, info: Parameters<ChildToolActivityCallback>[0]): void;
  resumeRun(runId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeRunStream(
    runId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  dispose(): Promise<void>;
}

export interface SubagentReviewResumer {
  resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
}

export interface CreateSubagentRunManagerOptions {
  runStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  taskRegistry?: TaskRegistry;
}

export interface SubagentRecoverySpec {
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export type SubagentRecoveryBuilder = (
  run: SubagentRunRecord,
  approval?: ApprovalRecord,
) => Promise<SubagentRecoverySpec | undefined> | SubagentRecoverySpec | undefined;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SubagentRunHandle {
  runId: string;
  parentSessionId: string;
  batchId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
  agent?: Agent;
  agentPromise?: Promise<Agent>;
}

interface CompletionWaiter {
  parentSessionId: string;
  batchIds: ReadonlySet<string>;
  resolve: (value: SubagentCompletionContinuation | undefined) => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSubagentRunManager(options: CreateSubagentRunManagerOptions): SubagentRunManager {
  return new InMemorySubagentRunManager(options);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class InMemorySubagentRunManager implements SubagentRunManager {
  private readonly handles = new Map<string, SubagentRunHandle>();
  private readonly completionWaiters = new Set<CompletionWaiter>();
  private onAgentEventCallback?: CodaraRuntimeEventListener;
  private sessionIdGetter?: string | (() => string);
  private recoveryBuilder?: SubagentRecoveryBuilder;

  constructor(private readonly options: CreateSubagentRunManagerOptions) {}

  // -- Event wiring --------------------------------------------------------

  setOnAgentEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void {
    this.onAgentEventCallback = listener;
    this.sessionIdGetter = sessionId;
  }

  registerRecoveryBuilder(builder: SubagentRecoveryBuilder): void {
    this.recoveryBuilder = builder;
  }

  // -- Launch --------------------------------------------------------------

  async launch(input: SubagentLaunchInput): Promise<SubagentRunLaunchResult> {
    const existing = findExistingLaunchResult(this.handles, this.options.runStore, input);
    if (existing) {
      return existing;
    }

    this.options.approvalStore?.removeBySubagentRunId(input.runId);
    this.options.runStore?.start({
      runId: input.runId,
      parentSessionId: input.parentSessionId,
      batchId: input.batchId,
      batchExpectedCount: input.batchExpectedCount,
      label: input.label,
      agentName: input.agentName,
      ...(input.subagentType ? {subagentType: input.subagentType} : {}),
      ...(input.permissionMode ? {permissionMode: input.permissionMode} : {}),
      childSessionId: input.childSessionId,
    });

    const handle = buildHandle(input);
    this.handles.set(input.runId, handle);

    // Register with unified task registry.
    const agentTask: AgentTaskState = {
      id: input.runId,
      type: 'agent',
      status: 'running',
      description: input.label,
      startTime: Date.now(),
      outputOffset: 0,
      runId: input.runId,
      childSessionId: input.childSessionId,
      agentName: input.agentName,
      label: input.label,
    };
    this.options.taskRegistry?.register(agentTask);

    this.emitAgentEvent({
      id: subagentRunEventId(input.runId),
      kind: 'agent',
      phase: 'start',
      status: 'running',
      label: input.label,
    });
    void this.runPrompt(handle, input.prompt);

    return buildLaunchResult(input);
  }

  // -- Wait ----------------------------------------------------------------

  async waitForCompletion(
    parentSessionId: string,
    batchIds: readonly string[],
  ): Promise<SubagentCompletionContinuation | undefined> {
    const normalizedParentSessionId = parentSessionId.trim();
    const normalizedBatchIds = batchIds.map((id) => id.trim()).filter(Boolean);
    if (normalizedBatchIds.length === 0 || !this.options.runStore) {
      return undefined;
    }

    const claimed = this.options.runStore.takePendingCompletion(normalizedParentSessionId, normalizedBatchIds);
    if (claimed) {
      return claimed;
    }

    if (!hasTrackedRuns(this.options.runStore, normalizedParentSessionId, normalizedBatchIds)) {
      return undefined;
    }

    return await new Promise<SubagentCompletionContinuation | undefined>((resolve) => {
      const waiter: CompletionWaiter = {
        parentSessionId: normalizedParentSessionId,
        batchIds: new Set(normalizedBatchIds),
        resolve: (value) => {
          this.completionWaiters.delete(waiter);
          resolve(value);
        },
      };
      this.completionWaiters.add(waiter);
    });
  }

  // -- Activity ------------------------------------------------------------

  recordActivity(runId: string, info: Parameters<ChildToolActivityCallback>[0]): void {
    const handle = this.handles.get(runId);
    if (!handle) {
      return;
    }

    const nextToolUseCount = (this.options.runStore?.get(runId)?.toolUseCount ?? 0) + 1;
    this.options.runStore?.update(runId, {
      latestActivity: info.label,
      activityLabel: info.label,
      toolUseCount: nextToolUseCount,
    });
    this.notifyCompletionWaiters(handle.parentSessionId, handle.batchId);
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'update',
      status: 'running',
      label: info.label,
      detail: info.toolName,
      parentId: subagentRunEventId(handle.runId),
    });
  }

  // -- Resume --------------------------------------------------------------

  async resumeRun(runId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void> {
    for await (const _chunk of this.resumeRunStream(runId, payload, config)) {
      // Drain streamed output for non-streaming consumers.
    }
  }

  async *resumeRunStream(
    runId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const handle = await this.resolveHandle(runId);
    const agent = await ensureChildAgent(handle);
    this.options.approvalStore?.removeBySubagentRunId(runId);
    this.options.runStore?.resume(runId, {
      childSessionId: handle.childSessionId,
      latestActivity: 'Resuming review',
    });
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'update',
      status: 'running',
      label: 'Subagent resumed',
      detail: handle.label,
      parentId: subagentRunEventId(handle.runId),
    });

    const stream = agent.resumeStream(payload, {
      ...config,
      resumeMode: 'tool',
      ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
    });
    const result = yield* forwardSubagentStream(stream);

    await this.applyResult(handle, result);
  }

  async resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void> {
    const record = requireApprovalRecord(this.options.approvalStore, approvalId);
    await this.resumeRun(record.subagentRunId!, payload, config);
  }

  async *resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const record = requireApprovalRecord(this.options.approvalStore, approvalId);
    yield* this.resumeRunStream(record.subagentRunId!, payload, config);
  }

  // -- Lifecycle -----------------------------------------------------------

  async dispose(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.all(handles.map((handle) => disposeHandleSafely(handle, this.options.runStore)));
  }

  // -- Private: run execution ----------------------------------------------

  private async runPrompt(handle: SubagentRunHandle, prompt: string): Promise<void> {
    try {
      const agent = await ensureChildAgent(handle);
      const result = await consumeSubagentStream(agent.stream({
        messages: [new HumanMessage(prompt)],
      }, {
        ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
      }));

      await this.applyResult(handle, result);
    } catch (error) {
      await this.handleTerminalFailure(handle, error);
    }
  }

  private async applyResult(handle: SubagentRunHandle, result: AgentResult): Promise<void> {
    const pause = result.state.pendingReview as ReviewRequest | undefined;
    if (pause) {
      this.applyPauseResult(handle, pause);
      return;
    }

    this.applyTerminalResult(handle, result);
    await this.disposeHandle(handle);
  }

  private applyPauseResult(handle: SubagentRunHandle, pause: ReviewRequest): void {
    const persistedPause = attachRecoveryMetadata(pause, handle);
    this.options.runStore?.pause(handle.runId, {
      childSessionId: handle.childSessionId,
      latestActivity: persistedPause.description,
    });
    this.options.approvalStore?.upsertSubagentRunApproval({
      sessionId: handle.parentSessionId,
      subagentRunId: handle.runId,
      reviewRequest: persistedPause,
      childSessionId: handle.childSessionId,
    });
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'update',
      status: 'paused',
      label: 'Subagent waiting for review',
      detail: persistedPause.description,
      parentId: subagentRunEventId(handle.runId),
    });
  }

  private applyTerminalResult(handle: SubagentRunHandle, result: AgentResult): void {
    this.options.approvalStore?.removeBySubagentRunId(handle.runId);
    const subagentResult = createSubagentResult(
      handle.childSessionId,
      result.turns,
      result.reason,
      result.error,
      result.state.messages,
      {
        runId: handle.runId,
        label: handle.label,
        agentName: handle.agentName,
      },
    );
    this.options.runStore?.finish(handle.runId, subagentResult);
    this.notifyCompletionWaiters(handle.parentSessionId, handle.batchId);

    // Sync with unified task registry.
    const terminalStatus = subagentResult.reason === 'error' ? 'failed' as const : 'completed' as const;
    this.options.taskRegistry?.terminate(handle.runId, terminalStatus, {
      summary: subagentResult.summary,
      errorMessage: subagentResult.errorMessage,
    });

    this.emitAgentEvent({
      kind: 'agent',
      phase: 'end',
      status: subagentResult.reason === 'error' ? 'error' : 'done',
      label: subagentResult.reason === 'error' ? 'Subagent failed' : 'Subagent completed',
      detail: subagentResult.summary ?? subagentResult.errorMessage,
      parentId: subagentRunEventId(handle.runId),
    });
  }

  private async handleTerminalFailure(handle: SubagentRunHandle, error: unknown): Promise<void> {
    this.options.approvalStore?.removeBySubagentRunId(handle.runId);
    const subagentResult: SubagentResult = {
      type: 'subagent_result',
      sessionId: handle.childSessionId,
      turns: 0,
      reason: 'error',
      runId: handle.runId,
      label: handle.label,
      agentName: handle.agentName,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    this.options.runStore?.finish(handle.runId, subagentResult);
    this.notifyCompletionWaiters(handle.parentSessionId, handle.batchId);

    // Sync with unified task registry.
    this.options.taskRegistry?.terminate(handle.runId, 'failed', {
      errorMessage: subagentResult.errorMessage,
    });

    this.emitAgentEvent({
      kind: 'agent',
      phase: 'end',
      status: 'error',
      label: 'Subagent failed',
      detail: subagentResult.errorMessage,
      parentId: subagentRunEventId(handle.runId),
    });
    await this.disposeHandle(handle);
  }

  private async disposeHandle(handle: SubagentRunHandle): Promise<void> {
    this.handles.delete(handle.runId);
    try {
      const agent = handle.agent ?? await handle.agentPromise;
      await agent?.dispose();
    } catch {
      // Best-effort cleanup.
    }
  }

  // -- Private: handle recovery --------------------------------------------

  private async resolveHandle(runId: string): Promise<SubagentRunHandle> {
    const normalizedRunId = runId.trim();
    const existing = this.handles.get(normalizedRunId);
    if (existing) {
      return existing;
    }

    const record = this.options.runStore?.get(normalizedRunId);
    if (!record || !record.childSessionId) {
      throw new Error(`Subagent run "${runId}" is not active in this run manager`);
    }

    if (!this.recoveryBuilder) {
      throw new Error(`Subagent run "${runId}" cannot be resumed after restart because no recovery builder is registered`);
    }

    const approval = findRunApproval(this.options.approvalStore, record);
    const recovery = await this.recoveryBuilder(record, approval);
    if (!recovery) {
      throw new Error(`Subagent run "${runId}" cannot be resumed because recovery metadata is incomplete`);
    }

    const recovered = buildRecoveredHandle(record, recovery);
    this.handles.set(normalizedRunId, recovered);
    return recovered;
  }

  // -- Private: event emission ---------------------------------------------

  private emitAgentEvent(event: EmitRuntimeEventInput): void {
    if (!this.onAgentEventCallback || !this.sessionIdGetter) {
      return;
    }

    const sessionId = typeof this.sessionIdGetter === 'function'
      ? this.sessionIdGetter()
      : this.sessionIdGetter;
    this.onAgentEventCallback({
      ...event,
      id: event.id ?? `${event.kind}:${event.phase}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  // -- Private: waiter notification ----------------------------------------

  private notifyCompletionWaiters(parentSessionId: string, batchId: string): void {
    if (!this.options.runStore || this.completionWaiters.size === 0) {
      return;
    }

    const normalizedParent = parentSessionId.trim();
    const normalizedBatch = batchId.trim();
    for (const waiter of [...this.completionWaiters]) {
      if (waiter.parentSessionId !== normalizedParent || !waiter.batchIds.has(normalizedBatch)) {
        continue;
      }

      const claimed = this.options.runStore.takePendingCompletion(normalizedParent, [...waiter.batchIds]);
      if (claimed) {
        waiter.resolve(claimed);
        continue;
      }

      if (!hasTrackedRuns(this.options.runStore, normalizedParent, [...waiter.batchIds])) {
        waiter.resolve(undefined);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers (extracted from class for testability & readability)
// ---------------------------------------------------------------------------

function findExistingLaunchResult(
  handles: Map<string, SubagentRunHandle>,
  runStore: SubagentRunStore | undefined,
  input: SubagentLaunchInput,
): SubagentRunLaunchResult | undefined {
  const existingHandle = handles.get(input.runId);
  if (existingHandle) {
    return {
      type: 'subagent_run_started',
      runId: existingHandle.runId,
      batchId: input.batchId,
      batchExpectedCount: input.batchExpectedCount,
      parentSessionId: existingHandle.parentSessionId,
      sessionId: existingHandle.childSessionId,
      agentName: existingHandle.agentName,
      label: existingHandle.label,
    };
  }

  const existingRun = runStore?.get(input.runId);
  if (existingRun && (existingRun.status === 'running' || existingRun.status === 'paused')) {
    return {
      type: 'subagent_run_started',
      runId: existingRun.runId,
      batchId: existingRun.batchId,
      batchExpectedCount: existingRun.batchExpectedCount,
      parentSessionId: existingRun.parentSessionId,
      sessionId: existingRun.childSessionId ?? input.childSessionId,
      agentName: existingRun.agentName,
      label: existingRun.label,
    };
  }

  return undefined;
}

function buildHandle(input: SubagentLaunchInput): SubagentRunHandle {
  return {
    runId: input.runId,
    parentSessionId: input.parentSessionId,
    batchId: input.batchId,
    childSessionId: input.childSessionId,
    label: input.label,
    agentName: input.agentName,
    ...(input.subagentType ? {subagentType: input.subagentType} : {}),
    ...(input.permissionMode ? {permissionMode: input.permissionMode} : {}),
    childOptions: input.childOptions,
    ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
  };
}

function buildLaunchResult(input: SubagentLaunchInput): SubagentRunLaunchResult {
  return {
    type: 'subagent_run_started',
    runId: input.runId,
    batchId: input.batchId,
    batchExpectedCount: input.batchExpectedCount,
    parentSessionId: input.parentSessionId,
    sessionId: input.childSessionId,
    agentName: input.agentName,
    label: input.label,
  };
}

function buildRecoveredHandle(record: SubagentRunRecord, recovery: SubagentRecoverySpec): SubagentRunHandle {
  return {
    runId: record.runId,
    parentSessionId: record.parentSessionId,
    batchId: record.batchId,
    childSessionId: record.childSessionId!,
    label: record.label,
    agentName: record.agentName,
    ...(record.subagentType ? {subagentType: record.subagentType} : {}),
    childOptions: recovery.childOptions,
    ...(typeof recovery.maxTurns === 'number' ? {maxTurns: recovery.maxTurns} : {}),
  };
}

function hasTrackedRuns(runStore: SubagentRunStore, parentSessionId: string, batchIds: readonly string[]): boolean {
  const allowedBatchIds = new Set(batchIds);
  return runStore.list().some((run) => (
    run.parentSessionId === parentSessionId
    && allowedBatchIds.has(run.batchId)
  ));
}

function requireApprovalRecord(approvalStore: ApprovalStore | undefined, approvalId: string): ApprovalRecord {
  const record = approvalStore?.get(approvalId);
  if (!record || record.source !== 'subagent_run' || !record.subagentRunId) {
    throw new Error(`Subagent approval "${approvalId}" is not available`);
  }
  return record;
}

function findRunApproval(approvalStore: ApprovalStore | undefined, run: SubagentRunRecord): ApprovalRecord | undefined {
  return approvalStore
    ?.list(run.parentSessionId)
    .find((record) => record.source === 'subagent_run' && record.subagentRunId === run.runId);
}

async function ensureChildAgent(handle: SubagentRunHandle): Promise<Agent> {
  if (handle.agent) {
    return handle.agent;
  }
  if (!handle.agentPromise) {
    handle.agentPromise = (async () => {
      const agent = await bootstrapSubagent(handle.childSessionId, handle.childOptions);
      handle.agent = agent;
      return agent;
    })();
  }
  return handle.agentPromise;
}

async function disposeHandleSafely(handle: SubagentRunHandle, runStore: SubagentRunStore | undefined): Promise<void> {
  const record = runStore?.get(handle.runId);
  if (record?.status === 'paused') {
    return;
  }
  try {
    const agent = handle.agent ?? await handle.agentPromise;
    await agent?.dispose();
  } catch {
    // Best-effort cleanup.
  }
}

function attachRecoveryMetadata(review: ReviewRequest, handle: SubagentRunHandle): ReviewRequest {
  const recovery = {
    ...(handle.childOptions.tools?.length
      ? {toolNames: handle.childOptions.tools.map((tool) => tool.name)}
      : {}),
    ...(handle.childOptions.systemMessage?.length
      ? {systemMessages: [...handle.childOptions.systemMessage]}
      : {}),
    ...(typeof handle.maxTurns === 'number' ? {maxTurns: handle.maxTurns} : {}),
  };

  if (Object.keys(recovery).length === 0) {
    return review;
  }

  const base = review.metadata && typeof review.metadata === 'object'
    ? review.metadata as Record<string, unknown>
    : {};

  return {
    ...review,
    metadata: mergeSubagentRunRecoveryMetadata(base, {
      childSessionId: handle.childSessionId,
      recovery,
    }),
  };
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

async function consumeSubagentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): Promise<AgentResult> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

async function* forwardSubagentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
    if (!result.done) {
      yield result.value;
    }
  } while (!result.done);
  return result.value;
}

function subagentRunEventId(runId: string): string {
  return `subagent-run:${runId}`;
}
