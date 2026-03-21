import type {PauseRequest, PauseUIActionOption, PauseUIFormOption, PauseUIFormTab} from '@core/agent';
import type {ReviewBlockingScope} from '../../codara/types';
import type {PermissionStage} from '../components/permission/types';

export type CliStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export type CliReviewAnswerValue = string | string[];
export type CliInputTarget = 'prompt' | 'review';

export interface CliRunState {
  status: CliStatus;
  error?: string;
}

export interface CliNotice {
  id: string;
  level: 'system' | 'warning' | 'error' | 'command' | 'assistant';
  content: string;
}

export interface CliActiveTurn {
  id: string;
  prompt: string;
  response: string;
  responseRole: 'assistant' | 'system';
  kind?: 'prompt' | 'task_completion';
  /** True once the current streaming model message includes a Task tool call. */
  pendingTaskLaunch?: boolean;
  /** Accumulated thinking/reasoning text (Extended Thinking). */
  thinking?: string;
  /** Real-time token counts from streaming chunks. */
  streamingTokens?: { input: number; output: number };
}

export type CliReviewFocus = 'actions' | 'input';

export interface CliReviewAction extends PauseUIActionOption {
  kind: 'primary' | 'secondary' | 'danger';
}

export type CliReviewFormOption = PauseUIFormOption;

export type CliReviewFormTab = Omit<PauseUIFormTab, 'options'> & {
  options: CliReviewFormOption[];
};

export interface CliReviewFormState {
  summary?: string;
  tabs: CliReviewFormTab[];
  activeTabIndex: number;
  answers: Record<string, CliReviewAnswerValue>;
  endStep?: boolean;
}

export interface CliReviewState {
  request: PauseRequest;
  blockingScope: ReviewBlockingScope;
  actions: CliReviewAction[];
  selectedActionIndex: number;
  focus: CliReviewFocus;
  draft: string;
  busy: boolean;
  validationMessage?: string;
  form?: CliReviewFormState;
  /** Permission three-stage flow state */
  permissionStage?: PermissionStage;
  /** Always-pattern candidates for permission stage 2 */
  permissionAlwaysPatterns?: string[];
  reviewIndex?: number;
  reviewCount?: number;
}
