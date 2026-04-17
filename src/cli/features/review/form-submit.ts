/**
 * Review form submission.
 *
 * Builds resume payloads, prepares submissions, and resolves review actions
 * from a ReviewRequest. Split from form-state.ts to isolate the submission
 * path (payload building, action resolution, decision mapping) from the
 * form's state-transition functions.
 */
import type {ReviewRequest, ReviewDecision, ReviewResumePayload} from '@/index';
import type {CliReviewAutoAction} from '../../app/view-state';
import type {CliReviewAction, CliReviewState} from '../../app/view-state';
import {
  findFirstIncompleteTabIndex,
} from './form-tabs';
import {
  applyCliReviewAutoAnswers,
  clearCliReviewValidation,
} from './form-answers';
import {
  advanceCliReviewToNextStep,
  resolveCliReviewFocusedFooterAction,
} from './form-state';

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

// ── Private helpers ────────────────────────────────────────────────────

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
