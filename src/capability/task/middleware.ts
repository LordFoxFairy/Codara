import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {resolveModel, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import {
  buildDelegatedChildOptions,
  createDelegatedAgentToolMessage,
  type DelegatedAgentResult,
  type DelegatedAgentOptions,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
} from '@capability/task/delegation';
import {CHILD_ACTIVITY_CALLBACK_KEY, type ChildToolActivityCallback} from '@observability/events';
import {createTaskTools} from '@capability/task/tools';
import {
  type SkillsRuntimeData,
  type SubagentDefinition,
} from '@context/skills/contracts';
import {
  readSkillsRuntimeData,
  resolveSubagentDefinition,
} from '@context/skills/runtime-shared';
import {readBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {filterToolsByReferences} from '@integration/tool';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import type {ApprovalStore} from '@durability/approval-store';
import {formatTaskRunLaunchResult} from '@shared/task-run-launch';
import {createTaskRuntime, type TaskRuntime} from '@capability/task/runtime';
import {createTaskRunMemoryStore} from '@capability/task/run-store';
import type {TaskRunRecord, TaskRunStore, TaskStore} from '@capability/task/types';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import type {BeforeModelContext, ToolCallContext, ToolCallHandler} from '@core/pipeline/types';
import {resolveToolCallId} from '@core/agent/run/tool-executor';

export const TASK_TOOL_NAME = 'Task';

export const TASK_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.
After calling Task, do not post a second "task started" confirmation, do not restate run metadata, and do not promise future updates.
Let the task/runtime UI carry launch and progress; only respond again with the delegated result or when review is required.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const TaskToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string().optional().describe('Subagent definition name, such as "general-purpose", "Explore", or "Plan"'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});
const taskToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();
const TASK_RUN_STORE_REBOUND = Symbol.for('codara.task.runStore.rebound');
const TASK_TOOL_OPTIONS = Symbol.for('codara.task.tool.options');

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export interface CreateTaskToolOptions extends DelegatedAgentOptions {
  description?: string;
  runStore?: TaskRunStore;
  approvalStore?: ApprovalStore;
  runtime?: TaskRuntime;
}

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  store?: TaskStore;
  name?: string;
}

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = rebindTaskRunStore(options.runStore ?? createTaskRunMemoryStore());
  const approvalStore = options.approvalStore;
  const runtime = options.runtime ?? createTaskRuntime({runStore, approvalStore});
  runtime.registerRecoveryBuilder(async (run) => buildRecoveredTaskChildOptions(
    options,
    delegatedCheckpointer,
    runtime,
    run,
  ));
  const taskTool = markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const configurable = taskToolConfigSchema.parse(config).configurable ?? {};
      const delegated = readDelegatedParentRuntimeMetadata(configurable, TASK_TOOL_NAME);
      const profile = resolveSubagentDefinition(
        readSkillsRuntimeData(configurable.runtimeShared),
        subagent_type,
      );
      const baseSystemMessage = readBaseSystemMessage(configurable.runtimeShared);
      const inheritedBaseMessageCount = baseSystemMessage?.systemMessage.length ?? 0;
      const childActivityCallback = readChildActivityCallback(configurable.runtimeShared);
      const runId = resolveTaskRunId(runStore, delegated);
      const agentName = normalizeAgentName(subagent_type, profile.name);
      const runLabel = `Delegating ${agentName}: ${prompt}`;
      const childSessionId = `${delegated.parentExecution.sessionId}:task:${runId}`;
      const childMaxTurns = max_turns ?? profile.maxTurns;
      const existingRunMessage = readExistingTaskRunMessage(
        runStore?.get(runId),
        delegated.parentExecution.toolCallId,
        {
          runId,
          agentName,
          label: runLabel,
          childSessionId,
        },
      );
      if (existingRunMessage) {
        return existingRunMessage;
      }

      const onChildToolActivity = runStore || childActivityCallback
        ? ((info: {toolName: string; label: string}) => {
            try {
              const nextToolUseCount = (() => {
                const existing = runStore?.get(runId);
                return (existing?.toolUseCount ?? 0) + 1;
              })();
              runStore?.update(runId, {
                latestActivity: info.label,
                toolUseCount: nextToolUseCount,
              });
            } catch {
              // Best-effort: task run tracking must not block delegated execution.
            }

            if (childActivityCallback) {
              childActivityCallback(info);
            }
          }) as ChildToolActivityCallback
        : undefined;
      const childOptions = await buildDelegatedChildOptions({
        ...options,
        ...(baseSystemMessage?.systemMessage?.length || options.systemMessages?.length || options.systemPrompt
          ? {systemMessages: mergeTaskSystemMessages(baseSystemMessage?.systemMessage, options.systemMessages, options.systemPrompt)}
          : {}),
        prepareContext: wrapDelegatedPrepareContext(options.prepareContext, inheritedBaseMessageCount),
        checkpointer: delegatedCheckpointer,
        ...(onChildToolActivity ? {onChildToolActivity} : {}),
      }, {
        prompt,
        ...(subagent_type ? {subagentType: subagent_type} : {}),
        maxTurns: childMaxTurns,
        toolName: TASK_TOOL_NAME,
        parentExecution: delegated.parentExecution,
        profileTools: resolveDefinitionTools(options.tools ?? [], profile),
        profileSystemPrompt: profile.systemPrompt,
      });

      const launched = await runtime.launch({
        runId,
        parentSessionId: delegated.parentExecution.sessionId,
        childSessionId,
        label: runLabel,
        agentName,
        prompt,
        childOptions,
        ...(typeof childMaxTurns === 'number' ? {maxTurns: childMaxTurns} : {}),
      });

      return new ToolMessage({
        content: formatTaskRunLaunchResult(launched),
        artifact: launched,
        status: 'success',
        tool_call_id: delegated.parentExecution.toolCallId,
      });
    },
    {
      name: TASK_TOOL_NAME,
      description: options.description ?? TASK_TOOL_DESCRIPTION,
      schema: TaskToolInputSchema,
    },
  ));

  Object.defineProperty(taskTool, TASK_TOOL_OPTIONS, {
    value: {...options},
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return taskTool;
}

export function readTaskToolOptions(tool: StructuredToolInterface): CreateTaskToolOptions | undefined {
  const record = tool as StructuredToolInterface & {[TASK_TOOL_OPTIONS]?: CreateTaskToolOptions};
  return record[TASK_TOOL_OPTIONS];
}

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  const runStore = rebindTaskRunStore(options.runStore ?? createTaskRunMemoryStore());
  const runtime = options.runtime ?? createTaskRuntime({
    runStore,
    approvalStore: options.approvalStore,
  });
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: [
      createTaskTool({...options, runStore, runtime}),
      ...(options.store ? createTaskTools({store: options.store}) : []),
    ],
    beforeModel(context) {
      const completionHandoff = formatTaskCompletionHandoff(context);
      if (completionHandoff) {
        context.systemMessage.push(completionHandoff);
      }
      const runtime = readSkillsRuntimeData(context.runtime.shared);
      const definitions = formatAvailableSubagents(runtime);
      if (definitions) {
        context.systemMessage.push(definitions);
      }
      return undefined;
    },
    async wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
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

      return handler(context);
    },
  });
}

interface TaskCompletionContinuationContext {
  codaraTaskCompletion?: {
    attempt?: number;
    previousInvalidResponse?: string;
    tasks?: Array<{
      runId: string;
      label: string;
      agentName: string;
      status: 'completed' | 'failed';
      summary?: string;
      errorMessage?: string;
      toolUseCount?: number;
      totalTokens?: number;
    }>;
  };
}

function formatTaskCompletionHandoff(context: BeforeModelContext): string | undefined {
  if (context.state.agentType !== 'main') {
    return undefined;
  }

  const runtimeContext = context.runtime.runtimeContext as TaskCompletionContinuationContext | undefined;
  const tasks = runtimeContext?.codaraTaskCompletion?.tasks;
  if (!tasks?.length) {
    return undefined;
  }
  const attempt = runtimeContext?.codaraTaskCompletion?.attempt ?? 1;
  const previousInvalidResponse = runtimeContext?.codaraTaskCompletion?.previousInvalidResponse?.trim();

  const lines = [
    'Delegated tasks from your previous response have completed.',
    'Continue the parent task using these completed delegated results.',
    'If more work is still needed, immediately take the next step, including launching more delegated tasks if appropriate.',
    'Only give a final user-facing answer once the entire original user request is satisfied.',
    'A completed delegated batch does not by itself mean the overall request is complete.',
    'If the user explicitly required later phases, serial follow-up steps, or additional analysis after this batch, do that next before answering.',
    'A progress-only update is not a valid completion.',
    'If your draft says work will continue later, that another phase will start later, or that you will answer after more results arrive, that draft is invalid.',
    'Either launch the required next-step work now or give the final answer only if no requested work remains.',
    'If the work is complete, respond with a unified user-facing answer.',
    'Do not claim the delegated work is still pending or that you are waiting for results that are already complete.',
    'Treat the completed delegated results below as finished work products, not as tasks to be restarted.',
    'Do not restart the plan from the beginning, do not relaunch the initial batch, and do not repeat a completed phase.',
    'Do not launch another delegated task that repeats, paraphrases, or only lightly rewords a completed topic listed below.',
    'If you launch more delegated tasks, launch only the missing next-step work that builds on the completed results.',
    'Do not mention subagents, delegated tasks, hidden handoff context, or orchestration stages in the user-visible answer.',
    'Do not structure the reply as per-task, per-subagent, or per-phase sections.',
    'Never write headings such as "Subagent report", "Phase 1", "First subagent", or similar orchestration labels.',
    'Do not restate task-by-task reports or raw child sections.',
    'Do not quote raw subagent output verbatim and do not mention hidden handoff context.',
    'The execution tree already showed the delegated work; your job is to either continue execution or synthesize the result for the user, not to replay child output.',
    'Use the completed task results below only as internal synthesis context:',
    ...tasks.map((task) => formatTaskCompletionLine(task)),
  ];

  if (attempt > 1) {
    lines.splice(3, 0,
      'Your previous continuation was invalid because it still described the delegated work as waiting or staged.',
      'All delegated tasks are already terminal. Do not say they are still pending, waiting, just started, or that another phase will continue later.',
    );
    if (previousInvalidResponse) {
      lines.push(`Invalid previous draft (for correction only): ${summarizeTaskCompletionDetail(previousInvalidResponse)}`);
    }
  }

  if (attempt > 2) {
    lines.splice(5, 0,
      'This is a repeated correction attempt.',
      'Do not provide another orchestration-status update, waiting update, or future-work promise.',
      'If you do not need to launch a new Task tool call right now, respond with the actual final answer for the user in this turn.',
    );
  }

  return lines.join('\n');
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

  if (context.toolCall.name?.trim() !== TASK_TOOL_NAME) {
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
): TaskCompletionContinuationContext['codaraTaskCompletion'] | undefined {
  return (context.runtime.runtimeContext as TaskCompletionContinuationContext | undefined)?.codaraTaskCompletion;
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

function formatTaskCompletionLine(
  task: NonNullable<NonNullable<TaskCompletionContinuationContext['codaraTaskCompletion']>['tasks']>[number],
): string {
  const topic = extractTaskTopic(task.label, task.agentName, task.runId);
  const status = task.status === 'failed' ? 'failed' : 'completed';
  const stats: string[] = [];
  if (typeof task.toolUseCount === 'number' && task.toolUseCount > 0) {
    stats.push(`${task.toolUseCount} tool uses`);
  }
  if (typeof task.totalTokens === 'number' && task.totalTokens > 0) {
    stats.push(`${formatCompactTaskNumber(task.totalTokens)} tokens`);
  }
  const detail = task.status === 'failed'
    ? summarizeTaskCompletionDetail(task.errorMessage?.trim() || task.summary?.trim())
    : summarizeTaskCompletionDetail(task.summary?.trim());
  const statSuffix = stats.length > 0 ? ` | stats: ${stats.join(' · ')}` : '';
  return `- topic: ${topic} | status: ${status}${statSuffix}\n  finding: ${detail}`;
}

function summarizeTaskCompletionDetail(detail: string | undefined): string {
  const text = detail
    ?.replace(/[*_`#>-]+/g, ' ')
    ?.replace(/\s+/g, ' ')
    ?.trim()
    ?.replace(/[.。!！]+$/, '');
  if (!text) {
    return 'No summary was recorded.';
  }
  if (text.length <= 140) {
    return text;
  }
  return `${text.slice(0, 137).trimEnd()}...`;
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

function formatCompactTaskNumber(value: number): string {
  if (value >= 1000) {
    const compact = (value / 1000);
    const rendered = compact >= 10 ? compact.toFixed(0) : compact.toFixed(1);
    return `${rendered.replace(/\.0$/, '')}k`;
  }
  return String(value);
}

function resolveDefinitionTools(
  tools: StructuredToolInterface[],
  definition: SubagentDefinition
): StructuredToolInterface[] {
  if (!definition.tools?.length) {
    return [...tools];
  }

  return filterToolsByReferences(tools, definition.tools);
}

function formatAvailableSubagents(runtime: SkillsRuntimeData | undefined): string | undefined {
  const definitions = Object.values(runtime?.subagentDefinitions ?? {});
  if (definitions.length === 0) {
    return undefined;
  }

  return [
    '### Available Subagents',
    ...definitions.map((definition) => {
      const toolRefs = definition.tools?.length ? ` | tools: ${definition.tools.join(', ')}` : '';
      const maxTurns = typeof definition.maxTurns === 'number' ? ` | max_turns: ${definition.maxTurns}` : '';
      return `- ${definition.name}: ${definition.description}${toolRefs}${maxTurns}`;
    }),
  ].join('\n');
}

function mergeTaskSystemMessages(
  inheritedMessages: string[] | undefined,
  providedMessages: string[] | undefined,
  baseSystemPrompt: string | undefined,
): string[] {
  return [
    ...(inheritedMessages ?? []),
    ...(providedMessages ?? []),
    ...(baseSystemPrompt?.trim() ? [baseSystemPrompt.trim()] : []),
  ];
}

function readChildActivityCallback(runtimeShared: unknown): ChildToolActivityCallback | undefined {
  if (!runtimeShared || typeof runtimeShared !== 'object') return undefined;
  const shared = runtimeShared as Record<string, unknown>;
  const callback = shared[CHILD_ACTIVITY_CALLBACK_KEY];
  return typeof callback === 'function' ? callback as ChildToolActivityCallback : undefined;
}

function resolveTaskRunId(
  runStore: TaskRunStore | undefined,
  delegated: ReturnType<typeof readDelegatedParentRuntimeMetadata>,
): string {
  const baseRunId = delegated.parentExecution.toolCallId.trim();
  if (!runStore) {
    return baseRunId;
  }

  const existing = runStore.get(baseRunId);
  if (!existing || existing.status === 'running' || existing.status === 'paused') {
    return baseRunId;
  }

  return createDetachedTaskRunId(runStore, baseRunId);
}

function normalizeAgentName(subagentType: string | undefined, fallback: string): string {
  const agentName = subagentType?.trim() || fallback.trim();
  return agentName || 'general-purpose';
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

function rebindTaskRunStore(runStore: TaskRunStore | undefined): TaskRunStore | undefined {
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

function wrapDelegatedPrepareContext(
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

function readExistingTaskRunMessage(
  run: TaskRunRecord | undefined,
  toolCallId: string,
  fallback: {runId: string; agentName: string; label: string; childSessionId: string},
): ToolMessage | undefined {
  if (!run) {
    return undefined;
  }

  const completed = toDelegatedAgentResult(run);
  if (completed) {
    return createDelegatedAgentToolMessage(completed, toolCallId);
  }

  const sessionId = run.childSessionId?.trim() || fallback.childSessionId;
  const label = run.label?.trim() || fallback.label;
  const agentName = run.agentName?.trim() || fallback.agentName;
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
      sessionId,
      agentName,
      label,
    },
    status: 'success',
    tool_call_id: toolCallId,
  });
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

async function buildRecoveredTaskChildOptions(
  options: CreateTaskToolOptions,
  checkpointer: NonNullable<CreateTaskToolOptions['checkpointer']>,
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
    checkpointer,
    inputBudget: options.inputBudget,
    prepareContext: options.prepareContext,
    ...(options.context ? {context: deepClone(options.context)} : {}),
    ...(options.values ? {values: deepClone(options.values)} : {}),
    ...(options.lifecycle ? {lifecycle: options.lifecycle} : {}),
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
