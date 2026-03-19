import {describe, expect, it} from 'bun:test';
import {
  claimNextCliHilAutoAction,
  shouldQueueCliHilAutoAction,
} from '@/cli/app/hil-auto-actions';
import type {CliHilAutoAction} from '@/cli/app/hil-review';
import type {CliHilReviewState} from '@/cli/app/view-state';

describe('CLI HIL auto actions helpers', () => {
  it('only queues auto actions for new pauses when idle and actions remain', () => {
    const review = createReview('pause-1');

    expect(shouldQueueCliHilAutoAction(undefined, false, 1, new Set())).toBe(false);
    expect(shouldQueueCliHilAutoAction(review, true, 1, new Set())).toBe(false);
    expect(shouldQueueCliHilAutoAction(review, false, 0, new Set())).toBe(false);
    expect(shouldQueueCliHilAutoAction(review, false, 1, new Set(['pause-1']))).toBe(false);
    expect(shouldQueueCliHilAutoAction(review, false, 1, new Set())).toBe(true);
  });

  it('claims each pause id once and consumes one action from the queue', () => {
    const actions: CliHilAutoAction[] = [{action: 'approve'}, {action: 'deny'}];
    const handled = new Set<string>();

    expect(claimNextCliHilAutoAction('pause-1', actions, handled)).toEqual({action: 'approve'});
    expect(actions).toEqual([{action: 'deny'}]);
    expect([...handled]).toEqual(['pause-1']);

    expect(claimNextCliHilAutoAction('pause-1', actions, handled)).toBeUndefined();
    expect(actions).toEqual([{action: 'deny'}]);
  });
});

function createReview(id: string): CliHilReviewState {
  return {
    request: {
      id,
      description: 'Resume the agent.',
      action: {
        toolCallId: `call-${id}`,
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: `run-${id}`,
        turn: 1,
        requestId: `req-${id}`,
        toolIndex: 0,
      },
      channel: 'interaction-center',
      ui: {
        actions: [{id: 'continue', label: 'Continue', kind: 'primary'}],
      },
    },
    actions: [{id: 'continue', label: 'Continue', kind: 'primary'}],
    selectedActionIndex: 0,
    focus: 'actions',
    draft: '',
    busy: false,
  };
}
