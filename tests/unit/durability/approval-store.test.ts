import {describe, expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApprovalFileStore} from '@durability/approval-store';
import type {PauseRequest} from '@shared/contracts/agent-types';

function makePauseRequest(id: string, description: string, toolName: string): PauseRequest {
  return {
    id,
    description,
    action: {
      toolCallId: `${id}-call`,
      toolName,
      toolArgs: {path: '/tmp/out.txt'},
    },
    review: {
      actionName: toolName,
      allowedDecisions: ['approve', 'reject'],
    },
    runtime: {
      runId: `${id}-run`,
      turn: 1,
      requestId: `${id}-request`,
      toolIndex: 0,
    },
  };
}

describe('FileApprovalStore', () => {
  test('round-trips task-run approvals across reopened stores', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-approval-task-run-'));
    try {
      const store = createApprovalFileStore({rootDir});
      store.upsertTaskRunApproval({
        sessionId: 'session-task-run',
        taskRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        pauseRequest: makePauseRequest('approval-task-run', 'Task approval required', 'dangerous_tool'),
      });

      const reopened = createApprovalFileStore({rootDir});
      expect(reopened.get('approval-task-run')).toEqual(expect.objectContaining({
        approvalId: 'approval-task-run',
        source: 'task_run',
        sessionId: 'session-task-run',
        taskRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        description: 'Task approval required',
        toolName: 'dangerous_tool',
        pauseRequest: expect.objectContaining({
          id: 'approval-task-run',
          description: 'Task approval required',
        }),
      }));
      expect(reopened.list('session-task-run')).toHaveLength(1);
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  test('removes only the targeted task-run approval without disturbing siblings', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-approval-task-run-siblings-'));
    try {
      const store = createApprovalFileStore({rootDir});

      store.upsertTaskRunApproval({
        sessionId: 'session-task-run',
        taskRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        pauseRequest: makePauseRequest('approval-task-run-1', 'Task approval required', 'dangerous_tool'),
      });
      store.upsertTaskRunApproval({
        sessionId: 'session-task-run',
        taskRunId: 'task-run-2',
        childSessionId: 'child-session-2',
        pauseRequest: makePauseRequest('approval-task-run-2', 'Task approval required', 'dangerous_tool'),
      });
      store.upsertTaskRunApproval({
        sessionId: 'session-task-run',
        taskRunId: 'task-run-3',
        childSessionId: 'child-session-3',
        pauseRequest: makePauseRequest('approval-task-run-3', 'Task approval required', 'dangerous_tool'),
      });

      store.removeByTaskRunId('task-run-1');

      expect(store.get('approval-task-run-1')).toBeUndefined();
      expect(store.get('approval-task-run-2')).toEqual(expect.objectContaining({
        taskRunId: 'task-run-2',
        childSessionId: 'child-session-2',
      }));
      expect(store.get('approval-task-run-3')).toEqual(expect.objectContaining({
        taskRunId: 'task-run-3',
        childSessionId: 'child-session-3',
      }));
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
