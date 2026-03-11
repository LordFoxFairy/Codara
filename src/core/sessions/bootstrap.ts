import type {Agent} from '@core/agents';
import {createAgent, normalizeAgentInput} from '@core/agents';
import {deriveAgentInputBudget} from '@core/agents/input-budget';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {ModelInfo} from '@core/provider';
import type {CreateSessionOptions} from '@core/sessions/types';

export interface SessionAgentBootstrapOptions {
  sessionOptions: CreateSessionOptions;
  threadId: string;
  isRestoringThread: boolean;
  checkpointer: NonNullable<CreateSessionOptions['checkpointer']>;
  prepareHostSources(): Promise<void>;
}

export async function bootstrapSessionAgent(
  options: SessionAgentBootstrapOptions,
): Promise<Agent> {
  await options.prepareHostSources();
  const selection = await resolveSessionModelSelection(options.sessionOptions);
  const shouldRestore = options.sessionOptions.restore === 'latest'
    || (options.sessionOptions.restore !== 'never' && options.isRestoringThread);
  const checkpoint = shouldRestore
    ? await options.checkpointer.getLatest(options.threadId)
    : undefined;
  const messages = options.sessionOptions.messages
    ? normalizeAgentInput(options.sessionOptions.messages)
    : undefined;

  return createAgent({
    model: selection.model,
    tools: options.sessionOptions.tools,
    handleToolErrors: options.sessionOptions.handleToolErrors,
    middleware: options.sessionOptions.middleware,
    checkpointer: options.checkpointer,
    threadId: options.threadId,
    inputBudget: resolveSessionInputBudget(options.sessionOptions, selection.modelInfo),
    ...(checkpoint ? {checkpoint} : {}),
    ...(messages ? {messages} : {}),
    ...(options.sessionOptions.context ? {context: options.sessionOptions.context} : {}),
    ...(options.sessionOptions.values ? {values: options.sessionOptions.values} : {}),
  });
}

async function resolveSessionModelSelection(options: CreateSessionOptions): Promise<{
  model: BaseChatModel;
  modelInfo?: ModelInfo;
}> {
  if (options.model) {
    return {
      model: await options.model,
    };
  }

  if (!options.modelCatalog) {
    throw new Error('Either model or modelCatalog must be provided');
  }

  const catalog = await options.modelCatalog;
  const modelRef = options.modelRef ?? 'default';
  return {
    model: await catalog.create(modelRef),
    modelInfo: catalog.getInfo(modelRef),
  };
}

function resolveSessionInputBudget(
  options: CreateSessionOptions,
  modelInfo?: Pick<ModelInfo, 'contextWindow' | 'maxOutputTokens'>,
) {
  return options.inputBudget ?? deriveAgentInputBudget(modelInfo);
}
