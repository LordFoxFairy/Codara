export type CliStatus = 'idle' | 'running' | 'done' | 'error';

export type CliRole = 'system' | 'user' | 'assistant' | 'error';

export interface CliRunState {
  status: CliStatus;
  error?: string;
}

export interface CliMessage {
  id: string;
  role: CliRole;
  content: string;
}

export interface CliComposerState {
  text: string;
  cursorOffset: number;
}

export interface CliSessionMeta {
  title: string;
  subtitle: string;
  model: string;
  route: string;
  mode: string;
  session: string;
}
