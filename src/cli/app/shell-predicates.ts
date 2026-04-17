/**
 * Pure predicates and layout helpers used by the shell application.
 *
 * These functions answer questions about the current UI state (which
 * surface is focused, whether the prompt frame should render, whether the
 * floating subagent panel is visible, etc.) without any side effects.
 * Extracted from shell-app.tsx so the root component can stay focused on
 * composition while these can be unit-tested in isolation.
 */
import type {CliInteractionSurface, CliReviewState} from './view-state';
import type {SolidifiedItem, TranscriptItem} from '../features/transcript/model';

export type CliForegroundSurface = 'transcript' | 'welcome';

export function resolveCliForegroundSurface(input: {
  hasReview: boolean;
  hasConversation: boolean;
}): CliForegroundSurface {
  if (input.hasConversation || input.hasReview) {
    return 'transcript';
  }
  return 'welcome';
}

export function isFloatingReview(review: CliReviewState | undefined): boolean {
  return Boolean(review);
}

export function shouldShowPromptFrame(input: {
  review?: CliReviewState;
  focusedSurface: CliInteractionSurface;
  hasCommandOutput: boolean;
  hasCompletion: boolean;
  hasSessionPicker: boolean;
  activeItems: readonly TranscriptItem[];
  runStateStatus: 'idle' | 'running' | 'paused' | 'done' | 'error';
  runningSubagentRunCount?: number;
  pausedSubagentRunCount?: number;
}): boolean {
  if (input.hasCommandOutput || input.hasSessionPicker) {
    return false;
  }

  if (input.review) {
    return false;
  }

  return true;
}

export function shouldDisablePromptInput(input: {
  review?: CliReviewState;
  focusedSurface: CliInteractionSurface;
  hasSessionPicker: boolean;
  hasCompletion: boolean;
  hasCommandOutput: boolean;
  runStateStatus: 'idle' | 'running' | 'paused' | 'done' | 'error';
}): boolean {
  return Boolean(input.review)
    || input.hasSessionPicker
    || input.hasCompletion
    || input.hasCommandOutput
    || input.runStateStatus === 'running'
    || input.runStateStatus === 'paused';
}

export function resolveActiveInteractionSurface(input: {
  focusedSurface: CliInteractionSurface;
  hasCommandOutput: boolean;
  hasCompletion: boolean;
  hasSessionPicker: boolean;
}): CliInteractionSurface {
  if (input.hasSessionPicker) {
    return 'session-picker';
  }
  if (input.hasCommandOutput) {
    return 'command-output';
  }
  if (input.hasCompletion) {
    return 'completion';
  }
  return input.focusedSurface;
}

export function shouldShowSubagentRunPanel(input: {
  subagentRunPanelVisible: boolean;
  subagentRunCount: number;
}): boolean {
  return input.subagentRunPanelVisible && input.subagentRunCount > 1;
}

export function shouldShowFloatingSubagentRunPanel(input: {
  hasConversation: boolean;
  subagentRunPanelVisible: boolean;
  subagentRunCount: number;
  hasBlockingOverlay: boolean;
  hasReview: boolean;
}): boolean {
  if (
    input.hasBlockingOverlay
    || input.hasReview
    || input.hasConversation
  ) {
    return false;
  }

  return shouldShowSubagentRunPanel({
    subagentRunPanelVisible: input.subagentRunPanelVisible,
    subagentRunCount: input.subagentRunCount,
  });
}

export function hasVisibleAssistantSolidifiedReply(items: readonly SolidifiedItem[]): boolean {
  return items.some((item) => item.items.some((entry) => entry.role === 'assistant' && entry.content.trim().length > 0));
}
