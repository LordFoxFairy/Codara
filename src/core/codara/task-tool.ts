import {createAgent, createTaskTool} from '@core/agents';
import type {CodaraOptions} from '@core/codara/types';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/codara/models';
import {createCodaraTools} from '@core/codara/tools';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import {createCodaraSourceProvider} from '@core/sessions/source-provider';

/**
 * 创建 Codara Task Tool。
 * 用于在 Codara agent 中委派子任务。
 */
export async function createCodaraTaskTool(options: CodaraOptions = {}) {
  const sourceProvider = createCodaraSourceProvider({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
    userHome: options.userHome,
    guidelines: options.guidelines,
  });

  const modelCatalog = await Promise.resolve(options.catalog ?? createCodaraModelCatalog({
    config: options.config,
  }));

  const alias = options.alias?.trim() || DEFAULT_CODARA_MODEL_ALIAS;
  const model = options.model ?? await Promise.resolve(options.modelResolver ? options.modelResolver() : modelCatalog.create(alias));
  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, sourceProvider);
  const inputBudget = options.inputBudget ?? (
    options.model || options.modelResolver
      ? undefined
      : deriveInputBudget(modelCatalog.getInfo(alias))
  );

  return createTaskTool({
    model,
    tools,
    middleware,
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget,
    context: options.context,
    values: options.values,
    runtimeHooks: {
      createChildAgent: (childOptions) => createAgent(childOptions),
    },
  });
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
