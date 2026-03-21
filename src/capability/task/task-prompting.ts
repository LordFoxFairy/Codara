import type {BeforeModelContext} from '@core/pipeline/types';
import type {SkillsRuntimeData} from '@context/skills/contracts';

interface TaskCompletionContinuationContext {
  codaraTaskCompletion?: {
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

  const lines = [
    'Delegated tasks from your previous response have completed.',
    'Respond now with a unified user-facing answer.',
    'Keep the final answer concise and user-facing.',
    'Do not mention subagents, delegated tasks, hidden handoff context, or orchestration stages in the user-visible answer.',
    'Do not structure the reply as per-task, per-subagent, or per-phase sections.',
    'Never write headings such as "Subagent report", "Phase 1", "First subagent", or similar orchestration labels.',
    'Do not restate task-by-task reports or raw child sections.',
    'Do not quote raw subagent output verbatim and do not mention hidden handoff context.',
    'The execution tree already showed the delegated work; your job is to synthesize the result for the user, not to replay child output.',
    'Use the completed task results below only as internal synthesis context:',
    ...tasks.map((task) => formatTaskCompletionLine(task)),
  ];

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
