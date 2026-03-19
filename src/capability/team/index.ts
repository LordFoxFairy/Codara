// Coordination
export {TeamRegistry, TeamRegistryError} from './coordination/team-registry';
export type {CreateTeamInput, CreateSubTeamInput} from './coordination/team-registry';
export type {
  Team,
  TeamConfig,
  TeamMember,
  TeamStatus,
  MemberRole,
  MemberStatus,
  Job,
  JobStatus,
  JobResult,
  JobArtifact,
  TeamMessage,
  TeamMessageType,
  TeamBudgetConfig,
  ModelCascade,
  MemberTokenUsage,
  TeamBudgetUsage,
  JobSpec,
  RetentionPolicy,
  TeamMemberTermination,
} from './coordination/types';
export {
  TeamConfigSchema,
  TeamSchema,
  TeamMemberSchema,
  JobSchema,
  JobStatusSchema,
  TeamStatusSchema,
  MemberRoleSchema,
  MemberStatusSchema,
  TeamMessageSchema,
  TeamMessageTypeSchema,
  TeamBudgetConfigSchema,
  ModelCascadeSchema,
  JobResultSchema,
  JobArtifactSchema,
  TeamMemberTerminationSchema,
  SECURITY_DEFAULTS,
  MESSAGE_LIMITS,
  MODEL_PRICING,
  DEFAULT_RETENTION,
} from './coordination/types';
export {JobBoard, JobBoardError} from './coordination/job-board';
export {getMergeOrder} from './coordination/merge-order';
export {
  TeamEventEmitter,
  isTeamEvent,
} from './coordination/events';
export type {
  TeamLifecycleEvent,
  MemberLifecycleEvent,
  JobLifecycleEvent,
  TeamMessageEvent,
  TeamBudgetEvent,
  TeamHealthEvent,
  TeamBusEvent,
} from './coordination/events';

// Runtime
export {TeamRuntime} from './runtime/team-runtime';
export type {TeamRuntimeOptions} from './runtime/team-runtime';
export {MemberRunner} from './runtime/member-runner';
export type {
  MemberRunnerStatus,
  MemberRunnerOptions,
  MemberSession,
  MemberSessionOptions,
  MemberInvokeResult,
} from './runtime/member-runner';

// Middleware
export {
  createTeamMiddleware,
  readTeamContext,
  readTeamSurfaceState,
  TEAM_MIDDLEWARE_NAME,
} from './middleware';
export type {
  TeamType,
  TeamSurfaceState,
  TeamRuntimeContext,
} from './middleware';

// Surface
export {createLeaderTools} from './surface/leader-tools';
export {createWorkerTools} from './surface/worker-tools';
export {createConversationTeamTools} from './surface/conversation-tools';
export {getToolsForRole, isTeamTool} from './surface/tool-filter';
export type {TeamToolContext} from './surface/types';

// Infrastructure
export {LocalTransport} from './local-transport';
export type {TeamTransport, Unsubscribe} from './local-transport';

// Persistence
export {TeamPersistence} from './persistence';
export type {TeamSnapshot, TeamSummary} from './persistence';

// Shared State
export {MemorySharedState, createSharedState, DEFAULT_SHARED_STATE_CONFIG} from './shared-state';
export type {SharedStateEntry, SharedState, SharedStateConfig} from './shared-state';

// Prompts
export {buildLeaderProtocol, buildWorkerProtocol} from './prompts';
export type {LeaderPromptContext, WorkerPromptContext} from './prompts';
