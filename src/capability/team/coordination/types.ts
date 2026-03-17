import {z} from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────

export const TeamStatusSchema = z.enum([
  'created',
  'spawning',
  'running',
  'paused',
  'completing',
  'completed',
  'failed',
  'archived',
]);
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

export const MemberRoleSchema = z.enum(['leader', 'worker']);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const MemberStatusSchema = z.enum([
  'initializing',
  'idle',
  'working',
  'paused',
  'disconnected',
  'leaving',
  'terminated',
]);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

export const JobStatusSchema = z.enum([
  'planned',
  'ready',
  'in_progress',
  'review',
  'done',
  'failed',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TeamMessageTypeSchema = z.enum([
  'message',
  'job_assigned',
  'job_submitted',
  'job_reviewed',
  'job_completed',
  'question',
  'answer',
  'code_review',
  'merge_request',
  'merge_conflict',
  'status_update',
  'shutdown_request',
  'shutdown_response',
  'heartbeat',
]);
export type TeamMessageType = z.infer<typeof TeamMessageTypeSchema>;

// ─── Object Schemas ──────────────────────────────────────────────────

export const TeamBudgetConfigSchema = z.object({
  teamMaxTokens: z.number().optional(),
  memberMaxTokens: z.number().optional(),
  onBudgetExceeded: z.enum(['pause', 'warn_leader', 'shutdown']),
});
export type TeamBudgetConfig = z.infer<typeof TeamBudgetConfigSchema>;

export const ModelCascadeSchema = z.object({
  leader: z.string().optional(),
  worker: z.string().optional(),
  default: z.string().optional(),
});
export type ModelCascade = z.infer<typeof ModelCascadeSchema>;

export const TeamConfigSchema = z.object({
  maxDepth: z.number().default(2),
  allowSubTeams: z.boolean().default(true),
  maxMembers: z.number().default(10),
  modelCascade: ModelCascadeSchema,
  autoShutdown: z.boolean().default(true),
  budget: TeamBudgetConfigSchema.optional(),
});
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const TeamSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  parentTeamId: z.string().optional(),
  rootTeamId: z.string(),
  status: TeamStatusSchema,
  goal: z.string(),
  createdBy: z.string(),
  depth: z.number(),
  config: TeamConfigSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

// NOTE: RemoteConnectionInfoSchema is used at the instance level (for connecting
// to remote Codara instances), NOT for individual team members. All team members
// are local agents.
export const RemoteConnectionInfoSchema = z.object({
  agentCardUrl: z.string(),
  contextId: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  authMethod: z.enum(['bearer', 'oauth2', 'apiKey']).optional(),
});
export type RemoteConnectionInfo = z.infer<typeof RemoteConnectionInfoSchema>;

export const TeamMemberSchema = z.object({
  memberId: z.string(),
  name: z.string(),
  teamId: z.string(),
  role: MemberRoleSchema,
  status: MemberStatusSchema,
  model: z.string().optional(),
  sessionId: z.string(),
  currentJobId: z.string().optional(),
  joinedAt: z.string(),
  lastHeartbeat: z.string().optional(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamMemberTerminationSchema = z.object({
  reason: z.enum(['normal', 'crashed', 'killed', 'disconnected', 'budget']),
  error: z.string().optional(),
});
export type TeamMemberTermination = z.infer<typeof TeamMemberTerminationSchema>;

export const JobArtifactSchema = z.object({
  type: z.enum(['diff', 'file', 'test_report', 'log']),
  content: z.string(),
  path: z.string().optional(),
  mimeType: z.string().optional(),
});
export type JobArtifact = z.infer<typeof JobArtifactSchema>;

export const JobResultSchema = z.object({
  summary: z.string(),
  artifacts: z.array(JobArtifactSchema).default([]),
  branch: z.string().optional(),
  commitSha: z.string().optional(),
});
export type JobResult = z.infer<typeof JobResultSchema>;

export const JobSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  title: z.string(),
  description: z.string(),
  status: JobStatusSchema,
  assignee: z.string().optional(),
  blockedBy: z.array(z.string()).default([]),
  blocks: z.array(z.string()).default([]),
  priority: z.number().default(0),
  result: JobResultSchema.optional(),
  reviewedBy: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const TeamMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.union([z.string(), z.literal('broadcast')]),
  teamId: z.string(),
  type: TeamMessageTypeSchema,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
  read: z.boolean().default(false),
});
export type TeamMessage = z.infer<typeof TeamMessageSchema>;

// ─── Plain Interfaces (no Zod) ──────────────────────────────────────

export interface MemberTokenUsage {
  memberId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

export interface TeamBudgetUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  byMember: Map<string, MemberTokenUsage>;
  estimatedCost: number;
}

export interface JobSpec {
  title: string;
  description: string;
  priority?: number;
  blockedBy?: string[];
}

export interface RetentionPolicy {
  archiveAfterDays: number;
  deleteAfterDays: number;
  maxMessagesPerTeam: number;
  maxCheckpointsPerMember: number;
}

// ─── Constants ───────────────────────────────────────────────────────

export const SECURITY_DEFAULTS = {
  maxTeamDepth: 2,
  maxTotalAgents: 20,
  maxMembersPerTeam: 10,
} as const;

export const MESSAGE_LIMITS = {
  maxMessagesPerTurn: 5,
  maxBroadcastsPerTurn: 1,
  maxMessageLength: 10_000,
} as const;

export const MODEL_PRICING: Record<string, {inputPer1M: number; outputPer1M: number}> = {
  'claude-opus-4-6': {inputPer1M: 15, outputPer1M: 75},
  'claude-sonnet-4-6': {inputPer1M: 3, outputPer1M: 15},
  'claude-haiku-4-5': {inputPer1M: 0.8, outputPer1M: 4},
};

export const DEFAULT_RETENTION: RetentionPolicy = {
  archiveAfterDays: 30,
  deleteAfterDays: 90,
  maxMessagesPerTeam: 10_000,
  maxCheckpointsPerMember: 5,
};
