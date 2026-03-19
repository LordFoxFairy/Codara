import {describe, expect, it} from 'bun:test';
import {createCliHilReviewControls} from '@/cli/app/hil-review-controls';
import type {CliHilAutoAction} from '@/cli/app/hil-review';
import type {CliHilReviewState} from '@/cli/app/view-state';

describe('CLI HIL review controls', () => {
  it('uses form shortcuts before falling back to free text input', () => {
    let review: CliHilReviewState | undefined = createFormReview();
    const submitted: CliHilAutoAction[] = [];
    const controls = createControls({
      getReview: () => review,
      setReview: (next) => {
        review = next;
      },
      submitHilAction: (action) => {
        if (action) {
          submitted.push(action);
        }
      },
    });

    controls.insertHilText('1');
    expect(review?.form?.answers.language).toBe('Python');
    expect(review?.form?.activeTabIndex).toBe(1);

    review = {
      ...review!,
      focus: 'input',
    };
    controls.insertHilText('x');
    expect(review?.draft.endsWith('x')).toBe(true);
    expect(submitted).toEqual([]);
  });

  it('moves between form tabs and toggles focus when no form exists', () => {
    let review: CliHilReviewState | undefined = createFormReview();
    const controls = createControls({
      getReview: () => review,
      setReview: (next) => {
        review = next;
      },
      submitHilAction: () => {},
    });

    controls.moveHilRight();
    expect(review?.form?.activeTabIndex).toBe(1);

    review = createSimpleReview();
    controls.moveHilLeft();
    expect(review?.focus).toBe('input');
  });

  it('routes quick actions through permission stages before submitting', () => {
    let review: CliHilReviewState | undefined = {
      ...createPermissionReview(),
      permissionStage: 'prompt',
    };
    const submitted: CliHilAutoAction[] = [];
    const controls = createControls({
      getReview: () => review,
      setReview: (next) => {
        review = next;
      },
      submitHilAction: (action) => {
        if (action) {
          submitted.push(action);
        }
      },
    });

    controls.quickHilAction('dont_ask_again');
    expect(review?.permissionStage).toBe('always-confirm');

    controls.quickHilAction('deny');
    expect(review?.permissionStage).toBe('reject-feedback');

    controls.quickHilAction('allow_once');
    expect(submitted).toEqual([{action: 'allow_once'}]);
  });

  it('uses the current draft when sending permission rejection feedback', () => {
    let review: CliHilReviewState | undefined = {
      ...createPermissionReview(),
      draft: '  explain why  ',
      permissionStage: 'reject-feedback',
    };
    const submitted: CliHilAutoAction[] = [];
    const controls = createControls({
      getReview: () => review,
      setReview: (next) => {
        review = next;
      },
      submitHilAction: (action) => {
        if (action) {
          submitted.push(action);
        }
      },
    });

    controls.permissionRejectSend();
    controls.permissionRejectSilent();

    expect(submitted).toEqual([
      {action: 'deny', comment: 'explain why'},
      {action: 'deny'},
    ]);
  });
});

function createControls(input: {
  getReview: () => CliHilReviewState | undefined;
  setReview: (review: CliHilReviewState | undefined) => void;
  submitHilAction: (action?: CliHilAutoAction) => void;
}) {
  return createCliHilReviewControls({
    setHilReview: (updater) => {
      input.setReview(updater(input.getReview()));
    },
    getCurrentReview: input.getReview,
    submitHilAction: input.submitHilAction,
  });
}

function createSimpleReview(): CliHilReviewState {
  return {
    request: {
      id: 'pause-simple',
      description: 'Resume the agent.',
      action: {
        toolCallId: 'call_simple',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-simple',
        turn: 1,
        requestId: 'req-simple',
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
    },
  };
}

function createPermissionReview(): CliHilReviewState {
  return {
    request: {
      id: 'pause-permission',
      description: 'Review tool permissions.',
      action: {
        toolCallId: 'call_permission',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
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
        modal: 'permission-review',
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
  };
}
