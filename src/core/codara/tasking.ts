import {createAgent} from '@core/agents';
import type {CodaraOptions} from '@core/codara/types';
import {createCodaraModelCatalog, DEFAULT_CODARA_MODEL_ALIAS} from '@core/codara/models';
import {createCodaraTools} from '@core/codara/tools';
import {createCodaraMiddlewares} from '@core/codara/middleware';
import {
  createSubagentMiddleware,
  createTaskMiddleware,
  type CreateSubagentMiddlewareOptions,
  type CreateTaskMiddlewareOptions,
} from '@core/middleware/tasking';
import {createCodaraSourceProvider} from '@core/sessions/source-provider';

export async function createCodaraTaskTool(options: CodaraOptions = {}) {
  const middleware = await createCodaraTaskMiddleware(options);
  const [taskTool] = middleware.tools ?? [];
  if (!taskTool) {
    throw new Error('Task middleware did not register a Task tool');
  }
  return taskTool;
}

export async function createCodaraTaskMiddleware(options: CodaraOptions = {}) {
  const defaults = await resolveCodaraTaskingDefaults(options);

  return createTaskMiddleware({
    ...defaults,
    runtimeHooks: {
      createChildAgent: (childOptions) => createAgent(childOptions),
    },
  });
}

export async function createCodaraSubagentTool(options: CodaraOptions = {}) {
  const middleware = await createCodaraSubagentMiddleware(options);
  const [subagentTool] = middleware.tools ?? [];
  if (!subagentTool) {
    throw new Error('Subagent middleware did not register a delegation tool');
  }
  return subagentTool;
}

export async function createCodaraSubagentMiddleware(options: CodaraOptions = {}) {
  const defaults = await resolveCodaraTaskingDefaults(options);
  return createSubagentMiddleware(defaults);
}

async function resolveCodaraTaskingDefaults(
  options: CodaraOptions,
): Promise<CreateTaskMiddlewareOptions & CreateSubagentMiddlewareOptions> {
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
  const model = options.model ?? await Promise.resolve(
    options.modelResolver ? options.modelResolver() : modelCatalog.create(alias),
  );
  const tools = createCodaraTools(options);
  const middleware = createCodaraMiddlewares(options, sourceProvider);
  const inputBudget = options.inputBudget ?? (
    options.model || options.modelResolver
      ? undefined
      : deriveInputBudget(modelCatalog.getInfo(alias))
  );

  return {
    model,
    tools,
    middleware,
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget,
    context: options.context,
    values: options.values,
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
