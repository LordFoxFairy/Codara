import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInputBudget,
  AgentInput,
} from '@core/agents';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {SkillStore} from '@core/skills';
import type {Session, SessionStore} from '@core/sessions';
import type {CodaraModelCatalog, CreateCodaraModelCatalogOptions} from '@core/product/models';
import type {GuidelinesOptions} from '@core/sessions/agents';
import type {SummaryOptions} from '@core/middleware/summary';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {CodaraCommandResult, CodaraCommandSpec} from '@core/product/commands/types';

export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  agentRoots?: string[];
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
}

export interface CodaraToolsOptions {
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  cwd?: string;
}

export interface CodaraMiddlewareOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  middleware?: BaseMiddleware[];
  guidelines?: boolean | GuidelinesOptions;
  skills?: false | CodaraSkillOptions;
  summary?: false | SummaryOptions;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
}

/**
 * Codara 配置选项。
 * 对外 API 使用 alias 而不是暴露 provider:model 格式。
 */
export interface CodaraOptions
  extends CreateCodaraModelCatalogOptions,
    CodaraToolsOptions,
    CodaraMiddlewareOptions {
  // Model 选择（产品化 API）
  alias?: string;  // 'default' / 'sonnet' / 'fast' / 'opus'
  model?: BaseChatModel;  // 高级用法：直接传 model 实例
  catalog?: CodaraModelCatalog | Promise<CodaraModelCatalog>;
  modelResolver?: () => Promise<BaseChatModel> | BaseChatModel;

  // Session 配置
  sessionId?: string;
  threadId?: string;
  restore?: 'latest' | 'never';
  store?: SessionStore;
  checkpointer?: AgentCheckpointer;
  handleToolErrors?: boolean;
  inputBudget?: AgentInputBudget;

  // 初始状态
  messages?: AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
}

export interface CodaraCommandSurface {
  listCommands(): Promise<readonly CodaraCommandSpec[]>;
  executeCommand(input: string): Promise<CodaraCommandResult>;
}

/** Codara 对外接口。 */
export type Codara = Session & CodaraCommandSurface;
