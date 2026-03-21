import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agent';
import type {PermissionStage} from '../components/permission/types';
import type {
  CliReviewAnswerValue,
  CliReviewFormState,
  CliReviewAction,
  CliReviewState,
} from './view-state';

export interface CliReviewAutoAction {
  action: string;
  scope?: string;
  comment?: string;
  editedToolArgs?: Record<string, unknown>;
  answers?: Record<string, CliReviewAnswerValue>;
}

export function syncCliReviewState(
  current: CliReviewState | undefined,
  request: PauseRequest | undefined,
): CliReviewState | undefined {
  if (!request) {
    return undefined;
  }

  const actions = resolveCliReviewActions(request);
  const form = resolveCliReviewFormState(request, current?.form);
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
          : resolveReviewInputSelectionIndex(form, current.selectedActionIndex)
        : Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0)),
      form,
      draft: form ? readReviewFormDraft(form) : current.draft,
      validationMessage: undefined,
    };
  }

  return {
    request,
    blockingScope: 'session',
    actions,
    selectedActionIndex: 0,
    focus: form ? (form.endStep ? 'actions' : 'input') : 'actions',
    draft: form ? readReviewFormDraft(form) : '',
    busy: false,
    ...(form ? {form} : {}),
  };
}

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

/** Count options + placeholder + actions as one unified navigable list. */
function countTotalNavigableItems(current: CliReviewState): number {
  if (!current.form) return current.actions.length;
  const activeTab = getActiveReviewTab(current.form);
  return current.focus === 'actions'
    ? current.form.endStep ? current.actions.length : 1
    : Math.max(activeTab?.options?.length ?? 0, 1);
}

/** Convert focus+selectedActionIndex to a single absolute index in the unified list. */
function toAbsoluteIndex(current: CliReviewState): number {
  return current.selectedActionIndex;
}

/** Apply absolute index back to focus+selectedActionIndex. */
function applyAbsoluteIndex(current: CliReviewState, absoluteIndex: number): CliReviewState {
  if (!current.form) {
    return {
      ...clearCliReviewValidation(current),
      selectedActionIndex: absoluteIndex % Math.max(current.actions.length, 1),
    };
  }
  return {
    ...clearCliReviewValidation(current),
    selectedActionIndex: absoluteIndex,
  };
}

export function toggleCliReviewFocus(current: CliReviewState): CliReviewState {
  if (current.focus === 'actions') {
    if (current.form?.endStep) {
      return current;
    }
    return {
      ...clearCliReviewValidation(current),
      focus: 'input',
      selectedActionIndex: current.form ? resolveReviewInputSelectionIndex(current.form) : current.selectedActionIndex,
    };
  }

  return {
    ...clearCliReviewValidation(current),
    focus: 'actions',
    selectedActionIndex: 0,
  };
}

export function updateCliReviewDraft(current: CliReviewState, draft: string): CliReviewState {
  if (current.form) {
    const nextForm = updateReviewFormAnswer(current.form, draft);
    return {
      ...clearCliReviewValidation(current),
      draft,
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
    };
  }

  if (current.form.activeTabIndex === current.form.tabs.length - 1 && findFirstIncompleteTabIndex(current.form) < 0) {
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
  };
}

export function applyCliReviewFormShortcut(current: CliReviewState, input: string): CliReviewState | undefined {
  if (!current.form) {
    return undefined;
  }

  const activeTab = getActiveReviewTab(current.form);
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

  return applyCliReviewOptionSelection(current, option.label);
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

  if (!acceptsReviewDraftInput(activeTab)) {
    return undefined;
  }

  return applyCliReviewDraftSelection(current);
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
  if (!activeTab || !acceptsReviewDraftInput(activeTab)) {
    return undefined;
  }

  return {
    ...clearCliReviewValidation(current),
    selectedActionIndex: Math.min(current.selectedActionIndex, Math.max(activeTab.options.length - 1, 0)),
  };
}

export function resolveCliReviewActions(request: PauseRequest): CliReviewAction[] {
  const configured = request.ui?.actions?.map((action) => ({
    ...action,
    kind: action.kind ?? 'secondary',
  })) ?? [];

  if (configured.length > 0) {
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
    : review.actions[review.selectedActionIndex];

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
          draft: readReviewFormDraft(nextForm),
          form: nextForm,
          validationMessage: tab ? `Complete ${tab.label} before submitting.` : 'Complete each question before submitting.',
        },
      };
    }
  }

  return {
    review: clearCliReviewValidation(nextReview),
    payload: buildCliReviewResumePayload(nextReview, actionOverride),
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
  return commitCliReviewAnswer(current, answer);
}

function applyCliReviewDraftSelection(current: CliReviewState): CliReviewState {
  return commitCliReviewAnswer(current, current.draft);
}

function commitCliReviewAnswer(
  current: CliReviewState,
  answer: CliReviewAnswerValue,
): CliReviewState {
  if (!current.form) {
    return current;
  }

  const nextForm = updateReviewFormAnswer(current.form, answer);
  return {
    ...clearCliReviewValidation(current),
    draft: readReviewFormDraft(nextForm),
    form: nextForm,
    focus: 'input',
    selectedActionIndex: resolveReviewInputSelectionIndex(nextForm, current.selectedActionIndex),
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
  };
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

function resolveCliReviewFormState(
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

function updateReviewFormAnswer(
  form: CliReviewFormState,
  answer: CliReviewAnswerValue,
): CliReviewFormState {
  const activeTab = getActiveReviewTab(form);
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

function readReviewFormDraft(form: CliReviewFormState): string {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return '';
  }
  return formatReviewAnswerValue(form.answers[activeTab.id] ?? '');
}

function acceptsReviewDraftInput(
  tab: CliReviewFormState['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

function resolveReviewInputSelectionIndex(
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
  }

  return Math.min(fallbackIndex, Math.max(activeTab.options.length - 1, 0));
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

function clearCliReviewValidation(current: CliReviewState): CliReviewState {
  if (!current.validationMessage) {
    return current;
  }

  return {
    ...current,
    validationMessage: undefined,
  };
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
export function isPermissionReviewState(review: CliReviewState): boolean {
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center';
}

/** Transition to a permission stage. */
export function setPermissionStage(current: CliReviewState, stage: PermissionStage): CliReviewState {
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
