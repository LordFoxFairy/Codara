/**
 * Checkpoint persistence barrel.
 *
 * Re-exports the generic checkpoint abstractions (types, in-memory, file) and
 * the agent-specific adapter that handles LangChain message serialization.
 *
 * @module
 */

export type {
  CheckpointRef,
  CheckpointRecord,
  PutCheckpointInput,
  CompactOptions,
  Checkpointer,
} from '@durability/checkpoint/types';
export {InMemoryCheckpointer} from '@durability/checkpoint/in-memory';
export {
  FileCheckpointer,
  type FileCheckpointerOptions,
} from '@durability/checkpoint/file';
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
  putForkCheckpoint,
  putManualCheckpoint,
} from '@durability/checkpoint/agent';
