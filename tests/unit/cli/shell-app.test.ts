import {describe, expect, it} from 'bun:test';
import {
  isFloatingHilReview,
  shouldShowFloatingTaskPanel,
  shouldShowFocusedTeamDetail,
  resolveCliForegroundSurface,
  shouldShowActivityLine,
  shouldShowTaskPanel,
  shouldShowPromptFrame,
} from '../../../src/cli/app/shell-app';
import type {CliHilReviewState} from '../../../src/cli/app/view-state';
import type {TranscriptItem} from '../../../src/cli/transcript/model';

describe('CLI foreground surface', () => {
  it('should prioritize HIL over the transcript when a review is active', () => {
    expect(resolveCliForegroundSurface({hasHilReview: true, hasConversation: true})).toBe('hil');
  });

  it('should show the transcript when conversation exists and no review is active', () => {
    expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: true})).toBe('transcript');
  });

  it('should fall back to the welcome state when there is no conversation or review', () => {
    expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: false})).toBe('welcome');
  });

  it('should treat AskUser forms as floating review windows', () => {
    expect(isFloatingHilReview(createAskReview())).toBe(true);
  });

  it('should also treat permission reviews as floating review windows', () => {
    expect(isFloatingHilReview(createPermissionReview())).toBe(true);
  });

  it('should hide the prompt frame while a floating AskUser review is active', () => {
    expect(shouldShowPromptFrame({
      hilReview: createAskReview(),
      hasCommandOutput: false,
      hasCompletion: false,
      hasSessionPicker: false,
    })).toBe(false);
  });

  it('should still hide the prompt frame for inline permission reviews', () => {
    expect(shouldShowPromptFrame({
      hilReview: createPermissionReview(),
      hasCommandOutput: false,
      hasCompletion: false,
      hasSessionPicker: false,
    })).toBe(false);
  });

  it('should hide the task panel when there is only one task', () => {
    expect(shouldShowTaskPanel({taskPanelVisible: true, taskCount: 1})).toBe(false);
  });

  it('should show the task panel when there are multiple tasks', () => {
    expect(shouldShowTaskPanel({taskPanelVisible: true, taskCount: 2})).toBe(true);
  });

  it('should render the task panel as a floating panel when conversation is active and no stronger overlay is open', () => {
    expect(shouldShowFloatingTaskPanel({
      hasConversation: true,
      taskPanelVisible: true,
      taskCount: 2,
      hasBlockingOverlay: false,
    })).toBe(true);
  });

  it('should hide the floating task panel while a stronger overlay is visible', () => {
    expect(shouldShowFloatingTaskPanel({
      hasConversation: true,
      taskPanelVisible: true,
      taskCount: 2,
      hasBlockingOverlay: true,
    })).toBe(false);
  });

  it('should still show the floating task panel while a HIL review overlay is visible', () => {
    expect(shouldShowFloatingTaskPanel({
      hasConversation: true,
      taskPanelVisible: true,
      taskCount: 2,
      hasBlockingOverlay: false,
    })).toBe(true);
  });

  it('should show focused team detail when conversation is active and no blocking overlay is open', () => {
    expect(shouldShowFocusedTeamDetail({
      hasConversation: true,
      hasFocusedTeamDetail: true,
      hasBlockingOverlay: false,
    })).toBe(true);
  });

  it('should hide focused team detail while a blocking overlay is open', () => {
    expect(shouldShowFocusedTeamDetail({
      hasConversation: true,
      hasFocusedTeamDetail: true,
      hasBlockingOverlay: true,
    })).toBe(false);
  });

  it('should hide the activity line when a running task block already owns task/tool progress', () => {
    const activeItems: TranscriptItem[] = [{
      id: 'active-task-run:run-1',
      role: 'task',
      content: '⚙ Explore(Inspect repo)\nRunning (12s)',
      toolMeta: {
        toolName: 'Task',
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
      activeTaskCount: 2,
      pausedTaskCount: 1,
    })).toBe(false);
  });

  it('should hide the activity line whenever active teams are still running or paused, even if no task block is projected', () => {
    expect(shouldShowActivityLine({
      runStateStatus: 'running',
      latestRuntimeEventKind: 'team',
      activeItems: [],
      activeTaskCount: 0,
      pausedTaskCount: 0,
      activeTeamCount: 1,
      pausedTeamCount: 1,
    })).toBe(false);
  });

  it('should keep the activity line for normal model thinking states', () => {
    expect(shouldShowActivityLine({
      runStateStatus: 'running',
      latestRuntimeEventKind: 'model',
      activeItems: [],
      activeTaskCount: 0,
      pausedTaskCount: 0,
      activeTeamCount: 0,
      pausedTeamCount: 0,
    })).toBe(true);
  });
});

function createAskReview(): CliHilReviewState {
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

function createPermissionReview(): CliHilReviewState {
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
  };
}
