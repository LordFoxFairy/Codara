import {useEffect, useMemo, useState} from 'react';
import type {CodaraRuntimeEvent} from '@/index';

export interface ActiveTask {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error' | 'paused';
  startedAt: number;
  endedAt?: number;
  elapsed: number;
  detail?: string;
  toolUseCount?: number;
  totalTokens?: string;
}

export interface UseActiveTasksInput {
  runtimeEvents: readonly CodaraRuntimeEvent[];
}

export interface UseActiveTasksOutput {
  tasks: ActiveTask[];
  runningCount: number;
  doneCount: number;
  errorCount: number;
  hasActiveTasks: boolean;
}

const MAX_VISIBLE_TASKS = 5;
const DONE_TASK_LINGER_MS = 3000;

export function extractTaskName(label: string): string {
  // Take first line only
  const firstLine = label.split('\n')[0]!.trim();
  // Strip "Delegating " prefix
  const text = firstLine.startsWith('Delegating ') ? firstLine.slice('Delegating '.length) : firstLine;
  // "Plan: some long description" → "Plan: some long desc…"
  if (text.length > 40) {
    return `${text.slice(0, 37)}…`;
  }
  return text;
}

export function deriveActiveTasks(
  events: readonly CodaraRuntimeEvent[],
  now: number,
): ActiveTask[] {
  // Collect task-level events (kind='task')
  const taskStarts = new Map<string, CodaraRuntimeEvent>();
  const taskEnds = new Map<string, CodaraRuntimeEvent>();
  // Also collect tool-level Task events (kind='tool', detail='Task') for early display
  const toolTaskStarts = new Map<string, CodaraRuntimeEvent>();
  const toolTaskEnds = new Map<string, CodaraRuntimeEvent>();
  // Map tool start ID → task start ID
  const toolToTask = new Map<string, string>();

  for (const event of events) {
    if (event.kind === 'task') {
      if (event.phase === 'start') {
        taskStarts.set(event.id, event);
        // Link tool parent → task
        if (event.parentId) {
          toolToTask.set(event.parentId, event.id);
        }
      } else if (event.phase === 'end' && event.parentId) {
        taskEnds.set(event.parentId, event);
      }
    }
    // Tool-level Task calls — these fire BEFORE the task start event
    if (event.kind === 'tool' && event.detail === 'Task') {
      if (event.phase === 'start') {
        toolTaskStarts.set(event.id, event);
      } else if (event.phase === 'end' && event.parentId) {
        toolTaskEnds.set(event.parentId, event);
      }
    }
  }

  const tasks: ActiveTask[] = [];
  const seenIds = new Set<string>();

  // First: add tasks from task-level events (these have richer info)
  for (const [id, startEvent] of taskStarts) {
    seenIds.add(id);
    // Also mark the tool parent as seen
    if (startEvent.parentId) {
      seenIds.add(startEvent.parentId);
    }
    const endEvent = taskEnds.get(id);
    const startedAt = Date.parse(startEvent.timestamp);
    const endedAt = endEvent ? Date.parse(endEvent.timestamp) : undefined;
    const status = endEvent?.status === 'error'
      ? 'error'
      : endEvent?.status === 'paused'
        ? 'paused'
        : endEvent
          ? 'done'
          : 'running';

    if (status === 'done' && endedAt && now - endedAt > DONE_TASK_LINGER_MS) {
      continue;
    }

    const detail = endEvent?.detail ?? startEvent.detail;
    const toolUseMatch = detail?.match(/(\d+)\s+tool uses?/);
    const tokenMatch = detail?.match(/([\d.]+[kKmM]?)\s+tokens?/);

    tasks.push({
      id,
      name: extractTaskName(startEvent.label),
      status,
      startedAt,
      endedAt,
      elapsed: (endedAt ?? now) - startedAt,
      detail,
      ...(toolUseMatch ? {toolUseCount: Number(toolUseMatch[1])} : {}),
      ...(tokenMatch ? {totalTokens: tokenMatch[1]} : {}),
    });
  }

  // Second: add tool-level Task calls that don't yet have a task-level event
  // (these are tasks that haven't started executing yet — "pending" in the queue)
  for (const [toolId, toolStartEvent] of toolTaskStarts) {
    if (seenIds.has(toolId)) continue;
    // Check if this tool call has a paired task start
    if (toolToTask.has(toolId)) continue;

    const toolEndEvent = toolTaskEnds.get(toolId);
    const startedAt = Date.parse(toolStartEvent.timestamp);
    const endedAt = toolEndEvent ? Date.parse(toolEndEvent.timestamp) : undefined;
    const status: ActiveTask['status'] = toolEndEvent
      ? (toolEndEvent.status === 'error' ? 'error' : 'done')
      : 'running';

    if (status === 'done' && endedAt && now - endedAt > DONE_TASK_LINGER_MS) {
      continue;
    }

    tasks.push({
      id: toolId,
      name: extractTaskName(toolStartEvent.label),
      status: status === 'running' ? 'paused' : status, // "paused" = pending/queued
      startedAt,
      endedAt,
      elapsed: (endedAt ?? now) - startedAt,
    });
  }

  // Running first, then by start time descending
  tasks.sort((a, b) => {
    const aRunning = a.status === 'running' ? 0 : 1;
    const bRunning = b.status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.startedAt - a.startedAt;
  });

  return tasks.slice(0, MAX_VISIBLE_TASKS);
}

export function useActiveTasks(input: UseActiveTasksInput): UseActiveTasksOutput {
  const [now, setNow] = useState(() => Date.now());
  const tasks = useMemo(() => deriveActiveTasks(input.runtimeEvents, now), [input.runtimeEvents, now]);
  const runningCount = useMemo(() => tasks.filter(t => t.status === 'running').length, [tasks]);
  const doneCount = useMemo(() => tasks.filter(t => t.status === 'done').length, [tasks]);
  const errorCount = useMemo(() => tasks.filter(t => t.status === 'error').length, [tasks]);

  useEffect(() => {
    if (runningCount === 0 && tasks.length === 0) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [runningCount, tasks.length]);

  return {
    tasks,
    runningCount,
    doneCount,
    errorCount,
    hasActiveTasks: tasks.length > 0,
  };
}
