import {describe, expect, test} from 'bun:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApprovalFileStore} from '@durability/approval-store';
import type {ReviewRequest} from '@shared/agent-types';

function makeReviewRequest(id: string, description: string, toolName: string): ReviewRequest {
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
  test('round-trips agent-run approvals across reopened stores', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-approval-agent-run-'));
    try {
      const store = createApprovalFileStore({rootDir});
      store.upsertSubagentRunApproval({
        sessionId: 'session-task-run',
        subagentRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        reviewRequest: makeReviewRequest('approval-task-run', 'Subagent approval required', 'dangerous_tool'),
      });

      const reopened = createApprovalFileStore({rootDir});
      expect(reopened.get('approval-task-run')).toEqual(expect.objectContaining({
        approvalId: 'approval-task-run',
        source: 'subagent_run',
        sessionId: 'session-task-run',
        subagentRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        description: 'Subagent approval required',
        toolName: 'dangerous_tool',
        reviewRequest: expect.objectContaining({
          id: 'approval-task-run',
          description: 'Subagent approval required',
        }),
      }));
      expect(reopened.list('session-task-run')).toHaveLength(1);
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });

  test('removes only the targeted agent-run approval without disturbing siblings', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'codara-approval-agent-run-siblings-'));
    try {
      const store = createApprovalFileStore({rootDir});

      store.upsertSubagentRunApproval({
        sessionId: 'session-task-run',
        subagentRunId: 'task-run-1',
        childSessionId: 'child-session-1',
        reviewRequest: makeReviewRequest('approval-task-run-1', 'Subagent approval required', 'dangerous_tool'),
      });
      store.upsertSubagentRunApproval({
        sessionId: 'session-task-run',
        subagentRunId: 'task-run-2',
        childSessionId: 'child-session-2',
        reviewRequest: makeReviewRequest('approval-task-run-2', 'Subagent approval required', 'dangerous_tool'),
      });
      store.upsertSubagentRunApproval({
        sessionId: 'session-task-run',
        subagentRunId: 'task-run-3',
        childSessionId: 'child-session-3',
        reviewRequest: makeReviewRequest('approval-task-run-3', 'Subagent approval required', 'dangerous_tool'),
      });

      store.removeBySubagentRunId('task-run-1');

      expect(store.get('approval-task-run-1')).toBeUndefined();
      expect(store.get('approval-task-run-2')).toEqual(expect.objectContaining({
        subagentRunId: 'task-run-2',
        childSessionId: 'child-session-2',
      }));
      expect(store.get('approval-task-run-3')).toEqual(expect.objectContaining({
        subagentRunId: 'task-run-3',
        childSessionId: 'child-session-3',
      }));
    } finally {
      await rm(rootDir, {recursive: true, force: true});
    }
  });
});
