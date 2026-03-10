import {createAgent} from '@core/agents';
import type {CodaraOptions} from '@core/codara/types';
import {
  createSubagentMiddleware,
  createTaskMiddleware,
  type CreateSubagentMiddlewareOptions,
  type CreateTaskMiddlewareOptions,
} from '@core/tasking/middleware';
import {resolveCodaraRuntime} from '@core/codara/runtime';

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
