/**
 * Pure navigation helpers for the review form.
 *
 * Handles tab-switching, absolute-index ↔ focus/selection mapping, and the
 * "advance to next step" flow. Split from form-state.ts so that file can
 * remain a thin facade over distinct concerns (navigation / draft / shortcut).
 *
 * @module
 */
import type {CliReviewFormState, CliReviewState} from '../../app/view-state';
import {
  getActiveReviewTab,
  getQuestionSelectableItemCount,
  findNextIncompleteTabIndex,
  isCustomSelectionIndex,
  isReviewAnswerComplete,
  resolveReviewInputSelectionIndex,
} from './form-tabs';
import {
  commitCliReviewAnswer,
  clearCliReviewValidation,
  hasCustomAnswerForActiveTab,
  isCustomAnswerValue,
  readReviewFormDraft,
} from './form-answers';

export function applyAbsoluteIndex(current: CliReviewState, absoluteIndex: number): CliReviewState {
  if (!current.form) {
    return {
      ...clearCliReviewValidation(current),
      selectedActionIndex: absoluteIndex % Math.max(current.actions.length, 1),
    };
  }

  if (!current.form.endStep) {
    const activeTab = getActiveReviewTab(current.form);
    const inputCount = getQuestionSelectableItemCount(activeTab);
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

export function applyTabSwitch(current: CliReviewState, nextTabIndex: number): CliReviewState {
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

export function applyEndStep(current: CliReviewState): CliReviewState {
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

export function advanceToNextStep(current: CliReviewState): CliReviewState {
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

  const nextIncompleteTabIndex = findNextIncompleteTabIndex(current.form, current.form.activeTabIndex);
  if (nextIncompleteTabIndex >= 0) {
    const nextForm: CliReviewFormState = {
      ...current.form,
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
      ...current.form,
      endStep: true,
    },
    focus: 'actions',
    selectedActionIndex: 0,
    customInputSelected: false,
    customInputActive: false,
  };
}
