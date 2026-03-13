import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agents';
import type {
  CliHilClarificationState,
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
  const clarification = resolveCliClarificationState(request, current?.clarification);
  if (current?.request.id === request.id) {
    return {
      ...current,
      request,
      actions,
      selectedActionIndex: Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0)),
      clarification,
      draft: clarification ? readClarificationDraft(clarification) : current.draft,
    };
  }

  return {
    request,
    actions,
    selectedActionIndex: 0,
    focus: 'actions',
    draft: clarification ? readClarificationDraft(clarification) : '',
    busy: false,
    ...(clarification ? {clarification} : {}),
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
  if (current.clarification) {
    const nextClarification = updateClarificationAnswer(current.clarification, draft);
    return {
      ...current,
      draft,
      clarification: nextClarification,
    };
  }

  return {
    ...current,
    draft,
  };
}

export function selectPreviousCliHilTab(current: CliHilReviewState): CliHilReviewState {
  if (!current.clarification || current.clarification.tabs.length === 0) {
    return current;
  }

  const nextClarification = {
    ...current.clarification,
    activeTabIndex: (current.clarification.activeTabIndex - 1 + current.clarification.tabs.length) % current.clarification.tabs.length,
  };

  return {
    ...current,
    clarification: nextClarification,
    draft: readClarificationDraft(nextClarification),
  };
}

export function selectNextCliHilTab(current: CliHilReviewState): CliHilReviewState {
  if (!current.clarification || current.clarification.tabs.length === 0) {
    return current;
  }

  const nextClarification = {
    ...current.clarification,
    activeTabIndex: (current.clarification.activeTabIndex + 1) % current.clarification.tabs.length,
  };

  return {
    ...current,
    clarification: nextClarification,
    draft: readClarificationDraft(nextClarification),
  };
}

export function applyCliHilClarificationShortcut(current: CliHilReviewState, input: string): CliHilReviewState | undefined {
  if (!current.clarification) {
    return undefined;
  }

  const activeTab = current.clarification.tabs[current.clarification.activeTabIndex];
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

  const answer = option.label;
  const nextClarification = updateClarificationAnswer(current.clarification, answer);
  return {
    ...current,
    draft: answer,
    clarification: nextClarification,
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

  if (review.clarification) {
    payload.metadata = {
      clarification: {
        activeTabId: review.clarification.tabs[review.clarification.activeTabIndex]?.id,
        answers: review.clarification.answers,
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

function resolveCliClarificationState(
  request: PauseRequest,
  current: CliHilClarificationState | undefined,
): CliHilClarificationState | undefined {
  const parsed = readClarificationMetadata(request.metadata);
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

function updateClarificationAnswer(
  clarification: CliHilClarificationState,
  answer: string,
): CliHilClarificationState {
  const activeTab = clarification.tabs[clarification.activeTabIndex];
  if (!activeTab) {
    return clarification;
  }

  return {
    ...clarification,
    answers: {
      ...clarification.answers,
      [activeTab.id]: answer,
    },
  };
}

function readClarificationDraft(clarification: CliHilClarificationState): string {
  const activeTab = clarification.tabs[clarification.activeTabIndex];
  if (!activeTab) {
    return '';
  }
  return clarification.answers[activeTab.id] ?? '';
}

function readClarificationMetadata(metadata: unknown): CliHilClarificationState | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const codara = (metadata as Record<string, unknown>).codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const clarification = (codara as Record<string, unknown>).clarification;
  if (!clarification || typeof clarification !== 'object' || Array.isArray(clarification)) {
    return undefined;
  }

  const tabs = Array.isArray((clarification as Record<string, unknown>).tabs)
    ? ((clarification as Record<string, unknown>).tabs as unknown[])
      .map(normalizeClarificationTab)
      .filter((tab): tab is NonNullable<ReturnType<typeof normalizeClarificationTab>> => Boolean(tab))
    : [];
  if (tabs.length === 0) {
    return undefined;
  }

  const summary = typeof (clarification as Record<string, unknown>).summary === 'string'
    ? String((clarification as Record<string, unknown>).summary).trim()
    : undefined;

  return {
    ...(summary ? {summary} : {}),
    tabs,
    activeTabIndex: 0,
    answers: {},
  };
}

function normalizeClarificationTab(tab: unknown) {
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

  const options = Array.isArray(record.options)
    ? record.options
      .map((option) => normalizeClarificationOption(option))
      .filter((option): option is NonNullable<ReturnType<typeof normalizeClarificationOption>> => Boolean(option))
    : [];
  const placeholder = typeof record.placeholder === 'string' ? record.placeholder.trim() : '';

  return {
    id,
    label,
    question,
    options,
    ...(placeholder ? {placeholder} : {}),
  };
}

function normalizeClarificationOption(option: unknown) {
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
