import {useEffect, useMemo, useState} from 'react';
import type {ApprovalQuerySummary, TaskRunQuerySummary} from '@/index';

export type {TaskRunQuerySummary};

export interface ActiveTask {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error' | 'paused';
  startedAt: number;
  endedAt?: number;
  elapsed: number;
  detail?: string;
  approvalCount?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface UseActiveTasksInput {
  taskRunSummaries: readonly TaskRunQuerySummary[];
  approvals?: readonly ApprovalQuerySummary[];
}

export interface UseActiveTasksOutput {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hasActiveTasks: boolean;
}

export interface ActiveTaskSnapshot {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
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
  runs: readonly TaskRunQuerySummary[] | undefined,
  now: number,
  approvals: readonly ApprovalQuerySummary[] | undefined = [],
): ActiveTask[] {
  return deriveActiveTaskSnapshot(runs, now, approvals).tasks;
}

export function deriveActiveTaskSnapshot(
  runs: readonly TaskRunQuerySummary[] | undefined,
  now: number,
  approvals: readonly ApprovalQuerySummary[] | undefined = [],
): ActiveTaskSnapshot {
  const safeRuns = runs ?? [];
  const safeApprovals = approvals ?? [];
  const approvalsByTaskRun = new Map<string, ApprovalQuerySummary[]>();
  for (const approval of safeApprovals) {
    if (approval.source !== 'task_run' || !approval.taskRunId) {
      continue;
    }
    const entries = approvalsByTaskRun.get(approval.taskRunId) ?? [];
    entries.push(approval);
    approvalsByTaskRun.set(approval.taskRunId, entries);
  }

  const tasks: ActiveTask[] = [];
  for (const run of safeRuns) {
    const status = normalizeTaskStatus(run.status);
    const startedAt = Date.parse(run.startedAt);
    const endedAt = parseTaskFinishedAt(run);
    const runApprovals = approvalsByTaskRun.get(run.runId) ?? [];

    if ((status === 'done' || status === 'error') && endedAt && now - endedAt > DONE_TASK_LINGER_MS) {
      continue;
    }

    const detail = resolveTaskDetail(run, runApprovals);
    tasks.push({
      id: run.runId,
      name: extractTaskName(run.label),
      status,
      startedAt,
      endedAt,
      elapsed: (endedAt ?? now) - startedAt,
      ...(detail ? {detail} : {}),
      ...(runApprovals.length > 0 ? {approvalCount: runApprovals.length} : {}),
      ...(run.toolUseCount !== undefined ? {toolUseCount: run.toolUseCount} : {}),
      ...(run.totalTokens !== undefined ? {totalTokens: run.totalTokens} : {}),
    });
  }

  // Running first, then by start time descending
  tasks.sort((a, b) => {
    const aPriority = taskSortPriority(a.status);
    const bPriority = taskSortPriority(b.status);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.startedAt - a.startedAt;
  });

  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const pausedCount = tasks.filter((task) => task.status === 'paused').length;
  const doneCount = tasks.filter((task) => task.status === 'done').length;
  const errorCount = tasks.filter((task) => task.status === 'error').length;

  return {
    tasks: tasks.slice(0, MAX_VISIBLE_TASKS),
    runningCount,
    pausedCount,
    doneCount,
    errorCount,
  };
}

export function useActiveTasks(input: UseActiveTasksInput): UseActiveTasksOutput {
  const [now, setNow] = useState(() => Date.now());
  const snapshot = useMemo(
    () => deriveActiveTaskSnapshot(input.taskRunSummaries ?? [], now, input.approvals ?? []),
    [input.approvals, input.taskRunSummaries, now],
  );
  const {tasks, runningCount, pausedCount, doneCount, errorCount} = snapshot;

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
    pausedCount,
    doneCount,
    errorCount,
    hasActiveTasks: tasks.length > 0,
  };
}

function normalizeTaskStatus(status: string): ActiveTask['status'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    case 'paused':
      return 'paused';
    default:
      return 'running';
  }
}

function taskSortPriority(status: ActiveTask['status']): number {
  switch (status) {
    case 'running':
      return 0;
    case 'paused':
      return 1;
    case 'done':
    case 'error':
      return 2;
  }

  return 2;
}

function parseTaskFinishedAt(run: TaskRunQuerySummary): number | undefined {
  if (run.endedAt) return Date.parse(run.endedAt);
  return undefined;
}

function resolveTaskDetail(
  run: TaskRunQuerySummary,
  approvals: readonly ApprovalQuerySummary[],
): string | undefined {
  if (approvals.length > 0) {
    const lead = approvals[0]!;
    if (approvals.length === 1) {
      return `Waiting for approval on ${lead.toolName}`;
    }
    return `Waiting for approval on ${lead.toolName} (+${approvals.length - 1} more)`;
  }

  const detail = run.latestActivity?.trim() || run.summary?.trim();
  return detail || undefined;
}
