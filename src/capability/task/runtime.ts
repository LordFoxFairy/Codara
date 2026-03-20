import {HumanMessage} from '@langchain/core/messages';
import type {AgentResumeStreamConfig, AgentStreamOutput, PauseRequest, ResumePayload} from '@core/agent';
import type {Agent} from '@core/agent/models/agent';
import {bootstrapAgent, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentResult} from '@shared/contracts/agent-types';
import type {ApprovalStore} from '@durability/approval-store';
import {createDelegatedAgentResult} from '@capability/task/delegation';
import type {ChildToolActivityCallback} from '@observability/events';
import type {CodaraRuntimeEventListener, EmitRuntimeEventInput} from '@observability/events';
import type {TaskRunRecord, TaskRunStore} from '@capability/task/types';
import type {TaskRunLaunchResult} from '@shared/task-run-launch';

export interface TaskRuntimeLaunchInput {
  runId: string;
  parentSessionId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  prompt: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export interface TaskRuntime {
  launch(input: TaskRuntimeLaunchInput): Promise<TaskRunLaunchResult>;
  registerRecoveryBuilder(builder: TaskRuntimeRecoveryBuilder): void;
  setOnTaskEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void;
  recordActivity(runId: string, info: Parameters<ChildToolActivityCallback>[0]): void;
  resumeRun(runId: string, payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeRunStream(
    runId: string,
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  resumeApprovalById(approvalId: string, payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalByIdStream(
    approvalId: string,
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  dispose(): Promise<void>;
}

interface TaskHandle {
  runId: string;
  parentSessionId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
  agent?: Agent;
  agentPromise?: Promise<Agent>;
}

export interface CreateTaskRuntimeOptions {
  runStore?: TaskRunStore;
  approvalStore?: ApprovalStore;
}

export type TaskRuntimeRecoveryBuilder = (
  run: TaskRunRecord,
) => Promise<BootstrapAgentOptions | undefined> | BootstrapAgentOptions | undefined;

export function createTaskRuntime(options: CreateTaskRuntimeOptions): TaskRuntime {
  return new InMemoryTaskRuntime(options);
}

class InMemoryTaskRuntime implements TaskRuntime {
  private readonly handles = new Map<string, TaskHandle>();
  private onTaskEventCallback?: CodaraRuntimeEventListener;
  private sessionIdGetter?: string | (() => string);
  private recoveryBuilder?: TaskRuntimeRecoveryBuilder;

  constructor(private readonly options: CreateTaskRuntimeOptions) {}

  setOnTaskEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void {
    this.onTaskEventCallback = listener;
    this.sessionIdGetter = sessionId;
  }

  registerRecoveryBuilder(builder: TaskRuntimeRecoveryBuilder): void {
    this.recoveryBuilder = builder;
  }

  async launch(input: TaskRuntimeLaunchInput): Promise<TaskRunLaunchResult> {
    const existingHandle = this.handles.get(input.runId);
    if (existingHandle) {
      return {
        type: 'task_run_started',
        runId: existingHandle.runId,
        sessionId: existingHandle.childSessionId,
        agentName: existingHandle.agentName,
        label: existingHandle.label,
      };
    }

    const existingRun = this.options.runStore?.get(input.runId);
    if (existingRun && (existingRun.status === 'running' || existingRun.status === 'paused')) {
      return {
        type: 'task_run_started',
        runId: existingRun.runId,
        sessionId: existingRun.childSessionId ?? input.childSessionId,
        agentName: existingRun.agentName,
        label: existingRun.label,
      };
    }

    this.options.approvalStore?.removeByTaskRunId(input.runId);
    this.options.runStore?.start({
      runId: input.runId,
      sessionId: input.parentSessionId,
      label: input.label,
      agentName: input.agentName,
      childSessionId: input.childSessionId,
      prompt: input.prompt,
      ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
      ...(input.childOptions.tools?.length
        ? {toolNames: input.childOptions.tools.map((tool) => tool.name)}
        : {}),
      ...(input.childOptions.systemMessage?.length
        ? {systemMessages: [...input.childOptions.systemMessage]}
        : {}),
    });

    const handle: TaskHandle = {
      runId: input.runId,
      parentSessionId: input.parentSessionId,
      childSessionId: input.childSessionId,
      label: input.label,
      agentName: input.agentName,
      childOptions: input.childOptions,
      ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
    };
    this.handles.set(input.runId, handle);
    this.emitTaskEvent({
      id: taskRootEventId(input.runId),
      kind: 'task',
      phase: 'start',
      status: 'running',
      label: input.label,
    });
    void this.runLaunch(handle, input.prompt);

    return {
      type: 'task_run_started',
      runId: input.runId,
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
    this.emitTaskEvent({
      kind: 'task',
      phase: 'update',
      status: 'running',
      label: info.label,
      detail: info.toolName,
      parentId: taskRootEventId(handle.runId),
    });
  }

  async resumeRun(runId: string, payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void> {
    for await (const _chunk of this.resumeRunStream(runId, payload, config)) {
      // Drain streamed output for non-streaming consumers.
    }
  }

  async *resumeRunStream(
    runId: string,
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const handle = await this.resolveHandle(runId);
    const agent = await this.ensureAgent(handle);
    this.options.approvalStore?.removeByTaskRunId(runId);
    this.options.runStore?.resume(runId, {
      childSessionId: handle.childSessionId,
      latestActivity: 'Resuming review',
    });
    this.emitTaskEvent({
      kind: 'task',
      phase: 'update',
      status: 'running',
      label: 'Delegated task resumed',
      detail: handle.label,
      parentId: taskRootEventId(handle.runId),
    });

    const stream = agent.resumeStream(payload, {
      ...config,
      resumeMode: 'tool',
      ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
    });
    const result = yield* forwardAgentStream(stream);

    await this.applyResult(handle, result);
  }

  async resumeApprovalById(approvalId: string, payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void> {
    const record = this.requireApprovalRecord(approvalId);
    await this.resumeRun(record.taskRunId!, payload, config);
  }

  async *resumeApprovalByIdStream(
    approvalId: string,
    payload: ResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void> {
    const record = this.requireApprovalRecord(approvalId);
    yield* this.resumeRunStream(record.taskRunId!, payload, config);
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

  private async runLaunch(handle: TaskHandle, prompt: string): Promise<void> {
    try {
      const agent = await this.ensureAgent(handle);
      const result = await consumeAgentStream(agent.stream({
        messages: [new HumanMessage(prompt)],
      }, {
        ...(typeof handle.maxTurns === 'number' ? {recursionLimit: handle.maxTurns} : {}),
      }));

      await this.applyResult(handle, result);
    } catch (error) {
      this.options.approvalStore?.removeByTaskRunId(handle.runId);
      this.options.runStore?.finish(handle.runId, {
        type: 'delegated_agent_result',
        sessionId: handle.childSessionId,
        turns: 0,
        reason: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.emitTaskEvent({
        kind: 'task',
        phase: 'end',
        status: 'error',
        label: 'Delegated task failed',
        detail: error instanceof Error ? error.message : String(error),
        parentId: taskRootEventId(handle.runId),
      });
      await this.disposeHandle(handle);
    }
  }

  private async ensureAgent(handle: TaskHandle): Promise<Agent> {
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

  private async applyResult(handle: TaskHandle, result: AgentResult): Promise<void> {
    const pause = result.state.pendingPause as PauseRequest | undefined;
    if (pause) {
      this.options.runStore?.pause(handle.runId, {
        childSessionId: handle.childSessionId,
        latestActivity: pause.description,
      });
      this.options.approvalStore?.upsertTaskRunApproval({
        sessionId: handle.parentSessionId,
        taskRunId: handle.runId,
        pauseRequest: pause,
        childSessionId: handle.childSessionId,
      });
      this.emitTaskEvent({
        kind: 'task',
        phase: 'update',
        status: 'paused',
        label: 'Delegated task waiting for review',
        detail: pause.description,
        parentId: taskRootEventId(handle.runId),
      });
      return;
    }

    this.options.approvalStore?.removeByTaskRunId(handle.runId);
    const delegatedResult = createDelegatedAgentResult(
      handle.childSessionId,
      result.turns,
      result.reason,
      result.error,
      result.state.messages,
    );
    this.options.runStore?.finish(handle.runId, delegatedResult);
    this.emitTaskEvent({
      kind: 'task',
      phase: 'end',
      status: delegatedResult.reason === 'error' ? 'error' : 'done',
      label: delegatedResult.reason === 'error' ? 'Delegated task failed' : 'Delegated task completed',
      detail: delegatedResult.summary ?? delegatedResult.errorMessage,
      parentId: taskRootEventId(handle.runId),
    });
    await this.disposeHandle(handle);
  }

  private async disposeHandle(handle: TaskHandle): Promise<void> {
    this.handles.delete(handle.runId);
    try {
      const agent = handle.agent ?? await handle.agentPromise;
      await agent?.dispose();
    } catch {
      // Best-effort cleanup.
    }
  }

  private async resolveHandle(runId: string): Promise<TaskHandle> {
    const normalizedRunId = runId.trim();
    const existing = this.handles.get(normalizedRunId);
    if (existing) {
      return existing;
    }

    const record = this.options.runStore?.get(normalizedRunId);
    if (!record || !record.childSessionId) {
      throw new Error(`Task run "${runId}" is not active in this runtime`);
    }

    if (!this.recoveryBuilder) {
      throw new Error(`Task run "${runId}" cannot be resumed after restart because no recovery builder is registered`);
    }

    const childOptions = await this.recoveryBuilder(record);
    if (!childOptions) {
      throw new Error(`Task run "${runId}" cannot be resumed because recovery metadata is incomplete`);
    }

    const recovered: TaskHandle = {
      runId: record.runId,
      parentSessionId: record.sessionId,
      childSessionId: record.childSessionId,
      label: record.label,
      agentName: record.agentName,
      childOptions,
      ...(typeof record.maxTurns === 'number' ? {maxTurns: record.maxTurns} : {}),
    };
    this.handles.set(normalizedRunId, recovered);
    return recovered;
  }

  private requireApprovalRecord(approvalId: string) {
    const record = this.options.approvalStore?.get(approvalId);
    if (!record || record.source !== 'task_run' || !record.taskRunId) {
      throw new Error(`Task approval "${approvalId}" is not available`);
    }
    return record;
  }

  private emitTaskEvent(event: EmitRuntimeEventInput): void {
    if (!this.onTaskEventCallback || !this.sessionIdGetter) {
      return;
    }

    const sessionId = typeof this.sessionIdGetter === 'function'
      ? this.sessionIdGetter()
      : this.sessionIdGetter;
    this.onTaskEventCallback({
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

function taskRootEventId(runId: string): string {
  return `task-run:${runId}`;
}
