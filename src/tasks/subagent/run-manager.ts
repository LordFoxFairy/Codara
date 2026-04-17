/**
 * Subagent run manager.
 *
 * Owns the lifecycle of in-process subagent runs:
 * - Launch   — stream a child agent to completion (see `runPrompt`).
 * - Pause    — persist review state + approval record, emit event.
 * - Resume   — resolve a handle (rebuilding from persisted state if
 *              needed) and stream the resumed child agent.
 * - Finish   — finalise store + task registry + waiters, emit event.
 *
 * Stateless mechanics live in sibling modules:
 * - `run-manager-types.ts` — shared type definitions
 * - `run-lifecycle.ts`     — handle building, stream draining, disposal
 * - `run-approval.ts`      — approval store lookups, recovery metadata
 * - `run-events.ts`        — runtime-event emitter, completion waiters
 * - `run-finalize.ts`      — pause/terminal outcome application
 * - `run-resume.ts`        — handle resolution after process restart
 *
 * @module
 */

import {HumanMessage} from '@langchain/core/messages';
import type {AgentResumeStreamConfig, AgentStreamOutput} from '@core/agent';
import type {ReviewResumePayload} from '@core/agent/agent-types';
import type {AgentResult} from '@shared/agent-types';
import type {ChildToolActivityCallback} from '@events';
import type {CodaraRuntimeEventListener} from '@events';
import type {SubagentCompletionContinuation} from '@tasks/subagent/types';
import type {SubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {AgentTaskState} from '@tasks/task-types';
import {requireApprovalRecord} from './run-approval';
import {
  buildHandle,
  buildLaunchResult,
  consumeSubagentStream,
  disposeHandleSafely,
  ensureChildAgent,
  findExistingLaunchResult,
  forwardSubagentStream,
  hasTrackedRuns,
  subagentRunEventId,
} from './run-lifecycle';
import {
  makeAgentEventEmitter,
  notifyCompletionWaiters,
  type AgentEventEmitter,
} from './run-events';
import {
  applyPauseResult,
  applyTerminalFailure,
  applyTerminalResult,
  type FinalizeDeps,
} from './run-finalize';
import {resolveHandleForResume} from './run-resume';
import type {
  CompletionWaiter,
  CreateSubagentRunManagerOptions,
  ReviewRequest,
  SubagentLaunchInput,
  SubagentRecoveryBuilder,
  SubagentRunHandle,
  SubagentRunManager,
} from './run-manager-types';

export type {
  CreateSubagentRunManagerOptions,
  SubagentLaunchInput,
  SubagentRecoveryBuilder,
  SubagentRecoverySpec,
  SubagentReviewResumer,
  SubagentRunManager,
} from './run-manager-types';

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
  private readonly emit: AgentEventEmitter;

  constructor(private readonly options: CreateSubagentRunManagerOptions) {
    this.emit = makeAgentEventEmitter(
      () => this.onAgentEventCallback,
      () => this.sessionIdGetter,
    );
  }

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

    this.emit({
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
    this.notifyWaiters(handle.parentSessionId, handle.batchId);
    this.emit({
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
    const handle = await resolveHandleForResume(
      {
        handles: this.handles,
        runStore: this.options.runStore,
        approvalStore: this.options.approvalStore,
        recoveryBuilder: this.recoveryBuilder,
      },
      runId,
    );
    const agent = await ensureChildAgent(handle);
    this.options.approvalStore?.removeBySubagentRunId(runId);
    this.options.runStore?.resume(runId, {
      childSessionId: handle.childSessionId,
      latestActivity: 'Resuming review',
    });
    this.emit({
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
      applyTerminalFailure(this.finalizeDeps(), handle, error);
      this.notifyWaiters(handle.parentSessionId, handle.batchId);
      await this.disposeHandle(handle);
    }
  }

  private async applyResult(handle: SubagentRunHandle, result: AgentResult): Promise<void> {
    const pause = result.state.pendingReview as ReviewRequest | undefined;
    if (pause) {
      applyPauseResult(this.finalizeDeps(), handle, pause);
      return;
    }

    applyTerminalResult(this.finalizeDeps(), handle, result);
    this.notifyWaiters(handle.parentSessionId, handle.batchId);
    await this.disposeHandle(handle);
  }

  private finalizeDeps(): FinalizeDeps {
    return {
      runStore: this.options.runStore,
      approvalStore: this.options.approvalStore,
      taskRegistry: this.options.taskRegistry,
      emit: this.emit,
    };
  }

  private notifyWaiters(parentSessionId: string, batchId: string): void {
    notifyCompletionWaiters(this.completionWaiters, this.options.runStore, parentSessionId, batchId);
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
}
