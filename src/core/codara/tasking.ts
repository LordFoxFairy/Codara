import {createAgent} from '@core/agents';
import type {CodaraOptions} from '@core/codara/types';
import {
  createSubagentTool,
  createSubagentMiddleware,
  createTaskTool,
  createTaskMiddleware,
  type CreateSubagentMiddlewareOptions,
  type CreateTaskMiddlewareOptions,
} from '@core/tasking';
import {resolveCodaraRuntime} from '@core/codara/runtime';

export async function createCodaraTaskTool(options: CodaraOptions = {}) {
  const defaults = await resolveCodaraTaskingDefaults(options);
  return createTaskTool({
    ...defaults,
    runtimeHooks: {
      createChildAgent: (childOptions) => createAgent(childOptions),
    },
  });
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
  const defaults = await resolveCodaraTaskingDefaults(options);
  return createSubagentTool(defaults);
}

export async function createCodaraSubagentMiddleware(options: CodaraOptions = {}) {
  const defaults = await resolveCodaraTaskingDefaults(options);
  return createSubagentMiddleware(defaults);
}

async function resolveCodaraTaskingDefaults(
  options: CodaraOptions,
): Promise<CreateTaskMiddlewareOptions & CreateSubagentMiddlewareOptions> {
  const runtime = await resolveCodaraRuntime(options);

  return {
    model: runtime.model,
    tools: runtime.tools,
    middleware: runtime.middleware,
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: runtime.inputBudget,
    context: options.context,
    values: options.values,
  };
}
