import type {AgentCheckpoint, AgentCheckpointInfo, AgentCheckpointer} from '@core/checkpoint';
import type {AgentResult, AgentState} from '@core/agents/contract/agent';
import {
  restoreCheckpointMetadata,
  toAgentState,
  toCheckpointInfo,
  toCheckpointState,
  type AgentRuntimeState,
} from '@core/agents/engine/state';

export function createAgentState(
  state: AgentRuntimeState
): AgentState {
  return toAgentState(state);
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
    state: toCheckpointState(state),
    info: toCheckpointInfo(state, source, result),
  });
}

export function updateStateFromCheckpointRecord(
  state: AgentRuntimeState,
  record: AgentCheckpoint
): void {
  restoreCheckpointMetadata(state, record);
}
