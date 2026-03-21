import {randomUUID} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {
  TaskRunPauseInput,
  TaskRunRecord,
  TaskRunResumeInput,
  TaskRunStartInput,
  TaskRunStore,
  TaskRunUpdateInput,
} from '@capability/task/types';
import type {DelegatedAgentResult} from '@shared/delegation-result';

export interface TaskRunFileStoreOptions {
  rootDir: string;
}

const taskRunRecordSchema = z.object({
  runId: z.string(),
  sessionId: z.string(),
  parentSessionId: z.string().optional(),
  label: z.string(),
  agentName: z.string(),
  status: z.enum(['running', 'paused', 'completed', 'failed']),
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
  childSessionId: z.string().optional(),
  prompt: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  toolNames: z.array(z.string()).optional(),
  systemMessages: z.array(z.string()).optional(),
  latestActivity: z.string().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  reason: z.enum(['complete', 'error', 'max_turns']).optional(),
  turns: z.number().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
});

export function createTaskRunMemoryStore(): TaskRunStore {
  return new InMemoryTaskRunStore();
}

export function createTaskRunFileStore(options: TaskRunFileStoreOptions): TaskRunStore {
  return new FileTaskRunStore(options.rootDir);
}

class InMemoryTaskRunStore implements TaskRunStore {
  private readonly records = new Map<string, TaskRunRecord>();

  list(): TaskRunRecord[] {
    return sortTaskRuns(Array.from(this.records.values()));
  }

  get(runId: string): TaskRunRecord | undefined {
    const record = this.records.get(runId.trim());
    return record ? cloneTaskRun(record) : undefined;
  }

  start(input: TaskRunStartInput): TaskRunRecord {
    const runId = normalizeRunId(input.runId);
    const next = applyTaskRunStart(this.records.get(runId), runId, input, new Date().toISOString());
    this.records.set(runId, next);
    return cloneTaskRun(next);
  }

  update(runId: string, input: TaskRunUpdateInput): TaskRunRecord {
    const record = this.requireRun(runId);
    const next = applyTaskRunUpdate(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneTaskRun(next);
  }

  resume(runId: string, input?: TaskRunResumeInput): TaskRunRecord {
    const record = this.requireRun(runId);
    const next = applyTaskRunResume(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneTaskRun(next);
  }

  pause(runId: string, input?: TaskRunPauseInput): TaskRunRecord {
    const record = this.requireRun(runId);
    const next = applyTaskRunPause(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneTaskRun(next);
  }

  finish(runId: string, result: DelegatedAgentResult): TaskRunRecord {
    const record = this.requireRun(runId);
    const next = applyTaskRunFinish(record, result, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneTaskRun(next);
  }

  recoverSession(sessionId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const now = new Date().toISOString();

    for (const [runId, record] of this.records.entries()) {
      if (record.sessionId !== normalizedSessionId || record.status !== 'running') {
        continue;
      }

      const next = applyTaskRunPause(record, undefined, now);
      this.records.set(runId, next);
    }
  }

  private requireRun(runId: string): TaskRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Task run "${runId}" not found`);
    }
    return record;
  }
}

class FileTaskRunStore implements TaskRunStore {
  private readonly records = new Map<string, TaskRunRecord>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly rootDir: string) {}

  list(): TaskRunRecord[] {
    this.ensureLoaded();
    return sortTaskRuns(Array.from(this.records.values()));
  }

  get(runId: string): TaskRunRecord | undefined {
    this.ensureLoaded();
    const record = this.records.get(normalizeRunId(runId));
    return record ? cloneTaskRun(record) : undefined;
  }

  start(input: TaskRunStartInput): TaskRunRecord {
    this.ensureLoaded();
    const runId = normalizeRunId(input.runId);
    const existing = this.records.get(runId);
    const next = applyTaskRunStart(existing, runId, input, new Date().toISOString());
    this.storeTaskRun(next, existing);
    this.writeTaskRun(next);
    return cloneTaskRun(next);
  }

  update(runId: string, input: TaskRunUpdateInput): TaskRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyTaskRunUpdate(record, input, new Date().toISOString());
    this.storeTaskRun(next, record);
    this.writeTaskRun(next);
    return cloneTaskRun(next);
  }

  resume(runId: string, input?: TaskRunResumeInput): TaskRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyTaskRunResume(record, input, new Date().toISOString());
    this.storeTaskRun(next, record);
    this.writeTaskRun(next);
    return cloneTaskRun(next);
  }

  pause(runId: string, input?: TaskRunPauseInput): TaskRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyTaskRunPause(record, input, new Date().toISOString());
    this.storeTaskRun(next, record);
    this.writeTaskRun(next);
    return cloneTaskRun(next);
  }

  finish(runId: string, result: DelegatedAgentResult): TaskRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyTaskRunFinish(record, result, new Date().toISOString());
    this.storeTaskRun(next, record);
    this.writeTaskRun(next);
    return cloneTaskRun(next);
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

      const next = applyTaskRunPause(record, undefined, now);
      this.storeTaskRun(next, record);
      this.writeTaskRun(next);
    }
  }

  private requireRun(runId: string): TaskRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Task run "${runId}" not found`);
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

      const record = this.readTaskRun(path.join(this.rootDir, entry));
      if (record) {
        this.storeTaskRun(record);
      }
    }
  }

  private taskRunPath(runId: string): string {
    return path.join(this.rootDir, `${normalizeRunId(runId)}.json`);
  }

  private readTaskRun(filePath: string): TaskRunRecord | undefined {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return parseTaskRunRecord(raw);
    } catch {
      return undefined;
    }
  }

  private writeTaskRun(record: TaskRunRecord): void {
    mkdirSync(this.rootDir, {recursive: true});
    const filePath = this.taskRunPath(record.runId);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  }

  private storeTaskRun(record: TaskRunRecord, previous?: TaskRunRecord): void {
    if (previous && previous.sessionId !== record.sessionId) {
      this.unindexTaskRun(previous.sessionId, previous.runId);
    }

    this.records.set(record.runId, record);
    this.indexTaskRun(record.sessionId, record.runId);
  }

  private indexTaskRun(sessionId: string, runId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId) ?? new Set<string>();
    runIds.add(runId);
    this.sessionIndex.set(normalizedSessionId, runIds);
  }

  private unindexTaskRun(sessionId: string, runId: string): void {
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

function createTaskRunRecord(runId: string, input: TaskRunStartInput, now: string): TaskRunRecord {
  return {
    runId,
    sessionId: normalizeSessionId(input.sessionId),
    parentSessionId: normalizeParentSessionId(input.parentSessionId, input.sessionId),
    label: normalizeText(input.label),
    agentName: normalizeText(input.agentName),
    status: 'running',
    startedAt: now,
    updatedAt: now,
    ...(input.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input.prompt !== undefined ? {prompt: normalizeOptionalText(input.prompt)} : {}),
    ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
    ...(input.toolNames?.length ? {toolNames: normalizeStringList(input.toolNames)} : {}),
    ...(input.systemMessages?.length ? {systemMessages: normalizeStringList(input.systemMessages)} : {}),
  };
}

function cloneTaskRun(record: TaskRunRecord): TaskRunRecord {
  return {...record};
}

function sortTaskRuns(records: TaskRunRecord[]): TaskRunRecord[] {
  return records
    .map((record) => cloneTaskRun(record))
    .sort((left, right) => {
      const started = left.startedAt.localeCompare(right.startedAt);
      return started !== 0 ? started : left.runId.localeCompare(right.runId);
    });
}

function applyTaskRunStart(
  existing: TaskRunRecord | undefined,
  runId: string,
  input: TaskRunStartInput,
  now: string,
): TaskRunRecord {
  const next: TaskRunRecord = {
    ...(existing ? cloneTaskRun(existing) : createTaskRunRecord(runId, input, now)),
    runId,
    sessionId: normalizeSessionId(input.sessionId),
    parentSessionId: normalizeParentSessionId(input.parentSessionId, input.sessionId),
    label: normalizeText(input.label),
    agentName: normalizeText(input.agentName),
    status: 'running',
    updatedAt: now,
    ...(input.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input.prompt !== undefined ? {prompt: normalizeOptionalText(input.prompt)} : {}),
    ...(typeof input.maxTurns === 'number' ? {maxTurns: input.maxTurns} : {}),
    ...(input.toolNames !== undefined ? {toolNames: normalizeStringList(input.toolNames)} : {}),
    ...(input.systemMessages !== undefined ? {systemMessages: normalizeStringList(input.systemMessages)} : {}),
    ...(existing ? {} : {startedAt: now}),
  };

  if (existing) {
    next.startedAt = existing.startedAt;
    delete next.endedAt;
  }

  return next;
}

function applyTaskRunUpdate(record: TaskRunRecord, input: TaskRunUpdateInput, now: string): TaskRunRecord {
  return {
    ...record,
    ...(input.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    ...(typeof input.toolUseCount === 'number' ? {toolUseCount: input.toolUseCount} : {}),
    updatedAt: now,
  };
}

function applyTaskRunResume(record: TaskRunRecord, input: TaskRunResumeInput | undefined, now: string): TaskRunRecord {
  return {
    ...record,
    status: 'running',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applyTaskRunPause(record: TaskRunRecord, input: TaskRunPauseInput | undefined, now: string): TaskRunRecord {
  return {
    ...record,
    status: 'paused',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applyTaskRunFinish(record: TaskRunRecord, result: DelegatedAgentResult, now: string): TaskRunRecord {
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

function parseTaskRunRecord(value: unknown): TaskRunRecord | undefined {
  const parsed = taskRunRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeRunId(value: string): string {
  const runId = value.trim();
  if (!runId) {
    throw new Error('Task run id is required');
  }
  return runId;
}

function normalizeSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) {
    throw new Error('Task run session id is required');
  }
  return sessionId;
}

function normalizeParentSessionId(value: string | undefined, fallbackSessionId: string): string {
  return normalizeSessionId(value ?? fallbackSessionId);
}

function normalizeText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new Error('Task run label and agent name are required');
  }
  return text;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function normalizeStringList(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);
}
