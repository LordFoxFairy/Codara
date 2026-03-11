import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import {
  type DelegatedAgentOptions,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
  runDelegatedAgent,
} from '@core/tasking/delegation';
import {
  readSkillsRuntimeData,
  resolveSubagentDefinition,
  type SkillsRuntimeData,
  type SubagentDefinition,
} from '@core/resources/skills/runtime';
import type {MiddlewareRuntimeShared} from '@core/middleware';
import {filterToolsByReferences} from '@core/tools';
import {createAgentMemoryCheckpointer} from '@core/checkpoint';

export const TASK_TOOL_NAME = 'Task';

export const TASK_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const TaskToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string().optional().describe('Subagent definition name, such as "general-purpose", "Explore", or "Plan"'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export interface CreateTaskToolOptions extends DelegatedAgentOptions {
  description?: string;
}

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  name?: string;
}

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

  return markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const configurable = asRecord(config?.configurable);
      const delegated = readDelegatedParentRuntimeMetadata(configurable, TASK_TOOL_NAME);
      const profile = resolveSubagentDefinition(
        readAgentSkillsRuntime(configurable.runtimeShared),
        subagent_type,
      );
      return runDelegatedAgent({
        ...options,
        checkpointer: delegatedCheckpointer,
      }, {
        prompt,
        maxTurns: max_turns ?? profile.maxTurns,
        toolName: TASK_TOOL_NAME,
        parentExecution: delegated.parentExecution,
        ...(delegated.resume ? {resume: delegated.resume} : {}),
        profileTools: resolveDefinitionTools(options.tools ?? [], profile),
        profileSystemPrompt: profile.systemPrompt,
      });
    },
    {
      name: TASK_TOOL_NAME,
      description: options.description ?? TASK_TOOL_DESCRIPTION,
      schema: TaskToolInputSchema,
    },
  ));
}

export const TASK_MIDDLEWARE_SYSTEM_PROMPT = `## Task Delegation

You can delegate focused work to a dedicated subagent with the \`Task\` tool.
Use it when a sub-problem deserves a fresh context window and a concise summary back to the current agent.

When using \`Task\`:
- choose the best available \`subagent_type\` when one fits
- omit \`subagent_type\` to use the default general-purpose delegate
- use \`TaskCreate\` / \`TaskUpdate\` / \`TaskList\` for shared coordination, not \`Task\`
`;

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

function resolveDefinitionTools(
  tools: StructuredToolInterface[],
  definition: SubagentDefinition
): StructuredToolInterface[] {
  if (!definition.tools?.length) {
    return [...tools];
  }

  return filterToolsByReferences(tools, definition.tools);
}

function readAgentSkillsRuntime(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return readSkillsRuntimeData(value as MiddlewareRuntimeShared);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
