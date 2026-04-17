import {describe, expect, it} from 'bun:test';
import {
  activateCliReviewFocusedSelection,
  applyCliReviewFormShortcut,
  confirmCliReviewFocusedSelection,
  prepareCliReviewDraftInput,
  prepareCliReviewSubmission,
  selectNextCliReviewAction,
  selectPreviousCliReviewAction,
  syncCliReviewState,
  toggleCliReviewFocus,
  updateCliReviewDraft,
  type CliReviewAutoAction,
} from '../../../src/cli/features/review/state-core';
import type {CliReviewState} from '../../../src/cli/app/view-state';

describe('cli review helpers', () => {
  it('should default AskUser forms to input focus', () => {
    const review = syncCliReviewState(undefined, {
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
    const review = syncCliReviewState(undefined, {
      id: 'pause-placeholder',
      description: 'Collect output format.',
      action: {
        toolCallId: 'call_placeholder',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-placeholder',
        turn: 1,
        requestId: 'req-placeholder',
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

  it('should route placeholder-backed AskUser typing into the custom answer path', () => {
    const review = syncCliReviewState(undefined, {
      id: 'pause-placeholder-draft',
      description: 'Collect output format.',
      action: {
        toolCallId: 'call_placeholder_draft',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-placeholder-draft',
        turn: 1,
        requestId: 'req-placeholder-draft',
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
    }) as CliReviewState;

    const selectedCustom = applyCliReviewFormShortcut(review as CliReviewState, '2') as CliReviewState;
    const prepared = prepareCliReviewDraftInput(selectedCustom) as CliReviewState;

    expect(prepared.selectedActionIndex).toBe(1);
    expect(prepared.customInputActive).toBe(true);
  });

  it('should require the custom row before entering free-text AskUser editing on select tabs', () => {
    const prepared = prepareCliReviewDraftInput(createFormReview());

    expect(prepared).toBeUndefined();
  });

  it('should keep single-select answers on the current tab until the user explicitly confirms next', () => {
    const review = createFormReview();

    const next = applyCliReviewFormShortcut(review, '1');

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(0);
    expect(next?.draft).toBe('Python');
    expect(next?.customInputActive).toBe(false);
  });

  it('should activate the currently highlighted option without advancing tabs', () => {
    const review = createFormReview();

    const next = activateCliReviewFocusedSelection(review);

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(0);
    expect(next?.draft).toBe('Python');
  });

  it('should move multiselect focus to the chosen preset option after selecting it from a custom answer state', () => {
    const review = {
      ...createMultiselectReview(),
      selectedActionIndex: 3,
      draft: '独立开发者',
      customInputActive: true,
      form: {
        ...createMultiselectReview().form!,
        answers: {
          audience: ['独立开发者'],
        },
      },
    } satisfies CliReviewState;

    const next = applyCliReviewFormShortcut(review, '2');

    expect(next?.selectedActionIndex).toBe(1);
    expect(next?.customInputActive).toBe(false);
    expect(next?.form?.answers).toEqual({
      audience: ['独立开发者', '团队/企业'],
    });
  });

  it('should start multiselect custom editing with an empty draft instead of reusing the preset summary', () => {
    const review = {
      ...createMultiselectReview(),
      form: {
        ...createMultiselectReview().form!,
        answers: {
          audience: ['独立开发者'],
        },
      },
      draft: '独立开发者',
    } satisfies CliReviewState;

    const next = applyCliReviewFormShortcut(review, '4');

    expect(next?.selectedActionIndex).toBe(3);
    expect(next?.customInputActive).toBe(true);
    expect(next?.draft).toBe('');
    expect(next?.form?.answers).toEqual({
      audience: ['独立开发者'],
    });
  });

  it('should preserve multiselect preset answers while editing a custom answer', () => {
    const review = {
      ...createMultiselectReview(),
      selectedActionIndex: 3,
      customInputActive: true,
      form: {
        ...createMultiselectReview().form!,
        answers: {
          audience: ['独立开发者'],
        },
      },
    } satisfies CliReviewState;

    const next = updateCliReviewDraft(review, '非程序员创作者');

    expect(next.form?.answers).toEqual({
      audience: ['独立开发者', '非程序员创作者'],
    });
    expect(next.draft).toBe('非程序员创作者');
    expect(next.customInputActive).toBe(true);
  });

  it('should keep the multiselect custom row selected even before any custom text is entered', () => {
    const review = createMultiselectReview();

    const next = applyCliReviewFormShortcut(review, '4');

    expect(next?.selectedActionIndex).toBe(3);
    expect(next?.customInputActive).toBe(true);
    expect(next?.customInputSelected).toBe(true);
    expect(next?.draft).toBe('');
    expect(next?.form?.answers).toEqual({});
  });

  it('should replace a custom single-select answer when navigation moves back onto a preset option', () => {
    const review = {
      ...createFormReview(),
      selectedActionIndex: 2,
      draft: 'adaDA',
      customInputActive: true,
      form: {
        ...createFormReview().form!,
        answers: {
          language: 'adaDA',
        },
      },
    } satisfies CliReviewState;

    const next = selectPreviousCliReviewAction(review);

    expect(next.selectedActionIndex).toBe(1);
    expect(next.customInputActive).toBe(false);
    expect(next.form?.answers).toEqual({
      language: 'Node.js',
    });
  });

  it('should enter custom text editing when Type something is activated', () => {
    const review = {
      ...createFormReview(),
      selectedActionIndex: 2,
    };

    const next = activateCliReviewFocusedSelection(review);

    expect(next?.customInputActive).toBe(true);
    expect(next?.selectedActionIndex).toBe(2);
    expect(next?.form?.answers).toEqual({});
  });

  it('should advance to the next unanswered tab only after explicit confirmation', () => {
    const review = activateCliReviewFocusedSelection(createFormReview()) as CliReviewState;

    const next = confirmCliReviewFocusedSelection(review);

    expect(next?.form?.answers).toEqual({language: 'Python'});
    expect(next?.form?.activeTabIndex).toBe(1);
    expect(next?.draft).toBe('');
  });

  it('should keep question-step submission on the current tab until the user reaches the final submit page', () => {
    const review = applyCliReviewFormShortcut(createFormReview(), '1') as CliReviewState;

    const prepared = prepareCliReviewSubmission(review);

    expect(prepared.payload).toBeUndefined();
    expect(prepared.review.focus).toBe('input');
    expect(prepared.review.form?.activeTabIndex).toBe(0);
    expect(prepared.review.validationMessage).toBeUndefined();
  });

  it('should not submit directly from question-step input focus even after moving to a later tab', () => {
    const review = createFormReview();
    const progressed = confirmCliReviewFocusedSelection(
      activateCliReviewFocusedSelection(review) as CliReviewState,
    ) as CliReviewState;
    const prepared = prepareCliReviewSubmission(progressed);

    expect(prepared.payload).toBeUndefined();
    expect(prepared.review.form?.activeTabIndex).toBe(1);
    expect(prepared.review.validationMessage).toBeUndefined();
  });

  it('should focus the explicit submit action after completing the final AskUser tab', () => {
    const first = confirmCliReviewFocusedSelection(
      activateCliReviewFocusedSelection(createFormReview()) as CliReviewState,
    ) as CliReviewState;
    const second = confirmCliReviewFocusedSelection(
      activateCliReviewFocusedSelection(first) as CliReviewState,
    ) as CliReviewState;

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

    const next = toggleCliReviewFocus(review);

    expect(next.focus).toBe('actions');
    expect(next.form?.endStep).toBe(false);
    expect(next.selectedActionIndex).toBe(0);
  });

  it('should keep unanswered question steps on the current tab and surface validation when Next is activated', () => {
    const review = toggleCliReviewFocus(createFormReview());

    const prepared = prepareCliReviewSubmission(review);

    expect(prepared.payload).toBeUndefined();
    expect(prepared.review.focus).toBe('actions');
    expect(prepared.review.form?.activeTabIndex).toBe(0);
    expect(prepared.review.validationMessage).toBe('Complete Language before continuing.');
  });

  it('should let arrow navigation reach the Next footer from the option list on question pages', () => {
    const review = selectNextCliReviewAction(
      selectNextCliReviewAction(
        selectNextCliReviewAction(createFormReview()),
      ),
    );

    expect(review.focus).toBe('actions');
    expect(review.selectedActionIndex).toBe(0);
    expect(review.form?.endStep).toBe(false);
  });

  it('should let arrow navigation move back from the Next footer into the option list', () => {
    const review = selectPreviousCliReviewAction({
      ...createFormReview(),
      focus: 'actions',
      selectedActionIndex: 0,
    });

    expect(review.focus).toBe('input');
    expect(review.selectedActionIndex).toBe(2);
    expect(review.form?.endStep).toBe(false);
  });

  it('should allow auto actions to supply form answers before submit', () => {
    const review = createFormReview();
    const autoAction: CliReviewAutoAction = {
      action: 'submit',
      answers: {
        language: 'Python',
        complexity: 'Simple',
      },
    };

    const prepared = prepareCliReviewSubmission(review, autoAction);

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

  it('should preserve review position metadata when the same pause is resynced', () => {
    const review: CliReviewState = {
      ...createFormReview(),
      reviewIndex: 2,
      reviewCount: 3,
    };

    const synced = syncCliReviewState(review, review.request);

    expect(synced?.reviewIndex).toBe(2);
    expect(synced?.reviewCount).toBe(3);
  });

  it('should map permission allow_tool auto actions to approve resumes', () => {
    const review: CliReviewState = {
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
      blockingScope: 'task',
    };

    const prepared = prepareCliReviewSubmission(review, {action: 'allow_tool'});

    expect(prepared.payload).toMatchObject({
      action: 'allow_tool',
      scope: 'tool',
    });
  });
});

function createFormReview(): CliReviewState {
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
            {id: 'cancel', label: 'Cancel', kind: 'secondary'},
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
    blockingScope: 'session',
    actions: [
      {id: 'submit', label: 'Submit', kind: 'primary'},
      {id: 'cancel', label: 'Cancel', kind: 'secondary'},
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

function createMultiselectReview(): CliReviewState {
  return {
    request: {
      id: 'pause-multi',
      description: 'Collect target audience.',
      action: {
        toolCallId: 'call_multi',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-multi',
        turn: 1,
        requestId: 'req-multi',
        toolIndex: 0,
      },
      channel: 'interaction-center',
      ui: {
        actions: [
          {id: 'submit', label: 'Submit', kind: 'primary'},
          {id: 'cancel', label: 'Cancel', kind: 'secondary'},
        ],
        form: {
          tabs: [
            {
              id: 'audience',
              label: 'Audience',
              question: 'Who is this for?',
              input: 'multiselect',
              options: [
                {id: 'solo', label: '独立开发者'},
                {id: 'team', label: '团队/企业'},
                {id: 'non-tech', label: '非技术用户'},
              ],
            },
          ],
        },
      },
    },
    blockingScope: 'session',
    actions: [
      {id: 'submit', label: 'Submit', kind: 'primary'},
      {id: 'cancel', label: 'Cancel', kind: 'secondary'},
    ],
    selectedActionIndex: 0,
    focus: 'input',
    draft: '',
    busy: false,
    customInputActive: false,
    form: {
      tabs: [
        {
          id: 'audience',
          label: 'Audience',
          question: 'Who is this for?',
          input: 'multiselect',
          options: [
            {id: 'solo', label: '独立开发者'},
            {id: 'team', label: '团队/企业'},
            {id: 'non-tech', label: '非技术用户'},
          ],
        },
      ],
      activeTabIndex: 0,
      answers: {},
      endStep: false,
    },
  };
}
