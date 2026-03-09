import type {CreateAgentOptions} from '@core/agents';
import type {CreateCodaraChatModelOptions} from '@core/codara/models';
import {createCodaraChatModel, createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/codara/models';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import {createCodaraTools} from '@core/codara/tools';
import type {CodaraAgentOptions} from '@core/codara/types';

interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

export async function resolveCodaraAgentOptions(
  options: CodaraAgentOptions = {},
  loadedSources: CodaraSourceProjection = {},
  overrides: Partial<CreateAgentOptions> = {}
): Promise<CreateAgentOptions> {
  const selection = overrides.model
    ? {model: overrides.model}
    : await resolveCodaraModelSelection(options);

  return {
    model: selection.model,
    agentType: overrides.agentType ?? options.agentType,
    tools: overrides.tools ?? createCodaraTools(options),
    middleware: overrides.middleware ?? createCodaraMiddlewares(options, loadedSources),
    handleToolErrors: overrides.handleToolErrors ?? options.handleToolErrors,
    inputBudget: overrides.inputBudget ?? options.inputBudget ?? deriveInputBudget('modelInfo' in selection ? selection.modelInfo : undefined),
    threadId: overrides.threadId ?? options.threadId,
    checkpointer: overrides.checkpointer ?? options.checkpointer,
    ...(overrides.checkpoint ?? options.checkpoint ? {checkpoint: overrides.checkpoint ?? options.checkpoint} : {}),
    ...(overrides.messages ?? options.messages ? {messages: overrides.messages ?? options.messages} : {}),
    ...(overrides.context ?? options.context ? {context: overrides.context ?? options.context} : {}),
    ...(overrides.values ?? options.values ? {values: overrides.values ?? options.values} : {}),
  };
}

export async function resolveCodaraModel(options: CodaraAgentOptions) {
  return (await resolveCodaraModelSelection(options)).model;
}

async function resolveCodaraModelSelection(options: CodaraAgentOptions) {
  if (options.model) {
    return {
      model: options.model,
    };
  }

  if (options.modelResolver) {
    return {
      model: await options.modelResolver(),
    };
  }

  const alias = normalizeAlias(options.alias);
  const catalog = options.catalog ?? (await createCodaraModelCatalog({
    ...(options.config ? {config: options.config} : {}),
  }));

  return {
    model: await createCodaraChatModel({
      alias,
      catalog,
    } satisfies CreateCodaraChatModelOptions),
    modelInfo: catalog.getInfo(alias),
  };
}

function deriveInputBudget(modelInfo: {contextWindow?: number; maxOutputTokens?: number} | undefined) {
  if (!modelInfo?.contextWindow) {
    return undefined;
  }

  return {
    maxInputTokens: modelInfo.contextWindow,
    ...(typeof modelInfo.maxOutputTokens === 'number' ? {reservedTokens: modelInfo.maxOutputTokens} : {}),
  };
}

function normalizeAlias(alias: string | undefined): string {
  return alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
}
