import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agent';
import type {PermissionStage} from '../components/permission/types';
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
      selectedActionIndex: Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0)),
      form,
      draft: form ? readHilFormDraft(form) : current.draft,
      validationMessage: undefined,
    };
  }

  return {
    request,
    actions,
    selectedActionIndex: 0,
    focus: form ? 'input' : 'actions',
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
  const activeTab = current.form.tabs[current.form.activeTabIndex];
  const optionCount = (activeTab?.options?.length ?? 0) + (activeTab?.placeholder ? 1 : 0);
  return optionCount + current.actions.length;
}

/** Convert focus+selectedActionIndex to a single absolute index in the unified list. */
function toAbsoluteIndex(current: CliHilReviewState): number {
  if (!current.form) return current.selectedActionIndex;
  const activeTab = current.form.tabs[current.form.activeTabIndex];
  const optionCount = (activeTab?.options?.length ?? 0) + (activeTab?.placeholder ? 1 : 0);
  if (current.focus === 'actions') return optionCount + current.selectedActionIndex;
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
  const activeTab = current.form.tabs[current.form.activeTabIndex];
  const optionCount = (activeTab?.options?.length ?? 0) + (activeTab?.placeholder ? 1 : 0);
  if (absoluteIndex < optionCount) {
    return {
      ...clearCliHilValidation(current),
      focus: 'input',
      selectedActionIndex: absoluteIndex,
    };
  }
  return {
    ...clearCliHilValidation(current),
    focus: 'actions',
    selectedActionIndex: absoluteIndex - optionCount,
  };
}

export function toggleCliHilFocus(current: CliHilReviewState): CliHilReviewState {
  return {
    ...clearCliHilValidation(current),
    focus: current.focus === 'actions' ? 'input' : 'actions',
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

  const nextForm = {
    ...current.form,
    activeTabIndex: (current.form.activeTabIndex - 1 + current.form.tabs.length) % current.form.tabs.length,
  };

  return {
    ...clearCliHilValidation(current),
    form: nextForm,
    draft: readHilFormDraft(nextForm),
  };
}

export function selectNextCliHilTab(current: CliHilReviewState): CliHilReviewState {
  if (!current.form || current.form.tabs.length === 0) {
    return current;
  }

  const nextForm = {
    ...current.form,
    activeTabIndex: (current.form.activeTabIndex + 1) % current.form.tabs.length,
  };

  return {
    ...clearCliHilValidation(current),
    form: nextForm,
    draft: readHilFormDraft(nextForm),
  };
}

export function applyCliHilFormShortcut(current: CliHilReviewState, input: string): CliHilReviewState | undefined {
  if (!current.form) {
    return undefined;
  }

  const activeTab = current.form.tabs[current.form.activeTabIndex];
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

  const answer = activeTab.input === 'multiselect'
    ? toggleHilFormSelection(current.form, option.label)
    : option.label;
  let nextForm = updateHilFormAnswer(current.form, answer);
  if (activeTab.input !== 'multiselect') {
    const nextIncompleteTabIndex = findNextIncompleteTabIndex(nextForm, current.form.activeTabIndex);
    if (nextIncompleteTabIndex >= 0) {
      nextForm = {
        ...nextForm,
        activeTabIndex: nextIncompleteTabIndex,
      };
    }
  }

  return {
    ...clearCliHilValidation(current),
    draft: readHilFormDraft(nextForm),
    form: nextForm,
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
  };
}

function updateHilFormAnswer(
  form: CliHilFormState,
  answer: CliHilAnswerValue,
): CliHilFormState {
  const activeTab = form.tabs[form.activeTabIndex];
  if (!activeTab) {
    return form;
  }

  return {
    ...form,
    answers: {
      ...form.answers,
      [activeTab.id]: answer,
    },
  };
}

function readHilFormDraft(form: CliHilFormState): string {
  const activeTab = form.tabs[form.activeTabIndex];
  if (!activeTab) {
    return '';
  }
  return formatHilAnswerValue(form.answers[activeTab.id] ?? '');
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
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center';
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

