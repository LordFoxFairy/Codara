import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {Agent, AgentRuntimeContext, AgentType, CreateAgentOptions} from '@core/agents/contract/agent';
import {
  type CreateSubagentToolOptions,
  runDelegatedAgent,
} from '@core/agents/subagent';
import {
  readSkillsRuntimeData,
  resolveSubagentDefinition,
  type SubagentDefinition,
} from '@core/skills/agents';
import type {BaseMiddleware} from '@core/middleware';
import {filterToolsByReferences} from '@core/tools';

export const TASK_TOOL_NAME = 'Task';

export const TASK_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.

Subagent definitions are loaded from agent definition files such as .codara/skills/*/agents/*.md or explicit agents roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const TaskToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string().optional().describe('Subagent definition name, such as "general-purpose", "Explore", or "Plan"'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export interface ResolvedSubagentRuntime {
  model?: BaseChatModel;
  middleware?: BaseMiddleware[];
  context?: AgentRuntimeContext;
}

export interface CreateTaskToolOptions extends Omit<CreateSubagentToolOptions, 'name' | 'description'> {
  description?: string;
  createChildAgent?: (options: CreateAgentOptions) => Agent | Promise<Agent>;
  resolveProfileRuntime?: (
    profile: SubagentDefinition,
    fallback: {
      model: BaseChatModel;
      middleware?: BaseMiddleware[];
      context?: AgentRuntimeContext;
    }
  ) => Promise<ResolvedSubagentRuntime | void> | ResolvedSubagentRuntime | void;
}

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  return tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const profile = resolveSubagentDefinition(
        readAgentSkillsRuntime(config?.configurable?.agentContext),
        subagent_type,
      );
      const resolvedRuntime = await resolveProfileRuntime(options, profile);
      return runDelegatedAgent(options, {
        prompt,
        maxTurns: max_turns ?? profile.maxTurns,
        toolName: TASK_TOOL_NAME,
        parentAgentType: readAgentType(config?.configurable?.agentType),
        profileModel: resolvedRuntime?.model,
        profileMiddleware: resolvedRuntime?.middleware,
        profileContext: resolvedRuntime?.context,
        profileTools: resolveDefinitionTools(options.tools ?? [], profile),
        profileSystemPrompt: profile.systemPrompt,
      }, options.createChildAgent);
    },
    {
      name: TASK_TOOL_NAME,
      description: options.description ?? TASK_TOOL_DESCRIPTION,
      schema: TaskToolInputSchema,
    },
  );
}

function readAgentType(value: unknown): AgentType {
  return value === 'subagent' ? 'subagent' : 'main';
}

async function resolveProfileRuntime(
  options: CreateTaskToolOptions,
  profile: SubagentDefinition
): Promise<ResolvedSubagentRuntime | undefined> {
  const resolver = options.resolveProfileRuntime;

  if (!resolver) {
    return undefined;
  }

  const resolved = await resolver(profile, {
    model: options.model,
    ...(options.middleware?.length ? {middleware: [...options.middleware]} : {}),
    ...(options.middlewares?.length ? {middleware: [...options.middlewares]} : {}),
    ...(options.context ? {context: options.context} : {}),
  });

  return resolved ?? undefined;
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

  return readSkillsRuntimeData(value as AgentRuntimeContext);
}
