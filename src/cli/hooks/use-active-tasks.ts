import {useEffect, useMemo, useState} from 'react';
import type {ReviewQueryItem, AgentRunQuerySummary} from '@/index';

export type {AgentRunQuerySummary};

export interface ActiveTask {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error' | 'paused';
  startedAt: number;
  endedAt?: number;
  elapsed: number;
  detail?: string;
  reviewCount?: number;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface UseActiveTasksInput {
  agentRunSummaries: readonly AgentRunQuerySummary[];
  reviews?: readonly ReviewQueryItem[];
  preferredRunIds?: readonly string[];
}

export interface UseActiveTasksOutput {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount: number;
  hasActiveTasks: boolean;
}

export interface ActiveTaskSnapshot {
  tasks: ActiveTask[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount: number;
}

const MAX_VISIBLE_TASKS = 5;
export function extractTaskName(label: string): string {
  // Take first line only
  const firstLine = label.split('\n')[0]!.trim();
  // Strip "Delegating " prefix
  const text = firstLine.startsWith('Delegating ') ? firstLine.slice('Delegating '.length) : firstLine;
  const concise = summarizeTaskLabel(text);
  // "Plan: some long description" → "Plan: some long desc…"
  if (concise.length > 40) {
    return `${concise.slice(0, 37)}…`;
  }
  return concise;
}

function summarizeTaskLabel(text: string): string {
  const colonIndex = text.indexOf(': ');
  if (colonIndex <= 0) {
    return text;
  }

  const prefix = text.slice(0, colonIndex).trim();
  const body = text.slice(colonIndex + 2).trim();
  const sentenceBoundary = body.search(/[。！？.!?]/);
  if (sentenceBoundary <= 0) {
    return `${prefix}: ${body}`;
  }

  return `${prefix}: ${body.slice(0, sentenceBoundary).trim()}`;
}

export function deriveActiveTasks(
  runs: readonly AgentRunQuerySummary[],
  now: number,
  reviews: readonly ReviewQueryItem[] = [],
  preferredRunIds: readonly string[] = [],
): ActiveTask[] {
  return deriveActiveTaskSnapshot(runs, now, reviews, preferredRunIds).tasks;
}

export function deriveActiveTaskSnapshot(
  runs: readonly AgentRunQuerySummary[],
  now: number,
  reviews: readonly ReviewQueryItem[] = [],
  preferredRunIds: readonly string[] = [],
): ActiveTaskSnapshot {
  const activeBatchRunIds = selectVisibleRunIds(runs, preferredRunIds);
  const reviewsByTaskRun = new Map<string, ReviewQueryItem[]>();
  for (const review of reviews) {
    if (review.source !== 'agent_run' || !review.anchor.agentRunId) {
      continue;
    }
    const entries = reviewsByTaskRun.get(review.anchor.agentRunId) ?? [];
    entries.push(review);
    reviewsByTaskRun.set(review.anchor.agentRunId, entries);
  }

  const tasks: ActiveTask[] = [];
  for (const run of runs) {
    if (!activeBatchRunIds.has(run.runId)) {
      continue;
    }

    const status = normalizeTaskStatus(run.status);
    const startedAt = Date.parse(run.startedAt);
    const endedAt = parseTaskFinishedAt(run);
    const runReviews = reviewsByTaskRun.get(run.runId) ?? [];

    const detail = resolveTaskDetail(run, runReviews);
    tasks.push({
      id: run.runId,
      name: extractTaskName(run.label),
      status,
      startedAt,
      endedAt,
      elapsed: (endedAt ?? now) - startedAt,
      ...(detail ? {detail} : {}),
      ...(runReviews.length > 0 ? {reviewCount: runReviews.length} : {}),
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
  const visibleTasks = tasks.slice(0, MAX_VISIBLE_TASKS);

  return {
    tasks: visibleTasks,
    runningCount,
    pausedCount,
    doneCount,
    errorCount,
    hiddenCount: Math.max(tasks.length - visibleTasks.length, 0),
  };
}

export function useActiveTasks(input: UseActiveTasksInput): UseActiveTasksOutput {
  const [now, setNow] = useState(() => Date.now());
  const snapshot = useMemo(
    () => deriveActiveTaskSnapshot(input.agentRunSummaries, now, input.reviews, input.preferredRunIds),
    [input.preferredRunIds, input.reviews, input.agentRunSummaries, now],
  );
  const {tasks, runningCount, pausedCount, doneCount, errorCount, hiddenCount} = snapshot;

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
    hiddenCount,
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

function parseTaskFinishedAt(run: AgentRunQuerySummary): number | undefined {
  if (run.endedAt) return Date.parse(run.endedAt);
  return undefined;
}

function resolveTaskDetail(
  run: AgentRunQuerySummary,
  reviews: readonly ReviewQueryItem[],
): string | undefined {
  if (reviews.length > 0) {
    const lead = reviews[0]!;
    if (reviews.length === 1) {
      return `Waiting for approval on ${lead.toolName}`;
    }
    return `Waiting for approval on ${lead.toolName} (+${reviews.length - 1} more)`;
  }

  const detail = run.latestActivity?.trim() || run.summary?.trim();
  return detail || undefined;
}

function selectVisibleRunIds(
  runs: readonly AgentRunQuerySummary[],
  preferredRunIds: readonly string[] = [],
): Set<string> {
  if (preferredRunIds.length > 0) {
    const preferred = new Set(preferredRunIds);
    const visibleRunIds = new Set(
      runs
        .filter((run) => preferred.has(run.runId))
        .map((run) => run.runId),
    );
    if (visibleRunIds.size > 0) {
      return visibleRunIds;
    }
  }

  return selectLatestBatchRunIds(runs);
}

function selectLatestBatchRunIds(runs: readonly AgentRunQuerySummary[]): Set<string> {
  if (runs.length === 0) {
    return new Set<string>();
  }

  const sortedRuns = [...runs].sort((a, b) => {
    const startedDiff = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    if (startedDiff !== 0) return startedDiff;
    return a.runId.localeCompare(b.runId);
  });

  const batches: AgentRunQuerySummary[][] = [];
  let currentBatch: AgentRunQuerySummary[] = [];
  let currentBatchTerminalAt = Number.NEGATIVE_INFINITY;

  for (const run of sortedRuns) {
    const startedAt = Date.parse(run.startedAt);
    const endedAt = parseTaskFinishedAt(run) ?? Number.POSITIVE_INFINITY;

    if (currentBatch.length === 0 || startedAt <= currentBatchTerminalAt) {
      currentBatch.push(run);
      currentBatchTerminalAt = Math.max(currentBatchTerminalAt, endedAt);
      continue;
    }

    batches.push(currentBatch);
    currentBatch = [run];
    currentBatchTerminalAt = endedAt;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return new Set(batches.at(-1)?.map((run) => run.runId) ?? []);
}
