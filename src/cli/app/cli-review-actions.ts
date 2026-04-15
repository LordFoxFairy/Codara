import {
  activateCliReviewFocusedSelection,
  applyCliReviewFormShortcut,
  prepareCliReviewDraftInput,
  selectNextCliReviewTab,
  selectNextCliReviewAction,
  selectPreviousCliReviewTab,
  selectPreviousCliReviewAction,
  toggleCliReviewFocus,
  updateCliReviewDraft,
} from './review-state';
import type {CliInteractionState, CliReviewState} from './view-state';

/**
 * Pure review UI actions: state in -> state out.
 * The React hook wraps each in a useCallback that passes current state.
 */

// --- Simple toggle/panel actions ---

export function toggleSubagentRunsPanelAction(current: boolean): boolean {
  return !current;
}

export function toggleExpandAction(current: boolean): boolean {
  return !current;
}

export function dismissCommandOutputAction(): undefined {
  return undefined;
}

export function scrollCommandOutputAction(
  current: {content: string; commandName?: string; scrollOffset: number} | undefined,
  delta: number,
): {content: string; commandName?: string; scrollOffset: number} | undefined {
  if (!current) return current;
  const totalLines = current.content.split('\n').length;
  const maxOffset = Math.max(0, totalLines - 20);
  const nextOffset = Math.max(0, Math.min(maxOffset, current.scrollOffset + delta));
  if (nextOffset === current.scrollOffset) return current;
  return {...current, scrollOffset: nextOffset};
}

// --- Focus actions ---

export function focusReviewWindowAction(
  current: CliInteractionState,
  hasReview: boolean,
): CliInteractionState {
  if (!hasReview) return current;
  return {
    ...current,
    focusedSurface: 'review',
    promptBlocked: true,
  };
}

export function focusPromptWindowAction(
  current: CliInteractionState,
  hasReview: boolean,
): CliInteractionState {
  if (hasReview) return current;
  return {
    ...current,
    focusedSurface: 'prompt',
    promptBlocked: false,
  };
}

// --- Review navigation ---

export function selectPreviousReviewActionUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  return current ? selectPreviousCliReviewAction(current) : current;
}

export function selectNextReviewActionUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  return current ? selectNextCliReviewAction(current) : current;
}

export function moveReviewLeftUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  return current?.form
    ? selectPreviousCliReviewTab(current)
    : current
      ? toggleCliReviewFocus(current)
      : current;
}

export function moveReviewRightUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  return current?.form
    ? selectNextCliReviewTab(current)
    : current
      ? toggleCliReviewFocus(current)
      : current;
}

export function toggleReviewFocusUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  return current ? toggleCliReviewFocus(current) : current;
}

export interface ActivateReviewSelectionResult {
  review: CliReviewState | undefined;
  activated: boolean;
}

export function activateReviewSelectionUpdate(
  current: CliReviewState | undefined,
): ActivateReviewSelectionResult {
  if (!current) return {review: current, activated: false};
  const activated = activateCliReviewFocusedSelection(current);
  return {
    review: activated ?? current,
    activated: activated !== undefined,
  };
}

// --- Review text input ---

export function insertReviewTextUpdate(
  current: CliReviewState | undefined,
  input: string,
): CliReviewState | undefined {
  if (!current) return current;
  const activeTab = current.form?.tabs[current.form.activeTabIndex];
  const customIndex = activeTab ? activeTab.options.length : -1;
  const customInputSelected = current.form
    && current.focus === 'input'
    && current.selectedActionIndex === customIndex;
  const reviewShortcut = applyCliReviewFormShortcut(current, input);
  const isSelectionDigit = /^[1-9]$/.test(input);
  if (reviewShortcut && isSelectionDigit) {
    return reviewShortcut;
  }
  const shouldTypeIntoDraft = Boolean(current.customInputActive || customInputSelected);
  if (shouldTypeIntoDraft && current.focus === 'input') {
    const prepared = prepareCliReviewDraftInput(current) ?? current;
    return updateCliReviewDraft(prepared, prepared.draft + input);
  }
  if (reviewShortcut) {
    return reviewShortcut;
  }
  if (current.focus !== 'input') {
    return current;
  }
  const prepared = prepareCliReviewDraftInput(current);
  if (!prepared) {
    return current;
  }
  return updateCliReviewDraft(prepared, prepared.draft + input);
}

export function insertReviewNewlineUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  if (!current || current.focus !== 'input') return current;
  return updateCliReviewDraft(current, `${current.draft}\n`);
}

export function backspaceReviewInputUpdate(
  current: CliReviewState | undefined,
): CliReviewState | undefined {
  if (!current || current.focus !== 'input' || current.draft.length === 0) return current;
  return updateCliReviewDraft(current, current.draft.slice(0, -1));
}
