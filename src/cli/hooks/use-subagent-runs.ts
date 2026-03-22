import {useEffect, useMemo, useState} from 'react';
import type {ReviewQueryItem, SubagentRunQuerySummary} from '@/index';

export type {SubagentRunQuerySummary};

export interface ActiveSubagentRun {
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

export interface UseSubagentRunsInput {
  subagentRunSummaries: readonly SubagentRunQuerySummary[];
  reviews?: readonly ReviewQueryItem[];
  preferredRunIds?: readonly string[];
}

export interface UseSubagentRunsOutput {
  runs: ActiveSubagentRun[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount: number;
  hasActiveRuns: boolean;
}

export interface ActiveSubagentRunSnapshot {
  runs: ActiveSubagentRun[];
  runningCount: number;
  pausedCount: number;
  doneCount: number;
  errorCount: number;
  hiddenCount: number;
}

const MAX_VISIBLE_SUBAGENT_RUNS = 5;

export function extractSubagentRunName(label: string): string {
  const firstLine = label.split('\n')[0]!.trim();
  const text = firstLine.startsWith('Delegating ') ? firstLine.slice('Delegating '.length) : firstLine;
  const concise = summarizeSubagentRunLabel(text);
  if (concise.length > 40) {
    return `${concise.slice(0, 37)}…`;
  }
  return concise;
}

function summarizeSubagentRunLabel(text: string): string {
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

export function deriveVisibleSubagentRuns(
  runs: readonly SubagentRunQuerySummary[],
  now: number,
  reviews: readonly ReviewQueryItem[] = [],
  preferredRunIds: readonly string[] = [],
): ActiveSubagentRun[] {
  return deriveSubagentRunSnapshot(runs, now, reviews, preferredRunIds).runs;
}

export function deriveSubagentRunSnapshot(
  runs: readonly SubagentRunQuerySummary[],
  now: number,
  reviews: readonly ReviewQueryItem[] = [],
  preferredRunIds: readonly string[] = [],
): ActiveSubagentRunSnapshot {
  const activeBatchRunIds = selectVisibleRunIds(runs, preferredRunIds);
  const reviewsBySubagentRun = new Map<string, ReviewQueryItem[]>();
  for (const review of reviews) {
    if (review.source !== 'subagent_run' || !review.anchor.subagentRunId) {
      continue;
    }
    const entries = reviewsBySubagentRun.get(review.anchor.subagentRunId) ?? [];
    entries.push(review);
    reviewsBySubagentRun.set(review.anchor.subagentRunId, entries);
  }

  const runsSnapshot: ActiveSubagentRun[] = [];
  for (const run of runs) {
    if (!activeBatchRunIds.has(run.runId)) {
      continue;
    }

    const status = normalizeSubagentRunStatus(run.status);
    const startedAt = Date.parse(run.startedAt);
    const endedAt = parseSubagentRunFinishedAt(run);
    const runReviews = reviewsBySubagentRun.get(run.runId) ?? [];
    const detail = resolveSubagentRunDetail(run, runReviews);

    runsSnapshot.push({
      id: run.runId,
      name: extractSubagentRunName(run.label),
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

  runsSnapshot.sort((a, b) => {
    const aPriority = subagentRunSortPriority(a.status);
    const bPriority = subagentRunSortPriority(b.status);
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return b.startedAt - a.startedAt;
  });

  const runningCount = runsSnapshot.filter((run) => run.status === 'running').length;
  const pausedCount = runsSnapshot.filter((run) => run.status === 'paused').length;
  const doneCount = runsSnapshot.filter((run) => run.status === 'done').length;
  const errorCount = runsSnapshot.filter((run) => run.status === 'error').length;
  const visibleRuns = runsSnapshot.slice(0, MAX_VISIBLE_SUBAGENT_RUNS);

  return {
    runs: visibleRuns,
    runningCount,
    pausedCount,
    doneCount,
    errorCount,
    hiddenCount: Math.max(runsSnapshot.length - visibleRuns.length, 0),
  };
}

export function useSubagentRuns(input: UseSubagentRunsInput): UseSubagentRunsOutput {
  const [now, setNow] = useState(() => Date.now());
  const snapshot = useMemo(
    () => deriveSubagentRunSnapshot(input.subagentRunSummaries, now, input.reviews, input.preferredRunIds),
    [input.preferredRunIds, input.reviews, input.subagentRunSummaries, now],
  );
  const {runs, runningCount, pausedCount, doneCount, errorCount, hiddenCount} = snapshot;

  useEffect(() => {
    if (runningCount === 0 && runs.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [runningCount, runs.length]);

  return {
    runs,
    runningCount,
    pausedCount,
    doneCount,
    errorCount,
    hiddenCount,
    hasActiveRuns: runs.length > 0,
  };
}

function normalizeSubagentRunStatus(status: string): ActiveSubagentRun['status'] {
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

function subagentRunSortPriority(status: ActiveSubagentRun['status']): number {
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

function parseSubagentRunFinishedAt(run: SubagentRunQuerySummary): number | undefined {
  if (run.endedAt) {
    return Date.parse(run.endedAt);
  }
  return undefined;
}

function resolveSubagentRunDetail(
  run: SubagentRunQuerySummary,
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
  runs: readonly SubagentRunQuerySummary[],
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

function selectLatestBatchRunIds(runs: readonly SubagentRunQuerySummary[]): Set<string> {
  if (runs.length === 0) {
    return new Set<string>();
  }

  const sortedRuns = [...runs].sort((a, b) => {
    const startedDiff = Date.parse(a.startedAt) - Date.parse(b.startedAt);
    if (startedDiff !== 0) {
      return startedDiff;
    }
    return a.runId.localeCompare(b.runId);
  });

  const batches: SubagentRunQuerySummary[][] = [];
  let currentBatch: SubagentRunQuerySummary[] = [];
  let currentBatchTerminalAt = Number.NEGATIVE_INFINITY;

  for (const run of sortedRuns) {
    const startedAt = Date.parse(run.startedAt);
    const endedAt = parseSubagentRunFinishedAt(run) ?? Number.POSITIVE_INFINITY;

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
