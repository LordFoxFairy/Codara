import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';
import {z} from 'zod';
import {FileCheckpointer} from '@durability/checkpoint/file';
import {InMemoryCheckpointer} from '@durability/checkpoint/in-memory';
import type {CheckpointRecord, Checkpointer} from '@durability/checkpoint/types';
import type {AgentType, ReviewRequest} from '@shared/contracts/agent-types';
import {deepClone} from '@shared/clone';

export type AgentCheckpointStatus = 'idle' | 'paused' | 'closed' | 'error';
export type AgentCheckpointReason = 'complete' | 'error' | 'max_turns' | 'budget_exhausted' | 'aborted';
export type AgentCheckpointContext = Record<string, unknown>;
export type AgentCheckpointValues = Record<string, unknown>;

export interface AgentCheckpointState {
  agentType: AgentType;
  messages: BaseMessage[];
  context: AgentCheckpointContext;
  values: AgentCheckpointValues;
  pendingReview?: ReviewRequest;
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
  pendingReview?: ReviewRequest;
}

export interface AgentFileCheckpointerOptions {
  rootDir: string;
}

const checkpointStateSchema = z.object({
  agentType: z.enum(['main', 'subagent']).catch('main'),
  messages: z.array(z.unknown()).catch([]),
  context: z.record(z.string(), z.unknown()).catch({}),
  values: z.record(z.string(), z.unknown()).catch({}),
  pendingReview: z.record(z.string(), z.unknown()).optional(),
}).loose();

const checkpointInfoSchema = z.object({
  source: z.enum(['invoke', 'resume', 'reset', 'dispose', 'manual', 'fork']).catch('manual'),
  status: z.enum(['idle', 'paused', 'closed', 'error']).catch('idle'),
  reason: z.enum(['complete', 'error', 'max_turns', 'budget_exhausted']).optional(),
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
      status: state.pendingReview ? 'paused' : 'idle',
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
    ...(state.pendingReview ? {pendingReview: deepClone(state.pendingReview)} : {}),
  };
}

function cloneCheckpointState(state: AgentCheckpointState): AgentCheckpointState {
  return {
    agentType: state.agentType,
    messages: mapStoredMessagesToChatMessages(mapChatMessagesToStoredMessages(state.messages)) as BaseMessage[],
    context: deepClone(state.context),
    values: deepClone(state.values),
    ...(state.pendingReview ? {pendingReview: deepClone(state.pendingReview)} : {}),
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
    // pendingReview is deserialized from checkpoint storage via loose Zod schema (Record<string, unknown>).
    // A full ReviewRequest Zod schema would eliminate this cast but is out of scope for checkpoint layer.
    ...(record.pendingReview
      ? {pendingReview: deepClone(record.pendingReview) as unknown as ReviewRequest}
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
