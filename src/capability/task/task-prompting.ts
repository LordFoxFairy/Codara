import type {BeforeModelContext} from '@core/pipeline/types';
import type {SkillsRuntimeData} from '@context/skills/contracts';

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

export function buildTaskCompletionHandoff(context: BeforeModelContext): string | undefined {
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

export function buildAvailableSubagentsMessage(runtime: SkillsRuntimeData | undefined): string {
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
