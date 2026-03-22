import type {CliReviewAnswerValue} from './view-state';

export interface CliReviewAutoAction {
  action: string;
  scope?: string;
  comment?: string;
  editedToolArgs?: Record<string, unknown>;
  answers?: Record<string, CliReviewAnswerValue>;
}
