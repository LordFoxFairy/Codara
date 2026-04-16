import type {CliReviewState} from './view-state';
import type {CliReviewKind} from './view-state';

export function getCliReviewKind(review: CliReviewState | undefined): CliReviewKind {
  if (!review) {
    return 'generic-review';
  }

  if (isPermissionReviewState(review)) {
    return 'permission';
  }

  if (isAskUserReviewState(review)) {
    return 'ask-user';
  }

  if (isToolReviewState(review)) {
    return 'tool-review';
  }

  return 'generic-review';
}

export function isPermissionReviewState(review: CliReviewState | undefined): boolean {
  if (!review) {
    return false;
  }

  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

export function isAskUserReviewState(review: CliReviewState | undefined): boolean {
  if (!review) {
    return false;
  }

  return Boolean(review.form)
    || review.request.action.toolName === 'AskUserQuestion'
    || review.request.channel === 'interaction-center'
    || Boolean(review.request.ui?.form);
}

export function isToolReviewState(review: CliReviewState | undefined): boolean {
  if (!review || isPermissionReviewState(review) || isAskUserReviewState(review)) {
    return false;
  }

  const toolName = review.request.action.toolName?.trim();
  return Boolean(toolName && toolName.length > 0);
}
