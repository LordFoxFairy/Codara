import type {PauseRequest, PauseUIActionOption} from '@core/agents';

export type CliStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

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

export interface CliHilReviewState {
  request: PauseRequest;
  actions: CliHilReviewAction[];
  selectedActionIndex: number;
  focus: CliHilFocus;
  draft: string;
  busy: boolean;
}
