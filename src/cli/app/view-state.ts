import type {PauseRequest, PauseUIActionOption, PauseUIFormOption, PauseUIFormTab} from '@engine/agent';
import type {PermissionStage} from '../components/permission/types';

export type CliStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export type CliHilAnswerValue = string | string[];

export interface CliRunState {
  status: CliStatus;
  error?: string;
}

export interface CliNotice {
  id: string;
  level: 'system' | 'warning' | 'error';
  content: string;
}

export interface CliActiveTurn {
  id: string;
  prompt: string;
  response: string;
  responseRole: 'assistant' | 'system';
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
}
