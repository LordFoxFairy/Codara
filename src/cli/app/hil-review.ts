import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agents';
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
    };
  }

  return {
    request,
    actions,
    selectedActionIndex: 0,
    focus: 'actions',
    draft: form ? readHilFormDraft(form) : '',
    busy: false,
    ...(form ? {form} : {}),
  };
}

export function selectPreviousCliHilAction(current: CliHilReviewState): CliHilReviewState {
  if (current.actions.length === 0) {
    return current;
  }

  return {
    ...current,
    selectedActionIndex: (current.selectedActionIndex - 1 + current.actions.length) % current.actions.length,
  };
}

export function selectNextCliHilAction(current: CliHilReviewState): CliHilReviewState {
  if (current.actions.length === 0) {
    return current;
  }

  return {
    ...current,
    selectedActionIndex: (current.selectedActionIndex + 1) % current.actions.length,
  };
}

export function toggleCliHilFocus(current: CliHilReviewState): CliHilReviewState {
  return {
    ...current,
    focus: current.focus === 'actions' ? 'input' : 'actions',
  };
}

export function updateCliHilDraft(current: CliHilReviewState, draft: string): CliHilReviewState {
  if (current.form) {
    const nextForm = updateHilFormAnswer(current.form, draft);
    return {
      ...current,
      draft,
      form: nextForm,
    };
  }

  return {
    ...current,
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
    ...current,
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
    ...current,
    form: nextForm,
    draft: readHilFormDraft(nextForm),
  };
}

export function applyCliHilFormShortcut(current: CliHilReviewState, input: string): CliHilReviewState | undefined {
  if (!current.form) {
    return undefined;
  }

  const activeTab = current.form.tabs[current.form.activeTabIndex];
  if (!activeTab) {
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
  const nextForm = updateHilFormAnswer(current.form, answer);
  return {
    ...current,
    draft: formatHilAnswerValue(answer),
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

function resolveRequestedAction(actions: readonly CliHilReviewAction[], actionId: string): CliHilReviewAction {
  const normalized = actionId.trim().toLowerCase();
  const resolved = actions.find((action) => action.id.toLowerCase() === normalized);
  if (!resolved) {
    throw new Error(`Unknown HIL action: ${actionId}`);
  }
  return resolved;
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
  if (normalized === 'approve' || normalized === 'allow' || normalized === 'allow_once' || normalized === 'always') {
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
