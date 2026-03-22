import {describe, expect, it} from 'bun:test';
import {
  isFloatingReview,
  shouldShowFloatingSubagentRunPanel,
  resolveCliForegroundSurface,
  shouldShowActivityLine,
  shouldDisablePromptInput,
  shouldShowSubagentRunPanel,
  shouldShowPromptFrame,
} from '../../../src/cli/app/shell-app';
import type {CliReviewState} from '../../../src/cli/app/view-state';
import type {TranscriptItem} from '../../../src/cli/transcript/model';

describe('CLI foreground surface', () => {
  it('should keep the transcript foreground when a review is active', () => {
    expect(resolveCliForegroundSurface({hasReview: true, hasConversation: true})).toBe('transcript');
  });

  it('should show the transcript when conversation exists and no review is active', () => {
    expect(resolveCliForegroundSurface({hasReview: false, hasConversation: true})).toBe('transcript');
  });

  it('should fall back to the welcome state when there is no conversation or review', () => {
    expect(resolveCliForegroundSurface({hasReview: false, hasConversation: false})).toBe('welcome');
  });

  it('should treat AskUser forms as floating review windows', () => {
    expect(isFloatingReview(createAskReview())).toBe(true);
  });

  it('should also treat permission reviews as floating review windows', () => {
    expect(isFloatingReview(createPermissionReview())).toBe(true);
  });

  it('should hide the prompt frame whenever any review owns the foreground', () => {
    expect(shouldShowPromptFrame({
      review: createAskReview(),
      focusedSurface: 'prompt',
      hasCommandOutput: false,
      hasCompletion: false,
      hasSessionPicker: false,
    })).toBe(false);
  });

  it('should also hide the prompt frame for session-scoped reviews', () => {
    expect(shouldShowPromptFrame({
      review: createSessionReview(),
      focusedSurface: 'prompt',
      hasCommandOutput: false,
      hasCompletion: false,
      hasSessionPicker: false,
    })).toBe(false);
  });

  it('should keep prompt input enabled while the agent is running if no session-scoped review owns the interaction', () => {
    expect(shouldDisablePromptInput({
      review: undefined,
      focusedSurface: 'prompt',
      hasSessionPicker: false,
    })).toBe(false);
  });

  it('should disable prompt input whenever a review is active', () => {
    expect(shouldDisablePromptInput({
      review: createAskReview(),
      focusedSurface: 'prompt',
      hasSessionPicker: false,
    })).toBe(true);
  });

  it('should hide the task panel when there is only one task', () => {
    expect(shouldShowSubagentRunPanel({subagentRunPanelVisible: true, subagentRunCount: 1})).toBe(false);
  });

  it('should show the task panel when there are multiple tasks', () => {
    expect(shouldShowSubagentRunPanel({subagentRunPanelVisible: true, subagentRunCount: 2})).toBe(true);
  });

  it('should render the task panel as a floating panel when conversation is active and no stronger overlay is open', () => {
    expect(shouldShowFloatingSubagentRunPanel({
      hasConversation: true,
      subagentRunPanelVisible: true,
      subagentRunCount: 2,
      hasBlockingOverlay: false,
      hasReview: false,
    })).toBe(true);
  });

  it('should hide the floating task panel while a stronger overlay is visible', () => {
    expect(shouldShowFloatingSubagentRunPanel({
      hasConversation: true,
      subagentRunPanelVisible: true,
      subagentRunCount: 2,
      hasBlockingOverlay: true,
      hasReview: false,
    })).toBe(false);
  });

  it('should hide the floating task panel while a review overlay is visible', () => {
    expect(shouldShowFloatingSubagentRunPanel({
      hasConversation: true,
      subagentRunPanelVisible: true,
      subagentRunCount: 2,
      hasBlockingOverlay: false,
      hasReview: true,
    })).toBe(false);
  });

  it('should hide the activity line when a running task block already owns task/tool progress', () => {
    const activeItems: TranscriptItem[] = [{
      id: 'active-subagent-run:run-1',
      role: 'agent',
      content: '⚙ Explore(Inspect repo)\nRunning (12s)',
      toolMeta: {
        toolName: 'Agent',
        displayName: 'Explore',
        icon: '⚙',
        args: 'Inspect repo',
        status: 'running',
        summaryLine: 'Running (12s)',
      },
    }];

    expect(shouldShowActivityLine({
      runStateStatus: 'running',
      latestRuntimeEventKind: 'tool',
      activeItems,
    })).toBe(false);
  });

  it('should hide the activity line whenever active tasks are still running or paused, even if no running task block is currently projected', () => {
    expect(shouldShowActivityLine({
      runStateStatus: 'running',
      latestRuntimeEventKind: 'tool',
      activeItems: [],
      runningSubagentRunCount: 2,
      pausedSubagentRunCount: 1,
    })).toBe(false);
  });

  it('should keep the activity line for normal model thinking states', () => {
    expect(shouldShowActivityLine({
      runStateStatus: 'running',
      latestRuntimeEventKind: 'model',
      activeItems: [],
      runningSubagentRunCount: 0,
      pausedSubagentRunCount: 0,
    })).toBe(true);
  });
});

function createAskReview(): CliReviewState {
  return {
    request: {
      id: 'pause-form',
      description: 'Collect missing requirements.',
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
        actions: [{id: 'submit', label: 'Submit', kind: 'primary'}],
        form: {
          tabs: [{
            id: 'spec',
            label: 'Spec',
            question: 'Where is the spec?',
            options: [{id: 'file', label: 'Existing spec file'}],
          }],
        },
      },
    },
    actions: [{id: 'submit', label: 'Submit', kind: 'primary'}],
    selectedActionIndex: 0,
    focus: 'input',
    draft: '',
    busy: false,
    blockingScope: 'task',
    form: {
      tabs: [{
        id: 'spec',
        label: 'Spec',
        question: 'Where is the spec?',
        options: [{id: 'file', label: 'Existing spec file'}],
      }],
      activeTabIndex: 0,
      answers: {},
    },
  };
}

function createPermissionReview(): CliReviewState {
  return {
    request: {
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
      ui: {
        actions: [{id: 'allow_once', label: 'Allow once', kind: 'primary'}],
      },
    },
    actions: [{id: 'allow_once', label: 'Allow once', kind: 'primary'}],
    selectedActionIndex: 0,
    focus: 'actions',
    draft: '',
    busy: false,
    blockingScope: 'task',
  };
}

function createSessionReview(): CliReviewState {
  return {
    ...createAskReview(),
    blockingScope: 'session',
  };
}
