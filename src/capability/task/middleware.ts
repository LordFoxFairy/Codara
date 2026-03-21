import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext, type ToolCallContext} from '@core/pipeline/types';
import {createTaskTools} from '@capability/task/coordination/tools';
import {readSkillsRuntimeData} from '@context/skills/runtime-shared';
import type {SkillsRuntimeData} from '@context/skills/contracts';
import {createTaskRuntime} from '@capability/task/delegation/runtime';
import {createTaskRunMemoryStore} from '@capability/task/delegation/store';
import type {CreateTaskMiddlewareOptions} from '@capability/task/tool-types';
import {createTaskTool} from '@capability/task/delegation/tool';
import {rebindTaskRunStore} from '@capability/task/delegation/support';
import {resolveToolCallId} from '@core/agent/run/tool-executor';

export {createTaskTool, readTaskToolOptions, TASK_TOOL_DESCRIPTION, TASK_TOOL_NAME} from '@capability/task/delegation/tool';
export type {CreateTaskToolOptions, CreateTaskMiddlewareOptions} from '@capability/task/tool-types';

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
      const completionHandoff = buildTaskCompletionHandoff(context);
      if (completionHandoff) {
        context.systemMessage.push(completionHandoff);
      }
      const runtime = readSkillsRuntimeData(context.runtime.shared);
      const definitions = buildAvailableSubagentsMessage(runtime);
      if (definitions) {
        context.systemMessage.push(definitions);
      }
      return undefined;
    },
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleTaskCompletionToolCall(context);
      if (blocked) {
        return blocked;
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

function buildTaskCompletionHandoff(context: BeforeModelContext): string | undefined {
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
    'The execution tree already showed the delegated work; your job is to synthesize the result for the user, not to replay child output.',
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

function buildAvailableSubagentsMessage(runtime: SkillsRuntimeData | undefined): string {
  const definitions = Object.values(runtime?.subagentDefinitions ?? {});

  return [
    '### Available Subagents',
    '- Agent: built-in child that inherits the main-agent baseline in a fresh child session',
    ...definitions.map((definition) => {
      const toolRefs = definition.tools?.length ? ` | tools: ${definition.tools.join(', ')}` : '';
      const maxTurns = typeof definition.maxTurns === 'number' ? ` | max_turns: ${definition.maxTurns}` : '';
      return `- ${definition.name}: ${definition.description}${toolRefs}${maxTurns}`;
    }),
  ].join('\n');
}

function maybeHandleTaskCompletionToolCall(context: ToolCallContext): ToolMessage | undefined {
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

function formatCompactTaskNumber(value: number): string {
  if (value >= 1000) {
    const compact = (value / 1000);
    const rendered = compact >= 10 ? compact.toFixed(0) : compact.toFixed(1);
    return `${rendered.replace(/\.0$/, '')}k`;
  }
  return String(value);
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
