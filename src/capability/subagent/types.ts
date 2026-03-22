import type {BaseMessage} from '@langchain/core/messages';
import type {SubagentResult} from '@shared/subagent-result';

export type SubagentRunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface SubagentRunRecord {
  runId: string;
  parentSessionId: string;
  batchId: string;
  batchExpectedCount: number;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  status: SubagentRunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  childSessionId?: string;
  latestActivity?: string;
  activityLog?: string[];
  summary?: string;
  errorMessage?: string;
  reason?: SubagentResult['reason'];
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
  completionClaimedAt?: string;
}

export interface SubagentRunStartInput {
  runId: string;
  parentSessionId: string;
  batchId?: string;
  batchExpectedCount?: number;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  childSessionId?: string;
}

export interface SubagentRunUpdateInput {
  latestActivity?: string;
  activityLabel?: string;
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

export interface SubagentCompletionRunSummary {
  runId: string;
  label: string;
  agentName: string;
  status: 'completed' | 'failed';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface SubagentCompletionContinuation {
  parentSessionId: string;
  batchId: string;
  runs: SubagentCompletionRunSummary[];
}

export interface SubagentRunDetail {
  runId: string;
  childSessionId: string;
  messages: BaseMessage[];
}

export interface SubagentRunStore {
  list(): SubagentRunRecord[];
  get(runId: string): SubagentRunRecord | undefined;
  start(input: SubagentRunStartInput): SubagentRunRecord;
  update(runId: string, input: SubagentRunUpdateInput): SubagentRunRecord;
  resume(runId: string, input?: SubagentRunResumeInput): SubagentRunRecord;
  pause(runId: string, input?: SubagentRunPauseInput): SubagentRunRecord;
  finish(runId: string, result: SubagentResult): SubagentRunRecord;
  takePendingCompletion(
    parentSessionId: string,
    preferredBatchIds?: readonly string[],
  ): SubagentCompletionContinuation | undefined;
  restorePendingCompletion(parentSessionId: string, batchId: string): void;
  recoverSession?(sessionId: string): void;
}
