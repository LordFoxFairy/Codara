import {HumanMessage} from '@langchain/core/messages';
import type {AgentResumeStreamConfig, AgentStreamOutput, ReviewRequest, ReviewResumePayload} from '@core/agent';
import type {Agent} from '@core/agent/models/agent';
import {bootstrapAgent, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentResult} from '@shared/contracts/agent-types';
import type {ApprovalRecord, ApprovalStore} from '@durability/approval-store';
import {createDelegatedAgentResult} from '@capability/subagent/agent';
import type {ChildToolActivityCallback} from '@observability/events';
import type {CodaraRuntimeEventListener, EmitRuntimeEventInput} from '@observability/events';
import type {AgentRunRecord, AgentRunStore} from '@capability/subagent/types';
import type {AgentRunLaunchResult} from '@shared/agent-run-launch';

export interface AgentRuntimeLaunchInput {
  runId: string;
  parentSessionId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  prompt: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export interface AgentRuntime {
  launch(input: AgentRuntimeLaunchInput): Promise<AgentRunLaunchResult>;
  registerRecoveryBuilder(builder: AgentRuntimeRecoveryBuilder): void;
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

interface AgentRunHandle {
  runId: string;
  parentSessionId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
  agent?: Agent;
  agentPromise?: Promise<Agent>;
}

export interface CreateAgentRuntimeOptions {
  runStore?: AgentRunStore;
  approvalStore?: ApprovalStore;
}

export interface AgentRuntimeRecoverySpec {
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export type AgentRuntimeRecoveryBuilder = (
  run: AgentRunRecord,
  approval?: ApprovalRecord,
) => Promise<AgentRuntimeRecoverySpec | undefined> | AgentRuntimeRecoverySpec | undefined;

export function createAgentRuntime(options: CreateAgentRuntimeOptions): AgentRuntime {
  return new InMemoryAgentRuntime(options);
}

class InMemoryAgentRuntime implements AgentRuntime {
  private readonly handles = new Map<string, AgentRunHandle>();
  private onAgentEventCallback?: CodaraRuntimeEventListener;
  private sessionIdGetter?: string | (() => string);
  private recoveryBuilder?: AgentRuntimeRecoveryBuilder;

  constructor(private readonly options: CreateAgentRuntimeOptions) {}

  setOnAgentEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void {
    this.onAgentEventCallback = listener;
    this.sessionIdGetter = sessionId;
  }

  registerRecoveryBuilder(builder: AgentRuntimeRecoveryBuilder): void {
    this.recoveryBuilder = builder;
  }

  async launch(input: AgentRuntimeLaunchInput): Promise<AgentRunLaunchResult> {
    const existingHandle = this.handles.get(input.runId);
    if (existingHandle) {
      return {
        type: 'agent_run_started',
        runId: existingHandle.runId,
        parentSessionId: existingHandle.parentSessionId,
        sessionId: existingHandle.childSessionId,
        agentName: existingHandle.agentName,
        label: existingHandle.label,
      };
    }

    const existingRun = this.options.runStore?.get(input.runId);
    if (existingRun && (existingRun.status === 'running' || existingRun.status === 'paused')) {
      return {
        type: 'agent_run_started',
        runId: existingRun.runId,
        parentSessionId: existingRun.parentSessionId,
        sessionId: existingRun.childSessionId ?? input.childSessionId,
        agentName: existingRun.agentName,
        label: existingRun.label,
      };
    }

    this.options.approvalStore?.removeByAgentRunId(input.runId);
    this.options.runStore?.start({
      runId: input.runId,
      parentSessionId: input.parentSessionId,
      label: input.label,
      agentName: input.agentName,
      ...(input.subagentType ? {subagentType: input.subagentType} : {}),
      childSessionId: input.childSessionId,
    });

    const handle: AgentRunHandle = {
      runId: input.runId,
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      label: input.label,
      agentName: input.agentName,
      ...(input.subagentType ? {subagentType: input.subagentType} : {}),
      childOptions: input.childOptions,
      ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
    };
    this.handles.set(input.runId, handle);
    this.emitAgentEvent({
      id: agentRootEventId(input.runId),
      kind: 'agent',
      phase: 'start',
      status: 'running',
      label: input.label,
    });
    void this.runLaunch(handle, input.prompt);

    return {
      type: 'agent_run_started',
      runId: input.runId,
      parentSessionId: input.parentSessionId,
      sessionId: input.childSessionId,
      agentName: input.agentName,
      label: input.label,
    };
  }

  recordActivity(runId: string, info: Parameters<ChildToolActivityCallback>[0]): void {
    const handle = this.handles.get(runId);
    if (!handle) {
      return;
    }

    const nextToolUseCount = (() => {
      const existing = this.options.runStore?.get(runId);
      return (existing?.toolUseCount ?? 0) + 1;
    })();
    this.options.runStore?.update(runId, {
      latestActivity: info.label,
      toolUseCount: nextToolUseCount,
    });
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'update',
      status: 'running',
      label: info.label,
      detail: info.toolName,
      parentId: agentRootEventId(handle.runId),
    });
  }

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
    const agent = await this.ensureAgent(handle);
    this.options.approvalStore?.removeByAgentRunId(runId);
    this.options.runStore?.resume(runId, {
      childSessionId: handle.childSessionId,
      latestActivity: 'Resuming review',
    });
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'update',
      status: 'running',
      label: 'Delegated agent resumed',
      detail: handle.label,
      parentId: agentRootEventId(handle.runId),
    });

    const stream = agent.resumeStream(payload, {
      ...config,
      resumeMode: 'tool',
      ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
    });
    const result = yield* forwardAgentStream(stream);

    await this.applyResult(handle, result);
  }

  async resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void> {
    const record = this.requireApprovalRecord(approvalId);
    await this.resumeRun(record.agentRunId!, payload, config);
  }

  async *resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const record = this.requireApprovalRecord(approvalId);
    yield* this.resumeRunStream(record.agentRunId!, payload, config);
  }

  async dispose(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    await Promise.all(handles.map(async (handle) => {
      const record = this.options.runStore?.get(handle.runId);
      if (record?.status === 'paused') {
        return;
      }
      try {
        const agent = handle.agent ?? await handle.agentPromise;
        await agent?.dispose();
      } catch {
        // Best-effort cleanup.
      }
    }));
  }

  private async runLaunch(handle: AgentRunHandle, prompt: string): Promise<void> {
    try {
      const agent = await this.ensureAgent(handle);
      const result = await consumeAgentStream(agent.stream({
        messages: [new HumanMessage(prompt)],
      }, {
        ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
      }));

      await this.applyResult(handle, result);
    } catch (error) {
      this.options.approvalStore?.removeByAgentRunId(handle.runId);
      this.options.runStore?.finish(handle.runId, {
        type: 'delegated_agent_result',
        sessionId: handle.childSessionId,
        turns: 0,
        reason: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.emitAgentEvent({
        kind: 'agent',
        phase: 'end',
        status: 'error',
        label: 'Delegated agent failed',
        detail: error instanceof Error ? error.message : String(error),
        parentId: agentRootEventId(handle.runId),
      });
      await this.disposeHandle(handle);
    }
  }

  private async ensureAgent(handle: AgentRunHandle): Promise<Agent> {
    if (handle.agent) {
      return handle.agent;
    }
    if (!handle.agentPromise) {
      handle.agentPromise = (async () => {
        const checkpoint = await handle.childOptions.checkpointer?.getLatest(handle.childSessionId);
        return bootstrapAgent({
          ...handle.childOptions,
          sessionId: handle.childSessionId,
          ...(checkpoint ? {checkpoint} : {}),
        });
      })().then((agent) => {
        handle.agent = agent;
        return agent;
      });
    }
    return handle.agentPromise;
  }

  private async applyResult(handle: AgentRunHandle, result: AgentResult): Promise<void> {
    const pause = result.state.pendingReview as ReviewRequest | undefined;
    if (pause) {
      const persistedPause = withAgentRecoveryMetadata(pause, handle);
      this.options.runStore?.pause(handle.runId, {
        childSessionId: handle.childSessionId,
        latestActivity: persistedPause.description,
      });
      this.options.approvalStore?.upsertAgentRunApproval({
        sessionId: handle.parentSessionId,
        agentRunId: handle.runId,
        reviewRequest: persistedPause,
        childSessionId: handle.childSessionId,
      });
      this.emitAgentEvent({
        kind: 'agent',
        phase: 'update',
        status: 'paused',
        label: 'Delegated agent waiting for review',
        detail: persistedPause.description,
        parentId: agentRootEventId(handle.runId),
      });
      return;
    }

    this.options.approvalStore?.removeByAgentRunId(handle.runId);
    const delegatedResult = createDelegatedAgentResult(
      handle.childSessionId,
      result.turns,
      result.reason,
      result.error,
      result.state.messages,
    );
    this.options.runStore?.finish(handle.runId, delegatedResult);
    this.emitAgentEvent({
      kind: 'agent',
      phase: 'end',
      status: delegatedResult.reason === 'error' ? 'error' : 'done',
      label: delegatedResult.reason === 'error' ? 'Delegated agent failed' : 'Delegated agent completed',
      detail: delegatedResult.summary ?? delegatedResult.errorMessage,
      parentId: agentRootEventId(handle.runId),
    });
    await this.disposeHandle(handle);
  }

  private async disposeHandle(handle: AgentRunHandle): Promise<void> {
    this.handles.delete(handle.runId);
    try {
      const agent = handle.agent ?? await handle.agentPromise;
      await agent?.dispose();
    } catch {
      // Best-effort cleanup.
    }
  }

  private async resolveHandle(runId: string): Promise<AgentRunHandle> {
    const normalizedRunId = runId.trim();
    const existing = this.handles.get(normalizedRunId);
    if (existing) {
      return existing;
    }

    const record = this.options.runStore?.get(normalizedRunId);
    if (!record || !record.childSessionId) {
      throw new Error(`Agent run "${runId}" is not active in this runtime`);
    }

    if (!this.recoveryBuilder) {
      throw new Error(`Agent run "${runId}" cannot be resumed after restart because no recovery builder is registered`);
    }

    const approval = this.findRunApproval(record);
    const recovery = await this.recoveryBuilder(record, approval);
    if (!recovery) {
      throw new Error(`Agent run "${runId}" cannot be resumed because recovery metadata is incomplete`);
    }

    const recovered: AgentRunHandle = {
      runId: record.runId,
      parentSessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
      label: record.label,
      agentName: record.agentName,
      ...(record.subagentType ? {subagentType: record.subagentType} : {}),
      childOptions: recovery.childOptions,
      ...(typeof recovery.maxTurns === 'number' ? {maxTurns: recovery.maxTurns} : {}),
    };
    this.handles.set(normalizedRunId, recovered);
    return recovered;
  }

  private requireApprovalRecord(approvalId: string) {
    const record = this.options.approvalStore?.get(approvalId);
    if (!record || record.source !== 'agent_run' || !record.agentRunId) {
      throw new Error(`Agent approval "${approvalId}" is not available`);
    }
    return record;
  }

  private findRunApproval(run: AgentRunRecord): ApprovalRecord | undefined {
    return this.options.approvalStore
      ?.list(run.parentSessionId)
      .find((record) => record.source === 'agent_run' && record.agentRunId === run.runId);
  }

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
}

async function consumeAgentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): Promise<AgentResult> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

async function* forwardAgentStream(
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

function agentRootEventId(runId: string): string {
  return `agent-run:${runId}`;
}

function withAgentRecoveryMetadata(review: ReviewRequest, handle: AgentRunHandle): ReviewRequest {
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
  const codara = base.codara && typeof base.codara === 'object'
    ? base.codara as Record<string, unknown>
    : {};

  return {
    ...review,
    metadata: {
      ...base,
      codara: {
        ...codara,
        agentRecovery: recovery,
      },
    },
  };
}
