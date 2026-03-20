import type {DelegatedAgentResult} from '@shared/delegation-result';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';
export type TaskRunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface TaskRecord {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blocks: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskRunRecord {
  runId: string;
  sessionId: string;
  label: string;
  agentName: string;
  status: TaskRunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  childSessionId?: string;
  prompt?: string;
  maxTurns?: number;
  toolNames?: string[];
  systemMessages?: string[];
  latestActivity?: string;
  summary?: string;
  errorMessage?: string;
  reason?: DelegatedAgentResult['reason'];
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface CreateTaskInput {
  subject: string;
  description: string;
  activeForm?: string;
}

export interface UpdateTaskInput {
  taskId: string;
  status?: TaskStatus;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

export interface TaskStore {
  list(): Promise<TaskRecord[]>;
  get(taskId: string): Promise<TaskRecord | undefined>;
  create(input: CreateTaskInput): Promise<TaskRecord>;
  update(input: UpdateTaskInput): Promise<TaskRecord>;
}

export interface TaskRunStartInput {
  runId: string;
  sessionId: string;
  label: string;
  agentName: string;
  childSessionId?: string;
  prompt?: string;
  maxTurns?: number;
  toolNames?: string[];
  systemMessages?: string[];
}

export interface TaskRunUpdateInput {
  latestActivity?: string;
  toolUseCount?: number;
}

export interface TaskRunResumeInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface TaskRunPauseInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface TaskRunStore {
  list(): TaskRunRecord[];
  get(runId: string): TaskRunRecord | undefined;
  start(input: TaskRunStartInput): TaskRunRecord;
  update(runId: string, input: TaskRunUpdateInput): TaskRunRecord;
  resume(runId: string, input?: TaskRunResumeInput): TaskRunRecord;
  pause(runId: string, input?: TaskRunPauseInput): TaskRunRecord;
  finish(runId: string, result: DelegatedAgentResult): TaskRunRecord;
  recoverSession?(sessionId: string): void;
}
