import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {formatTaskRunLaunchResult} from '@shared/task-run-launch';
import {createTaskRuntime} from '@capability/task/delegation/runtime';
import {createTaskRunMemoryStore} from '@capability/task/delegation/store';
import {markDelegationTool} from '@capability/task/delegation/agent';
import type {CreateTaskToolOptions} from '@capability/task/tool-types';
import {
  buildRecoveredTaskChildOptions,
  rebindTaskRunStore,
} from '@capability/task/delegation/support';
import {prepareTaskLaunch} from '@capability/task/delegation/launch-preparation';

export const TASK_TOOL_NAME = 'Task';

export const TASK_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.
After calling Task, do not post a second "task started" confirmation, do not restate run metadata, and do not promise future updates.
Let the task/runtime UI carry launch and progress; only respond again with the delegated result or when review is required.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const TaskToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string({
    error: 'subagent_type is required. Use "Agent" for the base child or a named profile such as "Explore".',
  }).trim().min(1).describe('Subagent profile name. Use "Agent" for the built-in baseline child, or a named profile such as "Explore" or "Plan".'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});

const taskToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();

const TASK_TOOL_OPTIONS = Symbol.for('codara.task.tool.options');

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = rebindTaskRunStore(options.runStore ?? createTaskRunMemoryStore());
  const approvalStore = options.approvalStore;
  const runtime = options.runtime ?? createTaskRuntime({runStore, approvalStore});
  runtime.registerRecoveryBuilder(async (run) => buildRecoveredTaskChildOptions(
    {...options, checkpointer: delegatedCheckpointer},
    runtime,
    run,
  ));

  const taskTool = markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const configurable = taskToolConfigSchema.parse(config).configurable ?? {};
      const prepared = await prepareTaskLaunch({
        prompt,
        subagentType: subagent_type,
        ...(typeof max_turns === 'number' ? {maxTurns: max_turns} : {}),
        configurable,
        toolOptions: options,
        runStore,
        checkpointer: delegatedCheckpointer,
      });

      if (prepared.existingRunMessage) {
        return prepared.existingRunMessage;
      }

      const launched = await runtime.launch({
        runId: prepared.runId,
        parentSessionId: prepared.parentSessionId,
        childSessionId: prepared.childSessionId,
        label: prepared.runLabel,
        agentName: prepared.agentName,
        prompt,
        childOptions: prepared.childOptions!,
        ...(typeof prepared.childMaxTurns === 'number' ? {maxTurns: prepared.childMaxTurns} : {}),
      });

      return new ToolMessage({
        content: formatTaskRunLaunchResult(launched),
        artifact: launched,
        status: 'success',
        tool_call_id: prepared.toolCallId,
      });
    },
    {
      name: TASK_TOOL_NAME,
      description: options.description ?? TASK_TOOL_DESCRIPTION,
      schema: TaskToolInputSchema,
    },
  ));

  Object.defineProperty(taskTool, TASK_TOOL_OPTIONS, {
    value: {...options},
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return taskTool;
}

export function readTaskToolOptions(tool: StructuredToolInterface): CreateTaskToolOptions | undefined {
  const record = tool as StructuredToolInterface & {[TASK_TOOL_OPTIONS]?: CreateTaskToolOptions};
  return record[TASK_TOOL_OPTIONS];
}
