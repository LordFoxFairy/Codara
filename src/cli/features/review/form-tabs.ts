/**
 * Review form tab navigation and query helpers.
 *
 * Pure functions for navigating between tabs, counting selectable items,
 * resolving selection indices, and reading footer actions. Extracted from
 * review-form-state.ts for single-responsibility.
 */
import type {
  CliReviewAction,
  CliReviewFormState,
  CliReviewState,
} from '../../app/view-state';

export function getActiveReviewTab(
  form: CliReviewFormState,
): CliReviewFormState['tabs'][number] | undefined {
  if (form.endStep) {
    return undefined;
  }
  return form.tabs[form.activeTabIndex];
}

export function countTotalNavigableItems(current: CliReviewState): number {
  if (!current.form) {
    return current.actions.length;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!current.form.endStep) {
    return Math.max(getQuestionSelectableItemCount(activeTab) + 1, 1);
  }

  return Math.max(getVisibleReviewFooterActions(current).length, 1);
}

export function toAbsoluteIndex(current: CliReviewState): number {
  if (current.form && !current.form.endStep) {
    const inputCount = getQuestionSelectableItemCount(getActiveReviewTab(current.form));
    return current.focus === 'actions'
      ? inputCount + current.selectedActionIndex
      : current.selectedActionIndex;
  }

  return current.selectedActionIndex;
}

export function getQuestionSelectableItemCount(
  tab: CliReviewFormState['tabs'][number] | undefined,
): number {
  if (!tab) {
    return 0;
  }

  return tab.options.length + (supportsCustomReviewAnswer(tab) ? 1 : 0);
}

export function supportsCustomReviewAnswer(
  tab: CliReviewFormState['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

export function acceptsReviewDraftInput(
  tab: CliReviewFormState['tabs'][number] | undefined,
  selectedIndex?: number,
): boolean {
  if (!tab) {
    return false;
  }

  if (tab.input === 'text') {
    return true;
  }

  if (!supportsCustomReviewAnswer(tab)) {
    return false;
  }

  return selectedIndex === tab.options.length;
}

export function resolveDraftInputSelectionIndex(
  tab: CliReviewFormState['tabs'][number],
  selectedIndex: number,
): number {
  if (tab.input === 'text') {
    return 0;
  }

  return Math.min(selectedIndex, Math.max(getQuestionSelectableItemCount(tab) - 1, 0));
}

export function isCustomSelectionIndex(form: CliReviewFormState, selectedIndex: number): boolean {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab || !supportsCustomReviewAnswer(activeTab)) {
    return false;
  }

  return selectedIndex === activeTab.options.length;
}

export function resolveReviewInputSelectionIndex(
  form: CliReviewFormState,
  fallbackIndex = 0,
): number {
  const activeTab = form.tabs[form.activeTabIndex];
  if (!activeTab || form.endStep) {
    return fallbackIndex;
  }

  const answer = form.answers[activeTab.id];
  if (typeof answer === 'string' && answer.trim()) {
    const optionIndex = activeTab.options.findIndex((option) => option.label === answer);
    if (optionIndex >= 0) {
      return optionIndex;
    }

    if (supportsCustomReviewAnswer(activeTab)) {
      return activeTab.options.length;
    }
  }

  return Math.min(fallbackIndex, Math.max(getQuestionSelectableItemCount(activeTab) - 1, 0));
}

export function getVisibleReviewFooterActions(current: CliReviewState): CliReviewAction[] {
  if (!current.form) {
    return [...current.actions];
  }

  if (current.form.endStep) {
    return current.actions
      .filter((action) => action.id === 'submit' || action.id === 'cancel')
      .map((action) => ({
        ...action,
        label: action.id === 'submit' ? 'Submit answers' : action.label,
      }));
  }

  return [{id: 'next', label: 'Next', kind: 'primary'}];
}

export function findFirstIncompleteTabIndex(form: CliReviewFormState): number {
  return form.tabs.findIndex((tab) => !isReviewAnswerComplete(form.answers[tab.id]));
}

export function findNextIncompleteTabIndex(form: CliReviewFormState, currentIndex: number): number {
  for (let index = currentIndex + 1; index < form.tabs.length; index += 1) {
    const tab = form.tabs[index];
    if (tab && !isReviewAnswerComplete(form.answers[tab.id])) {
      return index;
    }
  }

  return -1;
}

export function isReviewAnswerComplete(value: import('../../app/view-state').CliReviewAnswerValue | undefined): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
}
