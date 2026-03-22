import {randomUUID} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {
  SubagentCompletionContinuation,
  SubagentRunPauseInput,
  SubagentRunRecord,
  SubagentRunResumeInput,
  SubagentRunStartInput,
  SubagentRunStore,
  SubagentRunUpdateInput,
} from '@capability/subagent/types';
import type {SubagentResult} from '@shared/subagent-result';

export interface SubagentRunFileStoreOptions {
  rootDir: string;
}

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
  reason: z.enum(['complete', 'error', 'max_turns']).optional(),
  turns: z.number().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
  completionClaimedAt: z.string().optional(),
});

export function createSubagentRunMemoryStore(): SubagentRunStore {
  return new InMemorySubagentRunStore();
}

export function createSubagentRunFileStore(options: SubagentRunFileStoreOptions): SubagentRunStore {
  return new FileSubagentRunStore(options.rootDir);
}

class InMemorySubagentRunStore implements SubagentRunStore {
  private readonly records = new Map<string, SubagentRunRecord>();

  list(): SubagentRunRecord[] {
    return sortSubagentRuns(Array.from(this.records.values()));
  }

  get(runId: string): SubagentRunRecord | undefined {
    const record = this.records.get(runId.trim());
    return record ? cloneSubagentRun(record) : undefined;
  }

  start(input: SubagentRunStartInput): SubagentRunRecord {
    const runId = normalizeRunId(input.runId);
    const next = applySubagentRunStart(this.records.get(runId), runId, input, new Date().toISOString());
    this.records.set(runId, next);
    return cloneSubagentRun(next);
  }

  update(runId: string, input: SubagentRunUpdateInput): SubagentRunRecord {
    const record = this.requireRun(runId);
    const next = applySubagentRunUpdate(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneSubagentRun(next);
  }

  resume(runId: string, input?: SubagentRunResumeInput): SubagentRunRecord {
    const record = this.requireRun(runId);
    const next = applySubagentRunResume(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneSubagentRun(next);
  }

  pause(runId: string, input?: SubagentRunPauseInput): SubagentRunRecord {
    const record = this.requireRun(runId);
    const next = applySubagentRunPause(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneSubagentRun(next);
  }

  finish(runId: string, result: SubagentResult): SubagentRunRecord {
    const record = this.requireRun(runId);
    const next = applySubagentRunFinish(record, result, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneSubagentRun(next);
  }

  takePendingCompletion(parentSessionId: string, preferredBatchIds?: readonly string[]): SubagentCompletionContinuation | undefined {
    const pending = findPendingCompletionBatch(
      Array.from(this.records.values()),
      normalizeSessionId(parentSessionId),
      preferredBatchIds,
    );
    if (!pending) {
      return undefined;
    }

    const claimedAt = new Date().toISOString();
    for (const record of pending.records) {
      this.records.set(record.runId, {
        ...record,
        completionClaimedAt: claimedAt,
      });
    }

    return serializePendingCompletionBatch(pending.records);
  }

  restorePendingCompletion(parentSessionId: string, batchId: string): void {
    const normalizedSessionId = normalizeSessionId(parentSessionId);
    const normalizedBatchId = normalizeBatchId(batchId);
    for (const [runId, record] of this.records.entries()) {
      if (record.parentSessionId !== normalizedSessionId || record.batchId !== normalizedBatchId) {
        continue;
      }
      this.records.set(runId, {...record, completionClaimedAt: undefined});
    }
  }

  recoverSession(sessionId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const now = new Date().toISOString();

    for (const [runId, record] of this.records.entries()) {
      if (record.parentSessionId !== normalizedSessionId || record.status !== 'running') {
        continue;
      }
      this.records.set(runId, applySubagentRunPause(record, undefined, now));
    }
  }

  private requireRun(runId: string): SubagentRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Subagent run "${runId}" not found`);
    }
    return record;
  }
}

class FileSubagentRunStore implements SubagentRunStore {
  private readonly records = new Map<string, SubagentRunRecord>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly rootDir: string) {}

  list(): SubagentRunRecord[] {
    this.ensureLoaded();
    return sortSubagentRuns(Array.from(this.records.values()));
  }

  get(runId: string): SubagentRunRecord | undefined {
    this.ensureLoaded();
    const record = this.records.get(normalizeRunId(runId));
    return record ? cloneSubagentRun(record) : undefined;
  }

  start(input: SubagentRunStartInput): SubagentRunRecord {
    this.ensureLoaded();
    const runId = normalizeRunId(input.runId);
    const existing = this.records.get(runId);
    const next = applySubagentRunStart(existing, runId, input, new Date().toISOString());
    this.storeSubagentRun(next, existing);
    this.writeSubagentRun(next);
    return cloneSubagentRun(next);
  }

  update(runId: string, input: SubagentRunUpdateInput): SubagentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applySubagentRunUpdate(record, input, new Date().toISOString());
    this.storeSubagentRun(next, record);
    this.writeSubagentRun(next);
    return cloneSubagentRun(next);
  }

  resume(runId: string, input?: SubagentRunResumeInput): SubagentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applySubagentRunResume(record, input, new Date().toISOString());
    this.storeSubagentRun(next, record);
    this.writeSubagentRun(next);
    return cloneSubagentRun(next);
  }

  pause(runId: string, input?: SubagentRunPauseInput): SubagentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applySubagentRunPause(record, input, new Date().toISOString());
    this.storeSubagentRun(next, record);
    this.writeSubagentRun(next);
    return cloneSubagentRun(next);
  }

  finish(runId: string, result: SubagentResult): SubagentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applySubagentRunFinish(record, result, new Date().toISOString());
    this.storeSubagentRun(next, record);
    this.writeSubagentRun(next);
    return cloneSubagentRun(next);
  }

  takePendingCompletion(parentSessionId: string, preferredBatchIds?: readonly string[]): SubagentCompletionContinuation | undefined {
    this.ensureLoaded();
    const pending = findPendingCompletionBatch(
      Array.from(this.records.values()),
      normalizeSessionId(parentSessionId),
      preferredBatchIds,
    );
    if (!pending) {
      return undefined;
    }

    const claimedAt = new Date().toISOString();
    for (const record of pending.records) {
      const next = {
        ...record,
        completionClaimedAt: claimedAt,
      };
      this.storeSubagentRun(next, record);
      this.writeSubagentRun(next);
    }

    return serializePendingCompletionBatch(pending.records);
  }

  restorePendingCompletion(parentSessionId: string, batchId: string): void {
    this.ensureLoaded();
    const normalizedSessionId = normalizeSessionId(parentSessionId);
    const normalizedBatchId = normalizeBatchId(batchId);
    for (const record of this.records.values()) {
      if (record.parentSessionId !== normalizedSessionId || record.batchId !== normalizedBatchId || !record.completionClaimedAt) {
        continue;
      }
      const next = {
        ...record,
        completionClaimedAt: undefined,
      };
      this.storeSubagentRun(next, record);
      this.writeSubagentRun(next);
    }
  }

  recoverSession(sessionId: string): void {
    this.ensureLoaded();
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId);
    if (!runIds || runIds.size === 0) {
      return;
    }

    const now = new Date().toISOString();
    for (const runId of runIds) {
      const record = this.records.get(runId);
      if (!record || record.status !== 'running') {
        continue;
      }
      const next = applySubagentRunPause(record, undefined, now);
      this.storeSubagentRun(next, record);
      this.writeSubagentRun(next);
    }
  }

  private requireRun(runId: string): SubagentRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Subagent run "${runId}" not found`);
    }
    return record;
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    let entries: string[] = [];
    try {
      entries = readdirSync(this.rootDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const record = this.readSubagentRun(path.join(this.rootDir, entry));
      if (record) {
        this.storeSubagentRun(record);
      }
    }
  }

  private subagentRunPath(runId: string): string {
    return path.join(this.rootDir, `${normalizeRunId(runId)}.json`);
  }

  private readSubagentRun(filePath: string): SubagentRunRecord | undefined {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return parseSubagentRunRecord(raw);
    } catch {
      return undefined;
    }
  }

  private writeSubagentRun(record: SubagentRunRecord): void {
    mkdirSync(this.rootDir, {recursive: true});
    const filePath = this.subagentRunPath(record.runId);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  }

  private storeSubagentRun(record: SubagentRunRecord, previous?: SubagentRunRecord): void {
    if (previous && previous.parentSessionId !== record.parentSessionId) {
      this.unindexSubagentRun(previous.parentSessionId, previous.runId);
    }
    this.records.set(record.runId, record);
    this.indexSubagentRun(record.parentSessionId, record.runId);
  }

  private indexSubagentRun(sessionId: string, runId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId) ?? new Set<string>();
    runIds.add(runId);
    this.sessionIndex.set(normalizedSessionId, runIds);
  }

  private unindexSubagentRun(sessionId: string, runId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId);
    if (!runIds) {
      return;
    }
    runIds.delete(runId);
    if (runIds.size === 0) {
      this.sessionIndex.delete(normalizedSessionId);
    }
  }
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

function cloneSubagentRun(record: SubagentRunRecord): SubagentRunRecord {
  return {...record};
}

function sortSubagentRuns(records: SubagentRunRecord[]): SubagentRunRecord[] {
  return records
    .map((record) => cloneSubagentRun(record))
    .sort((left, right) => {
      const started = left.startedAt.localeCompare(right.startedAt);
      return started !== 0 ? started : left.runId.localeCompare(right.runId);
    });
}

function applySubagentRunStart(
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

function applySubagentRunUpdate(record: SubagentRunRecord, input: SubagentRunUpdateInput, now: string): SubagentRunRecord {
  const nextActivityLog = appendSubagentActivityLog(record.activityLog, input.activityLabel);
  return {
    ...record,
    ...(input.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    ...(nextActivityLog ? {activityLog: nextActivityLog} : {}),
    ...(typeof input.toolUseCount === 'number' ? {toolUseCount: input.toolUseCount} : {}),
    updatedAt: now,
  };
}

function applySubagentRunResume(record: SubagentRunRecord, input: SubagentRunResumeInput | undefined, now: string): SubagentRunRecord {
  return {
    ...record,
    status: 'running',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applySubagentRunPause(record: SubagentRunRecord, input: SubagentRunPauseInput | undefined, now: string): SubagentRunRecord {
  return {
    ...record,
    status: 'paused',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applySubagentRunFinish(record: SubagentRunRecord, result: SubagentResult, now: string): SubagentRunRecord {
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

function findPendingCompletionBatch(
  records: SubagentRunRecord[],
  parentSessionId: string,
  preferredBatchIds: readonly string[] = [],
): {records: SubagentRunRecord[]} | undefined {
  const batches = new Map<string, SubagentRunRecord[]>();
  for (const record of records) {
    if (record.parentSessionId !== parentSessionId) {
      continue;
    }
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
    if (batchRecords.length < expectedCount) {
      continue;
    }
    if (batchRecords.some((record) => record.status === 'running' || record.status === 'paused')) {
      continue;
    }
    if (batchRecords.some((record) => record.completionClaimedAt)) {
      continue;
    }
    return {records: sortSubagentRuns(batchRecords)};
  }

  return undefined;
}

function serializePendingCompletionBatch(records: SubagentRunRecord[]): SubagentCompletionContinuation {
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

function parseSubagentRunRecord(value: unknown): SubagentRunRecord | undefined {
  const parsed = subagentRunRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function appendSubagentActivityLog(current: string[] | undefined, nextLabel: string | undefined): string[] | undefined {
  const normalized = normalizeOptionalText(nextLabel);
  if (!normalized) {
    return current ? [...current] : undefined;
  }

  const next = [...(current ?? [])];
  if (next[next.length - 1] !== normalized) {
    next.push(normalized);
  }

  return next.slice(-12);
}

function normalizeRunId(value: string): string {
  const runId = value.trim();
  if (!runId) {
    throw new Error('Subagent run id is required');
  }
  return runId;
}

function normalizeSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) {
    throw new Error('Subagent run session id is required');
  }
  return sessionId;
}

function normalizeBatchId(value: string): string {
  const batchId = value.trim();
  if (!batchId) {
    throw new Error('Subagent run batch id is required');
  }
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
  if (!text) {
    throw new Error('Subagent run label and agent name are required');
  }
  return text;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}
