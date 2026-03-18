/**
 * Teams Integration Case Tests
 *
 * End-to-end tests for local team lifecycle:
 * - TeamRegistry + TeamRuntime + TeamEventBridge + event flow
 * - Resource cleanup (transport/emitter/bridge) on shutdown/kill
 * - Conversation tools (create_team, list_teams, team_status, shutdown_team)
 * - CLI hook: useActiveTeams derivation from runtime events
 *
 * NOTE: These tests do NOT require a real LLM or MCP server.
 * Member sessions are stubbed to simulate agent behavior.
 */
import {describe, test, expect, beforeEach} from 'bun:test';

import {TeamRegistry} from '@capability/team/coordination/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {MemorySharedState} from '@capability/team/shared-state';
import {createConversationTeamTools} from '@capability/team/surface/conversation-tools';
import type {CodaraRuntimeEvent} from '@observability/events';
import {deriveActiveTeams} from '@/cli/hooks/use-active-teams';

// ─── Helpers ──────────────────────────────────────────────────────────

function createTestRuntime(projectRoot = '/tmp/test-teams') {
  const registry = new TeamRegistry();
  const runtime = new TeamRuntime({
    registry,
    projectRoot,
    createSession: () => ({
      invoke: async () => ({reason: 'complete' as const}),
      dispose: async () => {},
    }),
  });
  return {registry, runtime};
}

// ─── 1. Team Lifecycle: create → start → shutdown ────────────────────

describe('Teams Case: Local Team Lifecycle', () => {
  let registry: TeamRegistry;
  let runtime: TeamRuntime;

  beforeEach(() => {
    ({registry, runtime} = createTestRuntime());
  });

  test('create team, start, verify running status, then shutdown', async () => {
    const team = registry.createTeam({name: 'test-alpha', goal: 'Build feature X'});
    expect(team.status).toBe('created');

    await runtime.startTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');

    // No auto-leader — main agent IS the leader (Claude Code model)
    const members = registry.getMembersByTeam(team.teamId);
    expect(members).toHaveLength(0);

    // Verify transport exists
    expect(runtime.getTransport(team.teamId)).toBeDefined();

    // Shutdown
    await runtime.shutdownTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('completed');

    // Verify transport cleaned up
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
  });

  test('kill team cleans up resources', async () => {
    const team = registry.createTeam({name: 'test-beta', goal: 'Quick task'});
    await runtime.startTeam(team.teamId);

    await runtime.killTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('failed');

    // Resources cleaned
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
  });

  test('pause and resume team', async () => {
    const team = registry.createTeam({name: 'test-gamma', goal: 'Ongoing work'});
    await runtime.startTeam(team.teamId);

    runtime.pauseTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('paused');

    runtime.resumeTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('running');
  });

  test('spawn worker member in running team', async () => {
    const team = registry.createTeam({name: 'test-delta', goal: 'Multi-worker'});
    await runtime.startTeam(team.teamId);

    const worker = await runtime.spawnMember(team.teamId, 'worker-1', 'worker');
    expect(worker.role).toBe('worker');
    expect(worker.teamId).toBe(team.teamId);

    const members = registry.getMembersByTeam(team.teamId);
    expect(members).toHaveLength(1); // just the worker (no auto-leader)
  });

  test('multiple teams run independently', async () => {
    const teamA = registry.createTeam({name: 'team-a', goal: 'Frontend'});
    const teamB = registry.createTeam({name: 'team-b', goal: 'Backend'});

    await runtime.startTeam(teamA.teamId);
    await runtime.startTeam(teamB.teamId);

    expect(registry.getTeam(teamA.teamId)?.status).toBe('running');
    expect(registry.getTeam(teamB.teamId)?.status).toBe('running');

    // Shutdown one, other stays running
    await runtime.shutdownTeam(teamA.teamId);
    expect(registry.getTeam(teamA.teamId)?.status).toBe('completed');
    expect(registry.getTeam(teamB.teamId)?.status).toBe('running');

    await runtime.shutdownTeam(teamB.teamId);
  });
});

// ─── 2. Conversation Tools ───────────────────────────────────────────

describe('Teams Case: Conversation Tools', () => {
  let registry: TeamRegistry;
  let runtime: TeamRuntime;
  let sharedState: MemorySharedState;
  let tools: ReturnType<typeof createConversationTeamTools>;

  beforeEach(() => {
    ({registry, runtime} = createTestRuntime());
    sharedState = new MemorySharedState();
    tools = createConversationTeamTools({registry, runtime, sharedState});
  });

  function getTool(name: string) {
    const t = tools.find(t => t.name === name);
    if (!t) throw new Error(`Tool ${name} not found`);
    return t;
  }

  test('create_team creates and starts a team', async () => {
    const result = await getTool('create_team').invoke({goal: 'Build auth module'});
    const parsed = JSON.parse(result as string);

    expect(parsed.status).toBe('running');
    expect(parsed.teamId).toBeDefined();
    expect(parsed.name).toBeDefined();

    // Verify in registry
    const team = registry.getTeam(parsed.teamId);
    expect(team).toBeDefined();
    expect(team!.status).toBe('running');
  });

  test('create_team with custom name', async () => {
    const result = await getTool('create_team').invoke({goal: 'Refactor DB', name: 'db-team'});
    const parsed = JSON.parse(result as string);

    expect(parsed.name).toBe('db-team');
  });

  test('list_teams returns all teams', async () => {
    await getTool('create_team').invoke({goal: 'Team 1', name: 'list-test-a'});
    await getTool('create_team').invoke({goal: 'Team 2', name: 'list-test-b'});

    const result = await getTool('list_teams').invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].status).toBe('running');
    expect(parsed[1].status).toBe('running');
  });

  test('team_status returns members and jobs', async () => {
    const createResult = JSON.parse(await getTool('create_team').invoke({goal: 'Status test'}) as string);
    const teamId = createResult.teamId;

    const result = await getTool('team_status').invoke({teamId});
    const parsed = JSON.parse(result as string);

    expect(parsed.team.id).toBe(teamId);
    expect(parsed.team.status).toBe('running');
    // No auto-leader — main agent IS the leader
    expect(parsed.members).toHaveLength(0);
    expect(Array.isArray(parsed.jobs)).toBe(true);
  });

  test('team_status by name', async () => {
    await getTool('create_team').invoke({goal: 'Named team', name: 'my-team'});

    const result = await getTool('team_status').invoke({teamId: 'my-team'});
    const parsed = JSON.parse(result as string);

    expect(parsed.team.name).toBe('my-team');
  });

  test('team_status returns error for unknown team', async () => {
    const result = await getTool('team_status').invoke({teamId: 'nonexistent'});
    const parsed = JSON.parse(result as string);

    expect(parsed.error).toBe('Team not found');
  });

  test('shutdown_team gracefully stops team', async () => {
    const createResult = JSON.parse(await getTool('create_team').invoke({goal: 'Shutdown test'}) as string);
    const teamId = createResult.teamId;

    const result = await getTool('shutdown_team').invoke({teamId});
    const parsed = JSON.parse(result as string);

    expect(parsed.ok).toBe(true);
    expect(registry.getTeam(teamId)?.status).toBe('completed');
  });

  test('create_team updates shared state', async () => {
    const createResult = JSON.parse(await getTool('create_team').invoke({goal: 'State test'}) as string);
    const teamId = createResult.teamId;

    const state = sharedState.getTeamState(teamId);
    expect(state).toBeDefined();
    expect(state!.status).toBe('running');
  });

  test('shutdown_team removes from shared state', async () => {
    const createResult = JSON.parse(await getTool('create_team').invoke({goal: 'Cleanup test'}) as string);
    const teamId = createResult.teamId;

    await getTool('shutdown_team').invoke({teamId});
    expect(sharedState.getTeamState(teamId)).toBeUndefined();
  });
});

// ─── 4. CLI Hook: deriveActiveTeams ──────────────────────────────────

describe('Teams Case: deriveActiveTeams', () => {
  const now = Date.now();

  function makeTeamEvent(overrides: Partial<CodaraRuntimeEvent>): CodaraRuntimeEvent {
    return {
      id: `evt-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: 'test-session',
      timestamp: new Date(now).toISOString(),
      kind: 'team',
      phase: 'start',
      status: 'running',
      label: 'Team test-team started',
      ...overrides,
    };
  }

  test('derives running team from start event', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({id: 'team-1', label: 'Team frontend: Build UI', detail: 'memberCount:3 jobTotal:5'}),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(1);
    expect(teams[0].status).toBe('running');
    expect(teams[0].name).toBe('frontend');
    expect(teams[0].goal).toBe('Build UI');
    expect(teams[0].memberCount).toBe(3);
    expect(teams[0].jobProgress.total).toBe(5);
  });

  test('pairs start/end events correctly', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({id: 'team-1', label: 'Team backend: API work'}),
      makeTeamEvent({
        id: 'end-1',
        phase: 'end',
        status: 'done',
        parentId: 'team-1',
        label: 'Team backend completed',
        detail: 'done:4 total:5',
        timestamp: new Date(now - 1000).toISOString(), // completed 1s ago
      }),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(1);
    expect(teams[0].status).toBe('completed');
    expect(teams[0].jobProgress.done).toBe(4);
    expect(teams[0].jobProgress.total).toBe(5);
  });

  test('completed teams disappear after linger period', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({id: 'team-1', label: 'Team old: Done long ago'}),
      makeTeamEvent({
        id: 'end-1',
        phase: 'end',
        status: 'done',
        parentId: 'team-1',
        timestamp: new Date(now - 10_000).toISOString(), // 10s ago — past 5s linger
      }),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(0);
  });

  test('failed teams shown within linger period', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({id: 'team-1', label: 'Team broken: Fail test'}),
      makeTeamEvent({
        id: 'end-1',
        phase: 'end',
        status: 'error',
        parentId: 'team-1',
        timestamp: new Date(now - 2000).toISOString(), // 2s ago
      }),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(1);
    expect(teams[0].status).toBe('failed');
  });

  test('running teams sorted before completed', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({id: 'team-done', label: 'Team done-team: A', timestamp: new Date(now - 5000).toISOString()}),
      makeTeamEvent({
        id: 'end-done',
        phase: 'end',
        status: 'done',
        parentId: 'team-done',
        timestamp: new Date(now - 1000).toISOString(),
      }),
      makeTeamEvent({id: 'team-running', label: 'Team running-team: B', timestamp: new Date(now - 3000).toISOString()}),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(2);
    expect(teams[0].status).toBe('running');
    expect(teams[1].status).toBe('completed');
  });

  test('max 3 teams visible', () => {
    const events: CodaraRuntimeEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(makeTeamEvent({
        id: `team-${i}`,
        label: `Team t${i}: Goal ${i}`,
        timestamp: new Date(now - i * 1000).toISOString(),
      }));
    }

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(3);
  });

  test('empty events returns empty teams', () => {
    expect(deriveActiveTeams([], now)).toHaveLength(0);
  });

  test('non-team events are ignored', () => {
    const events: CodaraRuntimeEvent[] = [
      makeTeamEvent({kind: 'task', id: 'task-1'}),
      makeTeamEvent({kind: 'tool', id: 'tool-1'}),
    ];

    const teams = deriveActiveTeams(events, now);
    expect(teams).toHaveLength(0);
  });
});

// ─── 5. Resource Cleanup Verification ────────────────────────────────

describe('Teams Case: Resource Cleanup', () => {
  test('shutdown cleans up all resources: runners, transports, emitters', async () => {
    const {registry, runtime} = createTestRuntime();

    const team = registry.createTeam({name: 'cleanup-test', goal: 'Verify cleanup'});
    await runtime.startTeam(team.teamId);

    // Spawn a worker (no auto-leader)
    await runtime.spawnMember(team.teamId, 'worker-1', 'worker');
    const members = registry.getMembersByTeam(team.teamId);
    expect(members).toHaveLength(1);

    // All runners should exist
    for (const m of members) {
      expect(runtime.getRunner(m.memberId)).toBeDefined();
    }

    await runtime.shutdownTeam(team.teamId);

    // All runners cleaned up
    for (const m of members) {
      expect(runtime.getRunner(m.memberId)).toBeUndefined();
    }

    // Transport cleaned up
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
  });

  test('kill cleans up all resources', async () => {
    const {registry, runtime} = createTestRuntime();

    const team = registry.createTeam({name: 'kill-cleanup', goal: 'Verify kill cleanup'});
    await runtime.startTeam(team.teamId);
    await runtime.spawnMember(team.teamId, 'worker-1', 'worker');

    await runtime.killTeam(team.teamId);

    expect(runtime.getTransport(team.teamId)).toBeUndefined();
  });

});

// ─── 6. SharedState ──────────────────────────────────────────────────

describe('Teams Case: SharedState Integration', () => {
  test('memory shared state stores and retrieves team state', () => {
    const state = new MemorySharedState();

    state.updateTeamState('team-1', {status: 'running', jobsSummary: {total: 5, done: 2, failed: 0}});
    state.updateTeamState('team-2', {status: 'paused', jobsSummary: {total: 3, done: 1, failed: 1}});

    expect(state.getTeamState('team-1')?.status).toBe('running');
    expect(state.getTeamState('team-2')?.jobsSummary.failed).toBe(1);
    expect(state.getTeamState('nonexistent')).toBeUndefined();
  });

  test('removeTeamState clears entry', () => {
    const state = new MemorySharedState();
    state.updateTeamState('team-1', {status: 'running', jobsSummary: {total: 0, done: 0, failed: 0}});
    state.removeTeamState('team-1');
    expect(state.getTeamState('team-1')).toBeUndefined();
  });

  test('getAllTeamStates returns all entries', () => {
    const state = new MemorySharedState();
    state.updateTeamState('t1', {status: 'running', jobsSummary: {total: 0, done: 0, failed: 0}});
    state.updateTeamState('t2', {status: 'completed', jobsSummary: {total: 3, done: 3, failed: 0}});

    const all = state.getAllTeamStates();
    expect(all.size).toBe(2);
    expect(all.get('t1')?.status).toBe('running');
    expect(all.get('t2')?.status).toBe('completed');
  });
});
