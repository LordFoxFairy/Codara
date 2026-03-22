import {describe, expect, it} from 'bun:test';
import {readCliReviewProjection, syncProjectedReview} from '@/cli/app/runtime-projection';

describe('CLI runtime projection helpers', () => {
  it('prefers focused approval review over pendingPause when projecting approval state', () => {
    const projection = readCliReviewProjection({
      getFocusedReview: () => ({
        item: {
          reviewId: 'approval-1',
          source: 'agent_run',
          kind: 'approval',
          interactionMode: 'approval',
          blockingScope: 'task',
          description: 'Approve bash',
          toolName: 'bash',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          anchor: {origin: 'delegated'},
          isFocused: true,
        },
        request: {
          id: 'approval-1',
          description: 'Approve bash',
          action: {toolCallId: 'tool-1', toolName: 'bash', toolArgs: {}},
          review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
          runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
        },
      }),
      listReviewItems: () => [{
        reviewId: 'approval-1',
        source: 'agent_run',
        kind: 'approval',
        interactionMode: 'approval',
        blockingScope: 'task',
        description: 'Approve bash',
        toolName: 'bash',
        createdAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
        anchor: {origin: 'delegated'},
        isFocused: true,
      }],
      getAgentState: () => ({
        pendingPause: {
          id: 'foreground-pause',
          description: 'Pending pause',
          action: {toolCallId: 'tool-2', toolName: 'read_file', toolArgs: {}},
          review: {actionName: 'read_file', allowedDecisions: ['approve']},
          runtime: {runId: 'run-2', turn: 1, requestId: 'req-2', toolIndex: 0},
        },
      }),
    } as never);

    expect(projection.activePause?.id).toBe('approval-1');
    expect(projection.reviews).toHaveLength(1);
  });

  it('applies approval index metadata while syncing the projected HIL review', () => {
    const review = syncProjectedReview({
      getFocusedReview: () => ({
        item: {
          reviewId: 'approval-2',
          source: 'agent_run',
          kind: 'approval',
          interactionMode: 'approval',
          blockingScope: 'task',
          description: 'Approve second task',
          toolName: 'bash',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          anchor: {origin: 'delegated'},
          isFocused: true,
        },
        request: {
          id: 'approval-2',
          description: 'Approve second task',
          action: {toolCallId: 'tool-2', toolName: 'bash', toolArgs: {}},
          review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
          runtime: {runId: 'run-2', turn: 1, requestId: 'req-2', toolIndex: 0},
        },
      }),
      listReviewItems: () => [
        {
          reviewId: 'approval-1',
          source: 'agent_run',
          kind: 'approval',
          interactionMode: 'approval',
          blockingScope: 'task',
          description: 'Approve first task',
          toolName: 'bash',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          anchor: {origin: 'delegated'},
          isFocused: false,
        },
        {
          reviewId: 'approval-2',
          source: 'agent_run',
          kind: 'approval',
          interactionMode: 'approval',
          blockingScope: 'task',
          description: 'Approve second task',
          toolName: 'bash',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          anchor: {origin: 'delegated'},
          isFocused: true,
        },
      ],
      getAgentState: () => ({pendingPause: undefined}),
    } as never, undefined);

    expect(review).toEqual(expect.objectContaining({
      request: expect.objectContaining({id: 'approval-2'}),
      blockingScope: 'task',
      reviewIndex: 2,
      reviewCount: 2,
    }));
  });

  it('projects session pauses as session-blocking reviews', () => {
    const review = syncProjectedReview({
      getFocusedReview: () => ({
        item: {
          reviewId: 'foreground-pause',
          source: 'session_pause',
          kind: 'ask_user',
          interactionMode: 'hybrid',
          blockingScope: 'session',
          description: 'Need clarification',
          toolName: 'AskUserQuestion',
          createdAt: '2026-03-21T00:00:00.000Z',
          updatedAt: '2026-03-21T00:00:00.000Z',
          anchor: {origin: 'main'},
          isFocused: true,
        },
        request: {
          id: 'foreground-pause',
          description: 'Need clarification',
          action: {toolCallId: 'tool-3', toolName: 'AskUserQuestion', toolArgs: {}},
          review: {actionName: 'AskUserQuestion', allowedDecisions: ['approve']},
          runtime: {runId: 'run-3', turn: 1, requestId: 'req-3', toolIndex: 0},
          channel: 'interaction-center',
        },
      }),
      listReviewItems: () => [{
        reviewId: 'foreground-pause',
        source: 'session_pause',
        kind: 'ask_user',
        interactionMode: 'hybrid',
        blockingScope: 'session',
        description: 'Need clarification',
        toolName: 'AskUserQuestion',
        createdAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
        anchor: {origin: 'main'},
        isFocused: true,
      }],
      getAgentState: () => ({
        pendingPause: undefined,
      }),
    } as never, undefined);

    expect(review).toEqual(expect.objectContaining({
      request: expect.objectContaining({id: 'foreground-pause'}),
      blockingScope: 'session',
    }));
  });
});
