export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

export interface TaskRecord {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
  blocks: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  subject: string;
  description: string;
  activeForm?: string;
}

export interface UpdateTaskInput {
  taskId: string;
  status?: TaskStatus;
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
}

export interface TaskStore {
  list(): Promise<TaskRecord[]>;
  get(taskId: string): Promise<TaskRecord | undefined>;
  create(input: CreateTaskInput): Promise<TaskRecord>;
  update(input: UpdateTaskInput): Promise<TaskRecord>;
}
