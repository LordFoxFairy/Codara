import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
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
} from '@core/checkpoint';
import type {PauseRequest} from '@core/agents/contract/pause';
import {deepClone} from '@core/support/clone';

/** Agent 内部运行态。 */
export interface AgentDurableState {
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  pendingPause?: PauseRequest;
}

export interface AgentExecutionControlState {
  threadId: string;
  checkpointId?: string;
  status: AgentStatus;
  lastResult?: AgentCheckpointSummary;
  step: number;
  createdAt: string;
  updatedAt: string;
}

/** Agent 内部运行态。 */
export interface AgentRuntimeState extends AgentDurableState, AgentExecutionControlState {}

export type MutableAgentState = AgentRuntimeState;

interface AgentInitialInput {
  agentType?: AgentType;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
}

type CheckpointComparableState = Pick<
  AgentDurableState | AgentState,
  'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'
>;

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
    messages: cloneAgentMessages(restoredState?.messages ?? input?.messages ?? []),
    context: cloneAgentContext(restoredState?.context ?? input?.context ?? {}),
    values: cloneAgentValues(input?.values ?? restoredState?.values ?? {}),
    status: deriveRuntimeStatus(pendingPause, restoredInfo?.status),
    pendingPause: clonePauseRequest(pendingPause),
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

export function toAgentState(state: AgentRuntimeState): AgentState {
  return {
    threadId: state.threadId,
    ...cloneDurableAgentState(state),
    status: state.status,
  };
}

export function toCheckpointState(state: AgentRuntimeState): AgentCheckpointState {
  return cloneDurableAgentState(state);
}

export function cloneDurableAgentState(
  state: Pick<AgentDurableState, 'agentType' | 'messages' | 'context' | 'values' | 'pendingPause'>,
): AgentDurableState {
  return {
    agentType: state.agentType,
    messages: cloneAgentMessages(state.messages),
    context: cloneAgentContext(state.context),
    values: cloneAgentValues(state.values),
    ...(state.pendingPause ? {pendingPause: clonePauseRequest(state.pendingPause)} : {}),
  };
}

export function hasEquivalentCheckpointState(
  left: CheckpointComparableState,
  right: CheckpointComparableState
): boolean {
  return JSON.stringify(toComparableCheckpointState(left)) === JSON.stringify(toComparableCheckpointState(right));
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
  return cloneAgentValues(values);
}

export function cloneAgentMessages<T extends BaseMessage[]>(messages: T): T {
  if (messages.every(isChatMessageLike)) {
    return mapStoredMessagesToChatMessages(
      mapChatMessagesToStoredMessages(messages),
    ) as T;
  }

  return mapStoredMessagesToChatMessages(
    messages as Parameters<typeof mapStoredMessagesToChatMessages>[0],
  ) as T;
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

export function cloneAgentState(state: AgentState): AgentState {
  return {
    threadId: state.threadId,
    ...cloneDurableAgentState(state),
    status: state.status,
  };
}

export function applyAgentStateSnapshot(
  target: MutableAgentState,
  snapshot: Pick<AgentState, 'messages' | 'context' | 'values' | 'pendingPause'>
): void {
  target.messages = cloneAgentMessages(snapshot.messages);
  target.context = cloneAgentContext(snapshot.context);
  target.values = cloneAgentValues(snapshot.values);
  target.pendingPause = clonePauseRequest(snapshot.pendingPause);
}

function toComparableCheckpointState(
  state: CheckpointComparableState
): PersistedAgentCheckpointComparableState {
  return {
    agentType: state.agentType,
    messages: mapChatMessagesToStoredMessages(state.messages),
    context: cloneAgentContext(state.context),
    values: cloneAgentValues(state.values),
    ...(state.pendingPause ? {pendingPause: clonePauseRequest(state.pendingPause)} : {}),
  };
}

interface PersistedAgentCheckpointComparableState {
  agentType: AgentType;
  messages: ReturnType<typeof mapChatMessagesToStoredMessages>;
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  pendingPause?: PauseRequest;
}

function isChatMessageLike(value: unknown): value is BaseMessage {
  return value !== null && typeof value === 'object' && 'toDict' in value;
}
