import {HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {
  createAgent,
  type AgentInputBudget,
  type AgentRuntimeContext,
  type AgentTurnContextPreparer,
  type AgentRuntimeValues,
  type CreateAgentOptions,
  type PauseRequest,
  type ResumePayload,
  type ToolErrorHandler,
} from '@core/agents';
import type {BaseMiddleware, HILToolMessagePayload} from '@core/middleware';
import type {ExecutionContextMetadata} from '@core/middleware/types';
import type {AgentCheckpointer} from '@core/checkpoint';
import {deepClone} from '@core/shared/clone';
import {readLatestAssistantText} from '@core/shared/messages';

const delegatedAgentResultSchema = z.object({
  type: z.literal('delegated_agent_result'),
  threadId: z.string(),
  turns: z.number(),
  reason: z.enum(['complete', 'error', 'max_turns']),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
});

const parentExecutionSchema = z.object({
  threadId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  toolCallId: z.string().trim().min(1),
  turn: z.number(),
  maxTurns: z.number(),
  toolIndex: z.number(),
});

const delegatedPauseMetadataSchema = z.object({
  codara: z.object({
    delegatedSubagent: z.object({
      childThreadId: z.string().trim().min(1),
      parentToolName: z.string().trim().min(1),
    }).optional(),
  }).loose().optional(),
}).loose();

const delegatedRuntimeContextSchema = z.object({
  hil: z.object({
    currentPause: z.object({
      metadata: z.unknown().optional(),
    }).loose().optional(),
    resume: z.unknown().optional(),
  }).loose().optional(),
}).loose();

export interface DelegatedAgentOptions {
  model: BaseChatModel;
  tools?: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  prepareTurnContext?: AgentTurnContextPreparer;
  systemPrompt?: string;
  blockedToolNames?: string[];
}

export interface DelegatedAgentResult {
  type: 'delegated_agent_result';
  threadId: string;
  turns: number;
  reason: 'complete' | 'error' | 'max_turns';
  summary?: string;
  errorMessage?: string;
}

interface DelegatedPauseMetadata {
  childThreadId: string;
  parentToolName: string;
}

interface ParentExecution {
  threadId: string;
  runId: string;
  requestId: string;
  toolCallId: string;
  turn: number;
  maxTurns: number;
  toolIndex: number;
}

interface DelegatedResumeState {
  childThreadId: string;
  payload: ResumePayload;
}

export interface DelegatedParentRuntimeMetadata {
  parentExecution: ParentExecution;
  resume?: DelegatedResumeState;
}

interface DelegatedChildInput {
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
  toolName: string;
  parentExecution: ParentExecution;
  profileModel?: BaseChatModel;
  profileMiddleware?: BaseMiddleware[];
  profileContext?: AgentRuntimeContext;
  profileTools?: StructuredToolInterface[];
  profileSystemPrompt?: string;
  resume?: DelegatedResumeState;
}

interface ParentPauseContext {
  execution: ParentExecution;
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
}

const DELEGATION_TOOL = Symbol.for('codara.tasks.delegation.tool');

export async function runDelegatedAgent(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): Promise<ToolMessage> {
  const childOptions = buildDelegatedChildOptions(options, input);
  const result = await runDelegatedChild(childOptions, input, options.systemPrompt);

  if (result.state.pendingPause) {
    return createDelegatedPauseToolMessage(result.state.pendingPause, {
      childThreadId: result.state.threadId,
      parentToolName: input.toolName,
    }, {
      execution: input.parentExecution,
      prompt: input.prompt,
      subagentType: input.subagentType,
      maxTurns: input.maxTurns,
    });
  }

  return createDelegatedAgentToolMessage(createDelegatedAgentResult(
    result.state.threadId,
    result.turns,
    result.reason,
    result.error,
    result.state.messages,
  ));
}

export function markDelegationTool<TTool extends StructuredToolInterface>(tool: TTool): TTool {
  Object.defineProperty(tool, DELEGATION_TOOL, {
    value: true,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return tool;
}

export function readDelegatedAgentResult(value: unknown): DelegatedAgentResult | undefined {
  const parsed = delegatedAgentResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readDelegatedParentRuntimeMetadata(
  configurable: unknown,
  toolName: string,
): DelegatedParentRuntimeMetadata {
  const record = delegatedRuntimeContextSchema.safeParse(readDelegatedRuntimeContext(configurable));
  const runtimeContext = record.success ? record.data : undefined;
  const resume = readDelegatedResumeState(runtimeContext, toolName);

  return {
    parentExecution: readParentExecution(
      configurable && typeof configurable === 'object' && 'execution' in configurable
        ? configurable.execution
        : undefined
    ),
    ...(resume ? {resume} : {}),
  };
}

function readDelegatedRuntimeContext(configurable: unknown): unknown {
  if (!configurable || typeof configurable !== 'object') {
    return configurable;
  }

  const record = configurable as Record<string, unknown>;
  return record.context ?? record.runtimeContext ?? configurable;
}

function createDelegatedAgentInput(prompt: string, systemPrompt: string | undefined): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (systemPrompt?.trim()) {
    messages.push(new SystemMessage(systemPrompt.trim()));
  }
  messages.push(new HumanMessage(prompt));
  return messages;
}

function buildDelegatedChildOptions(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): CreateAgentOptions {
  const mergedContext = mergeRuntimeContext(options.context, input.profileContext);

  return {
    model: input.profileModel ?? options.model,
    agentType: 'subagent',
    tools: resolveDelegatedAgentTools(
      input.profileTools ?? options.tools ?? [],
      input.toolName,
      options.blockedToolNames,
    ),
    ...(input.profileMiddleware ?? options.middleware?.length ? {middleware: [...(input.profileMiddleware ?? options.middleware ?? [])]} : {}),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    prepareTurnContext: options.prepareTurnContext,
    ...(mergedContext ? {context: mergedContext} : {}),
    ...(options.values ? {values: deepClone(options.values)} : {}),
  };
}

async function runDelegatedChild(
  childOptions: CreateAgentOptions,
  input: DelegatedChildInput,
  toolSystemPrompt: string | undefined,
) {
  if (input.resume) {
    return resumeDelegatedChild(childOptions, input.resume, input.maxTurns);
  }

  const child = createAgent(childOptions);
  const messages = createDelegatedAgentInput(
    input.prompt,
    mergeSystemPrompt(input.profileSystemPrompt, toolSystemPrompt),
  );
  return child.invoke(
    {messages},
    {...(input.maxTurns ? {recursionLimit: input.maxTurns} : {})},
  );
}

function resolveDelegatedAgentTools(
  tools: StructuredToolInterface[],
  toolName: string,
  blockedToolNames: string[] | undefined,
): StructuredToolInterface[] {
  const blocked = new Set([toolName, ...(blockedToolNames ?? [])]);
  return tools.filter((candidate) => !blocked.has(candidate.name) && !isDelegationTool(candidate));
}

async function resumeDelegatedChild(
  childOptions: CreateAgentOptions,
  resume: DelegatedResumeState,
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
    {resumeMode: 'tool', ...(maxTurns ? {recursionLimit: maxTurns} : {})},
  );
}

function mergeSystemPrompt(profileSystemPrompt: string | undefined, toolSystemPrompt: string | undefined): string | undefined {
  const parts = [profileSystemPrompt?.trim(), toolSystemPrompt?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function mergeRuntimeContext(
  baseContext: AgentRuntimeContext | undefined,
  profileContext: AgentRuntimeContext | undefined,
): AgentRuntimeContext | undefined {
  if (!baseContext && !profileContext) {
    return undefined;
  }

  return {
    ...(baseContext ? deepClone(baseContext) : {}),
    ...(profileContext ? deepClone(profileContext) : {}),
  };
}

function isDelegationTool(tool: StructuredToolInterface | undefined): boolean {
  if (!tool) {
    return false;
  }

  return (tool as unknown as Record<PropertyKey, unknown>)[DELEGATION_TOOL] === true;
}

function createDelegatedAgentResult(
  threadId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[],
): DelegatedAgentResult {
  const summary = readLatestAssistantSummary(messages);

  return {
    type: 'delegated_agent_result',
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
  parent: ParentPauseContext,
): ToolMessage {
  const request: PauseRequest = {
    id: `${parent.execution.runId}:${parent.execution.turn}:${parent.execution.toolCallId}:delegated`,
    description: pause.description,
    action: {
      toolCallId: parent.execution.toolCallId,
      toolName: delegated.parentToolName,
      toolArgs: {
        prompt: parent.prompt,
        ...(parent.subagentType ? {subagent_type: parent.subagentType} : {}),
        ...(typeof parent.maxTurns === 'number' ? {max_turns: parent.maxTurns} : {}),
      },
    },
    review: pause.review,
    runtime: {
      runId: parent.execution.runId,
      turn: parent.execution.turn,
      requestId: parent.execution.requestId,
      toolIndex: parent.execution.toolIndex,
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
    tool_call_id: parent.execution.toolCallId,
    name: delegated.parentToolName,
  });
}

function formatDelegatedAgentResult(result: DelegatedAgentResult): string {
  if (result.reason === 'error') {
    return [
      'Delegated task failed.',
      `delegate_id: ${result.threadId}`,
      `turns: ${result.turns}`,
      `error: ${result.errorMessage ?? 'Unknown error'}`,
      ...(result.summary ? [`summary:\n${result.summary}`] : []),
    ].join('\n');
  }

  return [
    'Delegated task completed.',
    `delegate_id: ${result.threadId}`,
    `turns: ${result.turns}`,
    `reason: ${result.reason}`,
    ...(result.summary ? [`summary:\n${result.summary}`] : []),
  ].join('\n');
}

function readLatestAssistantSummary(messages: BaseMessage[]): string | undefined {
  return readLatestAssistantText(messages);
}

function readDelegatedResumeState(
  runtimeContext: unknown,
  toolName: string,
): DelegatedResumeState | undefined {
  const parsed = delegatedRuntimeContextSchema.safeParse(runtimeContext);
  if (!parsed.success) {
    return undefined;
  }

  const hil = parsed.data.hil;
  const delegated = readDelegatedPauseMetadata(hil?.currentPause?.metadata, toolName);
  if (!delegated) {
    return undefined;
  }

  const payload = hil?.resume;
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
  const parsed = delegatedPauseMetadataSchema.safeParse(metadata);
  const base = parsed.success ? parsed.data : {};
  const codara = base.codara ?? {};

  return {
    ...base,
    codara: {
      ...codara,
      delegatedSubagent: {
        childThreadId: delegated.childThreadId,
        parentToolName: delegated.parentToolName,
      },
    },
  };
}

function readDelegatedPauseMetadata(
  metadata: unknown,
  toolName: string,
): DelegatedPauseMetadata | undefined {
  const parsed = delegatedPauseMetadataSchema.safeParse(metadata);
  const delegated = parsed.success ? parsed.data.codara?.delegatedSubagent : undefined;
  const childThreadId = delegated?.childThreadId;
  const parentToolName = delegated?.parentToolName;

  if (!childThreadId || !parentToolName || parentToolName !== toolName) {
    return undefined;
  }

  return {
    childThreadId,
    parentToolName,
  };
}

function readParentExecution(value: unknown): ExecutionContextMetadata & {
  toolIndex: number;
  toolCallId: string;
} {
  const parsed = parentExecutionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Delegation tools require execution metadata with toolCallId and toolIndex.');
  }

  return parsed.data;
}
