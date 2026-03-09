import type {BaseMessage} from '@langchain/core/messages';
import type {
  AgentResult,
  AgentStatus,
  AgentType,
  AgentRuntimeContext,
  AgentRuntimeValues,
} from '@core/agents/contract/agent';
import type {
  AgentCheckpoint,
  AgentCheckpointInfo,
  AgentCheckpointStatus,
  AgentCheckpointSummary,
} from '@core/checkpoint/state';
import type {HILPauseRequest} from '@core/middleware/hil';

/** Agent 内部运行态。 */
export interface AgentRuntimeState {
  threadId: string;
  agentType: AgentType;
  checkpointId?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  values: AgentRuntimeValues;
  status: AgentStatus;
  pendingPause?: HILPauseRequest;
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
    context: cloneContext(restoredState?.context ?? input?.context ?? {}),
    values: cloneValues(input?.values ?? restoredState?.values ?? {}),
    status: deriveRuntimeStatus(pendingPause, restoredInfo?.status),
    pendingPause: cloneOptionalPause(pendingPause),
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

export function deriveRuntimeStatus(
  pendingPause: HILPauseRequest | undefined,
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

export function cloneContext(context: AgentRuntimeContext): AgentRuntimeContext {
  try {
    return structuredClone(context);
  } catch {
    return {...context};
  }
}

export function cloneValues(values: AgentRuntimeValues): AgentRuntimeValues {
  try {
    return structuredClone(values);
  } catch {
    return {...values};
  }
}

export function clonePause(pause: HILPauseRequest): HILPauseRequest {
  return structuredClone(pause);
}

export function cloneOptionalPause(pause: HILPauseRequest | undefined): HILPauseRequest | undefined {
  return pause ? clonePause(pause) : undefined;
}
