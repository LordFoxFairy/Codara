import {
  applyCliHilFormShortcut,
  selectNextCliHilAction,
  selectNextCliHilTab,
  selectPreviousCliHilAction,
  selectPreviousCliHilTab,
  setPermissionStage,
  toggleCliHilFocus,
  updateCliHilDraft,
  type CliHilAutoAction,
} from './hil-review';
import type {CliHilReviewState} from './view-state';

type UpdateHilReview = (
  updater: (current: CliHilReviewState | undefined) => CliHilReviewState | undefined,
) => void;

export interface CreateCliHilReviewControlsInput {
  setHilReview: UpdateHilReview;
  getCurrentReview: () => CliHilReviewState | undefined;
  submitHilAction: (autoAction?: CliHilAutoAction) => void | Promise<void>;
}

export interface CliHilReviewControls {
  moveHilLeft: () => void;
  moveHilRight: () => void;
  selectPreviousHilAction: () => void;
  selectNextHilAction: () => void;
  toggleHilFocus: () => void;
  insertHilText: (input: string) => void;
  insertHilNewline: () => void;
  backspaceHilInput: () => void;
  quickHilAction: (actionId: string) => void;
  permissionBack: () => void;
  permissionConfirm: () => void;
  permissionRejectSend: () => void;
  permissionRejectSilent: () => void;
}

export function createCliHilReviewControls(input: CreateCliHilReviewControlsInput): CliHilReviewControls {
  return {
    moveHilLeft: () => {
      input.setHilReview((current) => current?.form
        ? selectPreviousCliHilTab(current)
        : current
          ? toggleCliHilFocus(current)
          : current);
    },

    moveHilRight: () => {
      input.setHilReview((current) => current?.form
        ? selectNextCliHilTab(current)
        : current
          ? toggleCliHilFocus(current)
          : current);
    },

    selectPreviousHilAction: () => {
      input.setHilReview((current) => current ? selectPreviousCliHilAction(current) : current);
    },

    selectNextHilAction: () => {
      input.setHilReview((current) => current ? selectNextCliHilAction(current) : current);
    },

    toggleHilFocus: () => {
      input.setHilReview((current) => current ? toggleCliHilFocus(current) : current);
    },

    insertHilText: (text: string) => {
      input.setHilReview((current) => {
        if (!current) {
          return current;
        }

        const shortcut = applyCliHilFormShortcut(current, text);
        if (shortcut) {
          return shortcut;
        }

        if (current.focus !== 'input') {
          return current;
        }

        return updateCliHilDraft(current, current.draft + text);
      });
    },

    insertHilNewline: () => {
      input.setHilReview((current) => {
        if (!current || current.focus !== 'input') {
          return current;
        }
        return updateCliHilDraft(current, `${current.draft}\n`);
      });
    },

    backspaceHilInput: () => {
      input.setHilReview((current) => {
        if (!current || current.focus !== 'input' || current.draft.length === 0) {
          return current;
        }
        return updateCliHilDraft(current, current.draft.slice(0, -1));
      });
    },

    quickHilAction: (actionId: string) => {
      if (actionId === 'dont_ask_again') {
        input.setHilReview((current) => current ? setPermissionStage(current, 'always-confirm') : current);
        return;
      }

      if (actionId === 'deny') {
        input.setHilReview((current) => current ? setPermissionStage(current, 'reject-feedback') : current);
        return;
      }

      void input.submitHilAction({action: actionId});
    },

    permissionBack: () => {
      input.setHilReview((current) => current ? setPermissionStage(current, 'prompt') : current);
    },

    permissionConfirm: () => {
      void input.submitHilAction({action: 'dont_ask_again'});
    },

    permissionRejectSend: () => {
      const review = input.getCurrentReview();
      if (!review) {
        return;
      }

      void input.submitHilAction({
        action: 'deny',
        comment: review.draft.trim() || undefined,
      });
    },

    permissionRejectSilent: () => {
      void input.submitHilAction({action: 'deny'});
    },
  };
}
