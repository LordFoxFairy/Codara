import {AIMessage, HumanMessage, SystemMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents/engine/agent';
import type {
  Agent,
  AgentInputBudget,
  AgentType,
  AgentRuntimeContext,
  AgentRuntimeValues,
  CreateAgentOptions,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import type {BaseMiddleware} from '@core/middleware';

export const DEFAULT_SUBAGENT_TOOL_NAME = 'delegate_to_subagent';

export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this when a sub-problem would benefit from a fresh context window or a filtered toolset.
The subagent runs independently and returns only a concise result summary back to the current agent.

Do not use this tool for trivial work that can be completed directly in the current agent.
Do not call this tool from inside another subagent unless nested delegation is explicitly supported.`;

const SubagentToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the subagent to execute'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the subagent run'),
});

type SubagentToolInput = z.infer<typeof SubagentToolInputSchema>;

export interface CreateSubagentToolOptions {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  middlewares?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  systemPrompt?: string;
  name?: string;
  description?: string;
  blockedToolNames?: string[];
}

export function createSubagentTool(options: CreateSubagentToolOptions): StructuredToolInterface {
  const toolName = options.name?.trim() || DEFAULT_SUBAGENT_TOOL_NAME;

  return tool(
    async ({prompt, max_turns}: SubagentToolInput, config) => {
      return runDelegatedAgent(options, {
        prompt,
        maxTurns: max_turns,
        toolName,
        parentAgentType: readAgentType(config?.configurable?.agentType),
      });
    },
    {
      name: toolName,
      description: options.description ?? DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
      schema: SubagentToolInputSchema,
    },
  );
}

export async function runDelegatedAgent(
  options: CreateSubagentToolOptions,
  input: {
    prompt: string;
    maxTurns?: number;
    toolName: string;
    parentAgentType: AgentType;
    profileModel?: BaseChatModel;
    profileMiddleware?: BaseMiddleware[];
    profileContext?: AgentRuntimeContext;
    profileTools?: StructuredToolInterface[];
    profileSystemPrompt?: string;
  },
  createChildAgent?: (options: CreateAgentOptions) => Agent | Promise<Agent>
): Promise<string> {
  if (input.parentAgentType === 'subagent') {
    throw new Error('Subagents cannot delegate to other subagents');
  }

  const childOptions: CreateAgentOptions = {
    model: input.profileModel ?? options.model,
    agentType: 'subagent',
    tools: resolveSubagentTools(
      input.profileTools ?? options.tools ?? [],
      input.toolName,
      options.blockedToolNames
    ),
    middleware: input.profileMiddleware ?? resolveSubagentMiddleware(options),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    ...(mergeRuntimeContext(options.context, input.profileContext)
      ? {context: mergeRuntimeContext(options.context, input.profileContext)}
      : {}),
    ...(options.values ? {values: cloneStructured(options.values)} : {}),
  };
  const child = await createDelegatedAgent(childOptions, createChildAgent);

  const messages = createSubagentInput(
    input.prompt,
    mergeSystemPrompt(input.profileSystemPrompt, options.systemPrompt)
  );
  const result = await child.invoke(
    {messages},
    {...(input.maxTurns ? {recursionLimit: input.maxTurns} : {})}
  );
  return formatSubagentResult(result.state.threadId, result.turns, result.reason, result.error, result.state.messages);
}

async function createDelegatedAgent(
  childOptions: CreateAgentOptions,
  createChildAgent: ((options: CreateAgentOptions) => Agent | Promise<Agent>) | undefined
): Promise<Agent> {
  if (!createChildAgent) {
    return createAgent(childOptions);
  }

  return createChildAgent(childOptions);
}

function mergeSystemPrompt(profileSystemPrompt: string | undefined, toolSystemPrompt: string | undefined): string | undefined {
  const parts = [profileSystemPrompt?.trim(), toolSystemPrompt?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function mergeRuntimeContext(
  baseContext: AgentRuntimeContext | undefined,
  profileContext: AgentRuntimeContext | undefined
): AgentRuntimeContext | undefined {
  if (!baseContext && !profileContext) {
    return undefined;
  }

  return {
    ...(baseContext ? cloneStructured(baseContext) : {}),
    ...(profileContext ? cloneStructured(profileContext) : {}),
  };
}

function resolveSubagentTools(
  tools: StructuredToolInterface[],
  toolName: string,
  blockedToolNames: string[] | undefined
): StructuredToolInterface[] {
  const blocked = new Set([toolName, ...(blockedToolNames ?? [])]);
  return tools.filter((candidate) => !blocked.has(candidate.name));
}

function resolveSubagentMiddleware(options: CreateSubagentToolOptions): BaseMiddleware[] | undefined {
  if (options.middleware?.length) {
    return [...options.middleware];
  }

  if (options.middlewares?.length) {
    return [...options.middlewares];
  }

  return undefined;
}

function createSubagentInput(prompt: string, systemPrompt: string | undefined): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (systemPrompt?.trim()) {
    messages.push(new SystemMessage(systemPrompt.trim()));
  }
  messages.push(new HumanMessage(prompt));
  return messages;
}

function readAgentType(value: unknown): AgentType {
  return value === 'subagent' ? 'subagent' : 'main';
}

function formatSubagentResult(
  threadId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[]
): string {
  const summary = readLatestAssistantSummary(messages);

  if (reason === 'error') {
    return [
      `Subagent failed.`,
      `subagent_id: ${threadId}`,
      `turns: ${turns}`,
      `error: ${error?.message ?? 'Unknown error'}`,
      ...(summary ? [`summary:\n${summary}`] : []),
    ].join('\n');
  }

  return [
    `Subagent completed.`,
    `subagent_id: ${threadId}`,
    `turns: ${turns}`,
    `reason: ${reason}`,
    ...(summary ? [`summary:\n${summary}`] : []),
  ].join('\n');
}

function readLatestAssistantSummary(messages: BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!AIMessage.isInstance(message)) {
      continue;
    }

    const content = stringifyMessageContent(message.content).trim();
    if (content) {
      return content;
    }
  }

  return undefined;
}

function stringifyMessageContent(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content ?? '');
  }

  return content.map((part) => {
    if (typeof part === 'string') {
      return part;
    }

    if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
      return part.text;
    }

    return JSON.stringify(part);
  }).join('\n');
}

function cloneStructured<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }

    if (value && typeof value === 'object') {
      return {...(value as Record<string, unknown>)} as T;
    }

    return value;
  }
}
