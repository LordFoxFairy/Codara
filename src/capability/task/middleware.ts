import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {createTaskTools} from '@capability/task/tools';
import {
  readSkillsRuntimeData,
} from '@context/skills/runtime-shared';
import {createTaskRuntime} from '@capability/task/runtime';
import {createTaskRunMemoryStore} from '@capability/task/run-store';
import type {CreateTaskMiddlewareOptions} from '@capability/task/tool-types';
import {buildAvailableSubagentsMessage, buildTaskCompletionHandoff} from '@capability/task/task-prompting';
import {createTaskTool} from '@capability/task/task-tool';
import {rebindTaskRunStore} from '@capability/task/task-tool-support';

export {createTaskTool, readTaskToolOptions, TASK_TOOL_DESCRIPTION, TASK_TOOL_NAME} from '@capability/task/task-tool';
export type {CreateTaskToolOptions, CreateTaskMiddlewareOptions} from '@capability/task/tool-types';

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  const runStore = rebindTaskRunStore(options.runStore ?? createTaskRunMemoryStore());
  const runtime = options.runtime ?? createTaskRuntime({
    runStore,
    approvalStore: options.approvalStore,
  });
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: [
      createTaskTool({...options, runStore, runtime}),
      ...(options.store ? createTaskTools({store: options.store}) : []),
    ],
    beforeModel(context) {
      const completionHandoff = buildTaskCompletionHandoff(context);
      if (completionHandoff) {
        context.systemMessage.push(completionHandoff);
      }
      const runtime = readSkillsRuntimeData(context.runtime.shared);
      const definitions = buildAvailableSubagentsMessage(runtime);
      if (definitions) {
        context.systemMessage.push(definitions);
      }
      return undefined;
    },
  });
}
