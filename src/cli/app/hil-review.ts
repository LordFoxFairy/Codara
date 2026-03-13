import type {PauseRequest, PauseReviewDecision, ResumePayload} from '@core/agents';
import type {CliHilReviewAction, CliHilReviewState} from './view-state';

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
  if (current?.request.id === request.id) {
    return {
      ...current,
      request,
      actions,
      selectedActionIndex: Math.min(current.selectedActionIndex, Math.max(actions.length - 1, 0)),
    };
  }

  return {
    request,
    actions,
    selectedActionIndex: 0,
    focus: 'actions',
    draft: '',
    busy: false,
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
  return {
    ...current,
    draft,
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
