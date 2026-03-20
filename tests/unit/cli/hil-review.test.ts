import {describe, expect, it} from 'bun:test';
import {
  activateCliHilFocusedSelection,
  applyCliHilFormShortcut,
  confirmCliHilFocusedSelection,
  prepareCliHilDraftInput,
  prepareCliHilSubmission,
  syncCliHilReviewState,
  toggleCliHilFocus,
  type CliHilAutoAction,
} from '../../../src/cli/app/hil-review';
import type {CliHilReviewState} from '../../../src/cli/app/view-state';

describe('cli hil review helpers', () => {
  it('should default AskUser forms to input focus', () => {
    const review = syncCliHilReviewState(undefined, {
      id: 'pause-1',
      description: 'Collect details',
      action: {
        toolCallId: 'call_1',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-1',
        turn: 1,
        requestId: 'req-1',
        toolIndex: 0,
      },
      ui: {
        actions: [{id: 'submit', label: 'Submit', kind: 'primary'}],
        form: {
          tabs: [
            {
              id: 'language',
              label: 'Language',
              question: 'Which language?',
              options: [{id: 'python', label: 'Python'}],
            },
          ],
        },
      },
    });

    expect(review?.focus).toBe('input');
    expect(review?.form?.tabs[0]?.input).toBe('select');
  });

  it('should default option tabs with placeholders to select when no explicit input is provided', () => {
    const review = syncCliHilReviewState(undefined, {
      id: 'pause-mixed',
      description: 'Collect output format.',
      action: {
        toolCallId: 'call_mixed',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-mixed',
        turn: 1,
        requestId: 'req-mixed',
        toolIndex: 0,
      },
      ui: {
        actions: [{id: 'submit', label: 'Submit', kind: 'primary'}],
        form: {
          tabs: [
            {
              id: 'format',
              label: 'Output Format',
              question: 'How should the result be delivered?',
              options: [{id: 'doc', label: 'Markdown Doc'}],
              placeholder: 'Type your own output format.',
            },
          ],
        },
      },
    });

    expect(review?.form?.tabs[0]?.input).toBe('select');
  });

  it('should route mixed AskUser typing into the custom placeholder path', () => {
    const review = syncCliHilReviewState(undefined, {
      id: 'pause-mixed-draft',
      description: 'Collect output format.',
      action: {
        toolCallId: 'call_mixed_draft',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-mixed-draft',
        turn: 1,
        requestId: 'req-mixed-draft',
        toolIndex: 0,
      },
      ui: {
        actions: [{id: 'submit', label: 'Submit', kind: 'primary'}],
        form: {
          tabs: [
            {
              id: 'format',
              label: 'Output Format',
              question: 'How should the result be delivered?',
              input: 'mixed',
              options: [{id: 'doc', label: 'Markdown Doc'}],
              placeholder: 'Type your own output format.',
            },
          ],
        },
      },
    }) as CliHilReviewState;

    const prepared = prepareCliHilDraftInput(review) as CliHilReviewState;

    expect(prepared.selectedActionIndex).toBe(0);
  });

  it('should allow free-text AskUser input even on plain select tabs', () => {
    const prepared = prepareCliHilDraftInput(createFormReview());

    expect(prepared).toBeDefined();
    expect(prepared?.selectedActionIndex).toBe(0);
  });

  it('should keep single-select answers on the current tab until the user explicitly confirms next', () => {
    const review = createFormReview();

    const next = applyCliHilFormShortcut(review, '1');

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(0);
    expect(next?.draft).toBe('Python');
  });

  it('should activate the currently highlighted option without advancing tabs', () => {
    const review = createFormReview();

    const next = activateCliHilFocusedSelection(review);

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(0);
    expect(next?.draft).toBe('Python');
  });

  it('should advance to the next unanswered tab only after explicit confirmation', () => {
    const review = activateCliHilFocusedSelection(createFormReview()) as CliHilReviewState;

    const next = confirmCliHilFocusedSelection(review);

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(1);
    expect(next?.draft).toBe('');
  });

  it('should block submit until every form tab has an answer', () => {
    const review = applyCliHilFormShortcut(createFormReview(), '1') as CliHilReviewState;

    const prepared = prepareCliHilSubmission(review);

    expect(prepared.payload).toBeUndefined();
    expect(prepared.review.focus).toBe('input');
    expect(prepared.review.form?.activeTabIndex).toBe(1);
    expect(prepared.review.validationMessage).toContain('Complexity');
  });

  it('should not submit directly from option focus before all tabs are complete', () => {
    const review = createFormReview();
    const progressed = confirmCliHilFocusedSelection(
      activateCliHilFocusedSelection(review) as CliHilReviewState,
    ) as CliHilReviewState;
    const prepared = prepareCliHilSubmission(progressed);

    expect(prepared.payload).toBeUndefined();
    expect(prepared.review.form?.activeTabIndex).toBe(1);
    expect(prepared.review.validationMessage).toContain('Complexity');
  });

  it('should focus the explicit submit action after completing the final AskUser tab', () => {
    const first = confirmCliHilFocusedSelection(
      activateCliHilFocusedSelection(createFormReview()) as CliHilReviewState,
    ) as CliHilReviewState;
    const second = confirmCliHilFocusedSelection(
      activateCliHilFocusedSelection(first) as CliHilReviewState,
    ) as CliHilReviewState;

    expect(second.form?.answers).toEqual({
      language: 'Python',
      complexity: 'Simple',
    });
    expect(second.form?.endStep).toBe(true);
    expect(second.focus).toBe('actions');
    expect(second.selectedActionIndex).toBe(0);
  });

  it('should let question steps focus a dedicated next footer before the final submit step', () => {
    const review = createFormReview();

    const next = toggleCliHilFocus(review);

    expect(next.focus).toBe('actions');
    expect(next.form?.endStep).toBe(false);
    expect(next.selectedActionIndex).toBe(0);
  });

  it('should allow auto actions to supply form answers before submit', () => {
    const review = createFormReview();
    const autoAction: CliHilAutoAction = {
      action: 'submit',
      answers: {
        language: 'Python',
        complexity: 'Simple',
      },
    };

    const prepared = prepareCliHilSubmission(review, autoAction);

    expect(prepared.review.form?.answers).toEqual({
      language: 'Python',
      complexity: 'Simple',
    });
    expect(prepared.payload).toMatchObject({
      action: 'submit',
      metadata: {
        form: {
          answers: {
            language: 'Python',
            complexity: 'Simple',
          },
        },
      },
    });
  });

  it('should preserve approval position metadata when the same pause is resynced', () => {
    const review: CliHilReviewState = {
      ...createFormReview(),
      approvalIndex: 2,
      approvalCount: 3,
    };

    const synced = syncCliHilReviewState(review, review.request);

    expect(synced?.approvalIndex).toBe(2);
    expect(synced?.approvalCount).toBe(3);
  });

  it('should map permission allow_tool auto actions to approve resumes', () => {
    const review: CliHilReviewState = {
      request: {
        id: 'pause-permission',
        description: 'Permission review required for Bash(cd ./tmp/repo && git fetch origin && git push origin main)',
        action: {
          toolCallId: 'call_permission',
          toolName: 'bash',
          toolArgs: {command: 'cd ./tmp/repo && git fetch origin && git push origin main'},
        },
        review: {
          actionName: 'bash',
          allowedDecisions: ['approve', 'reject'],
        },
        runtime: {
          runId: 'run-permission',
          turn: 1,
          requestId: 'req-permission',
          toolIndex: 0,
        },
        channel: 'permission-center',
        ui: {
          actions: [
            {id: 'allow_once', label: 'Allow once', kind: 'primary'},
            {id: 'allow_tool', label: 'Yes, and allow git commands in this project', kind: 'secondary', scope: 'tool'},
            {id: 'deny', label: 'Deny', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'allow_tool', label: 'Yes, and allow git commands in this project', kind: 'secondary', scope: 'tool'},
        {id: 'deny', label: 'Deny', kind: 'danger'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
    };

    const prepared = prepareCliHilSubmission(review, {action: 'allow_tool'});

    expect(prepared.payload).toMatchObject({
      action: 'allow_tool',
      scope: 'tool',
    });
  });
});

function createFormReview(): CliHilReviewState {
  return {
    request: {
      id: 'pause-form',
      description: 'Collect missing requirements.',
      action: {
        toolCallId: 'call_form',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-form',
        turn: 1,
        requestId: 'req-form',
        toolIndex: 0,
      },
      channel: 'interaction-center',
      ui: {
        actions: [
          {id: 'submit', label: 'Submit', kind: 'primary'},
          {id: 'chat', label: 'Chat about this', kind: 'secondary'},
        ],
        form: {
          tabs: [
            {
              id: 'language',
              label: 'Language',
              question: 'Which language?',
              input: 'select',
              options: [
                {id: 'python', label: 'Python'},
                {id: 'node', label: 'Node.js'},
              ],
            },
            {
              id: 'complexity',
              label: 'Complexity',
              question: 'How much complexity?',
              input: 'select',
              options: [
                {id: 'simple', label: 'Simple'},
                {id: 'standard', label: 'Standard'},
              ],
            },
          ],
        },
      },
    },
    actions: [
      {id: 'submit', label: 'Submit', kind: 'primary'},
      {id: 'chat', label: 'Chat about this', kind: 'secondary'},
    ],
    selectedActionIndex: 0,
    focus: 'input',
    draft: '',
    busy: false,
    form: {
      tabs: [
        {
          id: 'language',
          label: 'Language',
          question: 'Which language?',
          input: 'select',
          options: [
            {id: 'python', label: 'Python'},
            {id: 'node', label: 'Node.js'},
          ],
        },
        {
          id: 'complexity',
          label: 'Complexity',
          question: 'How much complexity?',
          input: 'select',
          options: [
            {id: 'simple', label: 'Simple'},
            {id: 'standard', label: 'Standard'},
          ],
        },
      ],
      activeTabIndex: 0,
      answers: {},
      endStep: false,
    },
  };
}
