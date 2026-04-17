/**
 * Review form state transitions.
 *
 * Pure state-in/state-out helpers for navigating the review panel: moving
 * between actions/tabs, handling focus/draft toggles, applying option
 * selections, and advancing through form steps. Submission-related code
 * (payload building, action resolution) lives in form-submit.ts; form
 * parsing lives in form-config.ts; answer mutation lives in form-answers.ts.
 */
import type {ReviewRequest} from '@/index';
import type {
  CliReviewAction,
  CliReviewFormState,
  CliReviewState,
} from '../../app/view-state';
import {readReviewFormConfig} from './form-config';
import {
  getActiveReviewTab,
  countTotalNavigableItems,
  toAbsoluteIndex,
  getQuestionSelectableItemCount,
  supportsCustomReviewAnswer,
  acceptsReviewDraftInput,
  resolveDraftInputSelectionIndex,
  isCustomSelectionIndex,
  resolveReviewInputSelectionIndex,
  getVisibleReviewFooterActions,
  findNextIncompleteTabIndex,
  isReviewAnswerComplete,
} from './form-tabs';
import {
  updateReviewFormAnswer,
  readReviewFormDraft,
  readReviewCustomDraft,
  hasCustomAnswerForActiveTab,
  isCustomAnswerValue,
  applyCliReviewOptionSelection,
  commitCliReviewAnswer,
  clearCliReviewValidation,
} from './form-answers';

// ── Re-exports (preserve the original public API) ──────────────────────
export {resolveReviewInputSelectionIndex} from './form-tabs';
export {readReviewFormDraft, hasCustomAnswerForActiveTab} from './form-answers';

// ── Navigation ─────────────────────────────────────────────────────────

export function selectPreviousCliReviewAction(current: CliReviewState): CliReviewState {
  const totalItems = countTotalNavigableItems(current);
  if (totalItems === 0) return current;

  const currentAbsolute = toAbsoluteIndex(current);
  const nextAbsolute = (currentAbsolute - 1 + totalItems) % totalItems;
  return applyAbsoluteIndex(current, nextAbsolute);
}

export function selectNextCliReviewAction(current: CliReviewState): CliReviewState {
  const totalItems = countTotalNavigableItems(current);
  if (totalItems === 0) return current;

  const currentAbsolute = toAbsoluteIndex(current);
  const nextAbsolute = (currentAbsolute + 1) % totalItems;
  return applyAbsoluteIndex(current, nextAbsolute);
}

export function toggleCliReviewFocus(current: CliReviewState): CliReviewState {
  if (current.focus === 'actions') {
    return {
      ...clearCliReviewValidation(current),
      focus: 'input',
      selectedActionIndex: current.form ? resolveReviewInputSelectionIndex(current.form) : current.selectedActionIndex,
      customInputSelected: current.customInputSelected,
      customInputActive: false,
    };
  }

  return {
    ...clearCliReviewValidation(current),
    focus: 'actions',
    selectedActionIndex: 0,
    customInputSelected: current.customInputSelected,
    customInputActive: false,
  };
}

// ── Draft / Input ──────────────────────────────────────────────────────

export function updateCliReviewDraft(current: CliReviewState, draft: string): CliReviewState {
  if (current.form) {
    const nextForm = updateReviewFormAnswer(current.form, draft);
    return {
      ...clearCliReviewValidation(current),
      draft,
      customInputSelected: current.customInputSelected ?? hasCustomAnswerForActiveTab(nextForm),
      customInputActive: true,
      form: nextForm,
    };
  }

  return {
    ...clearCliReviewValidation(current),
    draft,
  };
}

// ── Tab Navigation ─────────────────────────────────────────────────────

function applyTabSwitch(current: CliReviewState, nextTabIndex: number): CliReviewState {
  const nextForm = {...current.form!, endStep: false, activeTabIndex: nextTabIndex};
  return {
    ...clearCliReviewValidation(current),
    form: nextForm,
    draft: readReviewFormDraft(nextForm),
    focus: 'input',
    selectedActionIndex: resolveReviewInputSelectionIndex(nextForm),
    customInputSelected: hasCustomAnswerForActiveTab(nextForm),
    customInputActive: false,
  };
}

function applyEndStep(current: CliReviewState): CliReviewState {
  return {
    ...clearCliReviewValidation(current),
    form: {...current.form!, endStep: true},
    draft: '',
    focus: 'actions',
    selectedActionIndex: 0,
    customInputSelected: false,
    customInputActive: false,
  };
}

export function selectPreviousCliReviewTab(current: CliReviewState): CliReviewState {
  if (!current.form || current.form.tabs.length === 0) return current;
  if (current.form.endStep) return applyTabSwitch(current, Math.max(current.form.tabs.length - 1, 0));
  return applyTabSwitch(current, (current.form.activeTabIndex - 1 + current.form.tabs.length) % current.form.tabs.length);
}

export function selectNextCliReviewTab(current: CliReviewState): CliReviewState {
  if (!current.form || current.form.tabs.length === 0) return current;
  if (current.form.endStep) return applyTabSwitch(current, 0);
  if (current.form.activeTabIndex === current.form.tabs.length - 1) return applyEndStep(current);
  return applyTabSwitch(current, (current.form.activeTabIndex + 1) % current.form.tabs.length);
}

// ── Shortcuts / Selection ──────────────────────────────────────────────

export function applyCliReviewFormShortcut(current: CliReviewState, input: string): CliReviewState | undefined {
  if (!current.form) {
    return undefined;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!activeTab) {
    return undefined;
  }

  const optionIndex = Number.parseInt(input, 10) - 1;
  if (!Number.isFinite(optionIndex) || optionIndex < 0) {
    return undefined;
  }

  if (optionIndex < activeTab.options.length) {
    const option = activeTab.options[optionIndex];
    if (!option) {
      return undefined;
    }

    return applyCliReviewOptionSelection(current, option.label);
  }

  if (!supportsCustomReviewAnswer(activeTab) || optionIndex !== activeTab.options.length) {
    return undefined;
  }

  return {
    ...clearCliReviewValidation(current),
    selectedActionIndex: optionIndex,
    draft: readReviewCustomDraft(current.form),
    customInputSelected: true,
    customInputActive: true,
  };
}

export function activateCliReviewFocusedSelection(current: CliReviewState): CliReviewState | undefined {
  if (!current.form || current.focus === 'actions') {
    return undefined;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!activeTab) {
    return undefined;
  }

  const optionCount = activeTab.options.length;
  const selectedIndex = current.selectedActionIndex;

  if (selectedIndex < optionCount) {
    return applyCliReviewOptionSelection(current, activeTab.options[selectedIndex]?.label);
  }

  if (!acceptsReviewDraftInput(activeTab, selectedIndex) || selectedIndex !== optionCount) {
    return undefined;
  }

  return {
    ...clearCliReviewValidation(current),
    focus: 'input',
    selectedActionIndex: selectedIndex,
    draft: readReviewCustomDraft(current.form),
    customInputSelected: true,
    customInputActive: true,
  };
}

export function confirmCliReviewFocusedSelection(current: CliReviewState): CliReviewState | undefined {
  if (!current.form || current.focus === 'actions') {
    return undefined;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!activeTab) {
    return undefined;
  }

  if (activeTab.input === 'multiselect') {
    return isReviewAnswerComplete(current.form.answers[activeTab.id])
      ? advanceCliReviewToNextStep(current)
      : current;
  }

  const selected = activateCliReviewFocusedSelection(current) ?? current;
  return isReviewAnswerComplete(selected.form?.answers[activeTab.id])
    ? advanceCliReviewToNextStep(selected)
    : selected;
}

export function prepareCliReviewDraftInput(current: CliReviewState): CliReviewState | undefined {
  if (!current.form || current.focus !== 'input') {
    return undefined;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!activeTab || !acceptsReviewDraftInput(activeTab, current.selectedActionIndex)) {
    return undefined;
  }

  return {
    ...clearCliReviewValidation(current),
    selectedActionIndex: resolveDraftInputSelectionIndex(activeTab, current.selectedActionIndex),
    draft: readReviewCustomDraft(current.form),
    customInputSelected: true,
    customInputActive: true,
  };
}

export function resolveCliReviewFocusedFooterAction(current: CliReviewState): CliReviewAction | undefined {
  const footerActions = getVisibleReviewFooterActions(current);
  return footerActions[current.selectedActionIndex];
}

export function shouldSpaceInsertIntoCliReviewDraft(review: CliReviewState | undefined): boolean {
  if (!review?.form || review.focus !== 'input') {
    return false;
  }

  const activeTab = getActiveReviewTab(review.form);
  if (!activeTab || !supportsCustomReviewAnswer(activeTab)) {
    return false;
  }

  const customIndex = activeTab.options.length;
  if (review.selectedActionIndex === customIndex) {
    return true;
  }

  const answer = review.form.answers[activeTab.id];
  if (typeof answer !== 'string' || !answer.trim()) {
    return false;
  }

  return activeTab.options.every((option) => option.label !== answer);
}

// ── Step Advancement ───────────────────────────────────────────────────

export function advanceCliReviewToNextStep(current: CliReviewState): CliReviewState {
  if (!current.form) {
    return current;
  }

  const currentTab = getActiveReviewTab(current.form);
  if (currentTab && !isReviewAnswerComplete(current.form.answers[currentTab.id])) {
    return {
      ...current,
      validationMessage: `Complete ${currentTab.label} before continuing.`,
    };
  }

  let nextForm = current.form;
  const nextIncompleteTabIndex = findNextIncompleteTabIndex(nextForm, current.form.activeTabIndex);
  if (nextIncompleteTabIndex >= 0) {
    nextForm = {
      ...nextForm,
      endStep: false,
      activeTabIndex: nextIncompleteTabIndex,
    };
    return {
      ...clearCliReviewValidation(current),
      draft: readReviewFormDraft(nextForm),
      form: nextForm,
      focus: 'input',
      selectedActionIndex: resolveReviewInputSelectionIndex(nextForm),
      customInputSelected: hasCustomAnswerForActiveTab(nextForm),
      customInputActive: false,
    };
  }

  return {
    ...clearCliReviewValidation(current),
    draft: '',
    form: {
      ...nextForm,
      endStep: true,
    },
    focus: 'actions',
    selectedActionIndex: 0,
    customInputSelected: false,
    customInputActive: false,
  };
}

export function resolveCliReviewFormState(
  request: ReviewRequest,
  current: CliReviewFormState | undefined,
): CliReviewFormState | undefined {
  const parsed = readReviewFormConfig(request.ui);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    activeTabIndex: current
      ? Math.min(current.activeTabIndex, Math.max(parsed.tabs.length - 1, 0))
      : 0,
    answers: current?.answers ?? {},
    endStep: current?.endStep ?? false,
  };
}

// ── Private helpers ────────────────────────────────────────────────────

function applyAbsoluteIndex(current: CliReviewState, absoluteIndex: number): CliReviewState {
  if (!current.form) {
    return {
      ...clearCliReviewValidation(current),
      selectedActionIndex: absoluteIndex % Math.max(current.actions.length, 1),
    };
  }

  if (!current.form.endStep) {
    const activeTab = getActiveReviewTab(current.form);
    const inputCount = getQuestionSelectableItemCount(getActiveReviewTab(current.form));
    if (absoluteIndex < inputCount) {
      if (
        activeTab
        && activeTab.input !== 'multiselect'
        && absoluteIndex < activeTab.options.length
        && isCustomAnswerValue(activeTab, current.form.answers[activeTab.id])
      ) {
        return commitCliReviewAnswer(current, activeTab.options[absoluteIndex]?.label ?? '', absoluteIndex);
      }

      return {
        ...clearCliReviewValidation(current),
        focus: 'input',
        selectedActionIndex: absoluteIndex,
        customInputSelected: current.customInputSelected,
        customInputActive: isCustomSelectionIndex(current.form, absoluteIndex) ? current.customInputActive : false,
      };
    }

    return {
      ...clearCliReviewValidation(current),
      focus: 'actions',
      selectedActionIndex: absoluteIndex - inputCount,
      customInputSelected: current.customInputSelected,
      customInputActive: false,
    };
  }

  return {
    ...clearCliReviewValidation(current),
    selectedActionIndex: absoluteIndex,
  };
}
