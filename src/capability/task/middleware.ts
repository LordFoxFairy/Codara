import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {
  type DelegatedAgentOptions,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
  runDelegatedAgent,
} from '@core/agent/run/delegation';
import {CHILD_ACTIVITY_CALLBACK_KEY, type ChildToolActivityCallback} from '@observability/events';
import {createTaskTools} from '@capability/task/tools';
import type {TaskStore} from '@capability/task/types';
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
const taskToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

export interface CreateTaskToolOptions extends DelegatedAgentOptions {
  description?: string;
}

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  store?: TaskStore;
  name?: string;
}

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

  return markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const configurable = taskToolConfigSchema.parse(config).configurable ?? {};
      const delegated = readDelegatedParentRuntimeMetadata(configurable, TASK_TOOL_NAME);
      const profile = resolveSubagentDefinition(
        readSkillsRuntimeData(configurable.runtimeShared),
        subagent_type,
      );
      const baseSystemMessage = readBaseSystemMessage(configurable.runtimeShared);
      const inheritedBaseMessageCount = baseSystemMessage?.systemMessage.length ?? 0;
      // Read child activity callback injected by RuntimeEventsController
      const childActivityCallback = readChildActivityCallback(configurable.runtimeShared);
      return runDelegatedAgent({
        ...options,
        ...(baseSystemMessage?.systemMessage?.length || options.systemMessages?.length || options.systemPrompt
          ? {systemMessages: mergeTaskSystemMessages(baseSystemMessage?.systemMessage, options.systemMessages, options.systemPrompt)}
          : {}),
        prepareContext: wrapDelegatedPrepareContext(options.prepareContext, inheritedBaseMessageCount),
        checkpointer: delegatedCheckpointer,
        ...(childActivityCallback ? {onChildToolActivity: childActivityCallback} : {}),
      }, {
        prompt,
        ...(subagent_type ? {subagentType: subagent_type} : {}),
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

export function createTaskMiddleware(options: CreateTaskMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'TaskMiddleware',
    tools: [
      createTaskTool(options),
      ...(options.store ? createTaskTools({store: options.store}) : []),
    ],
    beforeModel(context) {
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

