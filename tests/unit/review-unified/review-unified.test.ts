import {describe, expect, test} from 'bun:test';
import type {CodaraRuntimeEvent} from '@observability/events';
import {RuntimeEventsController, AGENT_ACTIVITY_CALLBACK_KEY} from '@observability/events';
import {buildActiveItems} from '@/cli/transcript/model';
import type {SessionState} from '@durability/session/types';
import {FileSessionStore} from '@durability/session/store';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

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

    const defaultList = await store.list();
    expect(defaultList).toHaveLength(1);
    expect(defaultList[0]!.sessionId).toBe('main-001');

    const allList = await store.list({includeInternal: true});
    expect(allList).toHaveLength(2);
    const ids = allList.map((session) => session.sessionId).sort();
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

describe('delegated-task activity display', () => {
  test('RuntimeEventsController exposes the child activity callback contract for Agent tools', () => {
    const controller = new RuntimeEventsController('test-session');
    const events: CodaraRuntimeEvent[] = [];
    controller.subscribe((event) => events.push(event));

    const middleware = controller.createMiddleware();
    expect(middleware).toBeDefined();
    expect(middleware.name).toBe('RuntimeEventsMiddleware');
    expect(events).toEqual([]);
  });

  test('AGENT_ACTIVITY_CALLBACK_KEY is exported', () => {
    expect(AGENT_ACTIVITY_CALLBACK_KEY).toBe('__agentActivityCallback');
  });

  test('transcript renders child activity under running delegated subagent runs', () => {
    const now = new Date().toISOString();
    const taskId = 'subagent-run:task-root-1';
    const events: CodaraRuntimeEvent[] = [
      {
        id: taskId,
        sessionId: 'sess',
        timestamp: now,
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Plan: Analyze architecture',
        parentId: 'tool-1',
      },
      {
        id: 'activity-1',
        sessionId: 'sess',
        timestamp: now,
        kind: 'agent',
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
        kind: 'agent',
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
        kind: 'agent',
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

    const taskItem = items.find((item) => item.role === 'agent' && item.content.includes('⚙ Plan('));
    expect(taskItem).toBeDefined();
    expect(taskItem!.toolMeta?.outputLines).toEqual([
      'read(src/engine/agent.ts)',
      'grep(middleware)',
      'read(src/engine/pipeline/types.ts)',
    ]);
  });

  test('transcript shows overflow indicator for many child activities', () => {
    const now = new Date().toISOString();
    const taskId = 'subagent-run:task-root-2';
    const events: CodaraRuntimeEvent[] = [
      {
        id: taskId,
        sessionId: 'sess',
        timestamp: now,
        kind: 'agent',
        phase: 'start',
        status: 'running',
        label: 'Delegating Explore: Search codebase',
        parentId: 'tool-2',
      },
    ];

    for (let i = 0; i < 6; i += 1) {
      events.push({
        id: `activity-${i}`,
        sessionId: 'sess',
        timestamp: now,
        kind: 'agent',
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

    const taskItem = items.find((item) => item.role === 'agent');
    expect(taskItem).toBeDefined();
    expect(taskItem!.toolMeta?.summaryLine).toContain('6 tool activities');
    expect(taskItem!.toolMeta?.outputLines).toEqual([
      'read(file-3.ts)',
      'read(file-4.ts)',
      'read(file-5.ts)',
    ]);
    expect(taskItem!.toolMeta?.totalOutputLines).toBe(6);
  });

  test('task pause events carry delegated-review metadata without any legacy peer-runtime event kind', () => {
    const event: CodaraRuntimeEvent = {
      id: 'task-review-1',
      sessionId: 'sess',
      timestamp: new Date().toISOString(),
      kind: 'agent',
      phase: 'update',
      status: 'paused',
      label: 'Subagent waiting for review',
      detail: 'Waiting for approval on read_file',
      parentId: 'subagent-run:run-1',
    };

    expect(event.kind).toBe('agent');
    expect(event.status).toBe('paused');
    expect(event.label).toContain('waiting for review');
  });
});
