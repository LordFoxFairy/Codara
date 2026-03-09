import type {CreateAgentOptions} from '@core/agents';
import type {CreateCodaraChatModelOptions} from '@core/codara/models';
import {createCodaraChatModel} from '@core/codara/models';
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
  const model = overrides.model ?? await resolveCodaraModel(options);

  return {
    model,
    agentType: overrides.agentType ?? options.agentType,
    tools: overrides.tools ?? createCodaraTools(options),
    middleware: overrides.middleware ?? createCodaraMiddlewares(options, loadedSources),
    handleToolErrors: overrides.handleToolErrors ?? options.handleToolErrors,
    threadId: overrides.threadId ?? options.threadId,
    checkpointer: overrides.checkpointer ?? options.checkpointer,
    ...(overrides.checkpoint ?? options.checkpoint ? {checkpoint: overrides.checkpoint ?? options.checkpoint} : {}),
    ...(overrides.messages ?? options.messages ? {messages: overrides.messages ?? options.messages} : {}),
    ...(overrides.context ?? options.context ? {context: overrides.context ?? options.context} : {}),
    ...(overrides.values ?? options.values ? {values: overrides.values ?? options.values} : {}),
  };
}

export async function resolveCodaraModel(options: CodaraAgentOptions) {
  if (options.model) {
    return options.model;
  }

  if (options.modelResolver) {
    return options.modelResolver();
  }

  const modelOptions: CreateCodaraChatModelOptions = {
    ...(options.alias ? {alias: options.alias} : {}),
    ...(options.catalog ? {catalog: options.catalog} : {}),
    ...(options.config ? {config: options.config} : {}),
  };
  return createCodaraChatModel(modelOptions);
}
