/**
 * Core checkpoint abstractions.
 *
 * Checkpoints capture a point-in-time snapshot of agent state (messages,
 * context, values, pending review) and associated metadata (source, status,
 * step counter). The {@link Checkpointer} interface is storage-agnostic;
 * concrete implementations live in `in-memory.ts` (tests) and `file.ts`
 * (CLI persistence).
 *
 * @module
 */

/** Immutable reference to a single checkpoint within a session. */
export interface CheckpointRef {
  sessionId: string;
  checkpointId: string;
  /** Links to the previous checkpoint for ancestry traversal. */
  parentCheckpointId?: string;
}

/** A checkpoint snapshot: reference + state + metadata. */
export interface CheckpointRecord<TState = unknown, TInfo = unknown> {
  ref: CheckpointRef;
  state: TState;
  info: TInfo;
}

/** Input for creating a new checkpoint via {@link Checkpointer.put}. */
export interface PutCheckpointInput<TState = unknown, TInfo = unknown> {
  sessionId: string;
  parentCheckpointId?: string;
  state: TState;
  info: TInfo;
}

/** Options for pruning old checkpoints. */
export interface CompactOptions {
  /** Number of recent checkpoints to retain (default varies by implementation). */
  keepLast?: number;
}

/**
 * Storage-agnostic checkpoint persistence.
 *
 * Implementations must guarantee:
 * - `put` is atomic (readers never see a half-written record).
 * - `getLatest` returns the most recently `put` record for a session.
 * - `compact` is optional; when present it prunes old history.
 */
export interface Checkpointer<TState = unknown, TInfo = unknown> {
  getLatest(sessionId: string): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  get(ref: {sessionId: string; checkpointId: string}): Promise<CheckpointRecord<TState, TInfo> | undefined>;
  put(input: PutCheckpointInput<TState, TInfo>): Promise<CheckpointRecord<TState, TInfo>>;
  list(sessionId: string): Promise<Array<CheckpointRecord<TState, TInfo>>>;
  deleteSession(sessionId: string): Promise<void>;
  compact?(sessionId: string, options?: CompactOptions): Promise<void>;
}
