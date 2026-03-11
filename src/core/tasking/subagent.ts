import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgent} from '@core/agents/engine/agent';
import {createMiddleware, type BaseMiddleware} from '@core/middleware';
import type {HILToolMessagePayload} from '@core/middleware';
import type {
  AgentInputBudget,
  AgentType,
  AgentRuntimeContext,
  AgentRuntimeValues,
  CreateAgentOptions,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {PauseRequest, ResumePayload} from '@core/agents/contract/pause';
import type {AgentCheckpointer} from '@core/checkpoint/state';
import {createAgentMemoryCheckpointer} from '@core/checkpoint/state';

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

export interface CreateSubagentMiddlewareOptions extends CreateSubagentToolOptions {
  name?: string;
}

export interface DelegatedAgentResult {
  type: 'delegated_agent_result';
  agentType: 'subagent';
  threadId: string;
  turns: number;
  reason: 'complete' | 'error' | 'max_turns';
  summary?: string;
  errorMessage?: string;
}

interface DelegatedPauseMetadata {
  childThreadId: string;
  childPause: PauseRequest;
  parentToolName: string;
}

export interface DelegatedResumeState {
  childThreadId: string;
  payload: ResumePayload;
}

export function createSubagentTool(options: CreateSubagentToolOptions): StructuredToolInterface {
  const toolName = options.name?.trim() || DEFAULT_SUBAGENT_TOOL_NAME;
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();

  return tool(
    async ({prompt, max_turns}: SubagentToolInput, config) => {
      const configurable = asRecord(config?.configurable);
      const delegatedResume = readDelegatedResumeState(configurable.invokeContext, toolName);

      return runDelegatedAgent({
        ...options,
        checkpointer: delegatedCheckpointer,
      }, {
        prompt,
        maxTurns: max_turns,
        toolName,
        parentAgentType: readAgentType(configurable.agentType),
        parentToolCallId: readString(configurable.toolCallId) ?? '',
        parentRunId: readString(configurable.runId) ?? '',
        parentRequestId: readString(configurable.requestId) ?? '',
        parentTurn: readNumber(configurable.turn) ?? 0,
        parentToolIndex: readNumber(configurable.toolIndex) ?? 0,
        ...(delegatedResume ? {resume: delegatedResume} : {}),
      });
    },
    {
      name: toolName,
      description: options.description ?? DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
      schema: SubagentToolInputSchema,
    },
  );
}

export function createSubagentMiddleware(options: CreateSubagentMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: options.name?.trim() || 'SubagentMiddleware',
    tools: [createSubagentTool(options)],
  });
}

export async function runDelegatedAgent(
  options: CreateSubagentToolOptions,
  input: {
    prompt: string;
    maxTurns?: number;
    toolName: string;
    parentAgentType: AgentType;
    parentToolCallId: string;
    parentRunId: string;
    parentRequestId: string;
    parentTurn: number;
    parentToolIndex: number;
    profileModel?: BaseChatModel;
    profileMiddleware?: BaseMiddleware[];
    profileContext?: AgentRuntimeContext;
    profileTools?: StructuredToolInterface[];
    profileSystemPrompt?: string;
    resume?: {
      childThreadId: string;
      payload: ResumePayload;
    };
  }
): Promise<ToolMessage> {
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
  const child = createAgent(childOptions);

  const messages = createSubagentInput(
    input.prompt,
    mergeSystemPrompt(input.profileSystemPrompt, options.systemPrompt)
  );
  const result = input.resume
    ? await resumeDelegatedChild(childOptions, input.resume, input.maxTurns)
    : await child.invoke(
        {messages},
        {...(input.maxTurns ? {recursionLimit: input.maxTurns} : {})}
      );

  if (result.state.pendingPause) {
    return createDelegatedPauseToolMessage(result.state.pendingPause, {
      childThreadId: result.state.threadId,
      childPause: result.state.pendingPause,
      parentToolName: input.toolName,
    }, {
      toolCallId: input.parentToolCallId,
      runId: input.parentRunId,
      requestId: input.parentRequestId,
      turn: input.parentTurn,
      toolIndex: input.parentToolIndex,
      prompt: input.prompt,
      maxTurns: input.maxTurns,
    });
  }

  const delegatedResult = createDelegatedAgentResult(
    result.state.threadId,
    result.turns,
    result.reason,
    result.error,
    result.state.messages
  );
  return createDelegatedAgentToolMessage(delegatedResult);
}

async function resumeDelegatedChild(
  childOptions: CreateAgentOptions,
  resume: {
    childThreadId: string;
    payload: ResumePayload;
  },
  maxTurns: number | undefined,
) {
  const checkpoint = await childOptions.checkpointer?.getLatest(resume.childThreadId);
  const child = createAgent({
    ...childOptions,
    threadId: resume.childThreadId,
    ...(checkpoint ? {checkpoint} : {}),
  });

  return child.resume(
    resume.payload,
    {...(maxTurns ? {recursionLimit: maxTurns} : {})}
  );
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

function createDelegatedAgentResult(
  threadId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[]
): DelegatedAgentResult {
  const summary = readLatestAssistantSummary(messages);

  return {
    type: 'delegated_agent_result',
    agentType: 'subagent',
    threadId,
    turns,
    reason,
    ...(summary ? {summary} : {}),
    ...(error?.message ? {errorMessage: error.message} : {}),
  };
}

function createDelegatedAgentToolMessage(result: DelegatedAgentResult): ToolMessage {
  return new ToolMessage({
    content: formatDelegatedAgentResult(result),
    artifact: result,
    status: result.reason === 'error' ? 'error' : 'success',
    tool_call_id: '',
  });
}

function createDelegatedPauseToolMessage(
  pause: PauseRequest,
  delegated: DelegatedPauseMetadata,
  parent: {
    toolCallId: string;
    runId: string;
    requestId: string;
    turn: number;
    toolIndex: number;
    prompt: string;
    maxTurns?: number;
  },
): ToolMessage {
  const request: PauseRequest = {
    id: `${parent.runId}:${parent.turn}:${parent.toolCallId}:delegated`,
    description: pause.description,
    action: {
      toolCallId: parent.toolCallId,
      toolName: delegated.parentToolName,
      toolArgs: {
        prompt: parent.prompt,
        ...(typeof parent.maxTurns === 'number' ? {max_turns: parent.maxTurns} : {}),
      },
    },
    review: pause.review,
    runtime: {
      runId: parent.runId,
      turn: parent.turn,
      requestId: parent.requestId,
      toolIndex: parent.toolIndex,
    },
    ...(pause.channel ? {channel: pause.channel} : {}),
    ...(pause.ui ? {ui: pause.ui} : {}),
    metadata: mergeDelegatedPauseMetadata(pause.metadata, delegated),
  };

  const payload: HILToolMessagePayload = {
    type: 'hil_pause',
    request,
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    tool_call_id: parent.toolCallId,
    name: delegated.parentToolName,
  });
}

function formatDelegatedAgentResult(result: DelegatedAgentResult): string {
  if (result.reason === 'error') {
    return [
      'Subagent failed.',
      `subagent_id: ${result.threadId}`,
      `turns: ${result.turns}`,
      `error: ${result.errorMessage ?? 'Unknown error'}`,
      ...(result.summary ? [`summary:\n${result.summary}`] : []),
    ].join('\n');
  }

  return [
    'Subagent completed.',
    `subagent_id: ${result.threadId}`,
    `turns: ${result.turns}`,
    `reason: ${result.reason}`,
    ...(result.summary ? [`summary:\n${result.summary}`] : []),
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

function readDelegatedResumeState(
  invokeContext: unknown,
  toolName: string,
): DelegatedResumeState | undefined {
  const root = asRecord(invokeContext);
  const hil = asRecord(root.hil);
  const currentPause = readPauseRequest(hil.currentPause);
  if (!currentPause) {
    return undefined;
  }

  const delegated = readDelegatedPauseMetadata(currentPause.metadata, toolName);
  if (!delegated) {
    return undefined;
  }

  const payload = hil.resume;
  if (payload === undefined) {
    return undefined;
  }

  return {
    childThreadId: delegated.childThreadId,
    payload,
  };
}

function mergeDelegatedPauseMetadata(
  metadata: Record<string, unknown> | undefined,
  delegated: DelegatedPauseMetadata,
): Record<string, unknown> {
  const base = asRecord(metadata);
  const codara = asRecord(base.codara);

  return {
    ...base,
    codara: {
      ...codara,
      delegatedSubagent: {
        childThreadId: delegated.childThreadId,
        childPause: cloneStructured(delegated.childPause),
        parentToolName: delegated.parentToolName,
      },
    },
  };
}

function readDelegatedPauseMetadata(
  metadata: Record<string, unknown> | undefined,
  toolName: string,
): DelegatedPauseMetadata | undefined {
  const codara = asRecord(asRecord(metadata).codara);
  const delegated = asRecord(codara.delegatedSubagent);
  const childThreadId = readString(delegated.childThreadId);
  const childPause = readPauseRequest(delegated.childPause);
  const parentToolName = readString(delegated.parentToolName);

  if (!childThreadId || !childPause || !parentToolName || parentToolName !== toolName) {
    return undefined;
  }

  return {
    childThreadId,
    childPause,
    parentToolName,
  };
}

function readPauseRequest(value: unknown): PauseRequest | undefined {
  const record = asRecord(value);
  const action = asRecord(record.action);
  const review = asRecord(record.review);
  const runtime = asRecord(record.runtime);
  if (
    !readString(record.id) ||
    !readString(record.description) ||
    !readString(action.toolCallId) ||
    !readString(action.toolName) ||
    !readString(review.actionName) ||
    !Array.isArray(review.allowedDecisions) ||
    typeof runtime.turn !== 'number' ||
    typeof runtime.toolIndex !== 'number' ||
    !readString(runtime.runId) ||
    !readString(runtime.requestId)
  ) {
    return undefined;
  }

  return cloneStructured(record as unknown as PauseRequest);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function readDelegatedAgentResult(value: unknown): DelegatedAgentResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== 'delegated_agent_result' || record.agentType !== 'subagent') {
    return undefined;
  }

  if (typeof record.threadId !== 'string' || typeof record.turns !== 'number' || typeof record.reason !== 'string') {
    return undefined;
  }

  return {
    type: 'delegated_agent_result',
    agentType: 'subagent',
    threadId: record.threadId,
    turns: record.turns,
    reason: record.reason as DelegatedAgentResult['reason'],
    ...(typeof record.summary === 'string' ? {summary: record.summary} : {}),
    ...(typeof record.errorMessage === 'string' ? {errorMessage: record.errorMessage} : {}),
  };
}

export {readDelegatedResumeState};
