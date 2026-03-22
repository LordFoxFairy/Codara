import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentCheckpointer} from '@durability/checkpoint';
import type {BaseMiddleware} from '@core/pipeline/types';
import type {ReviewMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {SummarySettings} from '@core/middleware/summary';
import type {TaskStore} from '@capability/task';
import type {AgentRunStore} from '@capability/subagent';
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
import type {ReviewRequest} from '@shared/contracts/agent-types';
import type {CodaraModelCatalog} from './assembly/runtime';

// ── Skill & Memory Options ──

export type CodaraReviewOptions = ReviewMiddlewareOptions;

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

export interface CodaraAutoMemoryOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  autoGlobal?: boolean;
  rootDir?: string;
}

// ── Main Configuration ──

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
  autoMemory?: false | CodaraAutoMemoryOptions;
  /** MCP server configuration. `false` to disable, omit for auto-detection from .codara/mcp.json. */
  mcp?: false | McpConfig;
}

export interface CodaraRuntimeOptions extends CodaraOptions {
  codaraPath?: string;
  taskStore?: TaskStore;
  agentRunStore?: AgentRunStore;
  approvalStore?: ApprovalStore;
  /** Optional pre-configured ChannelRegistry for multi-channel review routing. */
  channelRegistry?: ChannelRegistry;
}

export type CreateCodaraModelCatalogOptions = Pick<CodaraOptions, 'config'>;

export type CreateCodaraChatModelOptions =
  Pick<CodaraOptions, 'alias' | 'config'>
  & { catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog> };

export type CodaraMiddlewareOptions = Pick<CodaraOptions, 'middleware' | 'review' | 'logging'>;

// ── Query Types ──

export interface AgentRunQuerySummary {
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
  summary?: string;
  errorMessage?: string;
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export type ReviewQuerySource = 'agent_run' | 'session_pause';
export type ReviewQueryKind = 'approval' | 'permission' | 'ask_user' | 'generic';
export type ReviewInteractionMode = 'approval' | 'structured' | 'freeform' | 'hybrid';
export type ReviewBlockingScope = 'session' | 'task' | 'none';

export interface ReviewQueryAnchor {
  origin: 'main' | 'delegated';
  agentRunId?: string;
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

export interface CodaraPromptStreamRequest {
  kind: 'prompt';
  input?: AgentInput;
  config?: AgentStreamConfig;
}

export interface CodaraContinuationStreamRequest {
  kind: 'continuation';
  context: AgentRuntimeContext;
  config?: Omit<AgentStreamConfig, 'context'>;
}

export interface CodaraReviewStreamRequest {
  kind: 'review';
  payload: ReviewResumePayload;
  config?: AgentResumeStreamConfig;
}

export type CodaraStreamRequest =
  | CodaraPromptStreamRequest
  | CodaraContinuationStreamRequest
  | CodaraReviewStreamRequest;

// ── Codara API Type ──

export type Codara = Omit<Session, 'resumeReview' | 'resumeReviewStream'> & {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
  listSessions(options?: import('@durability/session').SessionListOptions): Promise<SessionState[]>;
  getMcpStatus(): McpClientInfo[];
  getAgentRunSummaries(): AgentRunQuerySummary[];
  listReviewItems(): ReviewQueryItem[];
  getFocusedReview(): FocusedReviewQuery | undefined;
  focusReview(reviewId: string): Promise<void>;
  streamInteraction(request: CodaraStreamRequest): AsyncGenerator<AgentStreamOutput, void, void>;
  resumeReview(payload: ReviewResumePayload, config?: AgentResumeStreamConfig): Promise<AgentResult | undefined>;
  getChannelRegistry(): ChannelRegistry | undefined;
};
