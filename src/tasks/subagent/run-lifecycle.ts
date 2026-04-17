/**
 * Lifecycle helpers for {@link InMemorySubagentRunManager}.
 *
 * Handles the stateless "build / consume / dispose" mechanics:
 * - Building handles + launch results from {@link SubagentLaunchInput}.
 * - Ensuring a handle's child agent is materialised.
 * - Draining an agent stream to its terminal {@link AgentResult}.
 * - Disposing handles safely (respecting the paused state).
 *
 * The stateful coordination (handle map, event wiring, store updates)
 * lives in `run-manager.ts`; this file exports pure helpers only.
 *
 * @module
 */

import type {AgentStreamOutput} from '@core/agent';
import type {Agent} from '@core/agent/agent-types';
import type {AgentResult} from '@shared/agent-types';
import {bootstrapSubagent} from '@tasks/subagent/bootstrap';
import type {SubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {SubagentRunRecord, SubagentRunStore} from '@tasks/subagent/types';
import type {SubagentLaunchInput, SubagentRecoverySpec, SubagentRunHandle} from './run-manager-types';

export function buildHandle(input: SubagentLaunchInput): SubagentRunHandle {
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

export function buildLaunchResult(input: SubagentLaunchInput): SubagentRunLaunchResult {
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

export function buildRecoveredHandle(record: SubagentRunRecord, recovery: SubagentRecoverySpec): SubagentRunHandle {
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

/**
 * Look up an in-progress launch result for a run, either from the
 * live handle map or from the persisted run store. Returns `undefined`
 * if the run has not been launched (or is already terminal).
 */
export function findExistingLaunchResult(
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

/**
 * Returns true if the store has any tracked runs for the given parent
 * session + batch ids.
 */
export function hasTrackedRuns(runStore: SubagentRunStore, parentSessionId: string, batchIds: readonly string[]): boolean {
  const allowedBatchIds = new Set(batchIds);
  return runStore.list().some((run) => (
    run.parentSessionId === parentSessionId
    && allowedBatchIds.has(run.batchId)
  ));
}

/** Lazily bootstrap the child agent backing a handle (memoised on the handle). */
export async function ensureChildAgent(handle: SubagentRunHandle): Promise<Agent> {
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

/** Dispose the child agent, skipping paused runs (so they can be resumed). */
export async function disposeHandleSafely(handle: SubagentRunHandle, runStore: SubagentRunStore | undefined): Promise<void> {
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

/** Drain an agent stream fully, returning the terminal {@link AgentResult}. */
export async function consumeSubagentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): Promise<AgentResult> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

/**
 * Forward an agent stream, yielding each intermediate chunk and
 * returning the terminal {@link AgentResult}.
 */
export async function* forwardSubagentStream(
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

export function subagentRunEventId(runId: string): string {
  return `subagent-run:${runId}`;
}
