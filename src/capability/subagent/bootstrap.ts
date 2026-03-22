import {AIMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import type {
  AgentInputBudget,
  AgentRuntimeContext,
  AgentContextPreparer,
  AgentRuntimeValues,
  Agent,
  ToolErrorHandler,
} from '@core/agent/models/agent';
import {bootstrapAgent, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {createAgentMemoryCheckpointer, type AgentCheckpointer} from '@durability/checkpoint/agent';
import type {ApprovalRecord} from '@durability/approval-store';
import type {AgentLifecycleHooks} from '@observability/hook/types';
import type {ChildToolActivityCallback} from '@observability/events';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import {readLatestAssistantText} from '@shared/messages';
import type {SubagentResult} from '@shared/subagent-result';
import {
  extendBaseSystemMessage,
  type BaseSystemMessageLoader,
} from '@context/session-bundle/base-system-message';
import {
  readSubagentRunRecoveryMetadata,
} from './review-metadata';
import type {SubagentRunManager, SubagentRecoverySpec} from './run-manager';
import type {SubagentRunRecord} from './types';

export {readSubagentResult, type SubagentResult} from '@shared/subagent-result';

export type SubagentModelResolver =
  | BaseChatModel
  | Promise<BaseChatModel>
  | (() => BaseChatModel | Promise<BaseChatModel>);

export interface SubagentInstructionContext {
  prepareContext?: AgentContextPreparer;
  loadBaseSystemMessage?: BaseSystemMessageLoader;
  middlewares?: BaseMiddleware[];
}

export interface SubagentSystemInput {
  systemMessages?: string[];
  prompt?: string;
}

export interface SubagentOptions {
  model: SubagentModelResolver;
  tools?: StructuredToolInterface[];
  childMiddleware?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  childContext?: AgentRuntimeContext;
  childValues?: AgentRuntimeValues;
  childInstructionContext?: SubagentInstructionContext;
  childSystemInput?: SubagentSystemInput;
  blockedToolNames?: string[];
  childLifecycle?: AgentLifecycleHooks;
  onChildToolActivity?: ChildToolActivityCallback;
}

export interface SubagentBuildInput {
  subagentType?: string;
  profileModel?: SubagentModelResolver;
  profileMiddleware?: BaseMiddleware[];
  profileContext?: AgentRuntimeContext;
  profileTools?: StructuredToolInterface[];
  profileSystemPrompt?: string;
}

export interface SubagentChildBootstrapInput {
  model: SubagentModelResolver;
  tools: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  prepareContext?: AgentContextPreparer;
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  lifecycle?: AgentLifecycleHooks;
  systemMessages?: string[];
  runtimeShared?: Record<string, unknown>;
}

export async function bootstrapSubagent(
  childSessionId: string,
  options: BootstrapAgentOptions,
): Promise<Agent> {
  // Subagents reuse the same core bootstrap/createAgent path as the main agent.
  const checkpoint = await options.checkpointer?.getLatest(childSessionId);
  return bootstrapAgent({
    ...options,
    sessionId: childSessionId,
    ...(checkpoint ? {checkpoint} : {}),
  });
}

export async function buildSubagentChildOptions(
  options: SubagentOptions,
  input: SubagentBuildInput,
): Promise<BootstrapAgentOptions> {
  const instructionBundle = extendBaseSystemMessage(
    await options.childInstructionContext?.loadBaseSystemMessage?.(),
    {
      systemMessages: options.childSystemInput?.systemMessages,
      prompts: [
        ...(input.profileSystemPrompt ? [input.profileSystemPrompt] : []),
        ...(options.childSystemInput?.prompt ? [options.childSystemInput.prompt] : []),
      ],
    },
  );
  const mergedContext = mergeRuntimeContext(options.childContext, input.profileContext);
  const childMiddleware = [
    ...(options.childInstructionContext?.middlewares ?? []),
    ...(options.childMiddleware ?? []),
    ...(input.profileMiddleware ?? []),
  ];

  if (options.onChildToolActivity) {
    childMiddleware.unshift(createSubagentActivityMiddleware(options.onChildToolActivity));
  }

  return buildSubagentBootstrapOptions({
    model: input.profileModel ?? options.model,
    systemMessages: instructionBundle.systemMessage,
    tools: filterSubagentChildTools(
      input.profileTools ?? options.tools ?? [],
      options.blockedToolNames,
    ),
    ...(childMiddleware.length > 0 ? {middleware: childMiddleware} : {}),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    prepareContext: options.childInstructionContext?.prepareContext,
    ...(mergedContext ? {context: mergedContext} : {}),
    ...(options.childValues ? {values: deepClone(options.childValues)} : {}),
    ...(options.childLifecycle ? {lifecycle: options.childLifecycle} : {}),
    ...(instructionBundle.runtimeShared ? {runtimeShared: instructionBundle.runtimeShared} : {}),
  });
}

export function buildSubagentBootstrapOptions(
  input: SubagentChildBootstrapInput,
): BootstrapAgentOptions {
  return {
    model: input.model,
    agentType: 'subagent',
    ...(input.systemMessages?.length ? {systemMessage: [...input.systemMessages]} : {}),
    tools: [...input.tools],
    ...(input.middleware?.length ? {middleware: [...input.middleware]} : {}),
    handleToolErrors: input.handleToolErrors,
    checkpointer: input.checkpointer,
    inputBudget: input.inputBudget,
    prepareContext: input.prepareContext,
    ...(input.context ? {context: input.context} : {}),
    ...(input.values ? {values: deepClone(input.values)} : {}),
    ...(input.lifecycle ? {lifecycle: input.lifecycle} : {}),
    ...(input.runtimeShared ? {runtimeShared: input.runtimeShared} : {}),
  };
}

export async function buildRecoveredSubagentChildOptions(
  options: SubagentOptions,
  runManager: SubagentRunManager,
  run: SubagentRunRecord,
  approval: ApprovalRecord | undefined,
): Promise<SubagentRecoverySpec | undefined> {
  const recovered = readRecoveredSubagentRecoverySpec(approval);
  if (!recovered) {
    return undefined;
  }

  const instructionBundle = await options.childInstructionContext?.loadBaseSystemMessage?.();

  return {
    childOptions: buildSubagentBootstrapOptions({
      model: options.model,
      ...(recovered.systemMessages?.length ? {systemMessages: recovered.systemMessages} : {}),
      tools: filterRecoveredSubagentTools(options.tools ?? [], recovered.toolNames),
      middleware: [
        ...(options.childInstructionContext?.middlewares ?? []),
        ...(options.childMiddleware ?? []),
        createRecoveredSubagentActivityMiddleware(runManager, run.runId),
      ],
      handleToolErrors: options.handleToolErrors,
      checkpointer: options.checkpointer ?? createAgentMemoryCheckpointer(),
      inputBudget: options.inputBudget,
      ...(options.childInstructionContext?.prepareContext
        ? {prepareContext: options.childInstructionContext.prepareContext}
        : {}),
      ...(options.childContext ? {context: options.childContext} : {}),
      ...(options.childValues ? {values: deepClone(options.childValues)} : {}),
      ...(options.childLifecycle ? {lifecycle: options.childLifecycle} : {}),
      ...(instructionBundle?.runtimeShared ? {runtimeShared: instructionBundle.runtimeShared} : {}),
    }),
    ...(typeof recovered.maxTurns === 'number' ? {maxTurns: recovered.maxTurns} : {}),
  };
}

export function createSubagentResult(
  sessionId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[],
): SubagentResult {
  const summary = readLatestAssistantText(messages);
  const toolUseCount = messages.filter((message) => ToolMessage.isInstance(message)).length;
  const totalTokens = readSubagentTokenTotal(messages);

  return {
    type: 'subagent_result',
    sessionId,
    turns,
    reason,
    ...(summary ? {summary} : {}),
    ...(error?.message ? {errorMessage: error.message} : {}),
    ...(toolUseCount > 0 ? {toolUseCount} : {}),
    ...(totalTokens > 0 ? {totalTokens} : {}),
  };
}

export function createSubagentToolMessage(
  result: SubagentResult,
  toolCallId = '',
): ToolMessage {
  return new ToolMessage({
    content: formatSubagentResult(result),
    artifact: result,
    status: result.reason === 'error' ? 'error' : 'success',
    tool_call_id: toolCallId,
  });
}

export function formatSubagentResult(result: SubagentResult): string {
  if (result.reason === 'error') {
    return [
      'Subagent failed.',
      `delegate_id: ${result.sessionId}`,
      `turns: ${result.turns}`,
      `error: ${result.errorMessage ?? 'Unknown error'}`,
      ...(result.summary ? [`summary:\n${result.summary}`] : []),
    ].join('\n');
  }

  return [
    'Subagent completed.',
    `delegate_id: ${result.sessionId}`,
    `turns: ${result.turns}`,
    `reason: ${result.reason}`,
    ...(result.summary ? [`summary:\n${result.summary}`] : []),
  ].join('\n');
}

function filterSubagentChildTools(
  tools: StructuredToolInterface[],
  blockedToolNames: string[] | undefined,
): StructuredToolInterface[] {
  // Claude Code subagents cannot spawn other subagents. Keep the child toolset
  // explicit by removing delegation tools here instead of relying on middleware
  // shape elsewhere to accidentally exclude them.
  const blocked = new Set(['Agent', ...(blockedToolNames ?? [])]);
  return tools.filter((candidate) => !blocked.has(candidate.name));
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

function createSubagentActivityMiddleware(callback: ChildToolActivityCallback): BaseMiddleware {
  return createMiddleware({
    name: 'SubagentActivityMiddleware',
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const summary = shortenToolActivityLabel(formatToolSummary(toolName, context.toolCall.args));
      const label = summary ? `${toolName}(${summary})` : toolName;
      try {
        callback({toolName, label});
      } catch {
        // Best-effort only.
      }
      return handler(context);
    },
  });
}

function readRecoveredSubagentRecoverySpec(
  approval: ApprovalRecord | undefined,
): {
  toolNames?: string[];
  systemMessages?: string[];
  maxTurns?: number;
} | undefined {
  const recovery = readSubagentRunRecoveryMetadata(approval?.reviewRequest.metadata)?.recovery;
  if (!recovery) {
    return undefined;
  }

  const parsed = z.object({
    toolNames: z.array(z.string().trim().min(1)).optional(),
    systemMessages: z.array(z.string()).optional(),
    maxTurns: z.number().int().positive().optional(),
  }).safeParse(recovery);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

function filterRecoveredSubagentTools(
  tools: StructuredToolInterface[],
  toolNames: string[] | undefined,
): StructuredToolInterface[] {
  if (!toolNames?.length) {
    return [...tools];
  }

  const allowed = new Set(toolNames);
  return tools.filter((tool) => allowed.has(tool.name));
}

function createRecoveredSubagentActivityMiddleware(
  runManager: SubagentRunManager,
  runId: string,
): BaseMiddleware {
  return createMiddleware({
    name: `SubagentRecoveryActivityMiddleware:${runId}`,
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const summary = shortenToolActivityLabel(formatToolSummary(toolName, context.toolCall.args));
      const label = summary ? `${toolName}(${summary})` : toolName;
      runManager.recordActivity(runId, {toolName, label});
      return handler(context);
    },
  });
}

function readSubagentTokenTotal(messages: BaseMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (!AIMessage.isInstance(message) || !message.usage_metadata) continue;
    const metadata = message.usage_metadata as Record<string, unknown>;
    const all = typeof metadata.total_tokens === 'number' ? metadata.total_tokens : 0;
    const input = typeof metadata.input_tokens === 'number' ? metadata.input_tokens : 0;
    const output = typeof metadata.output_tokens === 'number' ? metadata.output_tokens : 0;
    total += all > 0 ? all : input + output;
  }
  return total;
}

function shortenToolActivityLabel(value: string | undefined, max = 60): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
