export interface CheckpointRef {
  sessionId: string;
  checkpointId: string;
  parentCheckpointId?: string;
}

export interface CheckpointRecord<TState = unknown, TInfo = unknown> {
  ref: CheckpointRef;
  state: TState;
  info: TInfo;
}

export interface PutCheckpointInput<TState = unknown, TInfo = unknown> {
  sessionId: string;
  parentCheckpointId?: string;
  state: TState;
  info: TInfo;
}

export interface CompactOptions {
  keepLast?: number;
}

export interface Checkpointer<TState = unknown, TInfo = unknown> {
  getLatest(sessionId: string): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  get(ref: {sessionId: string; checkpointId: string}): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>>;
  list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>>;
  deleteSession(sessionId: string): Promise<void>;
  compact?(sessionId: string, options?: CompactOptions): Promise<void>;
}
