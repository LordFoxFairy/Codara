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

  test('keeps team-member approvals runtime-only across reopened stores', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-approval-team-member-'));
    try {
      const store = createApprovalFileStore({rootDir});
      store.upsertTeamMemberApproval({
        sessionId: 'session-team-member',
        teamId: 'team-1',
        memberId: 'member-1',
        memberName: 'Alice',
        pauseRequest: makePauseRequest('approval-team-member', 'Team approval required', 'team_tool'),
      });

      expect(store.list('session-team-member')).toHaveLength(1);

      const reopened = createApprovalFileStore({rootDir});
      expect(reopened.get('approval-team-member')).toBeUndefined();
      expect(reopened.list('session-team-member')).toHaveLength(0);
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
