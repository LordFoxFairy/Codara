import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TaskRecord, TaskStore, TaskStatus} from '@capability/task/types';

export const TASK_CREATE_TOOL_NAME = 'TaskCreate';
export const TASK_UPDATE_TOOL_NAME = 'TaskUpdate';
export const TASK_LIST_TOOL_NAME = 'TaskList';

const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'deleted']);

export interface TaskToolOptions {
  store: TaskStore;
}

export function createTaskTools(options: TaskToolOptions): StructuredToolInterface[] {
  return [
    createTaskCreateTool(options),
    createTaskUpdateTool(options),
    createTaskListTool(options),
  ];
}

export function createTaskCreateTool(options: TaskToolOptions): StructuredToolInterface {
  return tool(
    async ({subject, description, activeForm}) => {
      const record = await options.store.create({subject, description, activeForm});
      return formatSingleTaskResult('Task created.', record);
    },
    {
      name: TASK_CREATE_TOOL_NAME,
      description: 'Create a persistent shared task for cross-agent coordination.',
      schema: z.object({
        subject: z.string().min(1).describe('Task title written as an imperative action'),
        description: z.string().min(1).describe('Detailed task description'),
        activeForm: z.string().optional().describe('Optional in-progress label, e.g. "Running tests"'),
      }),
    },
  );
}

export function createTaskUpdateTool(options: TaskToolOptions): StructuredToolInterface {
  return tool(
    async ({taskId, status, owner, addBlocks, addBlockedBy}) => {
      const record = await options.store.update({
        taskId,
        status,
        owner,
        addBlocks,
        addBlockedBy,
      });
      return formatSingleTaskResult('Task updated.', record);
    },
    {
      name: TASK_UPDATE_TOOL_NAME,
      description: 'Update a shared task status, owner, or dependency graph.',
      schema: z.object({
        taskId: z.string().min(1).describe('Task ID'),
        status: TaskStatusSchema.optional().describe('Next task status'),
        owner: z.string().optional().describe('Current task owner'),
        addBlocks: z.array(z.string()).optional().describe('Task IDs blocked by this task'),
        addBlockedBy: z.array(z.string()).optional().describe('Task IDs that block this task'),
      }),
    },
  );
}

export function createTaskListTool(options: TaskToolOptions): StructuredToolInterface {
  return tool(
    async () => formatTaskListResult(await options.store.list()),
    {
      name: TASK_LIST_TOOL_NAME,
      description: 'List all shared tasks with status, owner, and dependency information.',
      schema: z.object({}),
    },
  );
}

function formatSingleTaskResult(prefix: string, record: TaskRecord): string {
  return [
    prefix,
    formatTaskRecord(record),
  ].join('\n');
}

function formatTaskListResult(tasks: TaskRecord[]): string {
  if (tasks.length === 0) {
    return 'No tasks found.';
  }

  return [
    'Tasks:',
    ...tasks.map((task) => formatTaskRecord(task)),
  ].join('\n');
}

function formatTaskRecord(task: TaskRecord): string {
  const fields = [
    `- id: ${task.id}`,
    `subject: ${task.subject}`,
    `status: ${task.status}`,
    `description: ${task.description}`,
    ...(task.activeForm ? [`activeForm: ${task.activeForm}`] : []),
    ...(task.owner ? [`owner: ${task.owner}`] : []),
    `blockedBy: ${formatTaskIds(task.blockedBy)}`,
    `blocks: ${formatTaskIds(task.blocks)}`,
  ];

  return fields.join(' | ');
}

function formatTaskIds(taskIds: string[]): string {
  return taskIds.length > 0 ? taskIds.join(', ') : '(none)';
}

export type {TaskStatus};
