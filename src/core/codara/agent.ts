import {createAgent, type Agent} from '@core/agents';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {CreateCodaraChatModelOptions} from '@core/codara/models';
import {createCodaraChatModel} from '@core/codara/models';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import {createCodaraTools} from '@core/codara/tools';
import type {CodaraAgentOptions} from '@core/codara/types';

interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

/** 创建带 Codara 默认装配的 agent。 */
export async function createCodaraAgent(
  options: CodaraAgentOptions = {},
  loadedSources: CodaraSourceProjection = {}
): Promise<Agent> {
  const model = await resolveCodaraModel(options);
  const state = buildCodaraAgentState(options);

  return createAgent({
    model,
    tools: createCodaraTools(options),
    middleware: createCodaraMiddlewares(options, loadedSources),
    handleToolErrors: options.handleToolErrors,
    threadId: options.threadId,
    checkpointer: options.checkpointer,
    ...(options.checkpoint ? {checkpoint: options.checkpoint} : {}),
    ...(state ? {state} : {}),
  });
}

/** 按 thread 恢复最新的 Codara agent。 */
export async function loadCodaraAgent(
  options: CodaraAgentOptions & {threadId: string; checkpointer: AgentCheckpointer}
): Promise<Agent | undefined> {
  const checkpoint = await options.checkpointer.getLatest(options.threadId);
  if (!checkpoint) {
    return undefined;
  }

  return createCodaraAgent({...options, checkpoint});
}

async function resolveCodaraModel(options: CodaraAgentOptions) {
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

/** 构建传给 createAgent(...) 的初始运行状态。 */
function buildCodaraAgentState(options: CodaraAgentOptions) {
  if (!options.state && !options.messages && !options.context) {
    return undefined;
  }

  return {
    ...(options.state ?? {}),
    ...(options.messages ? {messages: options.messages} : {}),
    ...(options.context ? {context: options.context} : {}),
  };
}
