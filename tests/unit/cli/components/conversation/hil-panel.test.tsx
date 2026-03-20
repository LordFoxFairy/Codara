import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {HilPanel} from '@/cli/components/conversation/hil-panel';
import type {CliHilReviewState} from '@/cli/app/view-state';

describe('HilPanel approval queue banner', () => {
  it('should show approval position and queue-switch hint', () => {
    const review = {
      request: {
        id: 'pause-2',
        description: 'Permission review required for git push.',
        action: {
          toolCallId: 'call-2',
          toolName: 'bash',
          toolArgs: {command: 'git push'},
        },
        review: {
          actionName: 'bash',
          allowedDecisions: ['approve', 'reject'],
        },
        runtime: {
          runId: 'run-2',
          turn: 4,
          requestId: 'req-2',
          toolIndex: 0,
        },
        channel: 'permission-center',
        ui: {
          actions: [
            {id: 'allow_once', label: 'Allow once', kind: 'primary'},
            {id: 'deny', label: 'Deny', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'deny', label: 'Deny', kind: 'danger'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
      approvalIndex: 2,
      approvalCount: 5,
    } satisfies CliHilReviewState;

    const {lastFrame} = render(<HilPanel review={review} />);

    expect(lastFrame()).toContain('Approval 2/5');
    expect(lastFrame()).toContain('Use [ and ] to switch approvals');
    expect(lastFrame()).toContain('Permission review required for git push.');
  });
});
