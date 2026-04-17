/**
 * TaskOutput tool — read output from background tasks (aligns with Claude Code TaskOutputTool).
 *
 * Reads output from both shell background tasks and agent tasks
 * through the unified TaskRegistry.
 */

import {type FileHandle, open, stat} from 'node:fs/promises';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {TaskRegistry} from './task-registry';
import type {ShellTaskState, TaskState} from './task-types';
import {isShellTask} from './task-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_BYTES = 100_000;

// ---------------------------------------------------------------------------
// Output reading
// ---------------------------------------------------------------------------

export interface TaskOutputContext {
  registry: TaskRegistry;
  /** Read output for a shell task (by BackgroundProcessRegistry). */
  readShellOutput?: (taskId: string) => Promise<{stdout: string; stderr: string} | undefined>;
}

export interface TaskOutputResult {
  taskId: string;
  taskType: string;
  status: string;
  description: string;
  output: string;
  exitCode?: number | null;
}

/**
 * Read output from a task.
 *
 * For shell tasks: reads from stdout/stderr files via BackgroundProcessRegistry.
 * For agent tasks: reads from the output file (if any).
 */
export async function readTaskOutput(
  taskId: string,
  context: TaskOutputContext,
): Promise<TaskOutputResult> {
  const task = context.registry.get(taskId);

  if (!task) {
    throw new Error(`No task found with ID: ${taskId}`);
  }

  let output: string;

  if (isShellTask(task)) {
    output = await readShellTaskOutput(task, context);
  } else {
    output = await readOutputFile(task);
  }

  const result: TaskOutputResult = {
    taskId: task.id,
    taskType: task.type,
    status: task.status,
    description: task.description,
    output,
  };

  if (isShellTask(task)) {
    result.exitCode = task.exitCode;
  }

  return result;
}

async function readShellTaskOutput(task: ShellTaskState, context: TaskOutputContext): Promise<string> {
  // Try the registry's readShellOutput first (uses BackgroundProcessRegistry).
  if (context.readShellOutput) {
    const result = await context.readShellOutput(task.id);
    if (result) {
      const parts: string[] = [];
      if (result.stdout) parts.push(result.stdout);
      if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
      return parts.join('\n') || '(no output yet)';
    }
  }

  // Fallback: read from the output files directly.
  const stdout = await readFileSafe(task.stdoutPath, MAX_OUTPUT_BYTES);
  const stderr = await readFileSafe(task.stderrPath, MAX_OUTPUT_BYTES);
  const parts: string[] = [];
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(`STDERR:\n${stderr}`);
  return parts.join('\n') || '(no output yet)';
}

async function readOutputFile(task: TaskState): Promise<string> {
  if (!task.outputFile) {
    return '(no output file)';
  }
  return await readFileSafe(task.outputFile, MAX_OUTPUT_BYTES) || '(no output yet)';
}

async function readFileSafe(filePath: string, maxBytes: number): Promise<string> {
  let fh: FileHandle | undefined;
  try {
    const s = await stat(filePath);
    if (s.size === 0) return '';
    const readSize = Math.min(s.size, maxBytes);
    const buf = Buffer.alloc(readSize);
    fh = await open(filePath, 'r');
    await fh.read(buf, 0, readSize, 0);
    const text = buf.toString('utf8');
    if (s.size > maxBytes) {
      return text + `\n... [truncated, ${s.size - maxBytes} bytes remaining]`;
    }
    return text;
  } catch {
    return '';
  } finally {
    await fh?.close();
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const TASK_OUTPUT_TOOL_NAME = 'TaskOutput';

export interface TaskOutputToolOptions {
  context: TaskOutputContext;
}

export function createTaskOutputTool(options: TaskOutputToolOptions): StructuredToolInterface {
  return tool(
    async ({task_id}) => {
      try {
        const result = await readTaskOutput(task_id, options.context);
        const lines: string[] = [
          `[${result.taskId}] type=${result.taskType} status=${result.status}`,
          `description: ${result.description}`,
        ];
        if (result.exitCode !== undefined && result.exitCode !== null) {
          lines.push(`exit_code: ${result.exitCode}`);
        }
        lines.push('', result.output);
        return lines.join('\n');
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: TASK_OUTPUT_TOOL_NAME,
      description: 'Read the output of a background task (shell process or agent). Returns the current output and status.',
      schema: z.object({
        task_id: z.string().min(1).describe('The task ID to get output from'),
      }),
    },
  );
}
