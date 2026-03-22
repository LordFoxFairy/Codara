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

class InMemoryTaskStore implements TaskStore {
  private readonly records = new Map<string, TaskRecord>();

  async list(): Promise<TaskRecord[]> {
    return sortTasks([...this.records.values()].map((record) => cloneTask(record)));
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const record = this.records.get(taskId.trim());
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

    const nextGraph = await applyTaskUpdate(existing, input, (taskId) => this.records.get(taskId));
    for (const [taskId, record] of nextGraph.entries()) {
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
    await Promise.all([...nextGraph.values()].map((record) => this.writeTask(record)));
    return cloneTask(nextGraph.get(input.taskId) as TaskRecord);
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
    if (taskId === task.id || localLinks.includes(taskId)) {
      continue;
    }

    const linked = await getTask(taskId);
    if (!linked) {
      throw new Error(`Task "${taskId}" not found`);
    }

    localLinks.push(taskId);
    task.updatedAt = now;
    if (!linked[reciprocalKey].includes(task.id)) {
      linked[reciprocalKey].push(task.id);
      linked.updatedAt = now;
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
