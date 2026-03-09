import {createAgent, createTaskTool} from '@core/agents';
import type {CreateTaskToolOptions} from '@core/agents/task-tool';
import {resolveCodaraAgentOptions} from '@core/codara/assembly';
import type {CodaraAgentOptions} from '@core/codara/types';

interface CodaraSourceProjection {
  guidelines?: string;
  memory?: string;
}

export async function createCodaraTaskTool(
  options: CodaraAgentOptions = {},
  loadedSources: CodaraSourceProjection = {}
) {
  const base = await resolveCodaraAgentOptions(options, loadedSources);

  return createTaskTool({
    model: base.model,
    ...(base.tools ? {tools: base.tools} : {}),
    ...(base.middleware ? {middleware: base.middleware} : {}),
    ...(base.handleToolErrors !== undefined ? {handleToolErrors: base.handleToolErrors} : {}),
    ...(base.checkpointer ? {checkpointer: base.checkpointer} : {}),
    ...(base.context ? {context: base.context} : {}),
    ...(base.values ? {values: base.values} : {}),
    createChildAgent: async (childOptions) => {
      return createAgent(await resolveCodaraAgentOptions(options, loadedSources, childOptions));
    },
  } satisfies CreateTaskToolOptions);
}
