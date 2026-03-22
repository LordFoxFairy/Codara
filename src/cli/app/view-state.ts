import type {ReviewRequest, ReviewUIActionOption, ReviewUIFormOption, ReviewUIFormTab} from '@core/agent';
import type {ReviewBlockingScope} from '../../codara/types';
import type {PermissionStage} from './review-types';

export type CliStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export type CliReviewAnswerValue = string | string[];
export type CliInteractionSurface = 'prompt' | 'review' | 'completion' | 'command-output' | 'session-picker';
export type CliInteractionKind = 'session_prompt' | 'review_response' | 'agent_continuation';

export interface CliRunState {
  status: CliStatus;
  error?: string;
}

export interface CliInteractionState {
  focusedSurface: CliInteractionSurface;
  activeKind?: CliInteractionKind;
  pendingCount: number;
  promptBlocked: boolean;
}

export interface CliNotice {
  id: string;
  level: 'system' | 'warning' | 'error' | 'command' | 'assistant';
  content: string;
}

export interface CliActiveTurn {
  id: string;
  prompt: string;
  pendingResponse?: string;
  responseBeforeRuntime?: string;
  response: string;
  responseRole: 'assistant' | 'system';
  kind?: 'prompt' | 'subagent_completion';
  /** True once the current streaming turn delegates the foreground to an internal interaction surface. */
  suppressInteractionResponse?: boolean;
  /** True once the current streaming model message includes an Agent tool call. */
  pendingAgentLaunch?: boolean;
  /** True only when task launch chatter was detected before any visible response text was emitted. */
  suppressAgentLaunchResponse?: boolean;
  /** Accumulated thinking/reasoning text (Extended Thinking). */
  thinking?: string;
  /** Real-time token counts from streaming chunks. */
  streamingTokens?: { input: number; output: number };
}

export type CliReviewFocus = 'actions' | 'input';

export interface CliReviewAction extends ReviewUIActionOption {
  kind: 'primary' | 'secondary' | 'danger';
}

export type CliReviewFormOption = ReviewUIFormOption;

export type CliReviewFormTab = Omit<ReviewUIFormTab, 'options'> & {
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
  request: ReviewRequest;
  blockingScope: ReviewBlockingScope;
  actions: CliReviewAction[];
  selectedActionIndex: number;
  focus: CliReviewFocus;
  draft: string;
  customInputSelected?: boolean;
  customInputActive?: boolean;
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
