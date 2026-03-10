import type {BaseMessage} from '@langchain/core/messages';
import type {
  AgentResult,
  AgentState,
  AgentStatus,
  AgentType,
  AgentRuntimeContext,
  AgentRuntimeValues,
} from '@core/agents/contract/agent';
import type {
  AgentCheckpoint,
  AgentCheckpointState,
  AgentCheckpointInfo,
  AgentCheckpointStatus,
  AgentCheckpointSummary,
} from '@core/checkpoint/state';
import type {PauseRequest} from '@core/agents/contract/pause';
import {deepClone} from '@core/shared/clone';

/** Agent 内部运行态。 */
export interface AgentRuntimeState {
  threadId: string;
  agentType: AgentType;
  checkpointId?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  status: AgentStatus;
  pendingPause?: PauseRequest;
  lastResult?: AgentCheckpointSummary;
  step: number;
  createdAt: string;
  updatedAt: string;
}

export type MutableAgentState = AgentRuntimeState;

interface AgentInitialInput {
  agentType?: AgentType;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
}

export function createInitialAgentState(
  threadId: string,
  input: AgentInitialInput | undefined,
  checkpoint?: AgentCheckpoint
): MutableAgentState {
  const now = new Date().toISOString();
  const restoredState = checkpoint?.state;
  const restoredInfo = checkpoint?.info;
  const pendingPause = restoredState?.pendingPause;

  return {
    threadId: checkpoint?.ref.threadId ?? threadId,
    agentType: restoredState?.agentType ?? input?.agentType ?? 'main',
    checkpointId: checkpoint?.ref.checkpointId,
    messages: [...(restoredState?.messages ?? input?.messages ?? [])],
    context: deepClone(restoredState?.context ?? input?.context ?? {}),
    values: deepClone(input?.values ?? restoredState?.values ?? {}),
    status: deriveRuntimeStatus(pendingPause, restoredInfo?.status),
    pendingPause: pendingPause ? deepClone(pendingPause) : undefined,
    lastResult: restoredInfo ? summarizeCheckpointInfo(restoredInfo) : undefined,
    step: restoredInfo?.step ?? 0,
    createdAt: now,
    updatedAt: restoredInfo?.createdAt ?? now,
  };
}

export function summarizeResult(result: AgentResult): AgentCheckpointSummary {
  return {
    reason: result.reason,
    turns: result.turns,
    ...(result.error ? {errorMessage: result.error.message} : {}),
  };
}

export function summarizeCheckpointInfo(info: AgentCheckpointInfo): AgentCheckpointSummary | undefined {
  if (!info.reason && info.turns === undefined && !info.errorMessage) {
    return undefined;
  }

  return {
    reason: info.reason ?? 'complete',
    turns: info.turns ?? 0,
    ...(info.errorMessage ? {errorMessage: info.errorMessage} : {}),
  };
}

export function toAgentState(threadId: string, state: AgentRuntimeState): AgentState {
  return {
    threadId,
    agentType: state.agentType,
    messages: [...state.messages],
    context: deepClone(state.context),
    values: deepClone(state.values),
    status: state.status,
    ...(state.pendingPause ? {pendingPause: deepClone(state.pendingPause)} : {}),
  };
}

export function toCheckpointState(state: AgentRuntimeState): AgentCheckpointState {
  return {
    agentType: state.agentType,
    messages: [...state.messages],
    context: deepClone(state.context),
    values: deepClone(state.values),
    ...(state.pendingPause ? {pendingPause: deepClone(state.pendingPause)} : {}),
  };
}

export function toCheckpointInfo(
  state: AgentRuntimeState,
  source: AgentCheckpointInfo['source'],
  result?: AgentResult
): AgentCheckpointInfo {
  return {
    source,
    status: toCheckpointStatus(state.status, result),
    ...(result?.reason ? {reason: result.reason} : {}),
    ...(result ? {turns: result.turns} : {}),
    ...(result?.error ? {errorMessage: result.error.message} : {}),
    step: state.step + 1,
    createdAt: new Date().toISOString(),
  };
}

export function restoreCheckpointMetadata(
  state: MutableAgentState,
  record: AgentCheckpoint
): void {
  state.agentType = record.state.agentType;
  state.checkpointId = record.ref.checkpointId;
  state.step = record.info.step;
  state.updatedAt = record.info.createdAt;
  state.lastResult = summarizeCheckpointInfo(record.info);
}

export function deriveRuntimeStatus(
  pendingPause: PauseRequest | undefined,
  checkpointStatus: AgentCheckpointStatus | undefined
): AgentStatus {
  if (checkpointStatus === 'closed') {
    return 'closed';
  }
  if (pendingPause) {
    return 'paused';
  }
  return 'idle';
}

export function toCheckpointStatus(
  runtimeStatus: AgentStatus,
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

export function cloneValues(values: AgentRuntimeValues): AgentRuntimeValues {
  return deepClone(values);
}
