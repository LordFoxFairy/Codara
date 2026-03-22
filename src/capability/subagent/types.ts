import type {DelegatedAgentResult} from '@shared/delegation-result';

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface AgentRunRecord {
  runId: string;
  parentSessionId: string;
  label: string;
  agentName: string;
  status: AgentRunStatus;
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

export interface AgentRunStartInput {
  runId: string;
  parentSessionId: string;
  label: string;
  agentName: string;
  childSessionId?: string;
  prompt?: string;
  maxTurns?: number;
  toolNames?: string[];
  systemMessages?: string[];
}

export interface AgentRunUpdateInput {
  latestActivity?: string;
  toolUseCount?: number;
}

export interface AgentRunResumeInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface AgentRunPauseInput {
  childSessionId?: string;
  latestActivity?: string;
}

export interface AgentRunStore {
  list(): AgentRunRecord[];
  get(runId: string): AgentRunRecord | undefined;
  start(input: AgentRunStartInput): AgentRunRecord;
  update(runId: string, input: AgentRunUpdateInput): AgentRunRecord;
  resume(runId: string, input?: AgentRunResumeInput): AgentRunRecord;
  pause(runId: string, input?: AgentRunPauseInput): AgentRunRecord;
  finish(runId: string, result: DelegatedAgentResult): AgentRunRecord;
  recoverSession?(sessionId: string): void;
}
