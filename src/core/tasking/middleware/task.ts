import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import {
  createTaskTool,
  TASK_TOOL_DESCRIPTION,
  TASK_TOOL_NAME,
  type CreateTaskToolOptions,
} from '@core/tasking/task-tool';
import {readSkillsRuntimeData, type SkillsRuntimeData} from '@core/skills';

export {
  TASK_TOOL_DESCRIPTION,
  TASK_TOOL_NAME,
};

export const TASK_MIDDLEWARE_SYSTEM_PROMPT = `## Task Delegation

You can delegate focused work to a dedicated subagent with the \`Task\` tool.
Use it when a sub-problem deserves a fresh context window and a concise summary back to the current agent.

When using \`Task\`:
- choose the best available \`subagent_type\` when one fits
- omit \`subagent_type\` to use the default general-purpose delegate
- use \`TaskCreate\` / \`TaskUpdate\` / \`TaskList\` for shared coordination, not \`Task\`
`;

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  name?: string;
}

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: [createTaskTool(options)],
    beforeModel(context) {
      context.systemMessage.push(TASK_MIDDLEWARE_SYSTEM_PROMPT);
      const runtime = readSkillsRuntimeData(context.runtime.shared);
      const definitions = formatAvailableSubagents(runtime);
      if (definitions) {
        context.systemMessage.push(definitions);
      }
      return undefined;
    },
  });
}

function formatAvailableSubagents(runtime: SkillsRuntimeData | undefined): string | undefined {
  const definitions = Object.values(runtime?.agentDefinitions ?? {});
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
