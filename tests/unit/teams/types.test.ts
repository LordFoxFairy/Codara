import {describe, test, expect} from 'bun:test';
import {
  TeamStatusSchema,
  MemberRoleSchema,
  MemberStatusSchema,
  JobStatusSchema,
  TeamMessageTypeSchema,
  TeamBudgetConfigSchema,
  ModelCascadeSchema,
  TeamConfigSchema,
  TeamSchema,
  TeamMemberSchema,
  TeamMemberTerminationSchema,
  JobArtifactSchema,
  JobResultSchema,
  JobSchema,
  TeamMessageSchema,
  SECURITY_DEFAULTS,
  MESSAGE_LIMITS,
  MODEL_PRICING,
  DEFAULT_RETENTION,
} from '@capability/team/coordination/types';

// ─── Enum Schemas ────────────────────────────────────────────────────

describe('TeamStatusSchema', () => {
  const validValues = ['created', 'spawning', 'running', 'paused', 'completing', 'completed', 'failed', 'archived'];

  test.each(validValues)('accepts "%s"', (v) => {
    expect(TeamStatusSchema.parse(v)).toBe(v);
  });

  test('rejects invalid value', () => {
    expect(() => TeamStatusSchema.parse('unknown')).toThrow();
  });
});

describe('MemberRoleSchema', () => {
  test.each(['leader', 'worker'])('accepts "%s"', (v) => {
    expect(MemberRoleSchema.parse(v)).toBe(v);
  });

  test('rejects invalid value', () => {
    expect(() => MemberRoleSchema.parse('admin')).toThrow();
  });

  test('rejects "reviewer"', () => {
    expect(() => MemberRoleSchema.parse('reviewer')).toThrow();
  });
});

describe('MemberStatusSchema', () => {
  const validValues = ['initializing', 'idle', 'working', 'paused', 'disconnected', 'leaving', 'terminated'];

  test.each(validValues)('accepts "%s"', (v) => {
    expect(MemberStatusSchema.parse(v)).toBe(v);
  });

  test('rejects invalid value', () => {
    expect(() => MemberStatusSchema.parse('active')).toThrow();
  });
});

describe('JobStatusSchema', () => {
  test.each(['planned', 'ready', 'in_progress', 'review', 'done', 'failed'])('accepts "%s"', (v) => {
    expect(JobStatusSchema.parse(v)).toBe(v);
  });

  test('rejects invalid value', () => {
    expect(() => JobStatusSchema.parse('cancelled')).toThrow();
  });
});

describe('TeamMessageTypeSchema', () => {
  const validValues = [
    'message', 'job_assigned', 'job_submitted', 'job_reviewed', 'job_completed',
    'question', 'answer', 'code_review', 'merge_request', 'merge_conflict',
    'status_update', 'shutdown_request', 'shutdown_response', 'heartbeat',
  ];

  test.each(validValues)('accepts "%s"', (v) => {
    expect(TeamMessageTypeSchema.parse(v)).toBe(v);
  });

  test('rejects invalid value', () => {
    expect(() => TeamMessageTypeSchema.parse('ping')).toThrow();
  });
});

// ─── Object Schemas ──────────────────────────────────────────────────

describe('TeamBudgetConfigSchema', () => {
  test('validates with all fields', () => {
    const result = TeamBudgetConfigSchema.parse({
      teamMaxTokens: 100_000,
      memberMaxTokens: 50_000,
      onBudgetExceeded: 'pause',
    });
    expect(result.teamMaxTokens).toBe(100_000);
    expect(result.memberMaxTokens).toBe(50_000);
    expect(result.onBudgetExceeded).toBe('pause');
  });

  test('optional fields can be omitted', () => {
    const result = TeamBudgetConfigSchema.parse({onBudgetExceeded: 'warn_leader'});
    expect(result.teamMaxTokens).toBeUndefined();
    expect(result.memberMaxTokens).toBeUndefined();
  });

  test('rejects missing onBudgetExceeded', () => {
    expect(() => TeamBudgetConfigSchema.parse({})).toThrow();
  });

  test('rejects invalid onBudgetExceeded', () => {
    expect(() => TeamBudgetConfigSchema.parse({onBudgetExceeded: 'ignore'})).toThrow();
  });
});

describe('ModelCascadeSchema', () => {
  test('accepts all optional fields', () => {
    const result = ModelCascadeSchema.parse({});
    expect(result).toEqual({});
  });

  test('accepts filled fields', () => {
    const result = ModelCascadeSchema.parse({
      leader: 'claude-opus-4-6',
      worker: 'claude-sonnet-4-6',
      reviewer: 'claude-opus-4-6',
      default: 'claude-haiku-4-5',
    });
    expect(result.leader).toBe('claude-opus-4-6');
  });
});

describe('TeamConfigSchema', () => {
  const minimal = {
    modelCascade: {},
  };

  test('applies defaults', () => {
    const result = TeamConfigSchema.parse(minimal);
    expect(result.maxDepth).toBe(2);
    expect(result.allowSubTeams).toBe(true);
    expect(result.maxMembers).toBe(10);
    expect(result.autoShutdown).toBe(true);
    expect(result.budget).toBeUndefined();
  });

  test('overrides defaults', () => {
    const result = TeamConfigSchema.parse({
      ...minimal,
      maxDepth: 3,
      allowSubTeams: false,
      maxMembers: 5,
      autoShutdown: false,
    });
    expect(result.maxDepth).toBe(3);
    expect(result.allowSubTeams).toBe(false);
    expect(result.maxMembers).toBe(5);
    expect(result.autoShutdown).toBe(false);
  });

  test('rejects missing modelCascade', () => {
    expect(() => TeamConfigSchema.parse({})).toThrow();
  });

  test('accepts optional budget', () => {
    const result = TeamConfigSchema.parse({
      ...minimal,
      budget: {onBudgetExceeded: 'shutdown', teamMaxTokens: 500_000},
    });
    expect(result.budget?.onBudgetExceeded).toBe('shutdown');
  });
});

describe('TeamSchema', () => {
  const validTeam = {
    teamId: 'team-1',
    name: 'Alpha Team',
    rootTeamId: 'team-1',
    status: 'running' as const,
    goal: 'Build feature X',
    createdBy: 'user-1',
    depth: 0,
    config: {
      modelCascade: {leader: 'claude-opus-4-6'},
    },
    createdAt: '2026-03-17T00:00:00Z',
  };

  test('validates a valid team', () => {
    const result = TeamSchema.parse(validTeam);
    expect(result.teamId).toBe('team-1');
    expect(result.parentTeamId).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });

  test('accepts optional fields', () => {
    const result = TeamSchema.parse({
      ...validTeam,
      parentTeamId: 'team-0',
      completedAt: '2026-03-18T00:00:00Z',
    });
    expect(result.parentTeamId).toBe('team-0');
    expect(result.completedAt).toBe('2026-03-18T00:00:00Z');
  });

  test('rejects missing required fields', () => {
    expect(() => TeamSchema.parse({teamId: 'team-1'})).toThrow();
  });

  test('rejects invalid status', () => {
    expect(() => TeamSchema.parse({...validTeam, status: 'deleted'})).toThrow();
  });
});

describe('TeamMemberSchema', () => {
  const validMember = {
    memberId: 'member-1',
    name: 'Worker A',
    teamId: 'team-1',
    role: 'worker' as const,
    status: 'idle' as const,
    sessionId: 'session-1',
    mode: 'local' as const,
    joinedAt: '2026-03-17T00:00:00Z',
  };

  test('validates a valid member', () => {
    const result = TeamMemberSchema.parse(validMember);
    expect(result.memberId).toBe('member-1');
    expect(result.model).toBeUndefined();
  });

  test('rejects invalid role', () => {
    expect(() => TeamMemberSchema.parse({...validMember, role: 'admin'})).toThrow();
  });

  test('rejects invalid status', () => {
    expect(() => TeamMemberSchema.parse({...validMember, status: 'active'})).toThrow();
  });

  test('rejects missing sessionId', () => {
    const {sessionId: _, ...noSession} = validMember;
    expect(() => TeamMemberSchema.parse(noSession)).toThrow();
  });
});

describe('TeamMemberTerminationSchema', () => {
  test.each(['normal', 'crashed', 'killed', 'disconnected', 'budget'])('accepts reason "%s"', (r) => {
    expect(TeamMemberTerminationSchema.parse({reason: r}).reason).toBe(r);
  });

  test('accepts optional error', () => {
    const result = TeamMemberTerminationSchema.parse({reason: 'crashed', error: 'OOM'});
    expect(result.error).toBe('OOM');
  });

  test('rejects invalid reason', () => {
    expect(() => TeamMemberTerminationSchema.parse({reason: 'timeout'})).toThrow();
  });
});

describe('JobArtifactSchema', () => {
  test('validates a valid artifact', () => {
    const result = JobArtifactSchema.parse({type: 'diff', content: '--- a\n+++ b'});
    expect(result.type).toBe('diff');
  });

  test('accepts optional path and mimeType', () => {
    const result = JobArtifactSchema.parse({
      type: 'file',
      content: 'hello',
      path: '/tmp/out.txt',
      mimeType: 'text/plain',
    });
    expect(result.path).toBe('/tmp/out.txt');
  });

  test('rejects invalid type', () => {
    expect(() => JobArtifactSchema.parse({type: 'image', content: 'x'})).toThrow();
  });
});

describe('JobResultSchema', () => {
  test('applies default empty artifacts', () => {
    const result = JobResultSchema.parse({summary: 'Done'});
    expect(result.artifacts).toEqual([]);
    expect(result.branch).toBeUndefined();
  });

  test('accepts artifacts', () => {
    const result = JobResultSchema.parse({
      summary: 'Done',
      artifacts: [{type: 'log', content: 'ok'}],
      branch: 'feature/x',
      commitSha: 'abc123',
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.branch).toBe('feature/x');
  });
});

describe('JobSchema', () => {
  const validJob = {
    id: 'job-1',
    teamId: 'team-1',
    title: 'Implement feature',
    description: 'Details here',
    status: 'ready' as const,
    createdAt: '2026-03-17T00:00:00Z',
  };

  test('validates with defaults', () => {
    const result = JobSchema.parse(validJob);
    expect(result.blockedBy).toEqual([]);
    expect(result.blocks).toEqual([]);
    expect(result.priority).toBe(0);
    expect(result.assignee).toBeUndefined();
    expect(result.result).toBeUndefined();
  });

  test('accepts full job', () => {
    const result = JobSchema.parse({
      ...validJob,
      status: 'done',
      assignee: 'member-1',
      blockedBy: ['job-0'],
      blocks: ['job-2'],
      priority: 5,
      result: {summary: 'Completed'},
      reviewedBy: 'member-2',
      startedAt: '2026-03-17T01:00:00Z',
      completedAt: '2026-03-17T02:00:00Z',
    });
    expect(result.assignee).toBe('member-1');
    expect(result.priority).toBe(5);
    expect(result.result?.summary).toBe('Completed');
  });

  test('rejects invalid status', () => {
    expect(() => JobSchema.parse({...validJob, status: 'cancelled'})).toThrow();
  });

  test('rejects missing title', () => {
    const {title: _, ...noTitle} = validJob;
    expect(() => JobSchema.parse(noTitle)).toThrow();
  });
});

describe('TeamMessageSchema', () => {
  const validMsg = {
    id: 'msg-1',
    from: 'member-1',
    to: 'member-2',
    teamId: 'team-1',
    type: 'message' as const,
    content: 'Hello',
    timestamp: '2026-03-17T00:00:00Z',
  };

  test('validates with default read=false', () => {
    const result = TeamMessageSchema.parse(validMsg);
    expect(result.read).toBe(false);
    expect(result.metadata).toBeUndefined();
  });

  test('accepts broadcast destination', () => {
    const result = TeamMessageSchema.parse({...validMsg, to: 'broadcast'});
    expect(result.to).toBe('broadcast');
  });

  test('accepts metadata', () => {
    const result = TeamMessageSchema.parse({
      ...validMsg,
      metadata: {jobId: 'job-1', priority: 3},
    });
    expect(result.metadata).toEqual({jobId: 'job-1', priority: 3});
  });

  test('rejects invalid type', () => {
    expect(() => TeamMessageSchema.parse({...validMsg, type: 'ping'})).toThrow();
  });

  test('rejects missing content', () => {
    const {content: _, ...noContent} = validMsg;
    expect(() => TeamMessageSchema.parse(noContent)).toThrow();
  });
});

// ─── Constants ───────────────────────────────────────────────────────

describe('Constants', () => {
  test('SECURITY_DEFAULTS', () => {
    expect(SECURITY_DEFAULTS.maxTeamDepth).toBe(2);
    expect(SECURITY_DEFAULTS.maxTotalAgents).toBe(20);
    expect(SECURITY_DEFAULTS.maxMembersPerTeam).toBe(10);
  });

  test('MESSAGE_LIMITS', () => {
    expect(MESSAGE_LIMITS.maxMessagesPerTurn).toBe(5);
    expect(MESSAGE_LIMITS.maxBroadcastsPerTurn).toBe(1);
    expect(MESSAGE_LIMITS.maxMessageLength).toBe(10_000);
  });

  test('MODEL_PRICING', () => {
    expect(MODEL_PRICING['claude-opus-4-6']).toEqual({inputPer1M: 15, outputPer1M: 75});
    expect(MODEL_PRICING['claude-sonnet-4-6']).toEqual({inputPer1M: 3, outputPer1M: 15});
    expect(MODEL_PRICING['claude-haiku-4-5']).toEqual({inputPer1M: 0.8, outputPer1M: 4});
  });

  test('DEFAULT_RETENTION', () => {
    expect(DEFAULT_RETENTION.archiveAfterDays).toBe(30);
    expect(DEFAULT_RETENTION.deleteAfterDays).toBe(90);
    expect(DEFAULT_RETENTION.maxMessagesPerTeam).toBe(10_000);
    expect(DEFAULT_RETENTION.maxCheckpointsPerMember).toBe(5);
  });
});
