import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {HilPanel, isPermissionReview} from '@/cli/components/conversation/hil-panel';
import type {CliHilReviewState} from '@/cli/app/view-state';

describe('HilPanel', () => {
  it('prefers typed metadata when classifying permission reviews', () => {
    const review = createPermissionReview();

    expect(isPermissionReview(review)).toBe(true);

    const {lastFrame} = render(<HilPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Bash command');
    expect(frame).toContain('Do you want to proceed?');
  });

  it('renders permission reviews as plain text without the floating border chrome', () => {
    const review = createPermissionReview({
      action: {
        toolCallId: 'call-bash',
        toolName: 'bash',
        toolArgs: {
          command: 'mkdir -p\n/Users/nako/WebstormProjects/github/thefoxfairy/Codara/docs/superpowers/plans',
          description: 'Create plans directory',
        },
      },
      metadata: {
        codara: {interaction: {kind: 'permission'}},
        permissionPolicy: {
          reason: 'Writes to plans/',
          alwaysPatterns: ['Bash(plans/*)'],
        },
      },
    });

    const {lastFrame} = render(<HilPanel review={review} presentation="floating" />);
    const frame = lastFrame();

    expect(frame).toContain('Bash command');
    expect(frame).toContain('mkdir -p');
    expect(frame).toContain('/Users/nako/WebstormProjects/github/thefoxfairy/Codara/docs/superpowers/plans');
    expect(frame).toContain('Create plans directory');
    expect(frame).toContain('Do you want to proceed?');
    expect(frame).toContain('❯ 1. Yes');
    expect(frame).toContain('2. Yes, and always allow access to plans/ from this project');
    expect(frame).toContain('3. No');
    expect(frame).toContain('Esc cancel');
    expect(frame).not.toContain('Permission Review');
    expect(frame).not.toContain('y allow');
    expect(frame).not.toContain('╭');
  });

  it('shows approval queue context only when more than one approval is waiting', () => {
    const review = createPermissionReview({
      approvalIndex: 2,
      approvalCount: 5,
    });

    const {lastFrame} = render(<HilPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Approval 2/5');
    expect(frame).toContain('Use [ and ] to switch approvals');
  });

  it('renders AskUser steps without exposing submit actions in the numbered list early', () => {
    const review = createAskUserReview();

    const {lastFrame} = render(<HilPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Spec Source');
    expect(frame).toContain('Where are the requirements?');
    expect(frame).toContain('1. Existing spec file');
    expect(frame).not.toContain('3. Submit');
    expect(frame).not.toContain('4. Chat about this');
    expect(frame).toContain('Choose one or type your own answer.');
  });

  it('renders AskUser submit actions only on the final submit step', () => {
    const review = createAskUserReview({
      focus: 'actions',
      form: {
        ...createAskUserReview().form!,
        endStep: true,
      },
    });

    const {lastFrame} = render(<HilPanel review={review} presentation="floating" />);
    const frame = lastFrame();

    expect(frame).toContain('Ask User');
    expect(frame).toContain('[Submit]');
    expect(frame).toContain('[Chat about this]');
    expect(frame).toContain('Enter submit');
  });
});

function createPermissionReview(overrides: Partial<CliHilReviewState['request']> & Partial<CliHilReviewState> = {}): CliHilReviewState {
  const request = {
    id: 'pause-permission',
    description: 'Permission review required for bash.',
    action: {
      toolCallId: 'call-bash',
      toolName: 'bash',
      toolArgs: {command: 'git push'},
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
    metadata: {
      codara: {
        interaction: {
          kind: 'permission',
        },
      },
    },
    ui: {
      actions: [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'dont_ask_again', label: 'Allow always', kind: 'secondary'},
        {id: 'deny', label: 'Deny', kind: 'danger'},
      ],
    },
    ...(overrides as Partial<CliHilReviewState['request']>),
  };

  return {
    request,
    actions: [
      {id: 'allow_once', label: 'Allow once', kind: 'primary'},
      {id: 'dont_ask_again', label: 'Allow always', kind: 'secondary'},
      {id: 'deny', label: 'Deny', kind: 'danger'},
    ],
    selectedActionIndex: 0,
    focus: 'actions',
    draft: '',
    busy: false,
    ...('actions' in overrides ? {actions: overrides.actions as CliHilReviewState['actions']} : {}),
    ...('selectedActionIndex' in overrides ? {selectedActionIndex: overrides.selectedActionIndex as number} : {}),
    ...('approvalIndex' in overrides ? {approvalIndex: overrides.approvalIndex as number} : {}),
    ...('approvalCount' in overrides ? {approvalCount: overrides.approvalCount as number} : {}),
  };
}

function createAskUserReview(overrides: Partial<CliHilReviewState> = {}): CliHilReviewState {
  const form = {
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
  };

  return {
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
          tabs: form.tabs,
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
    form,
    ...overrides,
  };
}
