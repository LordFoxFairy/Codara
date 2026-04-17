// --- Todo task store (CRUD for shared tasks) ---
export type {
  CreateTaskInput,
  TaskRecord,
  TaskStatus,
  TaskStore,
  UpdateTaskInput,
} from '@tasks/types';
export {
  createTaskFileStore,
  createTaskMemoryStore,
  type TaskFileStoreOptions,
} from '@tasks/store';
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
} from '@tasks/tools';

// --- Unified task system (background execution) ---
export type {
  TaskType as UnifiedTaskType,
  ExecutionTaskStatus,
  TaskStateBase,
  ShellTaskState,
  AgentTaskState,
  TaskState,
} from '@tasks/task-types';
export {
  isTerminalTaskStatus,
  isShellTask,
  isAgentTask,
  generateTaskId,
} from '@tasks/task-types';
export type {
  TaskRegistry,
  TaskListFilter,
  TaskTerminatePatch,
} from '@tasks/task-registry';
export {
  createTaskRegistry,
} from '@tasks/task-registry';
export {
  TASK_STOP_TOOL_NAME,
  createTaskStopTool,
  stopTask,
  TaskStopError,
  type TaskStopContext,
  type TaskStopResult,
  type TaskStopToolOptions,
} from '@tasks/task-stop';
export {
  TASK_OUTPUT_TOOL_NAME,
  createTaskOutputTool,
  readTaskOutput,
  type TaskOutputContext,
  type TaskOutputResult,
  type TaskOutputToolOptions,
} from '@tasks/task-output';
