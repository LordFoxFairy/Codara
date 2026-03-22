import {randomUUID} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {
  AgentRunPauseInput,
  AgentRunRecord,
  AgentRunResumeInput,
  AgentRunStartInput,
  AgentRunStore,
  AgentRunUpdateInput,
} from '@capability/subagent/types';
import type {DelegatedAgentResult} from '@shared/delegation-result';

export interface AgentRunFileStoreOptions {
  rootDir: string;
}

const agentRunRecordSchema = z.object({
  runId: z.string(),
  parentSessionId: z.string(),
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

export function createAgentRunMemoryStore(): AgentRunStore {
  return new InMemoryAgentRunStore();
}

export function createAgentRunFileStore(options: AgentRunFileStoreOptions): AgentRunStore {
  return new FileAgentRunStore(options.rootDir);
}

class InMemoryAgentRunStore implements AgentRunStore {
  private readonly records = new Map<string, AgentRunRecord>();

  list(): AgentRunRecord[] {
    return sortAgentRuns(Array.from(this.records.values()));
  }

  get(runId: string): AgentRunRecord | undefined {
    const record = this.records.get(runId.trim());
    return record ? cloneAgentRun(record) : undefined;
  }

  start(input: AgentRunStartInput): AgentRunRecord {
    const runId = normalizeRunId(input.runId);
    const next = applyAgentRunStart(this.records.get(runId), runId, input, new Date().toISOString());
    this.records.set(runId, next);
    return cloneAgentRun(next);
  }

  update(runId: string, input: AgentRunUpdateInput): AgentRunRecord {
    const record = this.requireRun(runId);
    const next = applyAgentRunUpdate(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneAgentRun(next);
  }

  resume(runId: string, input?: AgentRunResumeInput): AgentRunRecord {
    const record = this.requireRun(runId);
    const next = applyAgentRunResume(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneAgentRun(next);
  }

  pause(runId: string, input?: AgentRunPauseInput): AgentRunRecord {
    const record = this.requireRun(runId);
    const next = applyAgentRunPause(record, input, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneAgentRun(next);
  }

  finish(runId: string, result: DelegatedAgentResult): AgentRunRecord {
    const record = this.requireRun(runId);
    const next = applyAgentRunFinish(record, result, new Date().toISOString());
    this.records.set(record.runId, next);
    return cloneAgentRun(next);
  }

  recoverSession(sessionId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const now = new Date().toISOString();

    for (const [runId, record] of this.records.entries()) {
      if (record.parentSessionId !== normalizedSessionId || record.status !== 'running') {
        continue;
      }

      const next = applyAgentRunPause(record, undefined, now);
      this.records.set(runId, next);
    }
  }

  private requireRun(runId: string): AgentRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Agent run "${runId}" not found`);
    }
    return record;
  }
}

class FileAgentRunStore implements AgentRunStore {
  private readonly records = new Map<string, AgentRunRecord>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private loaded = false;

  constructor(private readonly rootDir: string) {}

  list(): AgentRunRecord[] {
    this.ensureLoaded();
    return sortAgentRuns(Array.from(this.records.values()));
  }

  get(runId: string): AgentRunRecord | undefined {
    this.ensureLoaded();
    const record = this.records.get(normalizeRunId(runId));
    return record ? cloneAgentRun(record) : undefined;
  }

  start(input: AgentRunStartInput): AgentRunRecord {
    this.ensureLoaded();
    const runId = normalizeRunId(input.runId);
    const existing = this.records.get(runId);
    const next = applyAgentRunStart(existing, runId, input, new Date().toISOString());
    this.storeAgentRun(next, existing);
    this.writeAgentRun(next);
    return cloneAgentRun(next);
  }

  update(runId: string, input: AgentRunUpdateInput): AgentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyAgentRunUpdate(record, input, new Date().toISOString());
    this.storeAgentRun(next, record);
    this.writeAgentRun(next);
    return cloneAgentRun(next);
  }

  resume(runId: string, input?: AgentRunResumeInput): AgentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyAgentRunResume(record, input, new Date().toISOString());
    this.storeAgentRun(next, record);
    this.writeAgentRun(next);
    return cloneAgentRun(next);
  }

  pause(runId: string, input?: AgentRunPauseInput): AgentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyAgentRunPause(record, input, new Date().toISOString());
    this.storeAgentRun(next, record);
    this.writeAgentRun(next);
    return cloneAgentRun(next);
  }

  finish(runId: string, result: DelegatedAgentResult): AgentRunRecord {
    this.ensureLoaded();
    const record = this.requireRun(runId);
    const next = applyAgentRunFinish(record, result, new Date().toISOString());
    this.storeAgentRun(next, record);
    this.writeAgentRun(next);
    return cloneAgentRun(next);
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

      const next = applyAgentRunPause(record, undefined, now);
      this.storeAgentRun(next, record);
      this.writeAgentRun(next);
    }
  }

  private requireRun(runId: string): AgentRunRecord {
    const record = this.records.get(normalizeRunId(runId));
    if (!record) {
      throw new Error(`Agent run "${runId}" not found`);
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

      const record = this.readAgentRun(path.join(this.rootDir, entry));
      if (record) {
        this.storeAgentRun(record);
      }
    }
  }

  private agentRunPath(runId: string): string {
    return path.join(this.rootDir, `${normalizeRunId(runId)}.json`);
  }

  private readAgentRun(filePath: string): AgentRunRecord | undefined {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      return parseAgentRunRecord(raw);
    } catch {
      return undefined;
    }
  }

  private writeAgentRun(record: AgentRunRecord): void {
    mkdirSync(this.rootDir, {recursive: true});
    const filePath = this.agentRunPath(record.runId);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  }

  private storeAgentRun(record: AgentRunRecord, previous?: AgentRunRecord): void {
    if (previous && previous.parentSessionId !== record.parentSessionId) {
      this.unindexAgentRun(previous.parentSessionId, previous.runId);
    }

    this.records.set(record.runId, record);
    this.indexAgentRun(record.parentSessionId, record.runId);
  }

  private indexAgentRun(sessionId: string, runId: string): void {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const runIds = this.sessionIndex.get(normalizedSessionId) ?? new Set<string>();
    runIds.add(runId);
    this.sessionIndex.set(normalizedSessionId, runIds);
  }

  private unindexAgentRun(sessionId: string, runId: string): void {
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

function createAgentRunRecord(runId: string, input: AgentRunStartInput, now: string): AgentRunRecord {
  return {
    runId,
    parentSessionId: normalizeSessionId(input.parentSessionId),
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

function cloneAgentRun(record: AgentRunRecord): AgentRunRecord {
  return {...record};
}

function sortAgentRuns(records: AgentRunRecord[]): AgentRunRecord[] {
  return records
    .map((record) => cloneAgentRun(record))
    .sort((left, right) => {
      const started = left.startedAt.localeCompare(right.startedAt);
      return started !== 0 ? started : left.runId.localeCompare(right.runId);
    });
}

function applyAgentRunStart(
  existing: AgentRunRecord | undefined,
  runId: string,
  input: AgentRunStartInput,
  now: string,
): AgentRunRecord {
  const next: AgentRunRecord = {
    ...(existing ? cloneAgentRun(existing) : createAgentRunRecord(runId, input, now)),
    runId,
    parentSessionId: normalizeSessionId(input.parentSessionId),
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

function applyAgentRunUpdate(record: AgentRunRecord, input: AgentRunUpdateInput, now: string): AgentRunRecord {
  return {
    ...record,
    ...(input.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    ...(typeof input.toolUseCount === 'number' ? {toolUseCount: input.toolUseCount} : {}),
    updatedAt: now,
  };
}

function applyAgentRunResume(record: AgentRunRecord, input: AgentRunResumeInput | undefined, now: string): AgentRunRecord {
  return {
    ...record,
    status: 'running',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applyAgentRunPause(record: AgentRunRecord, input: AgentRunPauseInput | undefined, now: string): AgentRunRecord {
  return {
    ...record,
    status: 'paused',
    ...(input?.childSessionId !== undefined ? {childSessionId: normalizeOptionalText(input.childSessionId)} : {}),
    ...(input?.latestActivity !== undefined ? {latestActivity: normalizeOptionalText(input.latestActivity)} : {}),
    updatedAt: now,
    endedAt: undefined,
  };
}

function applyAgentRunFinish(record: AgentRunRecord, result: DelegatedAgentResult, now: string): AgentRunRecord {
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

function parseAgentRunRecord(value: unknown): AgentRunRecord | undefined {
  const parsed = agentRunRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function normalizeRunId(value: string): string {
  const runId = value.trim();
  if (!runId) {
    throw new Error('Agent run id is required');
  }
  return runId;
}

function normalizeSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId) {
    throw new Error('Agent run session id is required');
  }
  return sessionId;
}

function normalizeText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new Error('Agent run label and agent name are required');
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
