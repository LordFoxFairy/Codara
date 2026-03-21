import {mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {PauseRequest} from '@shared/contracts/agent-types';

export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  source: 'task_run';
  description: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
  pauseRequest: PauseRequest;
  taskRunId?: string;
  childSessionId?: string;
}

export interface ApprovalTaskRunInput {
  sessionId: string;
  taskRunId: string;
  pauseRequest: PauseRequest;
  childSessionId?: string;
}

export interface ApprovalStore {
  list(sessionId?: string): ApprovalRecord[];
  get(approvalId: string): ApprovalRecord | undefined;
  upsertTaskRunApproval(input: ApprovalTaskRunInput): ApprovalRecord;
  remove(approvalId: string): void;
  removeByTaskRunId(taskRunId: string): void;
}

export interface ApprovalFileStoreOptions {
  rootDir: string;
}

export function createApprovalMemoryStore(): ApprovalStore {
  return new InMemoryApprovalStore();
}

export function createApprovalFileStore(options: ApprovalFileStoreOptions): ApprovalStore {
  return new FileApprovalStore(options.rootDir);
}

class InMemoryApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private readonly taskRunIndex = new Map<string, Set<string>>();

  list(sessionId?: string): ApprovalRecord[] {
    const records = sessionId
      ? this.lookupBySession(sessionId)
      : Array.from(this.records.values());
    return sortApprovals(records);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    const record = this.records.get(normalizeApprovalId(approvalId));
    return record ? cloneApprovalRecord(record) : undefined;
  }

  upsertTaskRunApproval(input: ApprovalTaskRunInput): ApprovalRecord {
    const normalizedTaskRunId = normalizeTaskRunId(input.taskRunId);
    const approvalId = normalizeApprovalId(input.pauseRequest.id);
    const existing = this.records.get(approvalId);
    const now = new Date().toISOString();
    const next: ApprovalRecord = {
      approvalId,
      sessionId: normalizeSessionId(input.sessionId),
      source: 'task_run',
      taskRunId: normalizedTaskRunId,
      description: input.pauseRequest.description,
      toolName: input.pauseRequest.action.toolName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.childSessionId ? {childSessionId: input.childSessionId} : {}),
      pauseRequest: clonePauseRequest(input.pauseRequest),
    };
    this.store(next, existing);
    return cloneApprovalRecord(next);
  }

  remove(approvalId: string): void {
    const normalizedApprovalId = normalizeApprovalId(approvalId);
    const record = this.records.get(normalizedApprovalId);
    if (!record) {
      return;
    }
    this.records.delete(normalizedApprovalId);
    this.unindex(record);
  }

  removeByTaskRunId(taskRunId: string): void {
    const normalizedTaskRunId = normalizeTaskRunId(taskRunId);
    const approvalIds = [...(this.taskRunIndex.get(normalizedTaskRunId) ?? [])];
    for (const approvalId of approvalIds) {
      this.remove(approvalId);
    }
  }

  private lookupBySession(sessionId: string): ApprovalRecord[] {
    const approvalIds = this.sessionIndex.get(normalizeSessionId(sessionId));
    if (!approvalIds) {
      return [];
    }
    return [...approvalIds]
      .map((approvalId) => this.records.get(approvalId))
      .filter((record): record is ApprovalRecord => Boolean(record));
  }

  private store(record: ApprovalRecord, previous?: ApprovalRecord): void {
    if (previous) {
      this.unindex(previous);
    }

    this.records.set(record.approvalId, record);
    this.index(record);
  }

  private index(record: ApprovalRecord): void {
    indexValue(this.sessionIndex, normalizeSessionId(record.sessionId), record.approvalId);
    if (record.taskRunId) {
      indexValue(this.taskRunIndex, normalizeTaskRunId(record.taskRunId), record.approvalId);
    }
  }

  private unindex(record: ApprovalRecord): void {
    unindexValue(this.sessionIndex, normalizeSessionId(record.sessionId), record.approvalId);
    if (record.taskRunId) {
      unindexValue(this.taskRunIndex, normalizeTaskRunId(record.taskRunId), record.approvalId);
    }
  }
}

class FileApprovalStore implements ApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private readonly taskRunIndex = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly rootDir: string) {}

  list(sessionId?: string): ApprovalRecord[] {
    this.ensureLoaded();
    const records = sessionId
      ? this.lookupBySession(sessionId)
      : Array.from(this.records.values());
    return sortApprovals(records);
  }

  get(approvalId: string): ApprovalRecord | undefined {
    this.ensureLoaded();
    const record = this.records.get(normalizeApprovalId(approvalId));
    return record ? cloneApprovalRecord(record) : undefined;
  }

  upsertTaskRunApproval(input: ApprovalTaskRunInput): ApprovalRecord {
    this.ensureLoaded();
    const normalizedTaskRunId = normalizeTaskRunId(input.taskRunId);
    const approvalId = normalizeApprovalId(input.pauseRequest.id);
    const existing = this.records.get(approvalId);
    const now = new Date().toISOString();
    const next: ApprovalRecord = {
      approvalId,
      sessionId: normalizeSessionId(input.sessionId),
      source: 'task_run',
      taskRunId: normalizedTaskRunId,
      description: input.pauseRequest.description,
      toolName: input.pauseRequest.action.toolName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(input.childSessionId ? {childSessionId: input.childSessionId} : {}),
      pauseRequest: clonePauseRequest(input.pauseRequest),
    };
    this.store(next, existing);
    this.persist(next);
    return cloneApprovalRecord(next);
  }

  remove(approvalId: string): void {
    this.ensureLoaded();
    const normalizedApprovalId = normalizeApprovalId(approvalId);
    const record = this.records.get(normalizedApprovalId);
    if (!record) {
      return;
    }

    this.records.delete(normalizedApprovalId);
    this.unindex(record);
    rmSync(this.recordPath(normalizedApprovalId), {force: true});
  }

  removeByTaskRunId(taskRunId: string): void {
    this.ensureLoaded();
    const normalizedTaskRunId = normalizeTaskRunId(taskRunId);
    const approvalIds = [...(this.taskRunIndex.get(normalizedTaskRunId) ?? [])];
    for (const approvalId of approvalIds) {
      this.remove(approvalId);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    try {
      const entries = readdirSync(this.rootDir, {withFileTypes: true});
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }

        const record = this.readRecord(path.join(this.rootDir, entry.name));
        if (!record || record.source !== 'task_run') {
          continue;
        }

        this.records.set(record.approvalId, record);
        this.index(record);
      }
    } catch (error) {
      if (isMissingFile(error)) {
        return;
      }
      throw error;
    }
  }

  private lookupBySession(sessionId: string): ApprovalRecord[] {
    const approvalIds = this.sessionIndex.get(normalizeSessionId(sessionId));
    if (!approvalIds) {
      return [];
    }
    return [...approvalIds]
      .map((approvalId) => this.records.get(approvalId))
      .filter((record): record is ApprovalRecord => Boolean(record));
  }

  private recordPath(approvalId: string): string {
    return path.join(this.rootDir, `${normalizeApprovalId(approvalId)}.json`);
  }

  private readRecord(filePath: string): ApprovalRecord | undefined {
    try {
      const raw = readFileSync(filePath, 'utf8');
      return parseApprovalRecord(JSON.parse(raw));
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private store(record: ApprovalRecord, previous?: ApprovalRecord): void {
    if (previous) {
      this.unindex(previous);
    }

    this.records.set(record.approvalId, record);
    this.index(record);
  }

  private index(record: ApprovalRecord): void {
    indexValue(this.sessionIndex, normalizeSessionId(record.sessionId), record.approvalId);
    if (record.taskRunId) {
      indexValue(this.taskRunIndex, normalizeTaskRunId(record.taskRunId), record.approvalId);
    }
  }

  private persist(record: ApprovalRecord): void {
    mkdirSync(this.rootDir, {recursive: true});
    const filePath = this.recordPath(record.approvalId);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    rmSync(filePath, {force: true});
    renameSync(tempPath, filePath);
  }

  private unindex(record: ApprovalRecord): void {
    unindexValue(this.sessionIndex, normalizeSessionId(record.sessionId), record.approvalId);
    if (record.taskRunId) {
      unindexValue(this.taskRunIndex, normalizeTaskRunId(record.taskRunId), record.approvalId);
    }
  }
}

function sortApprovals(records: readonly ApprovalRecord[]): ApprovalRecord[] {
  return [...records]
    .sort((left, right) => {
      const createdDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdDelta !== 0) {
        return createdDelta;
      }
      return right.approvalId.localeCompare(left.approvalId);
    })
    .map(cloneApprovalRecord);
}

function cloneApprovalRecord(record: ApprovalRecord): ApprovalRecord {
  return {
    ...record,
    pauseRequest: clonePauseRequest(record.pauseRequest),
  };
}

function clonePauseRequest(request: PauseRequest): PauseRequest {
  return structuredClone(request);
}

function normalizeApprovalId(approvalId: string): string {
  const normalized = approvalId.trim();
  if (!normalized) {
    throw new Error('Approval id is required');
  }
  return normalized;
}

function normalizeTaskRunId(taskRunId: string): string {
  const normalized = taskRunId.trim();
  if (!normalized) {
    throw new Error('Task run id is required');
  }
  return normalized;
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error('Session id is required');
  }
  return normalized;
}

function parseApprovalRecord(value: unknown): ApprovalRecord | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Partial<ApprovalRecord>;
  if (record.source !== 'task_run') {
    return undefined;
  }

  normalizeApprovalId(record.approvalId ?? '');
  normalizeSessionId(record.sessionId ?? '');
  normalizeTaskRunId(record.taskRunId ?? '');

  return record as ApprovalRecord;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as {code?: string}).code === 'ENOENT',
  );
}

function indexValue(index: Map<string, Set<string>>, key: string, value: string): void {
  const entries = index.get(key) ?? new Set<string>();
  entries.add(value);
  index.set(key, entries);
}

function unindexValue(index: Map<string, Set<string>>, key: string, value: string): void {
  const entries = index.get(key);
  if (!entries) {
    return;
  }

  entries.delete(value);
  if (entries.size === 0) {
    index.delete(key);
  }
}
