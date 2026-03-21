import type {PauseRequest} from '@core/agent';
import type {CliReviewState} from './view-state';
export type {CliReviewAutoAction} from './review-auto-action';
export {
  activateCliReviewFocusedSelection,
  advanceCliReviewToNextStep,
  applyCliReviewFormShortcut,
  buildCliReviewResumePayload,
  confirmCliReviewFocusedSelection,
  prepareCliReviewDraftInput,
  prepareCliReviewSubmission,
  resolveCliReviewActions,
  resolveCliReviewFocusedFooterAction,
  resolveCliReviewFormState,
  resolveReviewInputSelectionIndex,
  readReviewFormDraft,
  selectNextCliReviewAction,
  selectNextCliReviewTab,
  selectPreviousCliReviewAction,
  selectPreviousCliReviewTab,
  shouldSpaceInsertIntoCliReviewDraft,
  toggleCliReviewFocus,
  updateCliReviewDraft,
  hasCustomAnswerForActiveTab,
} from './review-form-state';
export {
  readPermissionAlwaysPatterns,
  setPermissionStage,
} from './review-permission-state';
export {getCliReviewKind, isPermissionReviewState, isToolReviewState} from './review-kind';
import {
  hasCustomAnswerForActiveTab,
  readReviewFormDraft,
  resolveCliReviewActions,
  resolveCliReviewFormState,
  resolveReviewInputSelectionIndex,
} from './review-form-state';

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
      customInputSelected: current.customInputSelected ?? (form ? hasCustomAnswerForActiveTab(form) : false),
      customInputActive: current.customInputActive,
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
    customInputSelected: form ? hasCustomAnswerForActiveTab(form) : false,
    customInputActive: false,
    busy: false,
    ...(form ? {form} : {}),
  };
}
