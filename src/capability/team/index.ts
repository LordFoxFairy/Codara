// src/capability/team/index.ts — barrel export

// Types
export * from './types.js';

// Core
export { JobBoard, JobBoardError } from './job-board.js';
export { TeamRegistry, TeamRegistryError } from './team-registry.js';
export type { CreateTeamInput, CreateSubTeamInput } from './team-registry.js';

// Transport
export type { TeamTransport, Unsubscribe } from './transport/types.js';
export { LocalTransport } from './transport/local-transport.js';
export { A2ATransport } from './transport/a2a-transport.js';
export type { A2AConnectionConfig } from './transport/a2a-transport.js';

// Runtime
export { MemberRunner } from './runtime/member-runner.js';
export type {
  MemberRunnerOptions,
  MemberSession,
  MemberSessionOptions,
  MemberInvokeResult,
  MemberRunnerStatus,
} from './runtime/member-runner.js';
export { TeamRuntime } from './runtime/team-runtime.js';
export type { TeamRuntimeOptions } from './runtime/team-runtime.js';
export { resolveModel } from './runtime/model-resolver.js';
export { sortInbox, formatTeamMessage, prepareInboxInjection } from './runtime/message-injector.js';

// Events
export { TeamEventEmitter, isTeamEvent } from './events.js';
export type {
  TeamBusEvent,
  TeamLifecycleEvent,
  MemberLifecycleEvent,
  JobLifecycleEvent,
  TeamMessageEvent,
  TeamBudgetEvent,
  TeamHealthEvent,
} from './events.js';

// Tools
export { createLeaderTools } from './tools/leader-tools.js';
export { createWorkerTools } from './tools/worker-tools.js';
export { createConversationTeamTools } from './tools/conversation-tools.js';
export { getToolsForRole, isTeamTool } from './tools/tool-filter.js';
export type { TeamToolContext } from './tools/types.js';

// Protocol
export { buildLeaderProtocol } from './protocol/leader-protocol.js';
export type { LeaderPromptContext } from './protocol/leader-protocol.js';
export { buildWorkerProtocol } from './protocol/worker-protocol.js';
export type { WorkerPromptContext } from './protocol/worker-protocol.js';

// Persistence
export { TeamPersistence } from './persistence/team-persistence.js';
export type { TeamSnapshot, TeamSummary } from './persistence/team-persistence.js';
/** @deprecated Use TeamPersistence instead. */
export { MessageLog } from './persistence/message-log.js';
/** @deprecated Use TeamPersistence instead. */
export { TeamStore } from './persistence/team-store.js';
/** @deprecated Use TeamPersistence instead. */
export { JobBoardStore } from './persistence/job-board-store.js';
/** @deprecated Use TeamPersistence instead. */
export { MemberStore } from './persistence/member-store.js';

// Security
export { canCreateSubTeam, canSpawnMember } from './security/depth-control.js';

// Worktree
export { createMemberWorktree, removeMemberWorktree, listTeamWorktrees, cleanupTeamWorktrees } from './worktree/team-worktree.js';
export type { WorktreeInfo } from './worktree/team-worktree.js';
export { getMergeOrder, mergeBranch } from './worktree/merge-coordinator.js';
export type { MergeResult } from './worktree/merge-coordinator.js';

// Remote
export { RemotePool } from './remote-pool.js';
export type { RemoteAgentConfig } from './remote-pool.js';

// A2A
export { CodaraA2AServer, buildCodaraAgentCard } from './a2a-server.js';
export type { AgentCard, A2AServerConfig } from './a2a-server.js';

// SharedState
export type { SharedState, SharedStateEntry } from './state/shared-state.js';
export { MemorySharedState } from './state/memory-shared-state.js';
export { createSharedState, DEFAULT_SHARED_STATE_CONFIG } from './state/index.js';
export type { SharedStateConfig } from './state/index.js';

// Bridge
export { TeamEventBridge } from './bridge/team-event-bridge.js';
export type { TeamEventBridgeOptions } from './bridge/team-event-bridge.js';

// Middleware (moved from engine/pipeline — this is the canonical location)
export {
  createTeamContextMiddleware,
  readTeamContext,
  TEAM_CONTEXT_MIDDLEWARE_NAME,
  type TeamRuntimeContext,
} from './middleware/team-context.js';
