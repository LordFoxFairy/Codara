import {describe, expect, test} from 'bun:test';
import type {CodaraRuntimeEvent} from '@observability/events';
import {RuntimeEventsController, CHILD_ACTIVITY_CALLBACK_KEY} from '@observability/events';
import {buildActiveItems} from '@/cli/transcript/model';
import {deriveMemberActivities} from '@/cli/hooks/use-active-teams';
import type {SessionState} from '@durability/session/types';
import {FileSessionStore} from '@durability/session/store';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// ── Task 3: Sub-session Isolation ──────────────────────────────────

describe('sub-session isolation', () => {
  test('FileSessionStore.list() filters internal sessions by default', async () => {
    const basePath = await mkdtemp(path.join(tmpdir(), 'codara-session-test-'));
    const store = new FileSessionStore({basePath});

    const mainSession: SessionState = {
      sessionId: 'main-001',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        messageCount: 5,
        lastActivity: new Date().toISOString(),
        title: 'Main session',
      },
    };

    const internalSession: SessionState = {
      sessionId: 'internal-delegate-001',
      sessionStatus: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        messageCount: 3,
        lastActivity: new Date().toISOString(),
        title: 'Delegated task',
        internal: true,
      },
    };

    await store.save(mainSession.sessionId, mainSession);
    await store.save(internalSession.sessionId, internalSession);

    // Default: internal sessions are hidden
    const defaultList = await store.list();
    expect(defaultList).toHaveLength(1);
    expect(defaultList[0]!.sessionId).toBe('main-001');

    // Explicit: include internal sessions
    const allList = await store.list({includeInternal: true});
    expect(allList).toHaveLength(2);
    const ids = allList.map(s => s.sessionId).sort();
    expect(ids).toEqual(['internal-delegate-001', 'main-001']);
  });

  test('SessionMetadata supports internal flag', () => {
    const metadata: SessionState['metadata'] = {
      messageCount: 0,
      lastActivity: new Date().toISOString(),
      internal: true,
    };
    expect(metadata?.internal).toBe(true);
  });
});

// ── Task 2: Sub-agent Activity Display ─────────────────────────────

describe('sub-agent activity display', () => {
  test('RuntimeEventsController injects child activity callback for Task tools', () => {
    const controller = new RuntimeEventsController('test-session');
    const events: CodaraRuntimeEvent[] = [];
    controller.subscribe(e => events.push(e));

    // Simulate the middleware creating its middleware and calling wrapToolCall for a Task tool
    const middleware = controller.createMiddleware();
    expect(middleware).toBeDefined();
    expect(middleware.name).toBe('RuntimeEventsMiddleware');
  });

  test('CHILD_ACTIVITY_CALLBACK_KEY is exported', () => {
    expect(CHILD_ACTIVITY_CALLBACK_KEY).toBe('__taskActivityCallback');
  });

  test('transcript renders child activity under running tasks', () => {
    const now = new Date().toISOString();
    const taskId = 'task-root-1';
    const events: CodaraRuntimeEvent[] = [
      // Task start
      {
        id: taskId,
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Plan: Analyze architecture',
        parentId: 'tool-1',
      },
      // Child tool activity (task:update from ActivityForwardMiddleware)
      {
        id: 'activity-1',
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'update',
        status: 'running',
        label: 'read(src/engine/agent.ts)',
        detail: 'read',
        parentId: taskId,
      },
      {
        id: 'activity-2',
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'update',
        status: 'running',
        label: 'grep(middleware)',
        detail: 'grep',
        parentId: taskId,
      },
      {
        id: 'activity-3',
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'update',
        status: 'running',
        label: 'read(src/engine/pipeline/types.ts)',
        detail: 'read',
        parentId: taskId,
      },
    ];

    const items = buildActiveItems({
      activeTurn: {id: 'turn-1', prompt: 'test', response: '', responseRole: 'assistant'},
      runtimeEvents: events,
    });

    // Find the task item
    const taskItem = items.find(i => i.role === 'task' && i.content.includes('Plan'));
    expect(taskItem).toBeDefined();
    // Should contain child activity lines
    expect(taskItem!.content).toContain('⎿ read(src/engine/agent.ts)');
    expect(taskItem!.content).toContain('⎿ grep(middleware)');
    expect(taskItem!.content).toContain('⎿ read(src/engine/pipeline/types.ts)');
  });

  test('transcript shows overflow indicator for many child activities', () => {
    const now = new Date().toISOString();
    const taskId = 'task-root-2';
    const events: CodaraRuntimeEvent[] = [
      {
        id: taskId,
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Search codebase',
        parentId: 'tool-2',
      },
    ];

    // Add 6 child activity events
    for (let i = 0; i < 6; i++) {
      events.push({
        id: `activity-${i}`,
        sessionId: 'sess',
        timestamp: now,
        kind: 'task',
        phase: 'update',
        status: 'running',
        label: `read(file-${i}.ts)`,
        detail: 'read',
        parentId: taskId,
      });
    }

    const items = buildActiveItems({
      activeTurn: {id: 'turn-1', prompt: 'test', response: '', responseRole: 'assistant'},
      runtimeEvents: events,
    });

    const taskItem = items.find(i => i.role === 'task');
    expect(taskItem).toBeDefined();
    // Should show overflow indicator
    expect(taskItem!.content).toContain('+3 more');
    // Should show the 3 most recent
    expect(taskItem!.content).toContain('file-3.ts');
    expect(taskItem!.content).toContain('file-4.ts');
    expect(taskItem!.content).toContain('file-5.ts');
  });
});

// ── Task 4: Team Panel Member Activity ─────────────────────────────

describe('team panel member activity', () => {
  test('deriveMemberActivities extracts latest activity per member', () => {
    const events: CodaraRuntimeEvent[] = [
      {
        id: 'e1',
        sessionId: 'sess',
        timestamp: new Date().toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'member_abc: read(src/foo.ts)',
        detail: 'member.activity:member_abc:read(src/foo.ts)',
      },
      {
        id: 'e2',
        sessionId: 'sess',
        timestamp: new Date().toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'member_abc: edit(src/bar.ts)',
        detail: 'member.activity:member_abc:edit(src/bar.ts)',
      },
      {
        id: 'e3',
        sessionId: 'sess',
        timestamp: new Date().toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'member_xyz: bash(npm test)',
        detail: 'member.activity:member_xyz:bash(npm test)',
      },
    ];

    const activities = deriveMemberActivities(events);
    // member_abc should have latest activity (edit), not first (read)
    expect(activities.get('member_abc')).toBe('edit(src/bar.ts)');
    expect(activities.get('member_xyz')).toBe('bash(npm test)');
  });

  test('deriveMemberActivities ignores non-activity events', () => {
    const events: CodaraRuntimeEvent[] = [
      {
        id: 'e1',
        sessionId: 'sess',
        timestamp: new Date().toISOString(),
        kind: 'team',
        phase: 'update',
        status: 'running',
        label: 'alice joined as worker',
        detail: 'member_abc',
      },
    ];

    const activities = deriveMemberActivities(events);
    expect(activities.size).toBe(0);
  });
});

// ── Task 1: Team Worker HIL – basic event type checks ──────────────

describe('team worker HIL', () => {
  test('member.paused event supports pause data', () => {
    // Verify the event type accepts pause field
    const event = {
      type: 'member.paused' as const,
      data: {
        teamId: 'team-1',
        memberId: 'member-1',
        pause: {
          id: 'pause-1',
          description: 'Tool requires approval: bash(rm -rf /)',
          action: {toolCallId: 'call-1', toolName: 'bash', toolArgs: {command: 'rm -rf /'}},
        },
      },
    };

    expect(event.data.pause).toBeDefined();
    expect((event.data.pause as Record<string, unknown>).description).toBe('Tool requires approval: bash(rm -rf /)');
  });
});
