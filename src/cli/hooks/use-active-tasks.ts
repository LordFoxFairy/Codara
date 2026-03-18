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
  const taskStarts = new Map<string, CodaraRuntimeEvent>();
  const taskEnds = new Map<string, CodaraRuntimeEvent>();

  for (const event of events) {
    if (event.kind !== 'task') continue;
    if (event.phase === 'start') {
      taskStarts.set(event.id, event);
    } else if (event.phase === 'end' && event.parentId) {
      taskEnds.set(event.parentId, event);
    }
  }

  const tasks: ActiveTask[] = [];

  for (const [id, startEvent] of taskStarts) {
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

    // Remove done tasks after linger period
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
