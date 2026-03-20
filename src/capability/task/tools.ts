import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TaskRecord, TaskStore, TaskStatus} from '@capability/task/types';
import {createInternalSharedTaskCoordinationMessage} from '@shared/task-coordination-result';

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
    async ({subject, description, activeForm}, config) => {
      const record = await options.store.create({subject, description, activeForm});
      const content = formatSingleTaskResult('Task created.', record);
      const toolCallId = typeof config?.toolCall?.id === 'string' ? config.toolCall.id : '';
      return shouldHideSharedTaskCoordinationFromMainTranscript(config)
        ? createInternalSharedTaskCoordinationMessage(content, toolCallId)
        : content;
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
    async ({taskId, status, owner, addBlocks, addBlockedBy}, config) => {
      const record = await options.store.update({
        taskId,
        status,
        owner,
        addBlocks,
        addBlockedBy,
      });
      const content = formatSingleTaskResult('Task updated.', record);
      const toolCallId = typeof config?.toolCall?.id === 'string' ? config.toolCall.id : '';
      return shouldHideSharedTaskCoordinationFromMainTranscript(config)
        ? createInternalSharedTaskCoordinationMessage(content, toolCallId)
        : content;
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
    async (_input, config) => {
      const content = formatTaskListResult(await options.store.list());
      const toolCallId = typeof config?.toolCall?.id === 'string' ? config.toolCall.id : '';
      return shouldHideSharedTaskCoordinationFromMainTranscript(config)
        ? createInternalSharedTaskCoordinationMessage(content, toolCallId)
        : content;
    },
    {
      name: TASK_LIST_TOOL_NAME,
      description: 'List all shared tasks with status, owner, and dependency information.',
      schema: z.object({}),
    },
  );
}

function shouldHideSharedTaskCoordinationFromMainTranscript(config: unknown): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const configurable = (config as {configurable?: unknown}).configurable;
  if (!configurable || typeof configurable !== 'object') {
    return false;
  }

  const record = configurable as Record<string, unknown>;
  const runtimeShared = record.runtimeShared;
  if (runtimeShared && typeof runtimeShared === 'object' && !Array.isArray(runtimeShared)) {
    const teamContext = (runtimeShared as Record<string, unknown>).teamContext;
    if (teamContext && typeof teamContext === 'object' && !Array.isArray(teamContext)) {
      return true;
    }
  }

  const context = record.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return false;
  }

  const teamSurface = (context as Record<string, unknown>).teamSurface;
  if (!teamSurface || typeof teamSurface !== 'object' || Array.isArray(teamSurface)) {
    return false;
  }

  return typeof (teamSurface as Record<string, unknown>).activeTeamId === 'string';
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
