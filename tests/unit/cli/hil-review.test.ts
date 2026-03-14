import {describe, expect, it} from 'bun:test';
import {
  applyCliHilFormShortcut,
  prepareCliHilSubmission,
  syncCliHilReviewState,
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
        toolName: 'AskUser',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUser',
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

  it('should auto-advance to the next unanswered tab after choosing a single-select answer', () => {
    const review = createFormReview();

    const next = applyCliHilFormShortcut(review, '1');

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
});

function createFormReview(): CliHilReviewState {
  return {
    request: {
      id: 'pause-form',
      description: 'Collect missing requirements.',
      action: {
        toolCallId: 'call_form',
        toolName: 'AskUser',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUser',
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
