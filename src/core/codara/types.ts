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
import type {CodaraModelCatalog, CreateCodaraModelCatalogOptions} from '@core/codara/models';
import type {AgentsGuidelinesOptions} from '@core/guidelines';
import type {MemoryOptions} from '@core/memory';

export interface CodaraSkillOptions {
  store?: SkillStore;
  sources?: string[];
  projectRoot?: string;
  userHome?: string;
  cacheTtlMs?: number;
}

export interface CreateCodaraToolsOptions {
  tools?: StructuredToolInterface[];
  builtinTools?: boolean;
  cwd?: string;
}

export interface CreateCodaraMiddlewareOptions {
  middleware?: BaseMiddleware[];
  middlewares?: BaseMiddleware[];
  agentsGuidelines?: false | AgentsGuidelinesOptions;
  memory?: false | MemoryOptions;
  skills?: false | CodaraSkillOptions;
  hil?: false | HILMiddlewareOptions;
  logging?: false | LoggingMiddlewareOptions;
}

export interface CreateCodaraAgentOptions
  extends Omit<CreateAgentOptions, 'model' | 'tools' | 'middleware' | 'middlewares' | 'checkpoint'>,
    CreateCodaraModelCatalogOptions,
    CreateCodaraToolsOptions,
    CreateCodaraMiddlewareOptions {
  model?: BaseChatModel;
  alias?: string;
  catalog?: CodaraModelCatalog;
  modelResolver?: () => Promise<BaseChatModel> | BaseChatModel;
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  checkpoint?: AgentCheckpoint;
}

export interface CreateCodaraSessionOptions extends CreateCodaraAgentOptions {
  sessionId?: string;
  restore?: 'latest' | 'never';
}

export type CreateCodaraOptions = CreateCodaraAgentOptions;

export interface Codara {
  session(options?: CreateCodaraSessionOptions): Promise<import('@core/sessions').Session>;
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
  getState(): Promise<import('@core/sessions').SessionState>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}
