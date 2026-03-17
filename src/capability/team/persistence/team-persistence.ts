import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {TeamSchema, TeamMemberSchema} from '@capability/team/types';
import type {Team, TeamMember, TeamStatus, Job, TeamMessage} from '@capability/team/types';
import {JobBoard} from '@capability/team/job-board';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamSnapshot {
  team: Team;
  members: TeamMember[];
  jobs: Job[];
  recentMessages: TeamMessage[];
  metadata: {
    createdAt: string;
    lastActiveAt: string;
    totalTokens: number;
  };
}

export interface TeamSummary {
  teamId: string;
  name: string;
  status: TeamStatus;
  goal: string;
  depth: number;
  createdAt: string;
  memberCount: number;
  jobCount: number;
}

/** Maximum number of recent messages to persist per team. */
const MAX_RECENT_MESSAGES = 200;

// ─── TeamPersistence ────────────────────────────────────────────────

/**
 * Unified persistence for team state.
 * Each team is stored as a single JSON file at `{dataDir}/teams/{teamId}.json`.
 * A lightweight registry index is maintained at `{dataDir}/teams/registry.json`.
 */
export class TeamPersistence {
  constructor(private readonly dataDir: string) {}

  // ── Core CRUD ──────────────────────────────────────────────────────

  /** Save a complete team snapshot (atomic: write tmp -> rename). */
  save(teamId: string, snapshot: TeamSnapshot): void {
    const dir = this.teamsDir();
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    const filePath = this.teamPath(teamId);
    const tmp = filePath + '.tmp';
    // Trim messages to last N before persisting
    const trimmed: TeamSnapshot = {
      ...snapshot,
      recentMessages: snapshot.recentMessages.slice(-MAX_RECENT_MESSAGES),
    };
    writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
    renameSync(tmp, filePath);
  }

  /** Load a team snapshot by ID. */
  load(teamId: string): TeamSnapshot | null {
    const filePath = this.teamPath(teamId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      return this.parseSnapshot(raw);
    } catch {
      return null;
    }
  }

  /** List summaries of all persisted teams. */
  list(): TeamSummary[] {
    const dir = this.teamsDir();
    if (!existsSync(dir)) return [];
    const results: TeamSummary[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f === 'registry.json') continue;
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        const snap = this.parseSnapshot(raw);
        if (!snap) continue;
        results.push({
          teamId: snap.team.teamId,
          name: snap.team.name,
          status: snap.team.status,
          goal: snap.team.goal,
          depth: snap.team.depth,
          createdAt: snap.team.createdAt,
          memberCount: snap.members.length,
          jobCount: snap.jobs.length,
        });
      } catch {
        continue;
      }
    }
    return results;
  }

  /** Delete a team's persisted data. */
  delete(teamId: string): void {
    const filePath = this.teamPath(teamId);
    if (existsSync(filePath)) {
      rmSync(filePath, {force: true});
    }
  }

  // ── Convenience Builders ──────────────────────────────────────────

  /**
   * Build a TeamSnapshot from in-memory state.
   * Convenience for callers that have separate team/members/board/messages.
   */
  static buildSnapshot(
    team: Team,
    members: TeamMember[],
    board: JobBoard,
    recentMessages: TeamMessage[],
    totalTokens = 0,
  ): TeamSnapshot {
    return {
      team,
      members,
      jobs: board.getAllJobs(),
      recentMessages: recentMessages.slice(-MAX_RECENT_MESSAGES),
      metadata: {
        createdAt: team.createdAt,
        lastActiveAt: new Date().toISOString(),
        totalTokens,
      },
    };
  }

  /**
   * Reconstruct a JobBoard from a loaded snapshot's jobs array.
   */
  static restoreJobBoard(teamId: string, jobs: Job[]): JobBoard {
    return JobBoard.fromJSON({teamId, jobs});
  }

  // ── Internals ─────────────────────────────────────────────────────

  private teamsDir(): string {
    return join(this.dataDir, 'teams');
  }

  private teamPath(teamId: string): string {
    return join(this.teamsDir(), `${teamId}.json`);
  }

  private parseSnapshot(raw: unknown): TeamSnapshot | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    try {
      const team = TeamSchema.parse(obj.team);
      const members = Array.isArray(obj.members)
        ? obj.members.map((m: unknown) => TeamMemberSchema.parse(m))
        : [];
      const jobs = Array.isArray(obj.jobs) ? (obj.jobs as Job[]) : [];
      const recentMessages = Array.isArray(obj.recentMessages)
        ? (obj.recentMessages as TeamMessage[])
        : [];
      const meta = obj.metadata as Record<string, unknown> | undefined;
      return {
        team,
        members,
        jobs,
        recentMessages,
        metadata: {
          createdAt: (meta?.createdAt as string) ?? team.createdAt,
          lastActiveAt: (meta?.lastActiveAt as string) ?? new Date().toISOString(),
          totalTokens: (meta?.totalTokens as number) ?? 0,
        },
      };
    } catch {
      return null;
    }
  }
}
