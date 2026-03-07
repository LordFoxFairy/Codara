import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import type {AgentFinishReason, AgentRuntimeContext} from '@core/agents/types';
import {FileCheckpointer} from '@core/checkpoint/file';
import {MemoryCheckpointer} from '@core/checkpoint/memory';
import type {CheckpointRecord, Checkpointer} from '@core/checkpoint/types';
import type {HILPauseRequest} from '@core/middleware/hil';

export type AgentCheckpointStatus = 'idle' | 'paused' | 'closed' | 'error';

export interface AgentCheckpointState {
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  pendingPause?: HILPauseRequest;
}

export interface AgentCheckpointInfo {
  source: 'invoke' | 'resume' | 'reset' | 'dispose' | 'manual';
  status: AgentCheckpointStatus;
  reason?: AgentFinishReason;
  turns?: number;
  errorMessage?: string;
  step: number;
  createdAt: string;
}

export type AgentCheckpoint = CheckpointRecord<AgentCheckpointState, AgentCheckpointInfo>;
export type AgentCheckpointer = Checkpointer<AgentCheckpointState, AgentCheckpointInfo>;

export interface AgentResultSummary {
  reason: AgentFinishReason;
  turns: number;
  errorMessage?: string;
}

export interface AgentInstanceState {
  threadId: string;
  checkpointId?: string;
  messages: BaseMessage[];
  context: AgentRuntimeContext;
  status: 'idle' | 'running' | 'paused' | 'closed';
  pendingPause?: HILPauseRequest;
  lastResult?: AgentResultSummary;
  step: number;
  createdAt: string;
  updatedAt: string;
}

interface PersistedAgentCheckpointState {
  messages: ReturnType<typeof mapChatMessagesToStoredMessages>;
  context: AgentRuntimeContext;
  pendingPause?: HILPauseRequest;
}

export interface AgentFileCheckpointerOptions {
  rootDir: string;
}

export function createAgentMemoryCheckpointer(): AgentCheckpointer {
  return new MemoryCheckpointer<AgentCheckpointState, AgentCheckpointInfo>();
}

export function createAgentFileCheckpointer(options: AgentFileCheckpointerOptions): AgentCheckpointer {
  return new FileCheckpointer<AgentCheckpointState, AgentCheckpointInfo>({
    rootDir: options.rootDir,
    state: {
      serialize: serializeAgentCheckpointState,
      deserialize: deserializeAgentCheckpointState,
    },
    info: {
      serialize: serializeAgentCheckpointInfo,
      deserialize: deserializeAgentCheckpointInfo,
    },
  });
}

function serializeAgentCheckpointState(state: AgentCheckpointState): PersistedAgentCheckpointState {
  return {
    messages: mapChatMessagesToStoredMessages(state.messages),
    context: cloneContext(state.context),
    ...(state.pendingPause ? {pendingPause: cloneStructured(state.pendingPause)} : {}),
  };
}

function deserializeAgentCheckpointState(raw: unknown): AgentCheckpointState {
  const record = ensureRecord(raw);
  const storedMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = mapStoredMessagesToChatMessages(
    storedMessages as Parameters<typeof mapStoredMessagesToChatMessages>[0]
  );

  return {
    messages: messages as BaseMessage[],
    context: cloneContext(asRuntimeContext(record.context)),
    ...(isPlainRecord(record.pendingPause)
      ? {pendingPause: cloneStructured(record.pendingPause) as unknown as HILPauseRequest}
      : {}),
  };
}

function serializeAgentCheckpointInfo(info: AgentCheckpointInfo): AgentCheckpointInfo {
  return {...info};
}

function deserializeAgentCheckpointInfo(raw: unknown): AgentCheckpointInfo {
  const record = ensureRecord(raw);
  return {
    source: parseSource(record.source),
    status: parseStatus(record.status),
    ...(typeof record.reason === 'string' ? {reason: record.reason as AgentCheckpointInfo['reason']} : {}),
    ...(typeof record.turns === 'number' ? {turns: record.turns} : {}),
    ...(typeof record.errorMessage === 'string' ? {errorMessage: record.errorMessage} : {}),
    step: typeof record.step === 'number' ? record.step : 0,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
  };
}

function parseSource(value: unknown): AgentCheckpointInfo['source'] {
  switch (value) {
    case 'invoke':
    case 'resume':
    case 'reset':
    case 'dispose':
    case 'manual':
      return value;
    default:
      return 'manual';
  }
}

function parseStatus(value: unknown): AgentCheckpointInfo['status'] {
  switch (value) {
    case 'idle':
    case 'paused':
    case 'closed':
    case 'error':
      return value;
    default:
      return 'idle';
  }
}

function asRuntimeContext(value: unknown): AgentRuntimeContext {
  return isPlainRecord(value) ? (cloneStructured(value) as AgentRuntimeContext) : {};
}

function cloneContext(context: AgentRuntimeContext): AgentRuntimeContext {
  return cloneStructured(context);
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneStructured<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }

    if (value && typeof value === 'object') {
      return {...(value as Record<string, unknown>)} as T;
    }

    return value;
  }
}
