import {JobBoard} from '@capability/team/coordination/job-board';
import {TeamConfigSchema, SECURITY_DEFAULTS} from '@capability/team/coordination/types';
import type {Team, TeamConfig, TeamMember, TeamStatus, MemberRole} from '@capability/team/coordination/types';

// ─── Errors ──────────────────────────────────────────────────────────

export class TeamRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamRegistryError';
  }
}

// ─── Inputs ──────────────────────────────────────────────────────────

export interface CreateTeamInput {
  name: string;
  goal: string;
  config?: Partial<TeamConfig>;
  createdBy?: string;
}

export interface CreateSubTeamInput {
  name: string;
  goal: string;
  config?: Partial<TeamConfig>;
  createdBy: string;
}

// ─── Valid State Transitions ─────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, TeamStatus[]> = {
  created: ['spawning', 'running'],
  spawning: ['running', 'failed'],
  running: ['paused', 'completing', 'failed'],
  paused: ['running', 'failed'],
  completing: ['completed', 'failed'],
  completed: ['archived'],
};

// ─── TeamRegistry ────────────────────────────────────────────────────

export class TeamRegistry {
  private teams = new Map<string, Team>();
  private members = new Map<string, TeamMember[]>();
  private jobBoards = new Map<string, JobBoard>();

  // ── Team CRUD ────────────────────────────────────────────────────

  createTeam(input: CreateTeamInput): Team {
    this.validateNameUniqueness(input.name);

    const teamId = `team_${crypto.randomUUID().slice(0, 8)}`;
    const config = this.resolveConfig(input.config);

    const team: Team = {
      teamId,
      name: input.name,
      goal: input.goal,
      status: 'created',
      depth: 0,
      rootTeamId: teamId,
      createdBy: input.createdBy ?? 'user',
      config,
      createdAt: new Date().toISOString(),
    };

    this.teams.set(teamId, team);
    this.members.set(teamId, []);
    this.jobBoards.set(teamId, new JobBoard(teamId));

    return team;
  }

  getTeam(teamId: string): Team | undefined {
    return this.teams.get(teamId);
  }

  getTeamByName(name: string): Team | undefined {
    for (const team of this.teams.values()) {
      if (team.name === name) return team;
    }
    return undefined;
  }

  listTeams(filter?: {status?: TeamStatus}): Team[] {
    const all = [...this.teams.values()];
    if (!filter?.status) return all;
    return all.filter((t) => t.status === filter.status);
  }

  updateTeamStatus(teamId: string, status: TeamStatus): void {
    const team = this.mustGetTeam(teamId);
    const allowed = VALID_TRANSITIONS[team.status];

    if (!allowed || !allowed.includes(status)) {
      throw new TeamRegistryError(
        `Invalid status transition: '${team.status}' → '${status}'`,
      );
    }

    team.status = status;

    if (status === 'completed' || status === 'failed') {
      team.completedAt = new Date().toISOString();
    }
  }

  deleteTeam(teamId: string): void {
    this.teams.delete(teamId);
    this.members.delete(teamId);
    this.jobBoards.delete(teamId);
  }

  // ── Member Management ────────────────────────────────────────────

  registerMember(teamId: string, member: TeamMember): void {
    const team = this.mustGetTeam(teamId);
    const teamMembers = this.members.get(teamId) ?? [];

    if (teamMembers.length >= team.config.maxMembers) {
      throw new TeamRegistryError(
        `Team '${teamId}' has reached maxMembers limit (${team.config.maxMembers})`,
      );
    }

    if (this.getTotalAgentCount() >= SECURITY_DEFAULTS.maxTotalAgents) {
      throw new TeamRegistryError(
        `Global maxTotalAgents limit reached (${SECURITY_DEFAULTS.maxTotalAgents})`,
      );
    }

    teamMembers.push(member);
    this.members.set(teamId, teamMembers);
  }

  removeMember(teamId: string, memberId: string): void {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) return;

    this.members.set(
      teamId,
      teamMembers.filter((m) => m.memberId !== memberId),
    );
  }

  updateMember(teamId: string, memberId: string, updates: Partial<TeamMember>): void {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) return;

    const member = teamMembers.find((m) => m.memberId === memberId);
    if (!member) return;

    Object.assign(member, updates);
  }

  getMember(memberId: string): TeamMember | undefined {
    for (const teamMembers of this.members.values()) {
      const found = teamMembers.find((m) => m.memberId === memberId);
      if (found) return found;
    }
    return undefined;
  }

  getMembersByTeam(teamId: string): TeamMember[] {
    return this.members.get(teamId) ?? [];
  }

  getMembersByRole(teamId: string, role: MemberRole): TeamMember[] {
    return this.getMembersByTeam(teamId).filter((m) => m.role === role);
  }

  getLeader(teamId: string): TeamMember | undefined {
    return this.getMembersByTeam(teamId).find((m) => m.role === 'leader');
  }

  getTotalAgentCount(): number {
    let count = 0;
    for (const [teamId] of this.members) {
      const team = this.teams.get(teamId);
      // Only count members of active (non-archived, non-failed) teams
      if (team && team.status !== 'archived' && team.status !== 'failed') {
        count += (this.members.get(teamId) ?? []).length;
      }
    }
    return count;
  }

  // ── JobBoard Access ──────────────────────────────────────────────

  getJobBoard(teamId: string): JobBoard {
    let board = this.jobBoards.get(teamId);
    if (!board) {
      board = new JobBoard(teamId);
      this.jobBoards.set(teamId, board);
    }
    return board;
  }

  // ── Sub-Team Creation ────────────────────────────────────────────

  createSubTeam(parentTeamId: string, input: CreateSubTeamInput): Team {
    const parent = this.mustGetTeam(parentTeamId);

    if (!parent.config.allowSubTeams) {
      throw new TeamRegistryError(
        `Team '${parentTeamId}' does not allow sub-teams`,
      );
    }

    if (parent.depth >= parent.config.maxDepth) {
      throw new TeamRegistryError(
        `Cannot create sub-team: parent depth (${parent.depth}) >= maxDepth (${parent.config.maxDepth})`,
      );
    }

    this.validateNameUniqueness(input.name);

    const teamId = `team_${crypto.randomUUID().slice(0, 8)}`;

    // Inherit config from parent, overridden by input
    const config = this.resolveConfig({
      ...parent.config,
      ...input.config,
    });

    const team: Team = {
      teamId,
      name: input.name,
      goal: input.goal,
      status: 'created',
      depth: parent.depth + 1,
      parentTeamId,
      rootTeamId: parent.rootTeamId,
      createdBy: input.createdBy,
      config,
      createdAt: new Date().toISOString(),
    };

    this.teams.set(teamId, team);
    this.members.set(teamId, []);
    this.jobBoards.set(teamId, new JobBoard(teamId));

    return team;
  }

  // ── Restore (persistence recovery) ─────────────────────────────

  /** Restore a previously persisted team without validation (for startup recovery). */
  restoreTeam(team: Team): void {
    this.teams.set(team.teamId, team);
    if (!this.members.has(team.teamId)) {
      this.members.set(team.teamId, []);
    }
    if (!this.jobBoards.has(team.teamId)) {
      this.jobBoards.set(team.teamId, new JobBoard(team.teamId));
    }
  }

  /** Restore a previously persisted job board without validation. */
  restoreJobBoard(teamId: string, board: JobBoard): void {
    this.jobBoards.set(teamId, board);
  }

  /** Restore a previously persisted member without validation. */
  restoreMember(member: TeamMember): void {
    const teamMembers = this.members.get(member.teamId) ?? [];
    // Avoid duplicates
    if (!teamMembers.some(m => m.memberId === member.memberId)) {
      teamMembers.push(member);
      this.members.set(member.teamId, teamMembers);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private mustGetTeam(teamId: string): Team {
    const team = this.teams.get(teamId);
    if (!team) throw new TeamRegistryError(`Team not found: ${teamId}`);
    return team;
  }

  private validateNameUniqueness(name: string): void {
    for (const team of this.teams.values()) {
      if (
        team.name === name &&
        team.status !== 'archived' &&
        team.status !== 'failed'
      ) {
        throw new TeamRegistryError(`Team name '${name}' already exists`);
      }
    }
  }

  private resolveConfig(partial?: Partial<TeamConfig>): TeamConfig {
    return TeamConfigSchema.parse({
      modelCascade: {},
      ...partial,
    });
  }
}
