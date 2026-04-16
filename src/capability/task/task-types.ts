/**
 * Unified Task types — aligns with Claude Code Task.ts.
 *
 * Provides a common interface for all background execution:
 * - shell: background bash processes (from BashTool)
 * - agent: subagent runs (from SubagentRunManager)
 *
 * The existing "todo" TaskRecord system (store.ts/tools.ts) remains
 * separate — it's a CRUD todo tracker, not an execution task.
 */

import {randomBytes} from 'node:crypto';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type TaskType = 'shell' | 'agent';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

/**
 * True when a task is in a terminal state and will not transition further.
 * Guards against injecting messages into dead tasks, evicting finished tasks,
 * and orphan-cleanup paths.
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

// ---------------------------------------------------------------------------
// Task state
// ---------------------------------------------------------------------------

export interface TaskStateBase {
  id: string;
  type: TaskType;
  status: TaskStatus;
  description: string;
  startTime: number;
  endTime?: number;
  /** Path to the file where task output is written. */
  outputFile?: string;
  /** Byte offset into outputFile that has been reported to the model. */
  outputOffset: number;
}

export interface ShellTaskState extends TaskStateBase {
  type: 'shell';
  /** The shell command that was executed. */
  command: string;
  /** OS process ID. */
  pid: number;
  /** Working directory the command was started in. */
  cwd: string;
  /** Exit code (undefined while running). */
  exitCode?: number | null;
  /** Path to stdout output file. */
  stdoutPath: string;
  /** Path to stderr output file. */
  stderrPath: string;
}

export interface AgentTaskState extends TaskStateBase {
  type: 'agent';
  /** The subagent run ID (from SubagentRunManager). */
  runId: string;
  /** The child session ID for this agent task. */
  childSessionId?: string;
  /** Agent name. */
  agentName: string;
  /** Human-readable label. */
  label: string;
  /** Summary of the agent's result (set on completion). */
  summary?: string;
  /** Error message (set on failure). */
  errorMessage?: string;
}

export type TaskState = ShellTaskState | AgentTaskState;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isShellTask(task: TaskState): task is ShellTaskState {
  return task.type === 'shell';
}

export function isAgentTask(task: TaskState): task is AgentTaskState {
  return task.type === 'agent';
}

// ---------------------------------------------------------------------------
// Task ID generation
// ---------------------------------------------------------------------------

const TASK_ID_PREFIXES: Record<TaskType, string> = {
  shell: 'b',
  agent: 'a',
};

const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function generateTaskId(type: TaskType): string {
  const prefix = TASK_ID_PREFIXES[type];
  const bytes = randomBytes(8);
  let id = prefix;
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length];
  }
  return id;
}
