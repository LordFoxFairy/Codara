import type {PauseRequest, PauseUIActionOption, PauseUIFormOption, PauseUIFormTab} from '@core/agent';
import type {PermissionStage} from '../components/permission/types';

export type CliStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export type CliHilAnswerValue = string | string[];

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
  /** True only when task launch chatter was detected before any visible response text was emitted. */
  suppressTaskLaunchResponse?: boolean;
  /** Accumulated thinking/reasoning text (Extended Thinking). */
  thinking?: string;
  /** Real-time token counts from streaming chunks. */
  streamingTokens?: { input: number; output: number };
}

export type CliHilFocus = 'actions' | 'input';

export interface CliHilReviewAction extends PauseUIActionOption {
  kind: 'primary' | 'secondary' | 'danger';
}

export type CliHilFormOption = PauseUIFormOption;

export type CliHilFormTab = Omit<PauseUIFormTab, 'options'> & {
  options: CliHilFormOption[];
};

export interface CliHilFormState {
  summary?: string;
  tabs: CliHilFormTab[];
  activeTabIndex: number;
  answers: Record<string, CliHilAnswerValue>;
  endStep?: boolean;
}

export interface CliHilReviewState {
  request: PauseRequest;
  actions: CliHilReviewAction[];
  selectedActionIndex: number;
  focus: CliHilFocus;
  draft: string;
  busy: boolean;
  validationMessage?: string;
  form?: CliHilFormState;
  /** Permission three-stage flow state */
  permissionStage?: PermissionStage;
  /** Always-pattern candidates for permission stage 2 */
  permissionAlwaysPatterns?: string[];
  approvalIndex?: number;
  approvalCount?: number;
}
