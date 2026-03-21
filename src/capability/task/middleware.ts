import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {createTaskTools} from '@capability/task/coordination/tools';
import {
  readSkillsRuntimeData,
} from '@context/skills/runtime-shared';
import {createTaskRuntime} from '@capability/task/delegation/runtime';
import {createTaskRunMemoryStore} from '@capability/task/delegation/store';
import {buildAvailableSubagentsMessage, buildTaskCompletionHandoff} from '@capability/task/delegation/prompting';
import type {CreateTaskMiddlewareOptions} from '@capability/task/tool-types';
import {createTaskTool} from '@capability/task/delegation/tool';
import {maybeHandleTaskCompletionToolCall} from '@capability/task/delegation/completion-guard';
import {rebindTaskRunStore} from '@capability/task/delegation/support';

export {createTaskTool, readTaskToolOptions, TASK_TOOL_DESCRIPTION, TASK_TOOL_NAME} from '@capability/task/delegation/tool';
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
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleTaskCompletionToolCall(context);
      if (blocked) {
        return blocked;
      }
      return handler(context);
    },
  });
}
