/**
 * Subagent run stores.
 *
 * Two implementations with a shared base class:
 *  - {@link InMemorySubagentRunStore} — ephemeral, wiped on process exit.
 *  - {@link FileSubagentRunStore} — JSON-per-run persistence under a root dir.
 *
 * All record state transitions live in {@link ./run-store-mutations}; this
 * module only coordinates read/write/persist around them.
 *
 * @module
 */

import {randomUUID} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {
  SubagentCompletionContinuation,
  SubagentRunPauseInput,
  SubagentRunRecord,
  SubagentRunResumeInput,
  SubagentRunStartInput,
  SubagentRunStore,
  SubagentRunUpdateInput,
} from '@tasks/subagent/types';
import type {SubagentResult} from '@shared/subagent-result';
import {
  applySubagentRunFinish,
  applySubagentRunPause,
  applySubagentRunResume,
  applySubagentRunStart,
  applySubagentRunUpdate,
  cloneSubagentRun,
  findPendingCompletionBatch,
  normalizeBatchId,
  normalizeRunId,
  normalizeSessionId,
  parseSubagentRunRecord,
  serializePendingCompletionBatch,
  sortSubagentRuns,
} from './run-store-mutations';

export interface SubagentRunFileStoreOptions {
  rootDir: string;
}

export function createSubagentRunMemoryStore(): SubagentRunStore {
  return new InMemorySubagentRunStore();
}

export function createSubagentRunFileStore(options: SubagentRunFileStoreOptions): SubagentRunStore {
  return new FileSubagentRunStore(options.rootDir);
}

abstract class BaseSubagentRunStore implements SubagentRunStore {
  protected readonly records = new Map<string, SubagentRunRecord>();

  /** Called before any read/write to ensure data is loaded. */
  protected ensureReady(): void {}

  /** Persist a record after mutation. Override in file-backed stores. */
  protected persist(_record: SubagentRunRecord, _previous?: SubagentRunRecord): void {}

  protected storeRecord(record: SubagentRunRecord, previous?: SubagentRunRecord): void {
    this.records.set(record.runId, record);
    this.persist(record, previous);
  }

  list(): SubagentRunRecord[] {
    this.ensureReady();
    return sortSubagentRuns(Array.from(this.records.values()));
  }

  get(runId: string): SubagentRunRecord | undefined {
    this.ensureReady();
    const record = this.records.get(normalizeRunId(runId));
    return record ? cloneSubagentRun(record) : undefined;
  }

  start(input: SubagentRunStartInput): SubagentRunRecord {
    this.ensureReady();
    const runId = normalizeRunId(input.runId);
    const existing = this.records.get(runId);
    const next = applySubagentRunStart(existing, runId, input, new Date().toISOString());
    this.storeRecord(next, existing);
    return cloneSubagentRun(next);
  }

  update(runId: string, input: SubagentRunUpdateInput): SubagentRunRecord {
    this.ensureReady();
    const record = this.requireRun(runId);
    const next = applySubagentRunUpdate(record, input, new Date().toISOString());
    this.storeRecord(next, record);
    return cloneSubagentRun(next);
  }

  resume(runId: string, input?: SubagentRunResumeInput): SubagentRunRecord {
    this.ensureReady();
    const record = this.requireRun(runId);
    const next = applySubagentRunResume(record, input, new Date().toISOString());
    this.storeRecord(next, record);
    return cloneSubagentRun(next);
  }

  pause(runId: string, input?: SubagentRunPauseInput): SubagentRunRecord {
    this.ensureReady();
    const record = this.requireRun(runId);
    const next = applySubagentRunPause(record, input, new Date().toISOString());
    this.storeRecord(next, record);
    return cloneSubagentRun(next);
  }

  finish(runId: string, result: SubagentResult): SubagentRunRecord {
    this.ensureReady();
    const record = this.requireRun(runId);
    const next = applySubagentRunFinish(record, result, new Date().toISOString());
    this.storeRecord(next, record);
    return cloneSubagentRun(next);
  }

  takePendingCompletion(parentSessionId: string, preferredBatchIds?: readonly string[]): SubagentCompletionContinuation | undefined {
    this.ensureReady();
    const pending = findPendingCompletionBatch(
      Array.from(this.records.values()),
      normalizeSessionId(parentSessionId),
      preferredBatchIds,
    );
    if (!pending) return undefined;

    const claimedAt = new Date().toISOString();
    for (const record of pending.records) {
      const next = {...record, completionClaimedAt: claimedAt};
      this.storeRecord(next, record);
    }

    return serializePendingCompletionBatch(pending.records);
  }

  restorePendingCompletion(parentSessionId: string, batchId: string): void {
    this.ensureReady();
    const normalizedSessionId = normalizeSessionId(parentSessionId);
    const normalizedBatchId = normalizeBatchId(batchId);
    for (const record of this.records.values()) {
      if (record.parentSessionId !== normalizedSessionId || record.batchId !== normalizedBatchId || !record.completionClaimedAt) continue;
      const next = {...record, completionClaimedAt: undefined};
      this.storeRecord(next, record);
    }
  }

  recoverSession(sessionId: string): void {
    this.ensureReady();
    const normalizedSessionId = normalizeSessionId(sessionId);
    const now = new Date().toISOString();

    for (const record of this.records.values()) {
      if (record.parentSessionId !== normalizedSessionId || record.status !== 'running') continue;
      const next = applySubagentRunPause(record, undefined, now);
      this.storeRecord(next, record);
    }
  }

  protected requireRun(runId: string): SubagentRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) throw new Error(`Subagent run "${runId}" not found`);
    return record;
  }
}

class InMemorySubagentRunStore extends BaseSubagentRunStore {}

class FileSubagentRunStore extends BaseSubagentRunStore {
  private readonly sessionIndex = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly rootDir: string) {
    super();
  }

  protected override ensureReady(): void {
    if (this.loaded) return;
    this.loaded = true;

    let entries: string[] = [];
    try {
      entries = readdirSync(this.rootDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const record = this.readSubagentRun(path.join(this.rootDir, entry));
      if (record) {
        this.records.set(record.runId, record);
        this.indexSubagentRun(record.parentSessionId, record.runId);
      }
    }
  }

  protected override persist(record: SubagentRunRecord, previous?: SubagentRunRecord): void {
    if (previous && previous.parentSessionId !== record.parentSessionId) {
      this.unindexSubagentRun(previous.parentSessionId, previous.runId);
    }
    this.indexSubagentRun(record.parentSessionId, record.runId);
    this.writeSubagentRun(record);
  }

  override recoverSession(sessionId: string): void {
    this.ensureReady();
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId);
    if (!runIds || runIds.size === 0) return;

    const now = new Date().toISOString();
    for (const runId of runIds) {
      const record = this.records.get(runId);
      if (!record || record.status !== 'running') continue;
      const next = applySubagentRunPause(record, undefined, now);
      this.storeRecord(next, record);
    }
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
    const filePath = path.join(this.rootDir, `${normalizeRunId(record.runId)}.json`);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
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
    if (!runIds) return;
    runIds.delete(runId);
    if (runIds.size === 0) this.sessionIndex.delete(normalizedSessionId);
  }
}
