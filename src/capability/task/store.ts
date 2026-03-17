import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {CreateTaskInput, TaskRecord, TaskStore, UpdateTaskInput} from '@capability/task/types';

export interface TaskFileStoreOptions {
  rootDir: string;
}

const taskRecordInputSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  owner: z.string().optional(),
  blocks: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

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

    const nextGraph = await applyTaskUpdate(existing, input, async (taskId) => this.records.get(taskId));
    for (const [taskId, record] of nextGraph) {
      this.records.set(taskId, record);
    }
    return cloneTask(nextGraph.get(input.taskId) as TaskRecord);
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

    const nextGraph = await applyTaskUpdate(existing, input, (taskId) => this.get(taskId));
    for (const record of nextGraph.values()) {
      await this.writeTask(record);
    }
    return cloneTask(nextGraph.get(input.taskId) as TaskRecord);
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
): Promise<Map<string, TaskRecord>> {
  const graph = new Map<string, TaskRecord>([[existing.id, cloneTask(existing)]]);
  const now = new Date().toISOString();
  const readTask = async (taskId: string): Promise<TaskRecord | undefined> => {
    const cached = graph.get(taskId);
    if (cached) {
      return cached;
    }

    const loaded = await getTask(taskId);
    if (!loaded) {
      return undefined;
    }

    const cloned = cloneTask(loaded);
    graph.set(taskId, cloned);
    return cloned;
  };

  await reconcileTaskRelationships(graph.get(existing.id) as TaskRecord, readTask, now);
  await applyGraphAdditions(graph.get(existing.id) as TaskRecord, input, readTask, now);

  const current = graph.get(existing.id) as TaskRecord;
  const nextStatus = input.status ?? existing.status;

  if (nextStatus === 'in_progress') {
    const unresolved = await findUnresolvedDependencies(current.blockedBy, readTask);
    if (unresolved.length > 0) {
      throw new Error(`Task "${existing.id}" is blocked by: ${unresolved.join(', ')}`);
    }
  }

  graph.set(existing.id, {
    ...current,
    ...(input.owner !== undefined ? {owner: normalizeOptionalText(input.owner)} : {}),
    status: nextStatus,
    updatedAt: now,
  });

  return graph;
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

async function reconcileTaskRelationships(
  task: TaskRecord,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  for (const blockedId of task.blocks) {
    const blockedTask = await getTask(blockedId);
    if (blockedTask && !blockedTask.blockedBy.includes(task.id)) {
      blockedTask.blockedBy = mergeTaskIds(blockedTask.blockedBy, [task.id]);
      blockedTask.updatedAt = now;
    }
  }

  for (const prerequisiteId of task.blockedBy) {
    const prerequisite = await getTask(prerequisiteId);
    if (prerequisite && !prerequisite.blocks.includes(task.id)) {
      prerequisite.blocks = mergeTaskIds(prerequisite.blocks, [task.id]);
      prerequisite.updatedAt = now;
    }
  }
}

async function applyGraphAdditions(
  task: TaskRecord,
  input: UpdateTaskInput,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  for (const blockedId of normalizeNewTaskIds(input.addBlocks)) {
    await addDependencyEdge(task.id, blockedId, getTask, now);
  }

  for (const prerequisiteId of normalizeNewTaskIds(input.addBlockedBy)) {
    await addDependencyEdge(prerequisiteId, task.id, getTask, now);
  }

  const current = await getTask(task.id);
  if (!current) {
    return;
  }

  current.blocks = dedupeTaskIds(current.blocks);
  current.blockedBy = dedupeTaskIds(current.blockedBy);
}

async function addDependencyEdge(
  sourceTaskId: string,
  blockedTaskId: string,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  if (sourceTaskId === blockedTaskId) {
    throw new Error(`Task "${sourceTaskId}" cannot depend on itself`);
  }

  const source = await getTask(sourceTaskId);
  const blocked = await getTask(blockedTaskId);

  if (!source) {
    throw new Error(`Task "${sourceTaskId}" not found`);
  }
  if (!blocked) {
    throw new Error(`Task "${blockedTaskId}" not found`);
  }

  if (await createsCycle(sourceTaskId, blockedTaskId, getTask)) {
    throw new Error(`Adding dependency ${sourceTaskId} -> ${blockedTaskId} would create a cycle`);
  }

  source.blocks = mergeTaskIds(source.blocks, [blockedTaskId]);
  source.updatedAt = now;
  blocked.blockedBy = mergeTaskIds(blocked.blockedBy, [sourceTaskId]);
  blocked.updatedAt = now;
}

async function createsCycle(
  sourceTaskId: string,
  blockedTaskId: string,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
): Promise<boolean> {
  const visit = async (taskId: string, seen: Set<string>): Promise<boolean> => {
    if (taskId === sourceTaskId) {
      return true;
    }
    if (seen.has(taskId)) {
      return false;
    }
    seen.add(taskId);
    const task = await getTask(taskId);
    if (!task) {
      return false;
    }
    for (const next of task.blocks) {
      if (await visit(next, seen)) {
        return true;
      }
    }
    return false;
  };

  return visit(blockedTaskId, new Set());
}

function normalizeNewTaskIds(taskIds: string[] | undefined): string[] {
  return (taskIds ?? [])
    .map((taskId) => taskId.trim())
    .filter(Boolean);
}

function dedupeTaskIds(taskIds: string[]): string[] {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cloneTask(record: TaskRecord): TaskRecord {
  return {
    ...record,
    blocks: [...record.blocks],
    blockedBy: [...record.blockedBy],
  };
}

function parseTaskRecord(value: unknown): TaskRecord {
  const record = taskRecordInputSchema.parse(value);
  return {
    ...record,
    blocks: dedupeTaskIds(record.blocks ?? []),
    blockedBy: dedupeTaskIds(record.blockedBy ?? []),
  };
}

function sortTasks(records: TaskRecord[]): TaskRecord[] {
  return [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
