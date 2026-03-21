import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agent';
import type {PermissionStage} from '../components/permission/types';
import {isPermissionPauseRequest} from './hil-kind';
import type {
  CliHilAnswerValue,
  CliHilFormState,
  CliHilReviewAction,
  CliHilReviewState,
} from './view-state';

export interface CliHilAutoAction {
  action: string;
  scope?: string;
  comment?: string;
  editedToolArgs?: Record<string, unknown>;
  answers?: Record<string, CliHilAnswerValue>;
}

export function syncCliHilReviewState(
  current: CliHilReviewState | undefined,
  request: PauseRequest | undefined,
): CliHilReviewState | undefined {
  if (!request) {
    return undefined;
  }

  const actions = resolveCliHilActions(request);
  const form = resolveCliHilFormState(request, current?.form);
  if (current?.request.id === request.id) {
    return {
      ...current,
      request,
      actions,
      selectedActionIndex: form
        ? current.focus === 'actions'
          ? form.endStep
            ? Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0))
            : 0
          : resolveHilInputSelectionIndex(form, current.selectedActionIndex)
        : Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0)),
      form,
      draft: form ? readHilFormDraft(form) : current.draft,
      validationMessage: undefined,
    };
  }

  return {
    request,
    actions,
    selectedActionIndex: 0,
    focus: form ? (form.endStep ? 'actions' : 'input') : 'actions',
    draft: form ? readHilFormDraft(form) : '',
    busy: false,
    ...(form ? {form} : {}),
  };
}

export function selectPreviousCliHilAction(current: CliHilReviewState): CliHilReviewState {
  const totalItems = countTotalNavigableItems(current);
  if (totalItems === 0) return current;

  const currentAbsolute = toAbsoluteIndex(current);
  const nextAbsolute = (currentAbsolute - 1 + totalItems) % totalItems;
  return applyAbsoluteIndex(current, nextAbsolute);
}

export function selectNextCliHilAction(current: CliHilReviewState): CliHilReviewState {
  const totalItems = countTotalNavigableItems(current);
  if (totalItems === 0) return current;

  const currentAbsolute = toAbsoluteIndex(current);
  const nextAbsolute = (currentAbsolute + 1) % totalItems;
  return applyAbsoluteIndex(current, nextAbsolute);
}

/** Count options + placeholder + actions as one unified navigable list. */
function countTotalNavigableItems(current: CliHilReviewState): number {
  if (!current.form) return current.actions.length;
  const activeTab = getActiveHilTab(current.form);
  return current.focus === 'actions'
    ? current.form.endStep ? current.actions.length : 1
    : Math.max(activeTab?.options?.length ?? 0, 1);
}

/** Convert focus+selectedActionIndex to a single absolute index in the unified list. */
function toAbsoluteIndex(current: CliHilReviewState): number {
  return current.selectedActionIndex;
}

/** Apply absolute index back to focus+selectedActionIndex. */
function applyAbsoluteIndex(current: CliHilReviewState, absoluteIndex: number): CliHilReviewState {
  if (!current.form) {
    return {
      ...clearCliHilValidation(current),
      selectedActionIndex: absoluteIndex % Math.max(current.actions.length, 1),
    };
  }
  return {
    ...clearCliHilValidation(current),
    selectedActionIndex: absoluteIndex,
  };
}

export function toggleCliHilFocus(current: CliHilReviewState): CliHilReviewState {
  if (current.focus === 'actions') {
    if (current.form?.endStep) {
      return current;
    }
    return {
      ...clearCliHilValidation(current),
      focus: 'input',
      selectedActionIndex: current.form ? resolveHilInputSelectionIndex(current.form) : current.selectedActionIndex,
    };
  }

  return {
    ...clearCliHilValidation(current),
    focus: 'actions',
    selectedActionIndex: 0,
  };
}

export function updateCliHilDraft(current: CliHilReviewState, draft: string): CliHilReviewState {
  if (current.form) {
    const nextForm = updateHilFormAnswer(current.form, draft);
    return {
      ...clearCliHilValidation(current),
      draft,
      form: nextForm,
    };
  }

  return {
    ...clearCliHilValidation(current),
    draft,
  };
}

export function selectPreviousCliHilTab(current: CliHilReviewState): CliHilReviewState {
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
      ...clearCliHilValidation(current),
      form: nextForm,
      draft: readHilFormDraft(nextForm),
      focus: 'input',
      selectedActionIndex: resolveHilInputSelectionIndex(nextForm),
    };
  }

  const nextForm = {
    ...current.form,
    endStep: false,
    activeTabIndex: (current.form.activeTabIndex - 1 + current.form.tabs.length) % current.form.tabs.length,
  };

  return {
    ...clearCliHilValidation(current),
    form: nextForm,
    draft: readHilFormDraft(nextForm),
    focus: 'input',
    selectedActionIndex: resolveHilInputSelectionIndex(nextForm),
  };
}

export function selectNextCliHilTab(current: CliHilReviewState): CliHilReviewState {
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
      ...clearCliHilValidation(current),
      form: nextForm,
      draft: readHilFormDraft(nextForm),
      focus: 'input',
      selectedActionIndex: resolveHilInputSelectionIndex(nextForm),
    };
  }

  if (current.form.activeTabIndex === current.form.tabs.length - 1 && findFirstIncompleteTabIndex(current.form) < 0) {
    const nextForm = {
      ...current.form,
      endStep: true,
    };
    return {
      ...clearCliHilValidation(current),
      form: nextForm,
      draft: '',
      focus: 'actions',
      selectedActionIndex: 0,
    };
  }

  const nextForm = {
    ...current.form,
    endStep: false,
    activeTabIndex: (current.form.activeTabIndex + 1) % current.form.tabs.length,
  };

  return {
    ...clearCliHilValidation(current),
    form: nextForm,
    draft: readHilFormDraft(nextForm),
    focus: 'input',
    selectedActionIndex: resolveHilInputSelectionIndex(nextForm),
  };
}

export function applyCliHilFormShortcut(current: CliHilReviewState, input: string): CliHilReviewState | undefined {
  if (!current.form) {
    return undefined;
  }

  const activeTab = getActiveHilTab(current.form);
  if (!activeTab || activeTab.options.length === 0) {
    return undefined;
  }

  const optionIndex = Number.parseInt(input, 10) - 1;
  if (!Number.isFinite(optionIndex) || optionIndex < 0 || optionIndex >= activeTab.options.length) {
    return undefined;
  }

  const option = activeTab.options[optionIndex];
  if (!option) {
    return undefined;
  }

  return applyCliHilOptionSelection(current, option.label);
}

export function activateCliHilFocusedSelection(current: CliHilReviewState): CliHilReviewState | undefined {
  if (!current.form || current.focus === 'actions') {
    return undefined;
  }

  const activeTab = getActiveHilTab(current.form);
  if (!activeTab) {
    return undefined;
  }

  const optionCount = activeTab.options.length;
  const selectedIndex = current.selectedActionIndex;

  if (selectedIndex < optionCount) {
    return applyCliHilOptionSelection(current, activeTab.options[selectedIndex]?.label);
  }

  if (!acceptsHilDraftInput(activeTab)) {
    return undefined;
  }

  return applyCliHilDraftSelection(current);
}

export function confirmCliHilFocusedSelection(current: CliHilReviewState): CliHilReviewState | undefined {
  if (!current.form || current.focus === 'actions') {
    return undefined;
  }

  const activeTab = getActiveHilTab(current.form);
  if (!activeTab) {
    return undefined;
  }

  if (activeTab.input === 'multiselect') {
    return isHilAnswerComplete(current.form.answers[activeTab.id])
      ? advanceCliHilToNextStep(current)
      : current;
  }

  const selected = activateCliHilFocusedSelection(current) ?? current;
  return isHilAnswerComplete(selected.form?.answers[activeTab.id])
    ? advanceCliHilToNextStep(selected)
    : selected;
}

export function prepareCliHilDraftInput(current: CliHilReviewState): CliHilReviewState | undefined {
  if (!current.form || current.focus !== 'input') {
    return undefined;
  }

  const activeTab = getActiveHilTab(current.form);
  if (!activeTab || !acceptsHilDraftInput(activeTab)) {
    return undefined;
  }

  return {
    ...clearCliHilValidation(current),
    selectedActionIndex: Math.min(current.selectedActionIndex, Math.max(activeTab.options.length - 1, 0)),
  };
}

export function resolveCliHilActions(request: PauseRequest): CliHilReviewAction[] {
  const configured = request.ui?.actions?.map((action) => ({
    ...action,
    kind: action.kind ?? 'secondary',
  })) ?? [];

  if (configured.length > 0) {
    return configured;
  }

  return request.review.allowedDecisions.map(defaultActionForDecision);
}

export function buildCliHilResumePayload(
  review: CliHilReviewState,
  actionOverride?: CliHilAutoAction,
): ResumePayload {
  const action = actionOverride
    ? resolveRequestedAction(review.actions, actionOverride.action)
    : review.actions[review.selectedActionIndex];

  if (!action) {
    throw new Error('No HIL action is available for the current pause.');
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

export function prepareCliHilSubmission(
  review: CliHilReviewState,
  actionOverride?: CliHilAutoAction,
): {review: CliHilReviewState; payload?: ResumePayload} {
  const nextReview = applyCliHilAutoAnswers(review, actionOverride?.answers);
  const action = actionOverride
    ? resolveRequestedAction(nextReview.actions, actionOverride.action)
    : nextReview.actions[nextReview.selectedActionIndex];

  if (action?.id === 'submit' && nextReview.form) {
    const firstIncompleteTabIndex = findFirstIncompleteTabIndex(nextReview.form);
    if (firstIncompleteTabIndex >= 0) {
      const nextForm = {
        ...nextReview.form,
        activeTabIndex: firstIncompleteTabIndex,
      };
      const tab = nextForm.tabs[firstIncompleteTabIndex];
      return {
        review: {
          ...nextReview,
          focus: 'input',
          draft: readHilFormDraft(nextForm),
          form: nextForm,
          validationMessage: tab ? `Complete ${tab.label} before submitting.` : 'Complete each question before submitting.',
        },
      };
    }
  }

  return {
    review: clearCliHilValidation(nextReview),
    payload: buildCliHilResumePayload(nextReview, actionOverride),
  };
}

function resolveRequestedAction(actions: readonly CliHilReviewAction[], actionId: string): CliHilReviewAction {
  const normalized = actionId.trim().toLowerCase();
  const resolved = actions.find((action) => action.id.toLowerCase() === normalized);
  if (!resolved) {
    throw new Error(`Unknown HIL action: ${actionId}`);
  }
  return resolved;
}

function applyCliHilAutoAnswers(
  review: CliHilReviewState,
  answers: Record<string, CliHilAnswerValue> | undefined,
): CliHilReviewState {
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

  const nextForm: CliHilFormState = {
    ...review.form,
    answers: {
      ...review.form.answers,
      ...nextAnswers,
    },
  };

  return {
    ...clearCliHilValidation(review),
    form: nextForm,
    draft: readHilFormDraft(nextForm),
  };
}

function parseEditedToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    throw new Error('This HIL action requires edited tool args in JSON object form.');
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

function applyCliHilOptionSelection(
  current: CliHilReviewState,
  optionLabel: string | undefined,
): CliHilReviewState | undefined {
  if (!current.form || !optionLabel) {
    return undefined;
  }

  const activeTab = current.form.tabs[current.form.activeTabIndex];
  if (!activeTab) {
    return undefined;
  }

  const answer = activeTab.input === 'multiselect'
    ? toggleHilFormSelection(current.form, optionLabel)
    : optionLabel;
  return commitCliHilAnswer(current, answer);
}

function applyCliHilDraftSelection(current: CliHilReviewState): CliHilReviewState {
  return commitCliHilAnswer(current, current.draft);
}

function commitCliHilAnswer(
  current: CliHilReviewState,
  answer: CliHilAnswerValue,
): CliHilReviewState {
  if (!current.form) {
    return current;
  }

  const nextForm = updateHilFormAnswer(current.form, answer);
  return {
    ...clearCliHilValidation(current),
    draft: readHilFormDraft(nextForm),
    form: nextForm,
    focus: 'input',
    selectedActionIndex: resolveHilInputSelectionIndex(nextForm, current.selectedActionIndex),
  };
}

export function advanceCliHilToNextStep(current: CliHilReviewState): CliHilReviewState {
  if (!current.form) {
    return current;
  }

  const currentTab = getActiveHilTab(current.form);
  if (currentTab && !isHilAnswerComplete(current.form.answers[currentTab.id])) {
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
      ...clearCliHilValidation(current),
      draft: readHilFormDraft(nextForm),
      form: nextForm,
      focus: 'input',
      selectedActionIndex: resolveHilInputSelectionIndex(nextForm),
    };
  }

  return {
    ...clearCliHilValidation(current),
    draft: '',
    form: {
      ...nextForm,
      endStep: true,
    },
    focus: 'actions',
    selectedActionIndex: 0,
  };
}

function defaultActionForDecision(decision: PauseReviewDecision): CliHilReviewAction {
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

function resolveCliHilFormState(
  request: PauseRequest,
  current: CliHilFormState | undefined,
): CliHilFormState | undefined {
  const parsed = readHilFormConfig(request.ui);
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

function updateHilFormAnswer(
  form: CliHilFormState,
  answer: CliHilAnswerValue,
): CliHilFormState {
  const activeTab = getActiveHilTab(form);
  if (!activeTab) {
    return form;
  }

  return {
    ...form,
    endStep: false,
    answers: {
      ...form.answers,
      [activeTab.id]: answer,
    },
  };
}

function readHilFormDraft(form: CliHilFormState): string {
  const activeTab = getActiveHilTab(form);
  if (!activeTab) {
    return '';
  }
  return formatHilAnswerValue(form.answers[activeTab.id] ?? '');
}

function acceptsHilDraftInput(
  tab: CliHilFormState['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

function resolveHilInputSelectionIndex(
  form: CliHilFormState,
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
  }

  return Math.min(fallbackIndex, Math.max(activeTab.options.length - 1, 0));
}

function readHilFormConfig(ui: PauseRequest['ui']): CliHilFormState | undefined {
  if (!ui || !ui.form || typeof ui.form !== 'object' || Array.isArray(ui.form)) {
    return undefined;
  }

  const form = ui.form;
  const tabs = Array.isArray(form.tabs)
    ? (form.tabs as unknown[])
      .map(normalizeHilFormTab)
      .filter((tab): tab is NonNullable<ReturnType<typeof normalizeHilFormTab>> => Boolean(tab))
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

function normalizeHilFormTab(tab: unknown) {
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
  const normalizedInput: 'select' | 'multiselect' | 'text' | 'mixed' | undefined =
    input === 'select' || input === 'multiselect' || input === 'text' || input === 'mixed'
      ? input
      : Array.isArray(record.options) && record.options.length > 0
        ? 'select'
        : typeof record.placeholder === 'string' && record.placeholder.trim()
          ? 'text'
          : undefined;

  const options = Array.isArray(record.options)
    ? record.options
      .map((option) => normalizeHilFormOption(option))
      .filter((option): option is NonNullable<ReturnType<typeof normalizeHilFormOption>> => Boolean(option))
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

function normalizeHilFormOption(option: unknown) {
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

function toggleHilFormSelection(form: CliHilFormState, label: string): string[] {
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

function formatHilAnswerValue(value: CliHilAnswerValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function getActiveHilTab(
  form: CliHilFormState,
): CliHilFormState['tabs'][number] | undefined {
  if (form.endStep) {
    return undefined;
  }
  return form.tabs[form.activeTabIndex];
}

function clearCliHilValidation(current: CliHilReviewState): CliHilReviewState {
  if (!current.validationMessage) {
    return current;
  }

  return {
    ...current,
    validationMessage: undefined,
  };
}

function findFirstIncompleteTabIndex(form: CliHilFormState): number {
  return form.tabs.findIndex((tab) => !isHilAnswerComplete(form.answers[tab.id]));
}

function findNextIncompleteTabIndex(form: CliHilFormState, currentIndex: number): number {
  for (let index = currentIndex + 1; index < form.tabs.length; index += 1) {
    const tab = form.tabs[index];
    if (tab && !isHilAnswerComplete(form.answers[tab.id])) {
      return index;
    }
  }

  return -1;
}

function isHilAnswerComplete(value: CliHilAnswerValue | undefined): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
}

function normalizeAnswerEntry(key: string, value: CliHilAnswerValue): Array<[string, CliHilAnswerValue]> {
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

// ── Permission three-stage flow ──────────────────────────────────────

/** Read alwaysPatterns from permission pause metadata. */
export function readPermissionAlwaysPatterns(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const policy = (metadata as Record<string, unknown>).permissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return [];
  const patterns = (policy as Record<string, unknown>).alwaysPatterns;
  return Array.isArray(patterns) ? patterns.filter((p): p is string => typeof p === 'string') : [];
}

/** Check if the current review is a permission review. */
export function isPermissionReviewState(review: CliHilReviewState): boolean {
  return isPermissionPauseRequest(review.request);
}

/** Transition to a permission stage. */
export function setPermissionStage(current: CliHilReviewState, stage: PermissionStage): CliHilReviewState {
  if (stage === 'always-confirm') {
    const patterns = current.permissionAlwaysPatterns ?? readPermissionAlwaysPatterns(current.request.metadata);
    return {
      ...current,
      permissionStage: stage,
      permissionAlwaysPatterns: patterns,
    };
  }

  if (stage === 'reject-feedback') {
    return {
      ...current,
      permissionStage: stage,
      draft: '',
    };
  }

  // Back to prompt
  return {
    ...current,
    permissionStage: 'prompt',
  };
}
