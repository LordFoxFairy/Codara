import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {CreateTaskInput, TaskRecord, TaskStore, TaskStatus, UpdateTaskInput} from '@core/tasks/types';

export interface TaskFileStoreOptions {
  rootDir: string;
}

export function createTaskMemoryStore(): TaskStore {
  return new InMemoryTaskStore();
}

export function createTaskFileStore(options: TaskFileStoreOptions): TaskStore {
  return new FileTaskStore(options.rootDir);
}

class InMemoryTaskStore implements TaskStore {
  private readonly records = new Map<string, TaskRecord>();

  async list(): Promise<TaskRecord[]> {
    return sortTasks(Array.from(this.records.values()).map((record) => cloneTask(record)));
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const record = this.records.get(taskId);
    return record ? cloneTask(record) : undefined;
  }

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const record = createTaskRecord(input);
    this.records.set(record.id, record);
    return cloneTask(record);
  }

  async update(input: UpdateTaskInput): Promise<TaskRecord> {
    const existing = this.records.get(input.taskId);
    if (!existing) {
      throw new Error(`Task "${input.taskId}" not found`);
    }

    const next = await applyTaskUpdate(existing, input, async (taskId) => this.records.get(taskId));
    this.records.set(next.id, next);
    return cloneTask(next);
  }
}

class FileTaskStore implements TaskStore {
  constructor(private readonly rootDir: string) {}

  async list(): Promise<TaskRecord[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.rootDir);
    } catch (error) {
      if (isFileMissing(error)) {
        return [];
      }
      throw error;
    }

    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => this.readTask(path.join(this.rootDir, entry))));

    return sortTasks(records.filter((record): record is TaskRecord => Boolean(record)));
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    return this.readTask(this.taskPath(taskId));
  }

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const record = createTaskRecord(input);
    await this.writeTask(record);
    return cloneTask(record);
  }

  async update(input: UpdateTaskInput): Promise<TaskRecord> {
    const existing = await this.get(input.taskId);
    if (!existing) {
      throw new Error(`Task "${input.taskId}" not found`);
    }

    const next = await applyTaskUpdate(existing, input, (taskId) => this.get(taskId));
    await this.writeTask(next);
    return cloneTask(next);
  }

  private taskPath(taskId: string): string {
    return path.join(this.rootDir, `${taskId}.json`);
  }

  private async readTask(filePath: string): Promise<TaskRecord | undefined> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return parseTaskRecord(JSON.parse(raw));
    } catch (error) {
      if (isFileMissing(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeTask(record: TaskRecord): Promise<void> {
    await mkdir(this.rootDir, {recursive: true});
    const filePath = this.taskPath(record.id);
    const tempPath = `${filePath}.tmp-${randomUUID()}`;
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  }
}

function createTaskRecord(input: CreateTaskInput): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    subject: input.subject.trim(),
    description: input.description.trim(),
    ...(input.activeForm?.trim() ? {activeForm: input.activeForm.trim()} : {}),
    status: 'pending',
    blocks: [],
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function applyTaskUpdate(
  existing: TaskRecord,
  input: UpdateTaskInput,
  getTask: (taskId: string) => Promise<TaskRecord | undefined> | TaskRecord | undefined
): Promise<TaskRecord> {
  const nextStatus = input.status ?? existing.status;
  const nextBlockedBy = mergeTaskIds(existing.blockedBy, input.addBlockedBy);
  const nextBlocks = mergeTaskIds(existing.blocks, input.addBlocks);

  if (nextStatus === 'in_progress') {
    const unresolved = await findUnresolvedDependencies(nextBlockedBy, getTask);
    if (unresolved.length > 0) {
      throw new Error(`Task "${existing.id}" is blocked by: ${unresolved.join(', ')}`);
    }
  }

  return {
    ...existing,
    ...(input.owner !== undefined ? {owner: normalizeOptionalText(input.owner)} : {}),
    status: nextStatus,
    blocks: nextBlocks,
    blockedBy: nextBlockedBy,
    updatedAt: new Date().toISOString(),
  };
}

async function findUnresolvedDependencies(
  blockedBy: string[],
  getTask: (taskId: string) => Promise<TaskRecord | undefined> | TaskRecord | undefined
): Promise<string[]> {
  const unresolved: string[] = [];

  for (const taskId of blockedBy) {
    const task = await getTask(taskId);
    if (!task || task.status !== 'completed') {
      unresolved.push(taskId);
    }
  }

  return unresolved;
}

function mergeTaskIds(existing: string[], additions: string[] | undefined): string[] {
  const merged = new Set(existing);
  for (const taskId of additions ?? []) {
    const normalized = taskId.trim();
    if (normalized) {
      merged.add(normalized);
    }
  }
  return Array.from(merged);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function parseTaskRecord(value: unknown): TaskRecord {
  const record = isPlainRecord(value) ? value : {};
  const status = parseTaskStatus(record.status);
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString();
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt;

  return {
    id: typeof record.id === 'string' ? record.id : randomUUID(),
    subject: typeof record.subject === 'string' ? record.subject : '',
    description: typeof record.description === 'string' ? record.description : '',
    ...(typeof record.activeForm === 'string' && record.activeForm ? {activeForm: record.activeForm} : {}),
    status,
    ...(typeof record.owner === 'string' && record.owner ? {owner: record.owner} : {}),
    blocks: readTaskIds(record.blocks),
    blockedBy: readTaskIds(record.blockedBy),
    createdAt,
    updatedAt,
  };
}

function readTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((taskId): taskId is string => typeof taskId === 'string')
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

function parseTaskStatus(value: unknown): TaskStatus {
  switch (value) {
    case 'pending':
    case 'in_progress':
    case 'completed':
    case 'deleted':
      return value;
    default:
      return 'pending';
  }
}

function cloneTask(task: TaskRecord): TaskRecord {
  try {
    return structuredClone(task);
  } catch {
    return {
      ...task,
      blocks: [...task.blocks],
      blockedBy: [...task.blockedBy],
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFileMissing(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
