/**
 * TaskStop tool — unified task termination (aligns with Claude Code TaskStopTool).
 *
 * Can stop both shell background tasks and agent tasks through
 * the unified TaskRegistry.
 */

import {type ChildProcess} from 'node:child_process';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TaskRegistry} from './task-registry';
import {isShellTask, isTerminalTaskStatus} from './task-types';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TaskStopError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'not_running' | 'unsupported_type',
  ) {
    super(message);
    this.name = 'TaskStopError';
  }
}

// ---------------------------------------------------------------------------
// Stop logic
// ---------------------------------------------------------------------------

export interface TaskStopContext {
  registry: TaskRegistry;
  /** Resolve a shell task's child process for killing. */
  getShellProcess?: (taskId: string) => ChildProcess | undefined;
  /** Stop an agent task by its run ID. */
  stopAgentRun?: (runId: string) => Promise<void>;
}

export interface TaskStopResult {
  taskId: string;
  taskType: string;
  description: string;
}

/**
 * Stop a running task by ID.
 *
 * For shell tasks: sends SIGTERM to the child process, then SIGKILL after 5s.
 * For agent tasks: delegates to the SubagentRunManager's dispose.
 */
export async function stopTask(
  taskId: string,
  context: TaskStopContext,
): Promise<TaskStopResult> {
  const task = context.registry.get(taskId);

  if (!task) {
    throw new TaskStopError(`No task found with ID: ${taskId}`, 'not_found');
  }

  if (isTerminalTaskStatus(task.status)) {
    throw new TaskStopError(
      `Task ${taskId} is not running (status: ${task.status})`,
      'not_running',
    );
  }

  if (isShellTask(task)) {
    await killShellTask(taskId, context);
  } else {
    await killAgentTask(task, context);
  }

  context.registry.terminate(taskId, 'killed');

  return {
    taskId,
    taskType: task.type,
    description: task.description,
  };
}

async function killShellTask(taskId: string, context: TaskStopContext): Promise<void> {
  const child = context.getShellProcess?.(taskId);
  if (!child) {
    // Process already exited or reference lost — mark as killed anyway.
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Process already exited.
  }

  // Give it 5s to terminate gracefully, then SIGKILL.
  await new Promise<void>((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Process already exited.
      }
      resolve();
    }, 5000);

    child.once('close', () => {
      clearTimeout(killTimer);
      resolve();
    });
  });
}

async function killAgentTask(task: import('./task-types').AgentTaskState, context: TaskStopContext): Promise<void> {
  if (context.stopAgentRun) {
    await context.stopAgentRun(task.runId);
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const TASK_STOP_TOOL_NAME = 'TaskStop';

export interface TaskStopToolOptions {
  context: TaskStopContext;
}

export function createTaskStopTool(options: TaskStopToolOptions): StructuredToolInterface {
  return tool(
    async ({task_id}) => {
      try {
        const result = await stopTask(task_id, options.context);
        return `Task stopped.\n- id: ${result.taskId}\n- type: ${result.taskType}\n- description: ${result.description}`;
      } catch (error) {
        if (error instanceof TaskStopError) {
          return `Error: ${error.message}`;
        }
        return `Error stopping task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: TASK_STOP_TOOL_NAME,
      description: 'Stop a running background task (shell process or agent). Use this to terminate tasks that are no longer needed.',
      schema: z.object({
        task_id: z.string().min(1).describe('The task ID to stop'),
      }),
    },
  );
}
