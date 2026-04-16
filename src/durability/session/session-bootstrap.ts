import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {Agent, AgentInputBudget} from '@shared/agent-types';
import {
  buildBaseSystemMessage,
  type BaseSystemMessageBundle,
} from '@context/system-message';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import type {GuidelinesSource} from '@context/guidelines';
import type {PromptSource} from '@context/prompts';
import type {SkillsSource} from '@capability/skill';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';
import type {ModelInfo} from '@integration/provider';
import {deriveSessionInputBudget} from './metadata';
import type {AgentFactory, SessionMiddlewareFactory} from './types';
import type {RuntimeEventsController} from '@observability/events';

export interface SessionModelCatalog {
  create(modelRef?: string): Promise<BaseChatModel>;
  getInfo(modelRef?: string): ModelInfo;
}

export interface BootstrapDependencies {
  sessionId: string;
  model?: BaseChatModel | Promise<BaseChatModel>;
  modelRef?: string;
  modelCatalog?: SessionModelCatalog | Promise<SessionModelCatalog>;
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
  skillsSource?: SkillsSource;
  dynamicSections?: DynamicSectionRegistry;
  tools?: import('@langchain/core/tools').StructuredToolInterface[];
  handleToolErrors?: import('@shared/agent-types').ToolErrorHandler;
  middleware?: unknown[];
  summary?: false | unknown;
  messages?: import('@shared/agent-types').AgentInput;
  context?: Record<string, unknown>;
  values?: Record<string, unknown>;
  agentFactory: AgentFactory;
  middlewareFactory: SessionMiddlewareFactory;
  runtimeEvents: RuntimeEventsController;
  checkpointer: AgentCheckpointer;
  restoreCheckpoint: boolean;
  inputBudget?: AgentInputBudget;
  getLatestCheckpoint: () => Promise<import('@durability/checkpoint/agent').AgentCheckpoint | undefined>;
  /** Session-owned context preparer that shares the session's instruction cache. */
  prepareContext?: import('@shared/agent-types').AgentContextPreparer;
}

export interface BootstrapResult {
  agent: Agent;
  summaryOptions: unknown;
  inputBudget?: AgentInputBudget;
  baseSystemContext: BaseSystemMessageBundle;
}

export async function bootstrapSessionAgent(deps: BootstrapDependencies): Promise<BootstrapResult> {
  const baseSystemContext = await loadBaseInstructionContext(deps);
  const modelSelection = await resolveSessionModel(deps);
  const checkpoint = deps.restoreCheckpoint ? await deps.getLatestCheckpoint() : undefined;

  const inputBudget = deps.inputBudget ?? deriveSessionInputBudget(modelSelection.modelInfo);
  const summaryOptions = deps.summary
    ? deps.agentFactory
      ? deps.middlewareFactory.resolveSummaryOptions(deps.summary, modelSelection.model)
      : undefined
    : undefined;

  const middleware = buildSessionMiddleware(deps, summaryOptions);

  const agent = await deps.agentFactory.create({
    model: modelSelection.model,
    agentType: 'main',
    tools: deps.tools,
    handleToolErrors: deps.handleToolErrors,
    middleware,
    checkpointer: deps.checkpointer,
    sessionId: deps.sessionId,
    inputBudget,
    ...(checkpoint ? {checkpoint} : {}),
    ...(deps.messages ? {messages: deps.agentFactory.normalizeInput(deps.messages)} : {}),
    ...(deps.context ? {context: deps.context} : {}),
    ...(deps.values ? {values: deps.values} : {}),
    ...(baseSystemContext.systemMessage.length > 0 ? {systemMessage: baseSystemContext.systemMessage} : {}),
    ...(baseSystemContext.runtimeShared ? {runtimeShared: baseSystemContext.runtimeShared} : {}),
    ...(deps.prepareContext ? {prepareContext: deps.prepareContext} : {}),
  });

  return {agent, summaryOptions, inputBudget, baseSystemContext};
}

export async function loadBaseInstructionContext(
  deps: Pick<BootstrapDependencies, 'promptSource' | 'guidelinesSource' | 'skillsSource' | 'dynamicSections'>,
  forceReload = false,
  cached?: BaseSystemMessageBundle,
): Promise<BaseSystemMessageBundle> {
  if (!forceReload && cached) {
    return cached;
  }
  deps.promptSource?.reload?.();
  deps.guidelinesSource?.reload?.();
  deps.skillsSource?.reload();
  return buildBaseSystemMessage({
    promptSource: deps.promptSource,
    guidelinesSource: deps.guidelinesSource,
    skillsSource: deps.skillsSource,
    dynamicSections: deps.dynamicSections,
  });
}

export function buildSessionMiddleware(
  deps: Pick<BootstrapDependencies, 'middleware' | 'middlewareFactory' | 'runtimeEvents'>,
  summary: unknown | undefined,
): unknown[] | undefined {
  const mwFactory = deps.middlewareFactory;
  const middlewares: {name: string; [key: string]: unknown}[] = [
    deps.runtimeEvents.createMiddleware() as {name: string; [key: string]: unknown},
    ...((deps.middleware ?? []) as {name: string; [key: string]: unknown}[]),
  ];
  if (!summary || middlewares.some((middleware) => middleware.name === mwFactory.middlewareNames.Summary)) {
    return middlewares.length > 0 ? middlewares : undefined;
  }

  const summaryMiddleware = mwFactory.createSummaryMiddleware(summary) as {name: string; [key: string]: unknown} | undefined;
  if (!summaryMiddleware) {
    return middlewares.length > 0 ? middlewares : undefined;
  }

  const reviewIndex = middlewares.findIndex((middleware) => middleware.name === mwFactory.middlewareNames.Review);
  if (reviewIndex < 0) {
    middlewares.push(summaryMiddleware);
    return middlewares;
  }

  middlewares.splice(reviewIndex, 0, summaryMiddleware);
  return middlewares;
}

export async function resolveSessionModel(
  deps: Pick<BootstrapDependencies, 'model' | 'modelRef' | 'modelCatalog'>,
): Promise<{model: BaseChatModel; modelInfo?: ModelInfo}> {
  if (deps.model) {
    return {model: await deps.model};
  }

  if (!deps.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await deps.modelCatalog;
  const modelRef = deps.modelRef ?? 'default';
  return {model: await catalog.create(modelRef), modelInfo: catalog.getInfo(modelRef)};
}

