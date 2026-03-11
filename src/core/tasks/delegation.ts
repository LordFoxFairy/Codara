import {AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createAgent} from '@core/agents/engine/agent';
import type {BaseMiddleware, HILToolMessagePayload} from '@core/middleware';
import type {ExecutionContextMetadata} from '@core/middleware/types';
import type {
  AgentInputBudget,
  AgentRuntimeContext,
  AgentTurnContextPreparer,
  AgentRuntimeValues,
  CreateAgentOptions,
  ToolErrorHandler,
} from '@core/agents/contract/agent';
import type {PauseRequest, ResumePayload} from '@core/agents/contract/pause';
import type {AgentCheckpointer} from '@core/checkpoint';
import {deepClone} from '@core/support/clone';

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

interface DelegatedResumeState {
  childThreadId: string;
  payload: ResumePayload;
}

export interface DelegatedParentRuntimeMetadata {
  parentExecution: ExecutionContextMetadata & {
    toolIndex: number;
    toolCallId: string;
  };
  resume?: DelegatedResumeState;
}

const DELEGATION_TOOL = Symbol.for('codara.tasks.delegation.tool');

export async function runDelegatedAgent(
  options: DelegatedAgentOptions,
  input: {
    prompt: string;
    maxTurns?: number;
    toolName: string;
    parentExecution: ExecutionContextMetadata & {
      toolIndex: number;
      toolCallId: string;
    };
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
  const mergedContext = mergeRuntimeContext(options.context, input.profileContext);
  const childOptions: CreateAgentOptions = {
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
  const child = createAgent(childOptions);
  const messages = createDelegatedAgentInput(
    input.prompt,
    mergeSystemPrompt(input.profileSystemPrompt, options.systemPrompt),
  );
  const result = input.resume
    ? await resumeDelegatedChild(childOptions, input.resume, input.maxTurns)
    : await child.invoke(
        {messages},
        {...(input.maxTurns ? {recursionLimit: input.maxTurns} : {})},
      );

  if (result.state.pendingPause) {
    return createDelegatedPauseToolMessage(result.state.pendingPause, {
      childThreadId: result.state.threadId,
      parentToolName: input.toolName,
    }, {
      execution: input.parentExecution,
      prompt: input.prompt,
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.type !== 'delegated_agent_result') {
    return undefined;
  }

  if (typeof record.threadId !== 'string' || typeof record.turns !== 'number' || typeof record.reason !== 'string') {
    return undefined;
  }

  return {
    type: 'delegated_agent_result',
    threadId: record.threadId,
    turns: record.turns,
    reason: record.reason as DelegatedAgentResult['reason'],
    ...(typeof record.summary === 'string' ? {summary: record.summary} : {}),
    ...(typeof record.errorMessage === 'string' ? {errorMessage: record.errorMessage} : {}),
  };
}

export function readDelegatedParentRuntimeMetadata(
  configurable: unknown,
  toolName: string,
): DelegatedParentRuntimeMetadata {
  const record = asRecord(configurable);
  const resume = readDelegatedResumeState(record.runtimeContext, toolName);

  return {
    parentExecution: readParentExecution(record.execution),
    ...(resume ? {resume} : {}),
  };
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
    {...(maxTurns ? {recursionLimit: maxTurns} : {})},
  );
}

function createDelegatedAgentInput(prompt: string, systemPrompt: string | undefined): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (systemPrompt?.trim()) {
    messages.push(new SystemMessage(systemPrompt.trim()));
  }
  messages.push(new HumanMessage(prompt));
  return messages;
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
  parent: {
    execution: ExecutionContextMetadata & {
      toolIndex: number;
      toolCallId: string;
    };
    prompt: string;
    maxTurns?: number;
  },
): ToolMessage {
  const request: PauseRequest = {
    id: `${parent.execution.runId}:${parent.execution.turn}:${parent.execution.toolCallId}:delegated`,
    description: pause.description,
    action: {
      toolCallId: parent.execution.toolCallId,
      toolName: delegated.parentToolName,
      toolArgs: {
        prompt: parent.prompt,
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

function readDelegatedResumeState(
  runtimeContext: unknown,
  toolName: string,
): DelegatedResumeState | undefined {
  const root = asRecord(runtimeContext);
  const hil = asRecord(root.hil);
  const currentPause = asRecord(hil.currentPause);
  const delegated = readDelegatedPauseMetadata(asRecord(currentPause.metadata), toolName);
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
  const parentToolName = readString(delegated.parentToolName);

  if (!childThreadId || !parentToolName || parentToolName !== toolName) {
    return undefined;
  }

  return {
    childThreadId,
    parentToolName,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readParentExecution(value: unknown): ExecutionContextMetadata & {
  toolIndex: number;
  toolCallId: string;
} {
  const execution = asRecord(value);
  const threadId = readString(execution.threadId);
  const runId = readString(execution.runId);
  const requestId = readString(execution.requestId);
  const toolCallId = readString(execution.toolCallId);
  const turn = readNumber(execution.turn);
  const maxTurns = readNumber(execution.maxTurns);
  const toolIndex = readNumber(execution.toolIndex);

  if (
    !threadId
    || !runId
    || !requestId
    || !toolCallId
    || typeof turn !== 'number'
    || typeof maxTurns !== 'number'
    || typeof toolIndex !== 'number'
  ) {
    throw new Error('Delegation tools require execution metadata with toolCallId and toolIndex.');
  }

  return {
    threadId,
    runId,
    requestId,
    turn,
    maxTurns,
    toolIndex,
    toolCallId,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
