export interface CheckpointRef {
  threadId: string;
  checkpointId: string;
  parentCheckpointId?: string;
}

export interface CheckpointRecord<TState = unknown, TInfo = unknown> {
  ref: CheckpointRef;
  state: TState;
  info: TInfo;
}

export interface PutCheckpointInput<TState = unknown, TInfo = unknown> {
  threadId: string;
  parentCheckpointId?: string;
  state: TState;
  info: TInfo;
}

export interface CompactOptions {
  keepLast?: number;
}

export interface Checkpointer<TState = unknown, TInfo = unknown> {
  getLatest(threadId: string): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  get(ref: {threadId: string; checkpointId: string}): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>>;
  list(threadId: string): Promise<Array<CheckpointRecord<TState, TInfo>>>;
  deleteThread(threadId: string): Promise<void>;
  compact?(threadId: string, options?: CompactOptions): Promise<void>;
}
export {InMemoryCheckpointer} from '@core/checkpoint/in-memory';
export {
  FileCheckpointer,
  type FileCheckpointerOptions,
} from '@core/checkpoint/file';
export {
  createAgentFileCheckpointer,
  createAgentMemoryCheckpointer,
  type AgentCheckpoint,
  type AgentCheckpointContext,
  type AgentCheckpointInfo,
  type AgentCheckpointReason,
  type AgentCheckpointer,
  type AgentCheckpointState,
  type AgentCheckpointStatus,
  type AgentCheckpointSummary,
  type AgentFileCheckpointerOptions,
} from '@core/checkpoint/agent';
