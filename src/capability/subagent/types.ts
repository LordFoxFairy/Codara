import type {SubagentResult} from '@shared/subagent-result';

export type SubagentRunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface SubagentRunRecord {
  runId: string;
  parentSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  status: SubagentRunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  childSessionId?: string;
  latestActivity?: string;
  summary?: string;
  errorMessage?: string;
  reason?: SubagentResult['reason'];
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface SubagentRunStartInput {
  runId: string;
  parentSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  childSessionId?: string;
}

export interface SubagentRunUpdateInput {
  latestActivity?: string;
  toolUseCount?: number;
}

export interface SubagentRunResumeInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface SubagentRunPauseInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface SubagentRunStore {
  list(): SubagentRunRecord[];
  get(runId: string): SubagentRunRecord | undefined;
  start(input: SubagentRunStartInput): SubagentRunRecord;
  update(runId: string, input: SubagentRunUpdateInput): SubagentRunRecord;
  resume(runId: string, input?: SubagentRunResumeInput): SubagentRunRecord;
  pause(runId: string, input?: SubagentRunPauseInput): SubagentRunRecord;
  finish(runId: string, result: SubagentResult): SubagentRunRecord;
  recoverSession?(sessionId: string): void;
}
