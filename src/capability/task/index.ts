// --- Todo task store (CRUD for shared tasks) ---
export type {
  CreateTaskInput,
  TaskRecord,
  TaskStatus,
  TaskStore,
  UpdateTaskInput,
} from '@capability/task/types';
export {
  createTaskFileStore,
  createTaskMemoryStore,
  type TaskFileStoreOptions,
} from '@capability/task/store';
export {
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  createTaskCreateTool,
  createTaskGetTool,
  createTaskListTool,
  createTaskTools,
  createTaskUpdateTool,
  type TaskToolOptions,
} from '@capability/task/tools';

// --- Unified task system (background execution) ---
export type {
  TaskType as UnifiedTaskType,
  TaskStatus as UnifiedTaskStatus,
  TaskStateBase,
  ShellTaskState,
  AgentTaskState,
  TaskState,
} from '@capability/task/task-types';
export {
  isTerminalTaskStatus,
  isShellTask,
  isAgentTask,
  generateTaskId,
} from '@capability/task/task-types';
export type {
  TaskRegistry,
  TaskListFilter,
} from '@capability/task/task-registry';
export {
  createTaskRegistry,
  getGlobalTaskRegistry,
} from '@capability/task/task-registry';
export {
  TASK_STOP_TOOL_NAME,
  createTaskStopTool,
  stopTask,
  TaskStopError,
  type TaskStopContext,
  type TaskStopResult,
  type TaskStopToolOptions,
} from '@capability/task/task-stop';
export {
  TASK_OUTPUT_TOOL_NAME,
  createTaskOutputTool,
  readTaskOutput,
  type TaskOutputContext,
  type TaskOutputResult,
  type TaskOutputToolOptions,
} from '@capability/task/task-output';
