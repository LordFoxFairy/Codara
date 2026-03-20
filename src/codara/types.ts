import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {AgentCheckpointer} from '@durability/checkpoint';
import type {BaseMiddleware} from '@core/pipeline/types';
import type {HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {SummarySettings} from '@core/middleware/summary';
import type {TaskRunStore, TaskStore} from '@capability/task';
import type {ModelRoutingConfig} from '@integration/provider';
import type {SkillStore} from '@capability/skill';
import type {CodaraCommandResult, CodaraCommandSpec} from '@capability/command';
import type {Session, SessionState, SessionStore} from '@durability/session';
import type {ApprovalStore} from '@durability/approval-store';
import type {McpClientInfo, McpConfig} from '@integration/mcp';
import type {ChannelRegistry} from '@integration/channel';
import type {DelegatedAgentResult} from '@shared/delegation-result';
import type {AgentResumeStreamConfig, AgentStreamOutput, ResumePayload} from '@core/agent';
import type {PauseRequest} from '@shared/contracts/agent-types';
import type {CodaraModelCatalog} from './assembly/runtime';

// ── Skill & Memory Options ──

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
  hil?: false | HILMiddlewareOptions;
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
  taskRunStore?: TaskRunStore;
  approvalStore?: ApprovalStore;
  teams?: boolean;
  /** Optional pre-configured ChannelRegistry for multi-channel HIL routing. */
  channelRegistry?: ChannelRegistry;
}

export type CreateCodaraModelCatalogOptions = Pick<CodaraOptions, 'config'>;

export type CreateCodaraChatModelOptions =
  Pick<CodaraOptions, 'alias' | 'config'>
  & { catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog> };

export type CodaraMiddlewareOptions = Pick<CodaraOptions, 'middleware' | 'hil' | 'logging'>;

// ── Query Types ──

export interface TaskRunQuerySummary {
  runId: string;
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
  reason?: DelegatedAgentResult['reason'];
  turns?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface ApprovalQuerySummary {
  approvalId: string;
  source: 'task_run' | 'team_member';
  description: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
  taskRunId?: string;
  childSessionId?: string;
  teamId?: string;
  memberId?: string;
  memberName?: string;
  isForeground: boolean;
}

export interface ApprovalQueryReview {
  summary: ApprovalQuerySummary;
  request: PauseRequest;
}

export interface TeamQuerySummary {
  teamId: string;
  name: string;
  status: string;
  goal: string;
  memberCount: number;
  jobProgress: { done: number; total: number };
  startedAt: string;
  completedAt?: string;
}

export interface TeamQueryMember {
  memberId: string;
  name: string;
  role: string;
  status: string;
  model?: string;
  currentJobId?: string;
}

export interface TeamQueryJob {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  blockedBy: string[];
}

export interface TeamQueryDetail {
  teamId: string;
  name: string;
  status: string;
  goal: string;
  members: TeamQueryMember[];
  jobs: TeamQueryJob[];
}

// ── Codara API Type ──

export type Codara = Session & {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
  listSessions(options?: import('@durability/session').SessionListOptions): Promise<SessionState[]>;
  getMcpStatus(): McpClientInfo[];
  getTaskRunSummaries(): TaskRunQuerySummary[];
  getApprovalSummaries(): ApprovalQuerySummary[];
  getFocusedApprovalReview(): ApprovalQueryReview | undefined;
  focusApproval(approvalId: string): Promise<void>;
  resumeApproval(payload: ResumePayload, config?: AgentResumeStreamConfig): Promise<void>;
  resumeApprovalStream(payload: ResumePayload, config?: AgentResumeStreamConfig): AsyncGenerator<AgentStreamOutput, void, void>;
  getTeamSummaries(): TeamQuerySummary[];
  getTeamDetail(teamId: string): TeamQueryDetail | undefined;
  getChannelRegistry(): ChannelRegistry | undefined;
};
