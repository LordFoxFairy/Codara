import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {ReviewPanel} from '@/cli/components/conversation/review-panel';
import type {CliReviewState} from '@/cli/app/view-state';

describe('ReviewPanel review queue banner', () => {
  it('should show review position and queue-switch hint', () => {
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
      blockingScope: 'task',
      reviewIndex: 2,
      reviewCount: 5,
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);

    expect(lastFrame()).toContain('Review 2/5');
    expect(lastFrame()).toContain('Use [ and ] to switch reviews');
    expect(lastFrame()).toContain('Permission review required for git push.');
  });

  it('separates AskUser tabs from actions and keeps submit out of the numbered options list', () => {
    const review = {
      request: {
        id: 'pause-form',
        description: 'Collect requirements.',
        action: {
          toolCallId: 'call-form',
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
                id: 'spec_source',
                label: 'Spec Source',
                question: 'Where are the requirements?',
                options: [
                  {id: 'file', label: 'Existing spec file', description: 'I already have a spec document.'},
                  {id: 'describe', label: "I'll describe it", description: 'I will describe the work in chat.'},
                ],
              },
              {
                id: 'feature_name',
                label: 'Feature Name',
                question: 'What is the feature name?',
                options: [
                  {id: 'sync', label: 'Sync flow'},
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
      blockingScope: 'session',
      form: {
        tabs: [
          {
            id: 'spec_source',
            label: 'Spec Source',
            question: 'Where are the requirements?',
            options: [
              {id: 'file', label: 'Existing spec file', description: 'I already have a spec document.'},
              {id: 'describe', label: "I'll describe it", description: 'I will describe the work in chat.'},
            ],
          },
          {
            id: 'feature_name',
            label: 'Feature Name',
            question: 'What is the feature name?',
            options: [
              {id: 'sync', label: 'Sync flow'},
            ],
          },
        ],
        activeTabIndex: 0,
        answers: {},
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Spec Source');
    expect(frame).toContain('☐ Spec Source');
    expect(frame).toContain('☐ Feature Name');
    expect(frame).toContain('✔ Submit');
    expect(frame).not.toContain('✓Submit');
    expect(frame).not.toContain('3. Submit');
    expect(frame).not.toContain('4. Chat about this');
    expect(frame).not.toContain('Actions');
    expect(frame).not.toContain('[Submit]');
    expect(frame).not.toContain('[Chat about this]');
    expect(frame).not.toContain('Answer');
    expect(frame).toContain('Choose one or type your own answer.');
  });

  it('renders a selectable next footer on question steps without exposing submit actions early', () => {
    const review = {
      ...createAskUserReview(),
      focus: 'actions' as const,
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} presentation="floating" />);
    const frame = lastFrame();

    expect(frame).toContain('[Next]');
    expect(frame).not.toContain('[Submit]');
    expect(frame).not.toContain('[Chat about this]');
    expect(frame).not.toContain('Enter submit');
  });

  it('renders floating AskUser reviews as a titled window with action bar copy', () => {
    const review = {
      ...createAskUserReview(),
      focus: 'actions',
      form: {
        ...createAskUserReview().form!,
        endStep: true,
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} presentation="floating" />);
    const frame = lastFrame();

    expect(frame).toContain('Ask User');
    expect(frame).toContain('Enter submit');
    expect(frame).not.toContain('Actions');
    expect(frame).toContain('✔ Submit');
    expect(frame).toContain('[Submit]');
    expect(frame).toContain('╭');
    expect(frame).toContain('╰');
  });

  it('shows explicit selection hints before AskUser focus reaches the actions bar', () => {
    const review = {
      request: {
        id: 'pause-form-hint',
        description: 'Collect requirements.',
        action: {
          toolCallId: 'call-form-hint',
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
            tabs: [{
              id: 'spec_source',
              label: 'Spec Source',
              question: 'Where are the requirements?',
              options: [{id: 'file', label: 'Existing spec file'}],
            }],
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
      blockingScope: 'session',
      form: {
        tabs: [{
          id: 'spec_source',
          label: 'Spec Source',
          question: 'Where are the requirements?',
          options: [{id: 'file', label: 'Existing spec file'}],
        }],
        activeTabIndex: 0,
        answers: {},
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} presentation="floating" />);
    const frame = lastFrame();

    expect(frame).toContain('Space select');
    expect(frame).toContain('Enter next');
    expect(frame).not.toContain('Enter submit');
    expect(frame).not.toContain('Actions');
    expect(frame).not.toContain('Answer');
  });

  it('renders select tabs with radio markers and multiselect tabs with checkboxes', () => {
    const {lastFrame: singleFrame} = render(<ReviewPanel review={createAskUserReview({input: 'select'})} presentation="floating" />);
    const {lastFrame: multiFrame} = render(<ReviewPanel review={createAskUserReview({input: 'multiselect'})} presentation="floating" />);

    expect(singleFrame()).toContain('( ) 1. Existing spec file');
    expect(multiFrame()).toContain('[ ] 1. Existing spec file');
  });

  it('collapses long AskUser tab headers into a compact step navigator', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      tabs: [
        {id: 'p1', label: '需求来源优先级', question: 'Q1', options: [{id: 'a', label: 'A'}]},
        {id: 'p2', label: '功能名称', question: 'Q2', options: [{id: 'b', label: 'B'}]},
        {id: 'p3', label: '功能描述', question: 'Q3', options: [{id: 'c', label: 'C'}]},
        {id: 'p4', label: '涉及范围', question: 'Q4', options: [{id: 'd', label: 'D'}]},
        {id: 'p5', label: '技术难度', question: 'Q5', options: [{id: 'e', label: 'E'}]},
      ],
      activeTabIndex: 2,
    })} presentation="floating" />);

    const frame = lastFrame();

    expect(frame).toContain('☐ 功能描述');
    expect(frame).toContain('功能描述');
    expect(frame).toContain('☐ 技术难度');
    expect(frame).toContain('✔ Submit');
  });
});

function createAskUserReview(
  options: {
    input?: 'select' | 'multiselect';
    tabs?: Array<{id: string; label: string; question: string; options: Array<{id: string; label: string}>}>;
    activeTabIndex?: number;
    endStep?: boolean;
  } = {},
): CliReviewState {
  const tabs = options.tabs ?? [{
    id: 'spec_source',
    label: 'Spec Source',
    question: 'Where are the requirements?',
    options: [{id: 'file', label: 'Existing spec file'}],
    input: options.input ?? 'select',
  }];

  return {
    request: {
      id: 'pause-form-hint',
      description: 'Collect requirements.',
      action: {
        toolCallId: 'call-form-hint',
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
          tabs,
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
    blockingScope: 'session',
    form: {
      tabs,
      activeTabIndex: options.activeTabIndex ?? 0,
      answers: {},
      endStep: options.endStep ?? false,
    },
  };
}
