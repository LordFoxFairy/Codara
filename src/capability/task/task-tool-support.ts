import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createMiddleware, type BaseMiddleware, type ToolCallContext} from '@core/pipeline/types';
import {resolveModel, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import {resolveToolCallId} from '@core/agent/run/tool-executor';
import {CHILD_ACTIVITY_CALLBACK_KEY, type ChildToolActivityCallback} from '@observability/events';
import {
  createDelegatedAgentToolMessage,
  type DelegatedAgentResult,
} from '@capability/task/delegation';
import type {SubagentDefinition} from '@context/skills/contracts';
import {formatSubagentDisplayName} from '@context/skills/runtime-shared';
import {filterToolsByReferences} from '@integration/tool';
import type {TaskRuntime} from '@capability/task/runtime';
import type {TaskRunRecord, TaskRunStore} from '@capability/task/types';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import type {CreateTaskToolOptions} from '@capability/task/tool-types';

const TASK_RUN_STORE_REBOUND = Symbol.for('codara.task.runStore.rebound');

export function resolveDefinitionTools(
  tools: StructuredToolInterface[],
  definition: SubagentDefinition,
): StructuredToolInterface[] {
  if (!definition.tools?.length) {
    return [...tools];
  }

  return filterToolsByReferences(tools, definition.tools);
}

export function readChildActivityCallback(runtimeShared: unknown): ChildToolActivityCallback | undefined {
  if (!runtimeShared || typeof runtimeShared !== 'object') {
    return undefined;
  }
  const shared = runtimeShared as Record<string, unknown>;
  const callback = shared[CHILD_ACTIVITY_CALLBACK_KEY];
  return typeof callback === 'function' ? callback as ChildToolActivityCallback : undefined;
}

export function resolveTaskRunId(
  runStore: TaskRunStore | undefined,
  toolCallId: string,
): string {
  const baseRunId = toolCallId.trim();
  if (!runStore) {
    return baseRunId;
  }

  const existing = runStore.get(baseRunId);
  if (!existing || existing.status === 'running' || existing.status === 'paused') {
    return baseRunId;
  }

  return createDetachedTaskRunId(runStore, baseRunId);
}

export function normalizeAgentName(subagentType: string | undefined, fallback: string): string {
  const agentName = formatSubagentDisplayName(subagentType) || fallback.trim();
  return agentName || 'Agent';
}

export function rebindTaskRunStore(runStore: TaskRunStore | undefined): TaskRunStore | undefined {
  if (!runStore) {
    return undefined;
  }

  const record = runStore as TaskRunStore & {[TASK_RUN_STORE_REBOUND]?: boolean};
  if (record[TASK_RUN_STORE_REBOUND]) {
    return record;
  }

  const list = runStore.list.bind(runStore);
  const get = runStore.get.bind(runStore);
  const start = runStore.start.bind(runStore);
  const update = runStore.update.bind(runStore);
  const resume = runStore.resume.bind(runStore);
  const pause = runStore.pause.bind(runStore);
  const finish = runStore.finish.bind(runStore);

  record.list = (...args) => list(...args);
  record.get = (...args) => get(...args);
  record.start = (...args) => start(...args);
  record.update = (...args) => update(...args);
  record.resume = (...args) => resume(...args);
  record.pause = (...args) => pause(...args);
  record.finish = (...args) => finish(...args);
  record[TASK_RUN_STORE_REBOUND] = true;
  return record;
}

export function wrapDelegatedPrepareContext(
  prepareContext: CreateTaskToolOptions['prepareContext'],
  inheritedBaseMessageCount: number,
): CreateTaskToolOptions['prepareContext'] {
  if (!prepareContext) {
    return undefined;
  }

  return async (context) => {
    const preservedExtras = context.systemMessage.slice(inheritedBaseMessageCount);
    await prepareContext(context);
    if (preservedExtras.length > 0) {
      context.systemMessage.push(...preservedExtras);
    }
  };
}

export function readExistingTaskRunMessage(
  run: TaskRunRecord | undefined,
  toolCallId: string,
  fallback: {
    runId: string;
    agentName: string;
    label: string;
    childSessionId: string;
    parentSessionId: string;
  },
): ToolMessage | undefined {
  if (!run) {
    return undefined;
  }

  const completed = toDelegatedAgentResult(run);
  if (completed) {
    return createDelegatedAgentToolMessage(completed, toolCallId);
  }

  const sessionId = run.childSessionId?.trim() || fallback.childSessionId;
  const parentSessionId = run.parentSessionId?.trim() || run.sessionId?.trim() || fallback.parentSessionId;
  const label = run.label?.trim() || fallback.label;
  const agentName = normalizeAgentName(run.agentName?.trim(), fallback.agentName);
  const header = run.status === 'paused'
    ? 'Delegated task is waiting for review.'
    : 'Delegated task is already running in background.';
  const detail = run.latestActivity?.trim();

  return new ToolMessage({
    content: [
      header,
      'Do not restate launch metadata or promise follow-up.',
      ...(detail ? [`activity: ${detail}`] : []),
    ].join('\n'),
    artifact: {
      type: 'task_run_started',
      runId: run.runId,
      parentSessionId,
      sessionId,
      agentName,
      label,
    },
    status: 'success',
    tool_call_id: toolCallId,
  });
}

export async function buildRecoveredTaskChildOptions(
  options: CreateTaskToolOptions,
  runtime: TaskRuntime,
  run: TaskRunRecord,
): Promise<BootstrapAgentOptions | undefined> {
  if (!run.childSessionId) {
    return undefined;
  }

  const recoveryTools = filterRecoveredTaskTools(options.tools ?? [], run.toolNames);
  const recoveryMiddleware = [
    ...(options.middleware ?? []),
    createRecoveredTaskActivityMiddleware(runtime, run.runId),
  ];

  return {
    model: await resolveModel(options.model),
    agentType: 'subagent',
    ...(run.systemMessages?.length ? {systemMessage: [...run.systemMessages]} : {}),
    ...(recoveryTools.length > 0 ? {tools: recoveryTools} : {}),
    ...(recoveryMiddleware.length > 0 ? {middleware: recoveryMiddleware} : {}),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    prepareContext: options.prepareContext,
    ...(options.context ? {context: deepClone(options.context)} : {}),
    ...(options.values ? {values: deepClone(options.values)} : {}),
    ...(options.lifecycle ? {lifecycle: options.lifecycle} : {}),
  };
}

function createDetachedTaskRunId(runStore: TaskRunStore, baseRunId: string): string {
  const prefix = `${baseRunId}__`;
  const usedRunIds = new Set(runStore.list().map((record) => record.runId));
  let suffix = 2;

  while (usedRunIds.has(`${prefix}${suffix}`)) {
    suffix += 1;
  }

  return `${prefix}${suffix}`;
}

function toDelegatedAgentResult(run: TaskRunRecord): DelegatedAgentResult | undefined {
  if ((run.status !== 'completed' && run.status !== 'failed') || !run.childSessionId) {
    return undefined;
  }

  return {
    type: 'delegated_agent_result',
    sessionId: run.childSessionId,
    turns: run.turns ?? 0,
    reason: run.reason ?? (run.status === 'failed' ? 'error' : 'complete'),
    ...(run.summary?.trim() ? {summary: run.summary.trim()} : {}),
    ...(run.errorMessage?.trim() ? {errorMessage: run.errorMessage.trim()} : {}),
    ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
    ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
  };
}

function filterRecoveredTaskTools(
  tools: StructuredToolInterface[],
  toolNames: string[] | undefined,
): StructuredToolInterface[] {
  if (!toolNames?.length) {
    return [...tools];
  }

  const allowed = new Set(toolNames);
  return tools.filter((tool) => allowed.has(tool.name));
}

function createRecoveredTaskActivityMiddleware(
  runtime: TaskRuntime,
  runId: string,
): BaseMiddleware {
  return createMiddleware({
    name: `TaskRecoveryActivity:${runId}`,
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const summary = truncateTaskToolSummary(formatToolSummary(toolName, context.toolCall.args));
      const label = summary ? `${toolName}(${summary})` : toolName;
      runtime.recordActivity(runId, {toolName, label});
      return handler(context);
    },
  });
}

function truncateTaskToolSummary(value: string | undefined, max = 60): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function maybeHandleTaskCompletionToolCall(context: ToolCallContext): ToolMessage | undefined {
  if (shouldBlockInternalMemoryWriteDuringTaskCompletion(context)) {
    return new ToolMessage({
      content: 'Internal memory updates are deferred while completing delegated-task results. Finish the user request first by launching the next required Task or by giving the final user-facing answer.',
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  const repeatedTaskTopic = readRepeatedTaskCompletionTopic(context);
  if (repeatedTaskTopic) {
    return new ToolMessage({
      content: `This delegated task repeats already completed work (${repeatedTaskTopic}). Do not relaunch a completed phase or topic. Launch only the missing next-step Task, or give the final user-facing answer if nothing remains.`,
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  return undefined;
}

function shouldBlockInternalMemoryWriteDuringTaskCompletion(context: ToolCallContext): boolean {
  const taskCompletion = readTaskCompletionRuntimeContext(context);
  if (!taskCompletion?.tasks?.length) {
    return false;
  }

  const toolName = context.toolCall.name?.trim();
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return false;
  }

  const targetPath = readToolTargetPath(context.toolCall.args);
  return Boolean(targetPath && isInternalCodaraMemoryPath(targetPath));
}

function readRepeatedTaskCompletionTopic(context: ToolCallContext): string | undefined {
  const taskCompletion = readTaskCompletionRuntimeContext(context);
  if (!taskCompletion?.tasks?.length) {
    return undefined;
  }

  if (context.toolCall.name?.trim() !== 'Task') {
    return undefined;
  }

  const prompt = readTaskPrompt(context.toolCall.args);
  const normalizedPrompt = normalizeTaskReplayText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  for (const task of taskCompletion.tasks) {
    if (task.status !== 'completed') {
      continue;
    }

    const topic = extractTaskTopic(task.label, task.agentName, task.runId);
    const normalizedTopic = normalizeTaskReplayText(topic);
    if (!normalizedTopic) {
      continue;
    }

    if (isRepeatedTaskReplay(normalizedPrompt, normalizedTopic)) {
      return topic;
    }
  }

  return undefined;
}

function readTaskCompletionRuntimeContext(
  context: Pick<ToolCallContext, 'runtime'>,
): {
  tasks?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>;
} | undefined {
  return (context.runtime.runtimeContext as {codaraTaskCompletion?: {tasks?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>}} | undefined)?.codaraTaskCompletion;
}

function readTaskPrompt(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const prompt = (args as Record<string, unknown>).prompt;
  return typeof prompt === 'string' ? prompt.trim() || undefined : undefined;
}

function readToolTargetPath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const candidate = typeof record.file_path === 'string'
    ? record.file_path
    : typeof record.path === 'string'
      ? record.path
      : undefined;
  return candidate?.trim() || undefined;
}

function isInternalCodaraMemoryPath(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)\.codara\/memory(?:\/|$)/.test(normalized)
    || /(?:^|\/)\.codara\/projects\/[^/]+\/memory(?:\/|$)/.test(normalized);
}

function extractTaskTopic(label: string | undefined, agentName: string | undefined, runId: string): string {
  const raw = label?.trim() || agentName?.trim() || runId;
  const stripped = raw
    .replace(/^Delegating\s+[^:]+:\s*/i, '')
    .replace(/^Delegating\s+/i, '')
    .trim();
  return stripped || raw;
}

function normalizeTaskReplayText(text: string | undefined): string | undefined {
  const normalized = text
    ?.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function isRepeatedTaskReplay(prompt: string, topic: string): boolean {
  if (prompt === topic) {
    return true;
  }

  if (prompt.length >= 48 && topic.length >= 48) {
    return prompt.includes(topic) || topic.includes(prompt);
  }

  return false;
}
