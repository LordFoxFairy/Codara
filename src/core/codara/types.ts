import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInput,
  AgentInvokeConfig,
  AgentResumeConfig,
  AgentResumeStreamConfig,
  AgentResult,
  AgentRuntimeContext,
  AgentStreamConfig,
  AgentStreamOutput,
  CreateAgentOptions,
} from '@core/agents';
import type {BaseMiddleware, HILMiddlewareOptions, LoggingMiddlewareOptions} from '@core/middleware';
import type {AgentCheckpoint} from '@core/checkpoint/state';
import type {HILResumePayload} from '@core/middleware';
import type {SkillStore} from '@core/middleware/skills';
import type {Session, SessionState} from '@core/sessions';
import type {CodaraModelCatalog, CreateCodaraModelCatalogOptions} from '@core/codara/models';
import type {GuidelinesOptions} from '@core/middleware/guidelines';
import type {MemoryOptions} from '@core/middleware/memory';
import type {SummaryOptions} from '@core/middleware/summary';

export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
}

export interface CodaraToolsOptions {
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  cwd?: string;
  memory?: false | MemoryOptions;
}

export interface CodaraMiddlewareOptions {
  cwd?: string;
  middleware?: BaseMiddleware[];
  middlewares?: BaseMiddleware[];
  guidelines?: false | GuidelinesOptions;
  memory?: false | MemoryOptions;
  skills?: false | CodaraSkillOptions;
  summary?: false | SummaryOptions;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
}

export interface CodaraAgentOptions
  extends Omit<CreateAgentOptions, 'model' | 'tools' | 'middleware' | 'middlewares' | 'checkpoint'>,
    CreateCodaraModelCatalogOptions,
    CodaraToolsOptions,
    CodaraMiddlewareOptions {
  model?: BaseChatModel;
  alias?: string;
  catalog?: CodaraModelCatalog;
  modelResolver?: () => Promise<BaseChatModel> | BaseChatModel;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  checkpoint?: AgentCheckpoint;
}

export interface CodaraSessionOptions extends CodaraAgentOptions {
  sessionId?: string;
  restore?: 'latest' | 'never';
}

export type CodaraOptions = CodaraAgentOptions;

export interface Codara {
  session(options?: CodaraSessionOptions): Promise<Session>;
  invoke(input?: AgentInput, config?: AgentInvokeConfig): Promise<AgentResult>;
  stream(
    input?: AgentInput,
    config?: AgentStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  resume(payload: HILResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
  resumeStream(
    payload: HILResumePayload,
    config?: AgentResumeStreamConfig
  ): AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  getState(): Promise<SessionState>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}
