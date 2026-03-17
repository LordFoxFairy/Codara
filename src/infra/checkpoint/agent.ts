import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import {z} from 'zod';
import {FileCheckpointer} from '@infra/checkpoint/file';
import {InMemoryCheckpointer} from '@infra/checkpoint/in-memory';
import type {CheckpointRecord, Checkpointer} from '@infra/checkpoint/types';
import type {AgentType, PauseRequest} from '@shared/contracts/agent-types';
import {deepClone} from '@shared/clone';

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

const checkpointStateSchema = z.object({
  agentType: z.enum(['main', 'subagent']).catch('main'),
  messages: z.array(z.unknown()).catch([]),
  context: z.record(z.string(), z.unknown()).catch({}),
  values: z.record(z.string(), z.unknown()).catch({}),
  pendingPause: z.record(z.string(), z.unknown()).optional(),
}).loose();

const checkpointInfoSchema = z.object({
  source: z.enum(['invoke', 'resume', 'reset', 'dispose', 'manual', 'fork']).catch('manual'),
  status: z.enum(['idle', 'paused', 'closed', 'error']).catch('idle'),
  reason: z.enum(['complete', 'error', 'max_turns']).optional(),
  turns: z.number().optional(),
  errorMessage: z.string().optional(),
  step: z.number().catch(0),
  createdAt: z.string().catch(new Date(0).toISOString()),
}).loose();

export function createAgentMemoryCheckpointer(): AgentCheckpointer {
  return new InMemoryCheckpointer<AgentCheckpointState, AgentCheckpointInfo>({
    state: {
      serialize: serializeAgentCheckpointState,
      deserialize: deserializeAgentCheckpointState,
    },
    info: {
      serialize: (info) => ({...info}),
      deserialize: parseAgentCheckpointInfo,
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
      serialize: (info) => ({...info}),
      deserialize: parseAgentCheckpointInfo,
    },
  });
}

export async function putForkCheckpoint(
  checkpointer: AgentCheckpointer,
  sessionId: string,
  state: AgentCheckpointState,
): Promise<AgentCheckpoint> {
  return checkpointer.put({
    sessionId,
    state: cloneCheckpointState(state),
    info: {
      source: 'fork',
      status: state.pendingPause ? 'paused' : 'idle',
      step: 0,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function putManualCheckpoint(
  checkpointer: AgentCheckpointer,
  sessionId: string,
  state: AgentCheckpointState,
  latest?: AgentCheckpoint,
): Promise<AgentCheckpoint> {
  return checkpointer.put({
    sessionId,
    ...(latest?.ref.checkpointId ? {parentCheckpointId: latest.ref.checkpointId} : {}),
    state: cloneCheckpointState(state),
    info: {
      source: 'manual',
      status: 'idle',
      reason: 'complete',
      turns: 0,
      step: (latest?.info.step ?? 0) + 1,
      createdAt: new Date().toISOString(),
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

function cloneCheckpointState(state: AgentCheckpointState): AgentCheckpointState {
  return {
    agentType: state.agentType,
    messages: mapStoredMessagesToChatMessages(mapChatMessagesToStoredMessages(state.messages)) as BaseMessage[],
    context: deepClone(state.context),
    values: deepClone(state.values),
    ...(state.pendingPause ? {pendingPause: deepClone(state.pendingPause)} : {}),
  };
}

function deserializeAgentCheckpointState(raw: unknown): AgentCheckpointState {
  const record = checkpointStateSchema.parse(raw);
  const messages = mapStoredMessagesToChatMessages(
    record.messages as Parameters<typeof mapStoredMessagesToChatMessages>[0]
  );

  return {
    agentType: record.agentType,
    messages: messages as BaseMessage[],
    context: deepClone(record.context) as AgentCheckpointContext,
    values: deepClone(record.values) as AgentCheckpointValues,
    ...(record.pendingPause
      ? {pendingPause: deepClone(record.pendingPause) as unknown as PauseRequest}
      : {}),
  };
}

function parseAgentCheckpointInfo(raw: unknown): AgentCheckpointInfo {
  const record = checkpointInfoSchema.parse(raw);
  return {
    source: record.source,
    status: record.status,
    ...(record.reason ? {reason: record.reason} : {}),
    ...(record.turns !== undefined ? {turns: record.turns} : {}),
    ...(record.errorMessage ? {errorMessage: record.errorMessage} : {}),
    step: record.step,
    createdAt: record.createdAt,
  };
}
