/**
 * Pure state-transition helpers and validation for the subagent run store.
 *
 * Every function here is a pure projection over {@link SubagentRunRecord} —
 * the store file only orchestrates read/write/persist around these.
 *
 * @module
 */

import {z} from 'zod';
import type {
  SubagentCompletionContinuation,
  SubagentRunPauseInput,
  SubagentRunRecord,
  SubagentRunResumeInput,
  SubagentRunStartInput,
  SubagentRunUpdateInput,
} from '@tasks/subagent/types';
import type {SubagentResult} from '@shared/subagent-result';

const subagentRunRecordSchema = z.object({
  runId: z.string(),
  parentSessionId: z.string(),
  batchId: z.string(),
  batchExpectedCount: z.number().int().positive(),
  label: z.string(),
  agentName: z.string(),
  subagentType: z.string().optional(),
  permissionMode: z.string().optional(),
  status: z.enum(['running', 'paused', 'completed', 'failed']),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
  childSessionId: z.string().optional(),
  latestActivity: z.string().optional(),
  activityLog: z.array(z.string()).optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  reason: z.enum(['complete', 'error', 'max_turns', 'budget_exhausted']).optional(),
  turns: z.number().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
  completionClaimedAt: z.string().optional(),
});

export function parseSubagentRunRecord(value: unknown): SubagentRunRecord | undefined {
  const parsed = subagentRunRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function cloneSubagentRun(record: SubagentRunRecord): SubagentRunRecord {
  return {...record};
}

export function sortSubagentRuns(records: SubagentRunRecord[]): SubagentRunRecord[] {
  return records
    .map((record) => cloneSubagentRun(record))
    .sort((left, right) => {
      const started = left.startedAt.localeCompare(right.startedAt);
      return started !== 0 ? started : left.runId.localeCompare(right.runId);
    });
}

export function applySubagentRunStart(
  existing: SubagentRunRecord | undefined,
  runId: string,
  input: SubagentRunStartInput,
  now: string,
): SubagentRunRecord {
  const next: SubagentRunRecord = {
    ...(existing ? cloneSubagentRun(existing) : createSubagentRunRecord(runId, input, now)),
    runId,
    parentSessionId: normalizeSessionId(input.parentSessionId),
    batchId: normalizeBatchId(input.batchId ?? existing?.batchId ?? `${normalizeSessionId(input.parentSessionId)}:${runId}`),
    batchExpectedCount: normalizeBatchExpectedCount(input.batchExpectedCount ?? existing?.batchExpectedCount ?? 1),
    label: normalizeText(input.label),
    agentName: normalizeText(input.agentName),
    ...(input.subagentType !== undefined ? {subagentType: normalizeOptionalText(input.subagentType)} : {}),
    status: 'running',
    updatedAt: now,
    ...(input.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(existing ? {} : {startedAt: now}),
  };

  if (existing) {
    next.startedAt = existing.startedAt;
    delete next.endedAt;
  }

  return next;
}

export function applySubagentRunUpdate(record: SubagentRunRecord, input: SubagentRunUpdateInput, now: string): SubagentRunRecord {
  const nextActivityLog = appendSubagentActivityLog(record.activityLog, input.activityLabel);
  return {
    ...record,
    ...(input.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    ...(nextActivityLog ? {activityLog: nextActivityLog} : {}),
    ...(typeof input.toolUseCount === 'number' ? {toolUseCount: input.toolUseCount} : {}),
    updatedAt: now,
  };
}

export function applySubagentRunResume(record: SubagentRunRecord, input: SubagentRunResumeInput | undefined, now: string): SubagentRunRecord {
  return {
    ...record,
    status: 'running',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

export function applySubagentRunPause(record: SubagentRunRecord, input: SubagentRunPauseInput | undefined, now: string): SubagentRunRecord {
  return {
    ...record,
    status: 'paused',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

export function applySubagentRunFinish(record: SubagentRunRecord, result: SubagentResult, now: string): SubagentRunRecord {
  return {
    ...record,
    status: result.reason === 'complete' ? 'completed' : 'failed',
    childSessionId: normalizeOptionalText(result.sessionId),
    reason: result.reason,
    turns: result.turns,
    ...(result.summary ? {summary: result.summary} : {}),
    ...(result.errorMessage ? {errorMessage: result.errorMessage} : {}),
    ...(result.toolUseCount !== undefined ? {toolUseCount: result.toolUseCount} : {}),
    ...(result.totalTokens !== undefined ? {totalTokens: result.totalTokens} : {}),
    updatedAt: now,
    endedAt: now,
  };
}

export function findPendingCompletionBatch(
  records: SubagentRunRecord[],
  parentSessionId: string,
  preferredBatchIds: readonly string[] = [],
): {records: SubagentRunRecord[]} | undefined {
  const batches = new Map<string, SubagentRunRecord[]>();
  for (const record of records) {
    if (record.parentSessionId !== parentSessionId) continue;
    const bucket = batches.get(record.batchId) ?? [];
    bucket.push(record);
    batches.set(record.batchId, bucket);
  }

  const preferredBatchIdSet = new Set(preferredBatchIds.map((batchId) => normalizeBatchId(batchId)));
  const sortedBatches = [...batches.values()]
    .filter((batchRecords) => batchRecords.length > 0)
    .filter((batchRecords) => preferredBatchIdSet.size === 0 || preferredBatchIdSet.has(batchRecords[0]!.batchId))
    .sort((left, right) => {
      const leftStartedAt = left[0]!.startedAt;
      const rightStartedAt = right[0]!.startedAt;
      const started = leftStartedAt.localeCompare(rightStartedAt);
      return started !== 0 ? started : left[0]!.batchId.localeCompare(right[0]!.batchId);
    });

  for (const batchRecords of sortedBatches) {
    const expectedCount = Math.max(...batchRecords.map((record) => record.batchExpectedCount));
    if (batchRecords.length < expectedCount) continue;
    if (batchRecords.some((record) => record.status === 'running' || record.status === 'paused')) continue;
    if (batchRecords.some((record) => record.completionClaimedAt)) continue;
    return {records: sortSubagentRuns(batchRecords)};
  }

  return undefined;
}

export function serializePendingCompletionBatch(records: SubagentRunRecord[]): SubagentCompletionContinuation {
  const [first] = records;
  return {
    parentSessionId: first!.parentSessionId,
    batchId: first!.batchId,
    runs: records.map((record) => ({
      runId: record.runId,
      label: record.label,
      agentName: record.agentName,
      status: record.status === 'failed' ? 'failed' : 'completed',
      ...(record.summary ? {summary: record.summary} : {}),
      ...(record.errorMessage ? {errorMessage: record.errorMessage} : {}),
      ...(typeof record.toolUseCount === 'number' ? {toolUseCount: record.toolUseCount} : {}),
      ...(typeof record.totalTokens === 'number' ? {totalTokens: record.totalTokens} : {}),
    })),
  };
}

export function normalizeRunId(value: string): string {
  const runId = value.trim();
  if (!runId) throw new Error('Subagent run id is required');
  return runId;
}

export function normalizeSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) throw new Error('Subagent run session id is required');
  return sessionId;
}

export function normalizeBatchId(value: string): string {
  const batchId = value.trim();
  if (!batchId) throw new Error('Subagent run batch id is required');
  return batchId;
}

function normalizeBatchExpectedCount(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('Subagent run batch expected count must be a positive integer');
  }
  return value;
}

function normalizeText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('Subagent run label and agent name are required');
  return text;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function createSubagentRunRecord(runId: string, input: SubagentRunStartInput, now: string): SubagentRunRecord {
  return {
    runId,
    parentSessionId: normalizeSessionId(input.parentSessionId),
    batchId: normalizeBatchId(input.batchId ?? `${normalizeSessionId(input.parentSessionId)}:${runId}`),
    batchExpectedCount: normalizeBatchExpectedCount(input.batchExpectedCount ?? 1),
    label: normalizeText(input.label),
    agentName: normalizeText(input.agentName),
    ...(input.subagentType !== undefined ? {subagentType: normalizeOptionalText(input.subagentType)} : {}),
    ...(input.permissionMode !== undefined ? {permissionMode: normalizeOptionalText(input.permissionMode)} : {}),
    status: 'running',
    startedAt: now,
    updatedAt: now,
    ...(input.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
  };
}

function appendSubagentActivityLog(current: string[] | undefined, nextLabel: string | undefined): string[] | undefined {
  const normalized = normalizeOptionalText(nextLabel);
  if (!normalized) return current ? [...current] : undefined;
  const next = [...(current ?? [])];
  if (next[next.length - 1] !== normalized) next.push(normalized);
  return next.slice(-12);
}
