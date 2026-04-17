/**
 * Unified Task Registry — single source of truth for all running tasks.
 *
 * Both shell background processes (from BashTool) and agent tasks
 * (from SubagentRunManager) register here. The TaskStop and TaskOutput
 * tools query this registry to provide a unified interface.
 */

import type {TaskState, ExecutionTaskStatus, TaskType} from './task-types';
import {isTerminalTaskStatus} from './task-types';

// ---------------------------------------------------------------------------
// Registry interface
// ---------------------------------------------------------------------------

export interface TaskRegistry {
  /** Register a new task. */
  register(task: TaskState): void;

  /** Get a task by ID. */
  get(taskId: string): TaskState | undefined;

  /** List all tasks, optionally filtered by type or status. */
  list(filter?: TaskListFilter): TaskState[];

  /** Update a task's state. */
  update(taskId: string, patch: Partial<Omit<TaskState, 'id' | 'type'>>): TaskState | undefined;

  /** Mark a task as completed/failed/killed. */
  terminate(taskId: string, status: 'completed' | 'failed' | 'killed', patch?: TaskTerminatePatch): TaskState | undefined;

  /** Remove a terminal task from the registry. */
  remove(taskId: string): boolean;

  /** Remove all terminal tasks. */
  prune(): number;
}

/** Explicit fields allowed when terminating a task. */
export interface TaskTerminatePatch {
  summary?: string;
  errorMessage?: string;
  exitCode?: number | null;
}

export interface TaskListFilter {
  type?: TaskType;
  status?: ExecutionTaskStatus;
  /** If true, only return non-terminal (active) tasks. */
  activeOnly?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createTaskRegistry(): TaskRegistry {
  return new InMemoryTaskRegistry();
}

class InMemoryTaskRegistry implements TaskRegistry {
  private readonly tasks = new Map<string, TaskState>();

  register(task: TaskState): void {
    this.tasks.set(task.id, task);
  }

  get(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  list(filter?: TaskListFilter): TaskState[] {
    let result = [...this.tasks.values()];

    if (filter?.type) {
      result = result.filter((t) => t.type === filter.type);
    }
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.activeOnly) {
      result = result.filter((t) => !isTerminalTaskStatus(t.status));
    }

    return result;
  }

  update(taskId: string, patch: Partial<Omit<TaskState, 'id' | 'type'>>): TaskState | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }

    const updated: TaskState = {...existing, ...patch};
    this.tasks.set(taskId, updated);
    return updated;
  }

  terminate(taskId: string, status: 'completed' | 'failed' | 'killed', patch?: TaskTerminatePatch): TaskState | undefined {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return undefined;
    }

    const updated: TaskState = {
      ...existing,
      ...(patch ?? {}),
      status,
      endTime: Date.now(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  remove(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || !isTerminalTaskStatus(task.status)) {
      return false;
    }
    return this.tasks.delete(taskId);
  }

  prune(): number {
    let count = 0;
    for (const [taskId, task] of this.tasks) {
      if (isTerminalTaskStatus(task.status)) {
        this.tasks.delete(taskId);
        count++;
      }
    }
    return count;
  }
}

