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
import {describe, test, expect, beforeEach, afterEach} from 'bun:test';

import {TeamRegistry} from '@capability/team/team-registry';
import {TeamRuntime} from '@capability/team/runtime/team-runtime';
import {TeamEventBridge} from '@capability/team/bridge/team-event-bridge';
import {TeamEventEmitter} from '@capability/team/events';
import type {TeamBusEvent} from '@capability/team/events';
import {MemorySharedState} from '@capability/team/state/memory-shared-state';
import {createConversationTeamTools} from '@capability/team/tools/conversation-tools';
import type {CodaraRuntimeEvent} from '@engine/session/runtime-events';
import {deriveActiveTeams} from '@/cli/hooks/use-active-teams';

// ─── Helpers ──────────────────────────────────────────────────────────

function createTestRuntime(projectRoot = '/tmp/test-teams') {
  const registry = new TeamRegistry();
  const runtime = new TeamRuntime({
    registry,
    projectRoot,
    createSession: () => ({
      invoke: async () => ({messages: [], done: false}),
      dispose: async () => {},
    }),
  });
  return {registry, runtime};
}

function createBridge(sessionId = 'test-session') {
  const events: CodaraRuntimeEvent[] = [];
  const bridge = new TeamEventBridge({
    sessionId,
    onRuntimeEvent: (event) => events.push(event),
  });
  return {bridge, events};
}

function patchRuntimeWithBridge(
  runtime: TeamRuntime,
  bridge: TeamEventBridge,
) {
  const originalStart = runtime.startTeam.bind(runtime);
  runtime.startTeam = async (teamId: string) => {
    await originalStart(teamId);
    const emitter = runtime.getEmitter(teamId);
    if (emitter) {
      bridge.attachTeam(teamId, emitter);
      // Replay team.running event (emitted inside startTeam before bridge attachment)
      emitter.emit({type: 'team.running', data: {teamId}});
    }
  };

  const originalShutdown = runtime.shutdownTeam.bind(runtime);
  runtime.shutdownTeam = async (teamId: string) => {
    await originalShutdown(teamId);
    bridge.detachTeam(teamId);
  };

  const originalKill = runtime.killTeam.bind(runtime);
  runtime.killTeam = async (teamId: string) => {
    await originalKill(teamId);
    bridge.detachTeam(teamId);
  };
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

    // Verify leader member was created
    const members = registry.getMembersByTeam(team.teamId);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('leader');
    expect(members[0].name).toBe('leader');

    // Verify transport and emitter exist
    expect(runtime.getTransport(team.teamId)).toBeDefined();
    expect(runtime.getEmitter(team.teamId)).toBeDefined();

    // Shutdown
    await runtime.shutdownTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('completed');

    // Verify transport and emitter cleaned up
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
    expect(runtime.getEmitter(team.teamId)).toBeUndefined();
  });

  test('kill team cleans up resources', async () => {
    const team = registry.createTeam({name: 'test-beta', goal: 'Quick task'});
    await runtime.startTeam(team.teamId);

    await runtime.killTeam(team.teamId);
    expect(registry.getTeam(team.teamId)?.status).toBe('failed');

    // Resources cleaned
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
    expect(runtime.getEmitter(team.teamId)).toBeUndefined();
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
    expect(members).toHaveLength(2); // leader + worker
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

// ─── 2. Event Bridge ─────────────────────────────────────────────────

describe('Teams Case: Event Bridge', () => {
  let registry: TeamRegistry;
  let runtime: TeamRuntime;
  let bridge: TeamEventBridge;
  let events: CodaraRuntimeEvent[];

  beforeEach(() => {
    ({registry, runtime} = createTestRuntime());
    ({bridge, events} = createBridge());
    patchRuntimeWithBridge(runtime, bridge);
  });

  test('team start emits runtime event with kind=team, phase=start', async () => {
    const team = registry.createTeam({name: 'bridge-test', goal: 'Test bridging'});
    await runtime.startTeam(team.teamId);

    const startEvent = events.find(e => e.kind === 'team' && e.phase === 'start');
    expect(startEvent).toBeDefined();
    expect(startEvent!.status).toBe('running');
    expect(startEvent!.label).toContain(team.teamId);
  });

  test('team shutdown emits runtime event with phase=end, status=done', async () => {
    const team = registry.createTeam({name: 'bridge-shutdown', goal: 'Test shutdown'});
    await runtime.startTeam(team.teamId);
    events.length = 0; // clear start events

    await runtime.shutdownTeam(team.teamId);

    const endEvent = events.find(e => e.kind === 'team' && e.phase === 'end');
    expect(endEvent).toBeDefined();
    expect(endEvent!.status).toBe('done');
  });

  test('team kill emits runtime event with phase=end, status=error', async () => {
    const team = registry.createTeam({name: 'bridge-kill', goal: 'Test kill'});
    await runtime.startTeam(team.teamId);
    events.length = 0;

    await runtime.killTeam(team.teamId);

    const endEvent = events.find(e => e.kind === 'team' && e.phase === 'end');
    expect(endEvent).toBeDefined();
    expect(endEvent!.status).toBe('error');
  });

  test('team pause emits runtime event with phase=update, status=paused', async () => {
    const team = registry.createTeam({name: 'bridge-pause', goal: 'Test pause'});
    await runtime.startTeam(team.teamId);
    events.length = 0;

    runtime.pauseTeam(team.teamId);

    const pauseEvent = events.find(e => e.kind === 'team' && e.phase === 'update' && e.status === 'paused');
    expect(pauseEvent).toBeDefined();
  });

  test('start/end events have matching parentId', async () => {
    const team = registry.createTeam({name: 'bridge-pair', goal: 'Test pairing'});
    await runtime.startTeam(team.teamId);
    const startEvent = events.find(e => e.kind === 'team' && e.phase === 'start')!;

    await runtime.shutdownTeam(team.teamId);
    const endEvent = events.find(e => e.kind === 'team' && e.phase === 'end')!;

    expect(endEvent.parentId).toBe(startEvent.id);
  });

  test('bridge detaches on shutdown — no events after detach', async () => {
    const team = registry.createTeam({name: 'bridge-detach', goal: 'Test detach'});
    await runtime.startTeam(team.teamId);
    await runtime.shutdownTeam(team.teamId);

    const countAfterShutdown = events.length;

    // Creating another team — events should NOT be emitted for the old team
    // (it's already detached). Only new team events appear.
    const team2 = registry.createTeam({name: 'bridge-new', goal: 'New team'});
    await runtime.startTeam(team2.teamId);

    // New events are only from team2
    const newEvents = events.slice(countAfterShutdown);
    const oldTeamEvents = newEvents.filter(e => e.label?.includes(team.teamId));
    expect(oldTeamEvents).toHaveLength(0);

    await runtime.shutdownTeam(team2.teamId);
  });

  test('detachAll stops all event forwarding', async () => {
    const team = registry.createTeam({name: 'detach-all', goal: 'Test detach all'});
    await runtime.startTeam(team.teamId);
    bridge.detachAll();

    const countBefore = events.length;
    // Manually emit — should not appear in events
    runtime.getEmitter(team.teamId)?.emit({type: 'team.paused', data: {teamId: team.teamId, reason: 'test'}});

    // Wait a tick for any async delivery
    await new Promise(r => setTimeout(r, 10));
    expect(events.length).toBe(countBefore);
  });
});

// ─── 3. Conversation Tools ───────────────────────────────────────────

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

    expect(parsed.status).toBe('started');
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
    expect(parsed.members).toHaveLength(1); // leader
    expect(parsed.members[0].role).toBe('leader');
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

    // Spawn a worker
    await runtime.spawnMember(team.teamId, 'worker-1', 'worker');
    const members = registry.getMembersByTeam(team.teamId);
    expect(members).toHaveLength(2);

    // All runners should exist
    for (const m of members) {
      expect(runtime.getRunner(m.memberId)).toBeDefined();
    }

    await runtime.shutdownTeam(team.teamId);

    // All runners cleaned up
    for (const m of members) {
      expect(runtime.getRunner(m.memberId)).toBeUndefined();
    }

    // Transport and emitter cleaned up
    expect(runtime.getTransport(team.teamId)).toBeUndefined();
    expect(runtime.getEmitter(team.teamId)).toBeUndefined();
  });

  test('kill cleans up all resources', async () => {
    const {registry, runtime} = createTestRuntime();

    const team = registry.createTeam({name: 'kill-cleanup', goal: 'Verify kill cleanup'});
    await runtime.startTeam(team.teamId);
    await runtime.spawnMember(team.teamId, 'worker-1', 'worker');

    await runtime.killTeam(team.teamId);

    expect(runtime.getTransport(team.teamId)).toBeUndefined();
    expect(runtime.getEmitter(team.teamId)).toBeUndefined();
  });

  test('bridge + runtime combo: no dangling subscriptions after lifecycle', async () => {
    const {registry, runtime} = createTestRuntime();
    const {bridge, events} = createBridge();
    patchRuntimeWithBridge(runtime, bridge);

    // Create and destroy 3 teams
    for (let i = 0; i < 3; i++) {
      const team = registry.createTeam({name: `cycle-${i}`, goal: `Cycle ${i}`});
      await runtime.startTeam(team.teamId);
      await runtime.shutdownTeam(team.teamId);
    }

    const teamEventCount = events.filter(e => e.kind === 'team').length;
    expect(teamEventCount).toBeGreaterThan(0);

    // After all teams shutdown and bridge detached, no new events should appear
    const countAfter = events.length;
    // Simulate: nothing else can emit since all emitters are cleaned up
    await new Promise(r => setTimeout(r, 50));
    expect(events.length).toBe(countAfter);
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
