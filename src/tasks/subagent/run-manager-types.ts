/**
 * Shared types for the subagent run manager + its helpers.
 *
 * Factored out so helper files (`run-lifecycle.ts`, `run-approval.ts`,
 * `run-resume.ts`) can depend on these types without circular imports
 * through `run-manager.ts` itself.
 *
 * @module
 */

import type {AgentResumeStreamConfig, AgentStreamOutput, ReviewRequest} from '@core/agent';
import type {Agent, ReviewResumePayload} from '@core/agent/agent-types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {ApprovalRecord, ApprovalStore} from '@state/approval-store';
import type {ChildToolActivityCallback} from '@events';
import type {CodaraRuntimeEventListener} from '@events';
import type {SubagentCompletionContinuation, SubagentRunRecord, SubagentRunStore} from '@tasks/subagent/types';
import type {SubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {TaskRegistry} from '@tasks/task-registry';

// ---------------------------------------------------------------------------
// Public input/output shapes
// ---------------------------------------------------------------------------

export interface SubagentLaunchInput {
  runId: string;
  parentSessionId: string;
  batchId: string;
  batchExpectedCount: number;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  prompt: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export interface SubagentRunManager {
  launch(input: SubagentLaunchInput): Promise<SubagentRunLaunchResult>;
  waitForCompletion(parentSessionId: string, batchIds: readonly string[]): Promise<SubagentCompletionContinuation | undefined>;
  registerRecoveryBuilder(builder: SubagentRecoveryBuilder): void;
  setOnAgentEvent(listener: CodaraRuntimeEventListener, sessionId: string | (() => string)): void;
  recordActivity(runId: string, info: Parameters<ChildToolActivityCallback>[0]): void;
  resumeRun(runId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeRunStream(
    runId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
  dispose(): Promise<void>;
}

export interface SubagentReviewResumer {
  resumeApprovalById(approvalId: string, payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalByIdStream(
    approvalId: string,
    payload: ReviewResumePayload,
    config?: AgentResumeStreamConfig,
  ): AsyncGenerator<AgentStreamOutput, void, void>;
}

export interface CreateSubagentRunManagerOptions {
  runStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  taskRegistry?: TaskRegistry;
}

export interface SubagentRecoverySpec {
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
}

export type SubagentRecoveryBuilder = (
  run: SubagentRunRecord,
  approval?: ApprovalRecord,
) => Promise<SubagentRecoverySpec | undefined> | SubagentRecoverySpec | undefined;

// ---------------------------------------------------------------------------
// Internal handle + waiter shapes
// ---------------------------------------------------------------------------

export interface SubagentRunHandle {
  runId: string;
  parentSessionId: string;
  batchId: string;
  childSessionId: string;
  label: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  childOptions: BootstrapAgentOptions;
  maxTurns?: number;
  agent?: Agent;
  agentPromise?: Promise<Agent>;
}

export interface CompletionWaiter {
  parentSessionId: string;
  batchIds: ReadonlySet<string>;
  resolve: (value: SubagentCompletionContinuation | undefined) => void;
}

// ---------------------------------------------------------------------------
// Re-exports for convenience (so consumers can import from a single file)
// ---------------------------------------------------------------------------

export type {ReviewRequest};
