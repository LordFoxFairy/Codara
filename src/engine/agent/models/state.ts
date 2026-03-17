import {mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages, type BaseMessage} from '@langchain/core/messages';
import type {
  AgentResult,
  AgentState,
} from './agent';
import type {
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentStatus,
  AgentType,
  PauseRequest,
} from './types';
import type {
  AgentCheckpoint,
  AgentCheckpointInfo,
  AgentCheckpointState,
  AgentCheckpointStatus,
  AgentCheckpointSummary,
} from '@engine/checkpoint/agent';
import {deepClone} from '@shared/clone';

type DurableState = {
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  pendingPause?: PauseRequest;
};

export type AgentRuntimeState = DurableState & {
  sessionId: string;
  checkpointId?: string;
  status: AgentStatus;
  lastResult?: AgentCheckpointSummary;
  step: number;
  createdAt: string;
  updatedAt: string;
};

export type MutableAgentState = AgentRuntimeState;

export function createInitialAgentState(
  sessionId: string,
  input?: {agentType?: AgentType; messages?: BaseMessage[]; context?: AgentRuntimeContext; values?: AgentRuntimeValues},
  checkpoint?: AgentCheckpoint,
): MutableAgentState {
  const now = new Date().toISOString();
  const restored = checkpoint?.state;
  const pendingPause = restored?.pendingPause;

  return {
    sessionId: checkpoint?.ref.sessionId ?? sessionId,
    agentType: restored?.agentType ?? input?.agentType ?? 'main',
    checkpointId: checkpoint?.ref.checkpointId,
    messages: cloneAgentMessages(restored?.messages ?? input?.messages ?? []),
    context: cloneAgentContext(restored?.context ?? input?.context ?? {}),
    values: cloneAgentValues(input?.values ?? restored?.values ?? {}),
    pendingPause: clonePauseRequest(pendingPause),
    status: checkpoint?.info?.status === 'closed' ? 'closed' : pendingPause ? 'paused' : 'idle',
    lastResult: checkpoint?.info ? summarizeCheckpointInfo(checkpoint.info) : undefined,
    step: checkpoint?.info?.step ?? 0,
    createdAt: now,
    updatedAt: checkpoint?.info?.createdAt ?? now,
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
  return info.reason || info.turns !== undefined || info.errorMessage
    ? {
      reason: info.reason ?? 'complete',
      turns: info.turns ?? 0,
      ...(info.errorMessage ? {errorMessage: info.errorMessage} : {}),
    }
    : undefined;
}

export function toAgentState(state: AgentRuntimeState): AgentState {
  return {sessionId: state.sessionId, ...cloneDurableState(state), status: state.status};
}

export function toCheckpointState(state: AgentRuntimeState): AgentCheckpointState {
  return cloneDurableState(state);
}

export function toCheckpointInfo(
  state: AgentRuntimeState,
  source: AgentCheckpointInfo['source'],
  result?: AgentResult,
): AgentCheckpointInfo {
  const status: AgentCheckpointStatus =
    state.status === 'paused'
      ? 'paused'
      : state.status === 'closed'
        ? 'closed'
        : result?.reason === 'error'
          ? 'error'
          : 'idle';

  return {
    source,
    status,
    ...(result?.reason ? {reason: result.reason} : {}),
    ...(result ? {turns: result.turns} : {}),
    ...(result?.error ? {errorMessage: result.error.message} : {}),
    step: state.step + 1,
    createdAt: new Date().toISOString(),
  };
}

export function restoreCheckpointMetadata(state: MutableAgentState, record: AgentCheckpoint): void {
  state.agentType = record.state.agentType;
  state.checkpointId = record.ref.checkpointId;
  state.step = record.info.step;
  state.updatedAt = record.info.createdAt;
  state.lastResult = summarizeCheckpointInfo(record.info);
}

export function hasEquivalentCheckpointState(
  left: Pick<DurableState | AgentState, 'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'>,
  right: Pick<DurableState | AgentState, 'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'>,
): boolean {
  return JSON.stringify(toComparableState(left)) === JSON.stringify(toComparableState(right));
}

export function cloneAgentState(state: AgentState): AgentState {
  return {sessionId: state.sessionId, ...cloneDurableState(state), status: state.status};
}

export function cloneAgentMessages<T extends BaseMessage[]>(messages: T): T {
  const stored = messages.every(isMessage) ? mapChatMessagesToStoredMessages(messages) : messages;
  return mapStoredMessagesToChatMessages(stored as Parameters<typeof mapStoredMessagesToChatMessages>[0]) as T;
}

export function cloneAgentContext<T extends AgentRuntimeContext>(context: T): T {
  return deepClone(context);
}

export function cloneAgentValues<T extends AgentRuntimeValues>(values: T): T {
  return deepClone(values);
}

export function clonePauseRequest<T extends PauseRequest | undefined>(pause: T): T {
  return (pause ? deepClone(pause) : undefined) as T;
}

export function applyAgentStateSnapshot(
  target: MutableAgentState,
  snapshot: Pick<AgentState, 'messages' | 'context' | 'values' | 'pendingPause'>,
): void {
  target.messages = cloneAgentMessages(snapshot.messages);
  target.context = cloneAgentContext(snapshot.context);
  target.values = cloneAgentValues(snapshot.values);
  target.pendingPause = clonePauseRequest(snapshot.pendingPause);
}

function cloneDurableState(
  state: Pick<DurableState, 'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'>,
): DurableState {
  return {
    agentType: state.agentType,
    messages: cloneAgentMessages(state.messages),
    context: cloneAgentContext(state.context),
    values: cloneAgentValues(state.values),
    ...(state.pendingPause ? {pendingPause: clonePauseRequest(state.pendingPause)} : {}),
  };
}

function toComparableState(
  state: Pick<DurableState | AgentState, 'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'>,
): AgentCheckpointState {
  return {
    agentType: state.agentType,
    messages: mapChatMessagesToStoredMessages(state.messages) as unknown as BaseMessage[],
    context: cloneAgentContext(state.context),
    values: cloneAgentValues(state.values),
    ...(state.pendingPause ? {pendingPause: clonePauseRequest(state.pendingPause)} : {}),
  } as unknown as AgentCheckpointState;
}

function isMessage(value: unknown): value is BaseMessage {
  return value !== null && typeof value === 'object' && 'toDict' in value;
}
