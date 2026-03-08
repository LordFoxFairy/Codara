import type {AgentCheckpoint, AgentCheckpointInfo, AgentCheckpointer} from '@core/checkpoint/state';
import type {AgentResult, AgentState} from '@core/agents/contract/agent';
import {cloneContext, cloneOptionalPause, toCheckpointStatus, type AgentRuntimeState} from '@core/agents/engine/state';

export function createAgentState(
  threadId: string,
  state: AgentRuntimeState
): AgentState {
  return {
    threadId,
    messages: [...state.messages],
    status: state.status,
    ...(state.pendingPause ? {pendingPause: cloneOptionalPause(state.pendingPause)} : {}),
  };
}

export async function persistAgentCheckpoint(
  checkpointer: AgentCheckpointer,
  threadId: string,
  state: AgentRuntimeState,
  source: AgentCheckpointInfo['source'],
  result?: AgentResult
): Promise<AgentCheckpoint> {
  return checkpointer.put({
    threadId,
    ...(state.checkpointId ? {parentCheckpointId: state.checkpointId} : {}),
    state: {
      messages: [...state.messages],
      context: cloneContext(state.context),
      ...(state.pendingPause ? {pendingPause: cloneOptionalPause(state.pendingPause)} : {}),
    },
    info: {
      source,
      status: toCheckpointStatus(state.status, result),
      ...(result?.reason ? {reason: result.reason} : {}),
      ...(result ? {turns: result.turns} : {}),
      ...(result?.error ? {errorMessage: result.error.message} : {}),
      step: state.step + 1,
      createdAt: new Date().toISOString(),
    },
  });
}

export function updateStateFromCheckpointRecord(
  state: AgentRuntimeState,
  record: AgentCheckpoint
): void {
  state.checkpointId = record.ref.checkpointId;
  state.step = record.info.step;
  state.updatedAt = record.info.createdAt;
  state.lastResult = summarizeResultFromCheckpoint(record.info);
}

function summarizeResultFromCheckpoint(info: AgentCheckpointInfo): AgentRuntimeState['lastResult'] {
  return info.reason || info.turns !== undefined || info.errorMessage
    ? {
        reason: info.reason ?? 'complete',
        turns: info.turns ?? 0,
        ...(info.errorMessage ? {errorMessage: info.errorMessage} : {}),
      }
    : undefined;
}
