import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agent';
import type {CliReviewAutoAction} from './review-auto-action';
import type {
  CliReviewAction,
  CliReviewAnswerValue,
  CliReviewFormState,
  CliReviewState,
} from './view-state';

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

export function resolveCliReviewActions(request: PauseRequest): CliReviewAction[] {
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
): ResumePayload {
  const action = actionOverride
    ? resolveRequestedAction(review.actions, actionOverride.action)
    : resolveCliReviewFocusedFooterAction(review) ?? review.actions[review.selectedActionIndex];

  if (!action) {
    throw new Error('No review action is available for the current pause.');
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
): {review: CliReviewState; payload?: ResumePayload} {
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
  request: PauseRequest,
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

function countTotalNavigableItems(current: CliReviewState): number {
  if (!current.form) {
    return current.actions.length;
  }

  const activeTab = getActiveReviewTab(current.form);
  if (!current.form.endStep) {
    return Math.max(getQuestionSelectableItemCount(activeTab) + 1, 1);
  }

  return Math.max(getVisibleReviewFooterActions(current).length, 1);
}

function toAbsoluteIndex(current: CliReviewState): number {
  if (current.form && !current.form.endStep) {
    const inputCount = getQuestionSelectableItemCount(getActiveReviewTab(current.form));
    return current.focus === 'actions'
      ? inputCount + current.selectedActionIndex
      : current.selectedActionIndex;
  }

  return current.selectedActionIndex;
}

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

function clearCliReviewValidation(current: CliReviewState): CliReviewState {
  if (!current.validationMessage) {
    return current;
  }

  return {
    ...current,
    validationMessage: undefined,
  };
}

function resolveRequestedAction(actions: readonly CliReviewAction[], actionId: string): CliReviewAction {
  const normalized = actionId.trim().toLowerCase();
  const resolved = actions.find((action) => action.id.toLowerCase() === normalized);
  if (!resolved) {
    throw new Error(`Unknown review action: ${actionId}`);
  }
  return resolved;
}

function applyCliReviewAutoAnswers(
  review: CliReviewState,
  answers: Record<string, CliReviewAnswerValue> | undefined,
): CliReviewState {
  if (!review.form || !answers) {
    return review;
  }

  const nextAnswers = Object.fromEntries(
    Object.entries(answers)
      .flatMap(([key, value]) => normalizeAnswerEntry(key, value))
      .map(([key, value]) => [key, value]),
  );
  if (Object.keys(nextAnswers).length === 0) {
    return review;
  }

  const nextForm: CliReviewFormState = {
    ...review.form,
    answers: {
      ...review.form.answers,
      ...nextAnswers,
    },
  };

  return {
    ...clearCliReviewValidation(review),
    form: nextForm,
    draft: readReviewFormDraft(nextForm),
    customInputSelected: hasCustomAnswerForActiveTab(nextForm),
    customInputActive: hasCustomAnswerForActiveTab(nextForm),
  };
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

function applyCliReviewOptionSelection(
  current: CliReviewState,
  optionLabel: string | undefined,
): CliReviewState | undefined {
  if (!current.form || !optionLabel) {
    return undefined;
  }

  const activeTab = current.form.tabs[current.form.activeTabIndex];
  if (!activeTab) {
    return undefined;
  }

  const answer = activeTab.input === 'multiselect'
    ? toggleReviewFormSelection(current.form, optionLabel)
    : optionLabel;
  const selectedIndex = activeTab.options.findIndex((option) => option.label === optionLabel);
  return commitCliReviewAnswer(current, answer, selectedIndex >= 0 ? selectedIndex : current.selectedActionIndex);
}

function commitCliReviewAnswer(
  current: CliReviewState,
  answer: CliReviewAnswerValue,
  selectedIndexOverride?: number,
): CliReviewState {
  if (!current.form) {
    return current;
  }

  const nextForm = updateReviewFormAnswer(current.form, answer);
  const nextSelectedIndex = selectedIndexOverride ?? resolveReviewInputSelectionIndex(nextForm, current.selectedActionIndex);
  return {
    ...clearCliReviewValidation(current),
    draft: readReviewFormDraft(nextForm),
    form: nextForm,
    focus: 'input',
    selectedActionIndex: nextSelectedIndex,
    customInputSelected: resolveCustomSelectionState(current, nextForm, nextSelectedIndex),
    customInputActive: isCustomSelectionIndex(nextForm, nextSelectedIndex) && hasCustomAnswerForActiveTab(nextForm),
  };
}

function resolveCustomSelectionState(
  current: CliReviewState,
  nextForm: CliReviewFormState,
  nextSelectedIndex: number,
): boolean {
  const activeTab = getActiveReviewTab(nextForm);
  if (!activeTab) {
    return false;
  }

  if (activeTab.input !== 'multiselect') {
    return isCustomSelectionIndex(nextForm, nextSelectedIndex) && hasCustomAnswerForActiveTab(nextForm);
  }

  return current.customInputSelected === true
    || isCustomSelectionIndex(nextForm, nextSelectedIndex)
    || hasCustomAnswerForActiveTab(nextForm);
}

function defaultActionForDecision(decision: PauseReviewDecision): CliReviewAction {
  switch (decision) {
    case 'approve':
      return {id: 'approve', label: 'Approve', kind: 'primary'};
    case 'edit':
      return {id: 'edit', label: 'Edit and continue', kind: 'secondary', requiresToolEdit: true};
    case 'reject':
      return {id: 'reject', label: 'Reject', kind: 'danger', requiresConfirmation: true};
  }
}

function mapActionToDecision(actionId: string): PauseReviewDecision | undefined {
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

function updateReviewFormAnswer(
  form: CliReviewFormState,
  answer: CliReviewAnswerValue,
): CliReviewFormState {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return form;
  }

  const normalizedAnswer = normalizeReviewAnswerValue(form, activeTab, answer);

  return {
    ...form,
    endStep: false,
    answers: {
      ...form.answers,
      [activeTab.id]: normalizedAnswer,
    },
  };
}

export function readReviewFormDraft(form: CliReviewFormState): string {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return '';
  }
  return formatReviewAnswerValue(form.answers[activeTab.id] ?? '');
}

function readReviewCustomDraft(form: CliReviewFormState): string {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return '';
  }

  const answer = form.answers[activeTab.id];
  if (Array.isArray(answer)) {
    return answer.find((entry) => activeTab.options.every((option) => option.label !== entry)) ?? '';
  }
  if (typeof answer === 'string' && activeTab.options.every((option) => option.label !== answer)) {
    return answer;
  }
  return '';
}

function normalizeReviewAnswerValue(
  form: CliReviewFormState,
  activeTab: CliReviewFormState['tabs'][number],
  answer: CliReviewAnswerValue,
): CliReviewAnswerValue {
  if (activeTab.input !== 'multiselect' || Array.isArray(answer)) {
    return answer;
  }

  const current = form.answers[activeTab.id];
  const currentValues = Array.isArray(current)
    ? current
    : typeof current === 'string' && current.trim()
      ? [current]
      : [];
  const presetValues = currentValues.filter((entry) => activeTab.options.some((option) => option.label === entry));
  const customValue = answer.trim();

  return customValue ? [...presetValues, customValue] : presetValues;
}

function acceptsReviewDraftInput(
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

function supportsCustomReviewAnswer(
  tab: CliReviewFormState['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

function resolveDraftInputSelectionIndex(
  tab: CliReviewFormState['tabs'][number],
  selectedIndex: number,
): number {
  if (tab.input === 'text') {
    return 0;
  }

  return Math.min(selectedIndex, Math.max(getQuestionSelectableItemCount(tab) - 1, 0));
}

function getQuestionSelectableItemCount(
  tab: CliReviewFormState['tabs'][number] | undefined,
): number {
  if (!tab) {
    return 0;
  }

  return tab.options.length + (supportsCustomReviewAnswer(tab) ? 1 : 0);
}

function getVisibleReviewFooterActions(current: CliReviewState): CliReviewAction[] {
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

function isCustomSelectionIndex(form: CliReviewFormState, selectedIndex: number): boolean {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab || !supportsCustomReviewAnswer(activeTab)) {
    return false;
  }

  return selectedIndex === activeTab.options.length;
}

export function hasCustomAnswerForActiveTab(form: CliReviewFormState): boolean {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return false;
  }

  return isCustomAnswerValue(activeTab, form.answers[activeTab.id]);
}

function isCustomAnswerValue(
  tab: CliReviewFormState['tabs'][number],
  answer: CliReviewAnswerValue | undefined,
): boolean {
  if (!answer) {
    return false;
  }

  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.some((entry) => entry.trim().length > 0 && tab.options.every((option) => option.label !== entry));
}

function readReviewFormConfig(ui: PauseRequest['ui']): CliReviewFormState | undefined {
  if (!ui || !ui.form || typeof ui.form !== 'object' || Array.isArray(ui.form)) {
    return undefined;
  }

  const form = ui.form;
  const tabs = Array.isArray(form.tabs)
    ? (form.tabs as unknown[])
      .map(normalizeReviewFormTab)
      .filter((tab): tab is NonNullable<ReturnType<typeof normalizeReviewFormTab>> => Boolean(tab))
    : [];
  if (tabs.length === 0) {
    return undefined;
  }

  const summary = typeof form.summary === 'string'
    ? String(form.summary).trim()
    : undefined;

  return {
    ...(summary ? {summary} : {}),
    tabs,
    activeTabIndex: 0,
    answers: {},
  };
}

function normalizeReviewFormTab(tab: unknown) {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
    return undefined;
  }

  const record = tab as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (!id || !label || !question) {
    return undefined;
  }
  const input = typeof record.input === 'string' ? record.input.trim() : '';
  const normalizedInput: 'select' | 'multiselect' | 'text' =
    input === 'multiselect'
      ? 'multiselect'
      : input === 'text'
        ? 'text'
        : 'select';

  const options = Array.isArray(record.options)
    ? record.options
      .map((option) => normalizeReviewFormOption(option))
      .filter((option): option is NonNullable<ReturnType<typeof normalizeReviewFormOption>> => Boolean(option))
    : [];
  const placeholder = typeof record.placeholder === 'string' ? record.placeholder.trim() : '';

  return {
    id,
    label,
    question,
    ...(normalizedInput ? {input: normalizedInput} : {}),
    options,
    ...(placeholder ? {placeholder} : {}),
  };
}

function normalizeReviewFormOption(option: unknown) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    return undefined;
  }

  const record = option as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!id || !label) {
    return undefined;
  }

  const description = typeof record.description === 'string' ? record.description.trim() : '';
  return {
    id,
    label,
    ...(description ? {description} : {}),
  };
}

function toggleReviewFormSelection(form: CliReviewFormState, label: string): string[] {
  const activeTab = form.tabs[form.activeTabIndex];
  if (!activeTab) {
    return [label];
  }

  const current = form.answers[activeTab.id];
  const values = Array.isArray(current) ? [...current] : typeof current === 'string' && current.trim() ? [current] : [];
  const index = values.indexOf(label);
  if (index >= 0) {
    values.splice(index, 1);
    return values;
  }
  values.push(label);
  return values;
}

function formatReviewAnswerValue(value: CliReviewAnswerValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function getActiveReviewTab(
  form: CliReviewFormState,
): CliReviewFormState['tabs'][number] | undefined {
  if (form.endStep) {
    return undefined;
  }
  return form.tabs[form.activeTabIndex];
}

function findFirstIncompleteTabIndex(form: CliReviewFormState): number {
  return form.tabs.findIndex((tab) => !isReviewAnswerComplete(form.answers[tab.id]));
}

function findNextIncompleteTabIndex(form: CliReviewFormState, currentIndex: number): number {
  for (let index = currentIndex + 1; index < form.tabs.length; index += 1) {
    const tab = form.tabs[index];
    if (tab && !isReviewAnswerComplete(form.answers[tab.id])) {
      return index;
    }
  }

  return -1;
}

function isReviewAnswerComplete(value: CliReviewAnswerValue | undefined): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
}

function normalizeAnswerEntry(key: string, value: CliReviewAnswerValue): Array<[string, CliReviewAnswerValue]> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? [[normalizedKey, value]] : [];
  }

  const normalized = value.filter((entry) => entry.trim().length > 0);
  return normalized.length > 0 ? [[normalizedKey, normalized]] : [];
}
