import type {ReviewRequest, ReviewDecision, ReviewResumePayload} from '@/index';
import type {CliReviewAutoAction} from './view-state';
import type {
  CliReviewAction,
  CliReviewAnswerValue,
  CliReviewFormState,
  CliReviewState,
} from './view-state';
import {readReviewFormConfig} from './review-form-config';
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
  findFirstIncompleteTabIndex,
  findNextIncompleteTabIndex,
  isReviewAnswerComplete,
} from './review-form-tabs';
import {
  updateReviewFormAnswer,
  readReviewFormDraft,
  readReviewCustomDraft,
  hasCustomAnswerForActiveTab,
  isCustomAnswerValue,
  applyCliReviewOptionSelection,
  commitCliReviewAnswer,
  applyCliReviewAutoAnswers,
  clearCliReviewValidation,
  normalizeAnswerEntry,
} from './review-form-answers';

// ── Re-exports (preserve the original public API) ──────────────────────
export {resolveReviewInputSelectionIndex} from './review-form-tabs';
export {readReviewFormDraft, hasCustomAnswerForActiveTab} from './review-form-answers';

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

export function selectPreviousCliReviewTab(current: CliReviewState): CliReviewState {
  if (!current.form || current.form.tabs.length === 0) {
    return current;
  }

  if (current.form.endStep) {
    const nextForm = {
      ...current.form,
      endStep: false,
      activeTabIndex: Math.max(current.form.tabs.length - 1, 0),
    };
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

  const nextForm = {
    ...current.form,
    endStep: false,
    activeTabIndex: (current.form.activeTabIndex - 1 + current.form.tabs.length) % current.form.tabs.length,
  };

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

export function selectNextCliReviewTab(current: CliReviewState): CliReviewState {
  if (!current.form || current.form.tabs.length === 0) {
    return current;
  }

  if (current.form.endStep) {
    const nextForm = {
      ...current.form,
      endStep: false,
      activeTabIndex: 0,
    };
    return {
      ...clearCliReviewValidation(current),
      form: nextForm,
      draft: readReviewFormDraft(nextForm),
      focus: 'input',
      selectedActionIndex: resolveReviewInputSelectionIndex(nextForm),
      customInputActive: false,
    };
  }

  if (current.form.activeTabIndex === current.form.tabs.length - 1) {
    const nextForm = {
      ...current.form,
      endStep: true,
    };
    return {
      ...clearCliReviewValidation(current),
      form: nextForm,
      draft: '',
      focus: 'actions',
      selectedActionIndex: 0,
      customInputSelected: false,
      customInputActive: false,
    };
  }

  const nextForm = {
    ...current.form,
    endStep: false,
    activeTabIndex: (current.form.activeTabIndex + 1) % current.form.tabs.length,
  };

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

// ── Actions / Decisions ────────────────────────────────────────────────

export function resolveCliReviewActions(request: ReviewRequest): CliReviewAction[] {
  const configured = request.ui?.actions?.map((action) => ({
    ...action,
    kind: action.kind ?? 'secondary',
  })) ?? [];

  if (configured.length > 0) {
    if (request.action.toolName === 'AskUserQuestion' && !configured.some((action) => action.id === 'cancel')) {
      return [...configured, {id: 'cancel', label: 'Cancel', kind: 'secondary'}];
    }
    return configured;
  }

  return request.review.allowedDecisions.map(defaultActionForDecision);
}

export function buildCliReviewResumePayload(
  review: CliReviewState,
  actionOverride?: CliReviewAutoAction,
): ReviewResumePayload {
  const action = actionOverride
    ? resolveRequestedAction(review.actions, actionOverride.action)
    : resolveCliReviewFocusedFooterAction(review) ?? review.actions[review.selectedActionIndex];

  if (!action) {
    throw new Error('No review action is available for the current review.');
  }

  const payload: Record<string, unknown> = {
    action: action.id,
  };
  const decision = mapActionToDecision(action.id);
  if (decision) {
    payload.decision = decision;
  }
  if (actionOverride?.scope?.trim()) {
    payload.scope = actionOverride.scope.trim();
  } else if (action.scope?.trim()) {
    payload.scope = action.scope.trim();
  }

  if (action.requiresToolEdit) {
    const editedToolArgs = actionOverride?.editedToolArgs ?? parseEditedToolArgs(review.draft.trim());
    payload.editedToolArgs = editedToolArgs;
  } else {
    const comment = actionOverride?.comment?.trim() || review.draft.trim();
    if (comment) {
      payload.comment = comment;
    }
  }

  if (review.form) {
    payload.metadata = {
      form: {
        activeTabId: review.form.tabs[review.form.activeTabIndex]?.id,
        answers: review.form.answers,
      },
    };
  }

  return payload;
}

export function prepareCliReviewSubmission(
  review: CliReviewState,
  actionOverride?: CliReviewAutoAction,
): {review: CliReviewState; payload?: ReviewResumePayload} {
  const nextReview = applyCliReviewAutoAnswers(review, actionOverride?.answers);
  const action = actionOverride
    ? resolveRequestedAction(nextReview.actions, actionOverride.action)
    : resolveCliReviewFocusedFooterAction(nextReview) ?? nextReview.actions[nextReview.selectedActionIndex];

  if (nextReview.form && !nextReview.form.endStep) {
    if (!actionOverride && nextReview.focus !== 'actions') {
      return {
        review: clearCliReviewValidation(nextReview),
      };
    }

    if (action?.id === 'next') {
      return {
        review: advanceCliReviewToNextStep(nextReview),
      };
    }
  }

  if (action?.id === 'submit' && nextReview.form) {
    const firstIncompleteTabIndex = findFirstIncompleteTabIndex(nextReview.form);
    if (firstIncompleteTabIndex >= 0) {
      return {
        review: {
          ...nextReview,
          focus: 'actions',
          customInputActive: false,
          validationMessage: 'You have not answered all questions',
        },
      };
    }
  }

  return {
    review: clearCliReviewValidation(nextReview),
    payload: buildCliReviewResumePayload(nextReview, actionOverride),
  };
}

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

function resolveRequestedAction(actions: readonly CliReviewAction[], actionId: string): CliReviewAction {
  const normalized = actionId.trim().toLowerCase();
  const resolved = actions.find((action) => action.id.toLowerCase() === normalized);
  if (resolved) {
    return resolved;
  }

  const requestedDecision = mapActionToDecision(normalized);
  if (requestedDecision) {
    const fallback = actions.find((action) => mapActionToDecision(action.id) === requestedDecision);
    if (fallback) {
      return fallback;
    }
  }

  throw new Error(`Unknown review action: ${actionId}`);
}

function parseEditedToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    throw new Error('This review action requires edited tool args in JSON object form.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid edited tool args JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Edited tool args must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

function defaultActionForDecision(decision: ReviewDecision): CliReviewAction {
  switch (decision) {
    case 'approve':
      return {id: 'approve', label: 'Approve', kind: 'primary'};
    case 'edit':
      return {id: 'edit', label: 'Edit and continue', kind: 'secondary', requiresToolEdit: true};
    case 'reject':
      return {id: 'reject', label: 'Reject', kind: 'danger', requiresConfirmation: true};
  }
}

function mapActionToDecision(actionId: string): ReviewDecision | undefined {
  const normalized = actionId.trim().toLowerCase();
  if (normalized === 'reject' || normalized === 'deny') {
    return 'reject';
  }
  if (normalized === 'edit') {
    return 'edit';
  }
  if (
    normalized === 'approve'
    || normalized === 'allow'
    || normalized === 'allow_once'
    || normalized === 'always'
    || normalized === 'dont_ask_again'
  ) {
    return 'approve';
  }
  return undefined;
}
