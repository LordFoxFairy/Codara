import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import type {CreateTaskInput, TaskRecord, TaskStore, UpdateTaskInput} from './types';

export interface TaskFileStoreOptions {
  rootDir: string;
}

const taskRecordSchema = z.object({
  id: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  description: z.string().trim().min(1),
  activeForm: z.string().trim().min(1).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  owner: z.string().trim().min(1).optional(),
  blockedBy: z.array(z.string().trim().min(1)),
  blocks: z.array(z.string().trim().min(1)),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

export function createTaskMemoryStore(): TaskStore {
  return new InMemoryTaskStore();
}

export function createTaskFileStore(options: TaskFileStoreOptions): TaskStore {
  return new FileTaskStore(options.rootDir);
}

abstract class BaseTaskStore implements TaskStore {
  abstract list(): Promise<TaskRecord[]>;
  abstract get(taskId: string): Promise<TaskRecord | undefined>;

  /** Persist a batch of records after a graph update. */
  protected abstract persistBatch(records: Map<string, TaskRecord>): Promise<void>;

  /** Persist a single newly created record. */
  protected abstract persistOne(record: TaskRecord): Promise<void>;

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const record = createTaskRecord(input);
    await this.persistOne(record);
    return cloneTask(record);
  }

  async update(input: UpdateTaskInput): Promise<TaskRecord> {
    const existing = await this.get(input.taskId);
    if (!existing) {
      throw new Error(`Task "${input.taskId}" not found`);
    }

    const nextGraph = await applyTaskUpdate(existing, input, (taskId) => this.get(taskId));
    await this.persistBatch(nextGraph);
    return cloneTask(nextGraph.get(input.taskId) as TaskRecord);
  }
}

class InMemoryTaskStore extends BaseTaskStore {
  private readonly records = new Map<string, TaskRecord>();

  async list(): Promise<TaskRecord[]> {
    return sortTasks([...this.records.values()].map((record) => cloneTask(record)));
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const record = this.records.get(taskId.trim());
    return record ? cloneTask(record) : undefined;
  }

  protected async persistOne(record: TaskRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  protected async persistBatch(records: Map<string, TaskRecord>): Promise<void> {
    for (const [taskId, record] of records.entries()) {
      this.records.set(taskId, record);
    }
  }
}

class FileTaskStore extends BaseTaskStore {
  constructor(private readonly rootDir: string) {
    super();
  }

  async list(): Promise<TaskRecord[]> {
    let entries: string[] = [];
    try {
      entries = await readdir(this.rootDir);
    } catch {
      return [];
    }

    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => this.readTask(path.join(this.rootDir, entry))),
    );
    return sortTasks(records.filter((record): record is TaskRecord => Boolean(record)));
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    return this.readTask(this.taskPath(taskId));
  }

  protected async persistOne(record: TaskRecord): Promise<void> {
    await this.writeTask(record);
  }

  protected async persistBatch(records: Map<string, TaskRecord>): Promise<void> {
    await Promise.all([...records.values()].map((record) => this.writeTask(record)));
  }

  private taskPath(taskId: string): string {
    return path.join(this.rootDir, `${taskId.trim()}.json`);
  }

  private async readTask(filePath: string): Promise<TaskRecord | undefined> {
    try {
      const raw = await readFile(filePath, 'utf8');
      return parseTaskRecord(JSON.parse(raw));
    } catch {
      return undefined;
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
    blockedBy: [],
    blocks: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function applyTaskUpdate(
  existing: TaskRecord,
  input: UpdateTaskInput,
  getTask: (taskId: string) => Promise<TaskRecord | undefined> | TaskRecord | undefined,
): Promise<Map<string, TaskRecord>> {
  const graph = new Map<string, TaskRecord>([[existing.id, cloneTask(existing)]]);

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

  const now = new Date().toISOString();
  const current = graph.get(existing.id) as TaskRecord;

  if (input.status) {
    if (input.status === 'in_progress') {
      await validateNotBlocked(current, readTask);
    }
    current.status = input.status;
  }
  if (input.owner !== undefined) {
    current.owner = input.owner?.trim() ? input.owner.trim() : undefined;
  }
  current.updatedAt = now;

  await reconcileTaskRelationships(current, readTask, now);
  await applyGraphAdditions(current, input, readTask, now);
  return graph;
}

async function reconcileTaskRelationships(
  task: TaskRecord,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  task.blocks = await filterExistingTaskIds(task.blocks, getTask);
  task.blockedBy = await filterExistingTaskIds(task.blockedBy, getTask);

  await Promise.all(task.blocks.map(async (taskId) => {
    const linked = await getTask(taskId);
    if (!linked) {
      return;
    }
    if (!linked.blockedBy.includes(task.id)) {
      linked.blockedBy.push(task.id);
      linked.updatedAt = now;
    }
  }));

  await Promise.all(task.blockedBy.map(async (taskId) => {
    const linked = await getTask(taskId);
    if (!linked) {
      return;
    }
    if (!linked.blocks.includes(task.id)) {
      linked.blocks.push(task.id);
      linked.updatedAt = now;
    }
  }));
}

async function applyGraphAdditions(
  task: TaskRecord,
  input: UpdateTaskInput,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  await addTaskLinks(task, task.blocks, input.addBlocks, 'blockedBy', getTask, now);
  await addTaskLinks(task, task.blockedBy, input.addBlockedBy, 'blocks', getTask, now);
}

async function addTaskLinks(
  task: TaskRecord,
  localLinks: string[],
  additions: string[] | undefined,
  reciprocalKey: 'blockedBy' | 'blocks',
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
  now: string,
): Promise<void> {
  for (const taskId of normalizeTaskIds(additions)) {
    if (taskId === task.id) {
      throw new Error(`Task "${task.id}" cannot depend on itself`);
    }
    if (localLinks.includes(taskId)) {
      continue;
    }

    const linked = await getTask(taskId);
    if (!linked) {
      throw new Error(`Task "${taskId}" not found`);
    }

    await detectCycle(task.id, taskId, reciprocalKey === 'blockedBy' ? 'blocks' : 'blockedBy', getTask);

    localLinks.push(taskId);
    task.updatedAt = now;
    if (!linked[reciprocalKey].includes(task.id)) {
      linked[reciprocalKey].push(task.id);
      linked.updatedAt = now;
    }
  }
}

async function validateNotBlocked(
  task: TaskRecord,
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
): Promise<void> {
  const blockers: string[] = [];
  for (const blockerId of task.blockedBy) {
    const blocker = await getTask(blockerId);
    if (blocker && blocker.status !== 'completed' && blocker.status !== 'deleted') {
      blockers.push(blockerId);
    }
  }
  if (blockers.length > 0) {
    throw new Error(`Task "${task.id}" is blocked by: ${blockers.join(', ')}`);
  }
}

async function detectCycle(
  sourceId: string,
  targetId: string,
  followKey: 'blockedBy' | 'blocks',
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
): Promise<void> {
  const visited = new Set<string>();
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const record = await getTask(current);
    if (!record) continue;
    for (const next of record[followKey]) {
      if (next === sourceId) {
        throw new Error(`Adding dependency ${targetId} -> ${sourceId} would create a cycle`);
      }
      queue.push(next);
    }
  }
}

async function filterExistingTaskIds(
  taskIds: string[],
  getTask: (taskId: string) => Promise<TaskRecord | undefined>,
): Promise<string[]> {
  const next: string[] = [];
  for (const taskId of normalizeTaskIds(taskIds)) {
    if (await getTask(taskId)) {
      next.push(taskId);
    }
  }
  return next;
}

function normalizeTaskIds(taskIds: string[] | undefined): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const taskId of taskIds ?? []) {
    const normalized = taskId.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function cloneTask(record: TaskRecord): TaskRecord {
  return {
    ...record,
    blockedBy: [...record.blockedBy],
    blocks: [...record.blocks],
  };
}

function parseTaskRecord(value: unknown): TaskRecord | undefined {
  const parsed = taskRecordSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }

  return cloneTask(parsed.data);
}

function sortTasks(records: TaskRecord[]): TaskRecord[] {
  return records.sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated !== 0 ? updated : left.id.localeCompare(right.id);
  });
}
