import type { Team, TeamMember, MemberRole } from '@capability/team/types';
import { TeamRegistry } from '@capability/team/team-registry';
import { LocalTransport } from '@capability/team/transport/local-transport';
import { TeamEventEmitter } from '@capability/team/events';
import { MemberRunner } from '@capability/team/runtime/member-runner';
import type { MemberSession, MemberSessionOptions } from '@capability/team/runtime/member-runner';

// ─── Types ──────────────────────────────────────────────────────────

export interface TeamRuntimeOptions {
  registry: TeamRegistry;
  projectRoot: string;
  createSession?: (options: MemberSessionOptions) => MemberSession;
}

// ─── TeamRuntime ────────────────────────────────────────────────────

export class TeamRuntime {
  private runners = new Map<string, MemberRunner>();     // memberId -> runner
  private transports = new Map<string, LocalTransport>(); // teamId -> transport
  private emitters = new Map<string, TeamEventEmitter>(); // teamId -> emitter

  constructor(private readonly options: TeamRuntimeOptions) {}

  /** Start a team: create transport, emitter, spawn leader. */
  async startTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const transport = new LocalTransport();
    const emitter = new TeamEventEmitter();
    this.transports.set(teamId, transport);
    this.emitters.set(teamId, emitter);

    registry.updateTeamStatus(teamId, 'spawning');

    const leader = this.buildMember(teamId, 'leader', 'leader');
    registry.registerMember(teamId, leader);
    transport.registerMember(leader.memberId);

    const runner = new MemberRunner({
      member: leader,
      teamName: team.name,
      goal: team.goal,
      depth: team.depth,
      maxDepth: team.config.maxDepth,
      registry,
      transport,
      emitter,
      projectRoot: this.options.projectRoot,
      createSession: this.options.createSession,
    });

    this.runners.set(leader.memberId, runner);

    registry.updateTeamStatus(teamId, 'running');
    emitter.emit({ type: 'team.running', data: { teamId } });

    // Start leader in background (don't await)
    runner.start().catch(err => {
      this.handleMemberCrash(teamId, leader.memberId, err);
    });
  }

  /** Spawn a new member in a running team. */
  async spawnMember(teamId: string, name: string, role: MemberRole, model?: string): Promise<TeamMember> {
    const { registry } = this.options;
    const team = registry.getTeam(teamId);
    if (!team) throw new Error(`Team ${teamId} not found`);

    const transport = this.transports.get(teamId);
    const emitter = this.emitters.get(teamId);
    if (!transport || !emitter) throw new Error(`Team ${teamId} not started`);

    const member = this.buildMember(teamId, name, role, model);
    registry.registerMember(teamId, member);
    transport.registerMember(member.memberId);

    emitter.emit({
      type: 'member.joined',
      data: { teamId, memberId: member.memberId, name, role, mode: 'local' },
    });

    const runner = new MemberRunner({
      member,
      teamName: team.name,
      goal: team.goal,
      depth: team.depth,
      maxDepth: team.config.maxDepth,
      registry,
      transport,
      emitter,
      projectRoot: this.options.projectRoot,
      createSession: this.options.createSession,
    });

    this.runners.set(member.memberId, runner);
    runner.start().catch(err => this.handleMemberCrash(teamId, member.memberId, err));

    return member;
  }

  /** Graceful shutdown of a team. */
  async shutdownTeam(teamId: string): Promise<void> {
    const { registry } = this.options;
    const emitter = this.emitters.get(teamId);

    // Request shutdown for all runners belonging to this team
    for (const [memberId, runner] of this.runners) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.requestShutdown();
      }
    }

    // Wait for runners to stop (with timeout)
    const timeout = 10_000;
    const deadline = Date.now() + timeout;
    for (const [memberId, runner] of this.runners) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        const remaining = Math.max(0, deadline - Date.now());
        await Promise.race([
          this.waitForTermination(runner),
          new Promise<void>(r => setTimeout(r, remaining)),
        ]);
      }
    }

    // Cleanup runners for this team
    for (const [memberId] of [...this.runners]) {
      const member = registry.getMember(memberId);
      if (member?.teamId === teamId) {
        this.runners.delete(memberId);
      }
    }

    registry.updateTeamStatus(teamId, 'completing');
    registry.updateTeamStatus(teamId, 'completed');
    emitter?.emit({ type: 'team.completed', data: { teamId, summary: 'Team shutdown complete' } });
  }

  /** Force-kill a team. */
  async killTeam(teamId: string): Promise<void> {
    for (const [memberId, runner] of [...this.runners]) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.requestShutdown();
        this.runners.delete(memberId);
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'failed');
    this.emitters.get(teamId)?.emit({ type: 'team.failed', data: { teamId, error: 'Killed by user' } });
  }

  /** Pause all members of a team. */
  pauseTeam(teamId: string): void {
    for (const [memberId, runner] of this.runners) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.pause();
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'paused');
    this.emitters.get(teamId)?.emit({ type: 'team.paused', data: { teamId, reason: 'User requested' } });
  }

  /** Resume all members of a paused team. */
  resumeTeam(teamId: string): void {
    for (const [memberId, runner] of this.runners) {
      const member = this.options.registry.getMember(memberId);
      if (member?.teamId === teamId) {
        runner.resume();
      }
    }
    this.options.registry.updateTeamStatus(teamId, 'running');
    this.emitters.get(teamId)?.emit({ type: 'team.running', data: { teamId } });
  }

  getRunner(memberId: string): MemberRunner | undefined {
    return this.runners.get(memberId);
  }

  getTransport(teamId: string): LocalTransport | undefined {
    return this.transports.get(teamId);
  }

  getEmitter(teamId: string): TeamEventEmitter | undefined {
    return this.emitters.get(teamId);
  }

  // ── Private ──────────────────────────────────────────────────────

  private handleMemberCrash(teamId: string, memberId: string, error: unknown): void {
    const { registry } = this.options;
    const member = registry.getMember(memberId);
    if (!member) return;

    const emitter = this.emitters.get(teamId);

    if (member.role === 'leader') {
      // Leader crash -> pause entire team
      this.pauseTeam(teamId);
      emitter?.emit({ type: 'team.paused', data: { teamId, reason: `Leader crashed: ${error}` } });
    } else {
      // Worker/reviewer crash -> release their job, emit event
      const jobBoard = registry.getJobBoard(teamId);
      if (member.currentJobId && jobBoard) {
        try { jobBoard.releaseJob(member.currentJobId); } catch { /* job may not be releasable */ }
      }
      emitter?.emit({
        type: 'member.failed',
        data: { teamId, memberId, error: String(error) },
      });
    }
  }

  private waitForTermination(runner: MemberRunner): Promise<void> {
    return new Promise<void>(resolve => {
      const check = () => {
        if (runner.getStatus() === 'terminated') {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private buildMember(teamId: string, name: string, role: MemberRole, model?: string): TeamMember {
    const memberId = `member_${crypto.randomUUID().slice(0, 8)}`;
    return {
      memberId,
      name,
      teamId,
      role,
      status: 'initializing',
      model,
      sessionId: `session-${teamId}-${name}`,
      joinedAt: new Date().toISOString(),
    };
  }
}
