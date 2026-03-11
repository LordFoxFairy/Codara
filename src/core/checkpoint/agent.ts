import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import {FileCheckpointer} from '@core/checkpoint/file';
import {InMemoryCheckpointer} from '@core/checkpoint/in-memory';
import type {CheckpointRecord, Checkpointer} from '@core/checkpoint';
import type {PauseRequest} from '@core/agents/contract/pause';
import type {AgentType} from '@core/agents/contract/agent';
import {deepClone} from '@core/support/clone';

export type AgentCheckpointStatus = 'idle' | 'paused' | 'closed' | 'error';
export type AgentCheckpointReason = 'complete' | 'error' | 'max_turns';
export type AgentCheckpointContext = Record<string, unknown>;
export type AgentCheckpointValues = Record<string, unknown>;

export interface AgentCheckpointState {
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentCheckpointContext;
  values: AgentCheckpointValues;
  pendingPause?: PauseRequest;
}

export interface AgentCheckpointInfo {
  source: 'invoke' | 'resume' | 'reset' | 'dispose' | 'manual' | 'fork';
  status: AgentCheckpointStatus;
  reason?: AgentCheckpointReason;
  turns?: number;
  errorMessage?: string;
  step: number;
  createdAt: string;
}

export type AgentCheckpoint = CheckpointRecord<AgentCheckpointState, AgentCheckpointInfo>;
export type AgentCheckpointer = Checkpointer<AgentCheckpointState, AgentCheckpointInfo>;

export interface AgentCheckpointSummary {
  reason: AgentCheckpointReason;
  turns: number;
  errorMessage?: string;
}

interface PersistedAgentCheckpointState {
  agentType: AgentType;
  messages: ReturnType<typeof mapChatMessagesToStoredMessages>;
  context: AgentCheckpointContext;
  values: AgentCheckpointValues;
  pendingPause?: PauseRequest;
}

export interface AgentFileCheckpointerOptions {
  rootDir: string;
}

export function createAgentMemoryCheckpointer(): AgentCheckpointer {
  return new InMemoryCheckpointer<AgentCheckpointState, AgentCheckpointInfo>({
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
    agentType: state.agentType,
    messages: mapChatMessagesToStoredMessages(state.messages),
    context: deepClone(state.context),
    values: deepClone(state.values),
    ...(state.pendingPause ? {pendingPause: deepClone(state.pendingPause)} : {}),
  };
}

function deserializeAgentCheckpointState(raw: unknown): AgentCheckpointState {
  const record = ensureRecord(raw);
  const storedMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = mapStoredMessagesToChatMessages(
    storedMessages as Parameters<typeof mapStoredMessagesToChatMessages>[0]
  );

  return {
    agentType: parseAgentType(record.agentType),
    messages: messages as BaseMessage[],
    context: deepClone(asCheckpointContext(record.context)),
    values: deepClone(asCheckpointValues(record.values)),
    ...(isPlainRecord(record.pendingPause)
      ? {pendingPause: deepClone(record.pendingPause) as unknown as PauseRequest}
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
    case 'fork':
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

function parseAgentType(value: unknown): AgentType {
  return value === 'subagent' ? 'subagent' : 'main';
}

function asCheckpointContext(value: unknown): AgentCheckpointContext {
  return isPlainRecord(value) ? (deepClone(value) as AgentCheckpointContext) : {};
}

function asCheckpointValues(value: unknown): AgentCheckpointValues {
  return isPlainRecord(value) ? (deepClone(value) as AgentCheckpointValues) : {};
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
