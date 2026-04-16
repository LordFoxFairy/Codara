/**
 * Codara public type definitions.
 *
 * This file is the single source of truth for the facade layer's type surface:
 *  - Configuration options  (CodaraOptions, CodaraRuntimeOptions)
 *  - Stream request types   (CodaraStreamRequest variants)
 *  - Query models           (ReviewQueryItem, SubagentRunQuerySummary, ...)
 *  - The Codara API handle  (Codara)
 */

import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {BaseMessage} from '@langchain/core/messages';
import type {AgentCheckpointer} from '@durability/checkpoint';
import type {BaseMiddleware} from '@core/pipeline-types';
import type {ReviewMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {SummarySettings} from '@core/middleware/summary';
import type {TaskStore} from '@capability/task';
import type {SubagentRunStore} from '@capability/subagent';
import type {ModelRoutingConfig} from '@integration/provider';
import type {SkillStore} from '@capability/skill';
import type {CodaraCommandResult, CodaraCommandSpec} from '@capability/command';
import type {Session, SessionState, SessionStore} from '@durability/session';
import type {ApprovalStore} from '@durability/approval-store';
import type {McpClientInfo, McpConfig} from '@integration/mcp';
import type {ChannelRegistry} from '@integration/channel';
import type {
  AgentInput,
  AgentResumeStreamConfig,
  AgentRuntimeContext,
  AgentResult,
  AgentStreamConfig,
  AgentStreamOutput,
  ReviewResumePayload,
} from '@core/agent';
import type {ReviewRequest} from '@shared/agent-types';
import type {CostSnapshot} from '@observability/cost';
import type {MemoryWriter} from '@capability/memory/writer';
import type {CodaraModelCatalog} from './assembly/runtime';

// ── Auxiliary Options ──

export type CodaraReviewOptions = ReviewMiddlewareOptions;

/** Configuration for the built-in skill discovery system. */
export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  subagentRoots?: string[];
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
  /** 启用后额外扫描 ~/.claude/skills/（Claude Code 兼容），默认关闭。 */
  claudeSkillsCompat?: boolean;
}

// ── Main Configuration ──

/** Base options shared by `createCodara` and `createCodaraRuntime`. */
export interface CodaraOptions {
  id?: string;
  config?: ModelRoutingConfig;
  alias?: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  middleware?: BaseMiddleware[];
  skills?: false | CodaraSkillOptions;
  summary?: false | SummarySettings;
  review?: false | CodaraReviewOptions;
  logging?: false | LoggingMiddlewareOptions;
  sessionId?: string;
  restore?: 'latest' | 'never';
  store?: SessionStore;
  checkpointer?: AgentCheckpointer;
  handleToolErrors?: boolean;
  inputBudget?: import('@core/agent').AgentInputBudget;
  messages?: import('@core/agent').AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  /** MCP server configuration. `false` to disable, omit for auto-detection from .codara/mcp.json. */
  mcp?: false | McpConfig;
}

/** Extended options for the full-runtime path (`createCodaraRuntime`). */
export interface CodaraRuntimeOptions extends CodaraOptions {
  codaraPath?: string;
  taskStore?: TaskStore;
  subagentRunStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  /** Optional pre-configured ChannelRegistry for multi-channel review routing. */
  channelRegistry?: ChannelRegistry;
}

export type CreateCodaraModelCatalogOptions = Pick<CodaraOptions, 'config'>;

export type CreateCodaraChatModelOptions =
  Pick<CodaraOptions, 'alias' | 'config'>
  & { catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog> };

export type CodaraMiddlewareOptions = Pick<CodaraOptions, 'middleware' | 'review' | 'logging'>;

// ── Query Types (read-only projections for UI/CLI) ──

/** Lightweight summary for listing subagent runs. */
export interface SubagentRunQuerySummary {
  runId: string;
  parentSessionId: string;
  label: string;
  agentName: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  childSessionId?: string;
  latestActivity?: string;
  activityLog?: string[];
  summary?: string;
  errorMessage?: string;
  reason?: 'complete' | 'error' | 'max_turns' | 'budget_exhausted' | 'aborted';
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

/** Full message history for a single subagent run (used by detail views). */
export interface SubagentRunQueryDetail {
  runId: string;
  childSessionId: string;
  messages: BaseMessage[];
}

// ── Review Query Types ──

export type ReviewQuerySource = 'subagent_run' | 'session_review';
export type ReviewQueryKind = 'approval' | 'permission' | 'ask_user' | 'generic';
export type ReviewInteractionMode = 'approval' | 'structured' | 'freeform' | 'hybrid';
export type ReviewBlockingScope = 'session' | 'task' | 'none';

export interface ReviewQueryAnchor {
  origin: 'main' | 'delegated';
  subagentRunId?: string;
  childSessionId?: string;
  parentSessionId?: string;
}

export interface ReviewQueryItem {
  reviewId: string;
  source: ReviewQuerySource;
  kind: ReviewQueryKind;
  interactionMode: ReviewInteractionMode;
  blockingScope: ReviewBlockingScope;
  description: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
  anchor: ReviewQueryAnchor;
  isFocused: boolean;
}

export interface FocusedReviewQuery {
  item: ReviewQueryItem;
  request: ReviewRequest;
}

// ── Stream Request Variants ──

/** Start a new interaction turn from user input. */
export interface CodaraPromptStreamRequest {
  kind: 'prompt';
  input?: AgentInput;
  config?: AgentStreamConfig;
}

/** Continue an ongoing turn with additional runtime context. */
export interface CodaraContinuationStreamRequest {
  kind: 'continuation';
  context: AgentRuntimeContext;
  config?: Omit<AgentStreamConfig, 'context'>;
}

/** Resume after a review decision (approve/reject/provide input). */
export interface CodaraReviewStreamRequest {
  kind: 'review';
  payload: ReviewResumePayload;
  config?: AgentResumeStreamConfig;
}

export type CodaraStreamRequest =
  | CodaraPromptStreamRequest
  | CodaraContinuationStreamRequest
  | CodaraReviewStreamRequest;

// ── Codara API Handle ──

/**
 * The unified Codara runtime handle.
 *
 * Extends `Session` (minus raw review methods) with Commands, Review,
 * InteractionStream, SubagentRun queries, MCP status, Memory, and Cost.
 */
export type Codara = Omit<Session, 'resumeReview' | 'resumeReviewStream'> & {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
  listSessions(options?: import('@durability/session').SessionListOptions): Promise<SessionState[]>;
  getMcpStatus(): McpClientInfo[];
  getSubagentRunSummaries(): SubagentRunQuerySummary[];
  getSubagentRunDetails(runIds?: readonly string[]): Promise<SubagentRunQueryDetail[]>;
  listReviewItems(): ReviewQueryItem[];
  getFocusedReview(): FocusedReviewQuery | undefined;
  focusReview(reviewId: string): Promise<void>;
  streamInteraction(request: CodaraStreamRequest): AsyncGenerator<AgentStreamOutput, void, void>;
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<AgentResult | undefined>;
  getChannelRegistry(): ChannelRegistry | undefined;
  getMemoryWriter(): MemoryWriter | undefined;
  getCostSnapshot(): CostSnapshot;
};
