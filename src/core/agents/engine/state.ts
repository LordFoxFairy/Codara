import type {BaseMessage} from '@langchain/core/messages';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import type {
  AgentResult,
  AgentStatus,
  AgentRuntimeContext,
  AgentRuntimeValues,
  AgentInput,
  AgentMessagesInput,
} from '@core/agents/contract/agent';
import type {
  AgentCheckpoint,
  AgentCheckpointInfo,
  AgentCheckpointStatus,
  AgentCheckpointSummary,
} from '@core/checkpoint/state';
import {parseHILToolMessagePayload, type HILPauseRequest, type HILResumePayload} from '@core/middleware/hil';

/** Agent 内部运行态。 */
export interface AgentRuntimeState {
  threadId: string;
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

export function normalizeAgentInput(input: AgentInput): BaseMessage[] {
  if (input === undefined) {
    return [];
  }

  if (isAgentMessagesState(input)) {
    return [...input.messages];
  }

  if (typeof input === 'string') {
    const content = input.trim();
    return content ? [new HumanMessage(content)] : [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

export function isAgentMessagesState(input: AgentInput): input is AgentMessagesInput {
  return typeof input === 'object' && input !== null && 'messages' in input && Array.isArray((input as {messages?: unknown}).messages);
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

export function readLatestPause(messages: BaseMessage[]): HILPauseRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    const payload = parseHILToolMessagePayload(message.content);
    if (payload?.type === 'hil_pause') {
      return clonePause(payload.request);
    }
  }

  return undefined;
}

export function injectResumePayload(
  context: AgentRuntimeContext | undefined,
  pause: HILPauseRequest,
  payload: HILResumePayload
): AgentRuntimeContext {
  const nextContext = mergeContext({}, context);
  const root = ensureRecord(nextContext);
  const rawHil = ensureRecord(root.hil);
  const rawResumes = ensureRecord(rawHil.resumes);

  root.hil = {
    ...rawHil,
    resumes: {
      ...rawResumes,
      [pause.id]: payload,
      [pause.action.toolCallId]: payload,
    },
  };

  return root;
}

export function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides) {
    return cloneContext(base);
  }

  const merged: AgentRuntimeContext = cloneContext(base);
  for (const [key, value] of Object.entries(cloneContext(overrides))) {
    const previous = merged[key];
    if (isPlainRecord(previous) && isPlainRecord(value)) {
      merged[key] = {...previous, ...value};
      continue;
    }
    merged[key] = value;
  }
  return merged;
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

function ensureRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
