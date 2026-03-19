import {describe, expect, it} from 'bun:test';
import {AIMessageChunk} from '@langchain/core/messages';
import {runCliHilExecution} from '@/cli/app/hil-execution';
import type {CliHilReviewState, CliNotice, CliRunState} from '@/cli/app/view-state';

describe('CLI HIL execution helper', () => {
  it('skips when there is no review or execution is already running', async () => {
    const results = await Promise.all([
      runCliHilExecution({
        review: undefined,
        isRunning: false,
        setHilReview: () => {},
        setRunState: () => {},
        appendNotice: () => {},
        streamResumePause: async function* () {},
        appendResumeText: () => {},
        clearActiveTurn: () => {},
        refreshCoreState: async () => ({status: 'done'}),
        syncHilReviewFromPause: () => {},
        reportError: () => 'error',
      }),
      runCliHilExecution({
        review: createSimpleReview(),
        isRunning: true,
        setHilReview: () => {},
        setRunState: () => {},
        appendNotice: () => {},
        streamResumePause: async function* () {},
        appendResumeText: () => {},
        clearActiveTurn: () => {},
        refreshCoreState: async () => ({status: 'done'}),
        syncHilReviewFromPause: () => {},
        reportError: () => 'error',
      }),
    ]);

    expect(results).toEqual([{started: false}, {started: false}]);
  });

  it('keeps the review open when submission still needs more form input', async () => {
    const runStates: CliRunState[] = [];
    const reviews: Array<CliHilReviewState | undefined> = [];

    const result = await runCliHilExecution({
      review: createFormReview(),
      isRunning: false,
      setHilReview: (review) => {
        reviews.push(review);
      },
      setRunState: (state) => {
        runStates.push(state);
      },
      appendNotice: () => {},
      streamResumePause: async function* () {},
      appendResumeText: () => {},
      clearActiveTurn: () => {},
      refreshCoreState: async () => ({status: 'done'}),
      syncHilReviewFromPause: () => {},
      reportError: () => 'error',
    });

    expect(result).toEqual({started: true, pausedForMoreInput: true});
    expect(runStates).toEqual([{status: 'paused'}]);
    expect(reviews.at(-1)?.validationMessage).toContain('Complexity');
  });

  it('streams resume output and settles the run state after refresh', async () => {
    const runStates: CliRunState[] = [];
    const notices: Array<{level: CliNotice['level']; content: string}> = [];
    const streamed: string[] = [];
    const reviews: Array<CliHilReviewState | undefined> = [];
    const synced: unknown[] = [];

    const result = await runCliHilExecution({
      review: createSimpleReview(),
      isRunning: false,
      setHilReview: (review) => {
        reviews.push(review);
      },
      setRunState: (state) => {
        runStates.push(state);
      },
      appendNotice: (level, content) => {
        notices.push({level, content});
      },
      streamResumePause: async function* () {
        yield new AIMessageChunk({content: 'hi', text: 'hi'});
      },
      appendResumeText: (text) => {
        streamed.push(text);
      },
      clearActiveTurn: () => {
        streamed.push('<clear>');
      },
      refreshCoreState: async () => ({status: 'done', pendingPause: {id: 'pause-next'}}),
      syncHilReviewFromPause: (pendingPause) => {
        synced.push(pendingPause);
      },
      reportError: () => 'error',
    });

    expect(result).toEqual({started: true});
    expect(runStates).toEqual([{status: 'running'}, {status: 'done'}]);
    expect(notices).toEqual([{level: 'system', content: 'HIL action: Continue'}]);
    expect(streamed).toEqual(['hi', '<clear>']);
    expect(reviews[0]).toBeUndefined();
    expect(synced).toEqual([{id: 'pause-next'}]);
  });
});

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
      answers: {
        language: 'Python',
      },
    },
  };
}
