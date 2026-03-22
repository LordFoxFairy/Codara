import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {
  AgentInputBudget,
  AgentRuntimeContext,
  AgentContextPreparer,
  AgentRuntimeValues,
  ReviewRequest,
  ToolErrorHandler,
} from '@core/agent/models/agent';
import type {AgentResult, AgentStreamOutput} from '@core/agent/models/agent';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import {bootstrapAgent, resolveModel} from '@core/agent/bootstrap';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import type {ChildToolActivityCallback} from '@observability/events';
import type {ReviewToolMessagePayload} from '@core/middleware/review';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import type {AgentLifecycleHooks} from '@observability/hook/types';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import {readLatestAssistantText} from '@shared/messages';
import {formatSubagentDisplayName} from '@capability/skill';
import type {DelegatedAgentResult} from '@shared/delegation-result';
import {
  mergeDelegatedPauseMetadata,
  type DelegatedParentRuntimeMetadata,
  type DelegatedPauseRecoverySpec,
  type DelegatedResumeState,
} from './review-metadata';

export {readDelegatedAgentResult, type DelegatedAgentResult} from '@shared/delegation-result';

export type DelegatedAgentModelResolver =
  | BaseChatModel
  | Promise<BaseChatModel>
  | (() => BaseChatModel | Promise<BaseChatModel>);

export interface DelegatedAgentOptions {
  model: DelegatedAgentModelResolver;
  tools?: StructuredToolInterface[];
  childMiddleware?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  childContext?: AgentRuntimeContext;
  childValues?: AgentRuntimeValues;
  childPrepareContext?: AgentContextPreparer;
  childSystemMessages?: string[];
  childSystemPrompt?: string;
  blockedToolNames?: string[];
  childLifecycle?: AgentLifecycleHooks;
  onChildToolActivity?: ChildToolActivityCallback;
}

export interface DelegatedChildInput {
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
  toolName: string;
  parentExecution: DelegatedParentRuntimeMetadata['parentExecution'];
  profileModel?: DelegatedAgentModelResolver;
  profileMiddleware?: BaseMiddleware[];
  profileContext?: AgentRuntimeContext;
  profileTools?: StructuredToolInterface[];
  profileSystemPrompt?: string;
  resume?: DelegatedResumeState;
}

interface ParentReviewContext {
  execution: DelegatedParentRuntimeMetadata['parentExecution'];
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
}

const DELEGATION_TOOL = Symbol.for('codara.subagent.delegation.tool');

export async function runDelegatedAgent(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): Promise<ToolMessage> {
  const childOptions = await buildDelegatedChildOptions(options, input);
  const result = await runDelegatedChild(childOptions, input);

  if (options.childLifecycle && !result.state.pendingReview) {
    try {
      await options.childLifecycle.onSubagentStop({
        hookEvent: 'SubagentStop',
        sessionId: input.parentExecution.sessionId,
        agentName: formatSubagentDisplayName(input.subagentType),
        taskId: result.state.sessionId,
        reason: result.reason,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Best-effort hook.
    }
  }

  if (result.state.pendingReview) {
    return createDelegatedReviewToolMessage(result.state.pendingReview, {
      childSessionId: result.state.sessionId,
      parentToolName: input.toolName,
      recovery: buildDelegatedPauseRecoverySpec(childOptions, input.maxTurns),
    }, {
      execution: input.parentExecution,
      prompt: input.prompt,
      subagentType: input.subagentType,
      maxTurns: input.maxTurns,
    });
  }

  return createDelegatedAgentToolMessage(createDelegatedAgentResult(
    result.state.sessionId,
    result.turns,
    result.reason,
    result.error,
    result.state.messages,
  ), input.parentExecution.toolCallId);
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

export async function buildDelegatedChildOptions(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): Promise<BootstrapAgentOptions> {
  const mergedContext = mergeRuntimeContext(options.childContext, input.profileContext);
  const baseMiddleware = [...(input.profileMiddleware ?? options.childMiddleware ?? [])];

  if (options.onChildToolActivity) {
    baseMiddleware.unshift(createActivityForwardMiddleware(options.onChildToolActivity));
  }

  return {
    model: await resolveModel(input.profileModel ?? options.model),
    agentType: 'subagent',
    ...(mergeDelegatedSystemMessages(options.childSystemMessages, input.profileSystemPrompt, options.childSystemPrompt).length > 0
      ? {systemMessage: mergeDelegatedSystemMessages(options.childSystemMessages, input.profileSystemPrompt, options.childSystemPrompt)}
      : {}),
    tools: resolveDelegatedAgentTools(
      input.profileTools ?? options.tools ?? [],
      input.toolName,
      options.blockedToolNames,
    ),
    ...(baseMiddleware.length > 0 ? {middleware: baseMiddleware} : {}),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    prepareContext: options.childPrepareContext,
    ...(mergedContext ? {context: mergedContext} : {}),
    ...(options.childValues ? {values: deepClone(options.childValues)} : {}),
  };
}

export function createDelegatedAgentResult(
  sessionId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[],
): DelegatedAgentResult {
  const summary = readLatestAssistantText(messages);
  const toolUseCount = messages.filter((m) => ToolMessage.isInstance(m)).length;
  const totalTokens = sumChildTokens(messages);

  return {
    type: 'delegated_agent_result',
    sessionId,
    turns,
    reason,
    ...(summary ? {summary} : {}),
    ...(error?.message ? {errorMessage: error.message} : {}),
    ...(toolUseCount > 0 ? {toolUseCount} : {}),
    ...(totalTokens > 0 ? {totalTokens} : {}),
  };
}

export function createDelegatedAgentToolMessage(
  result: DelegatedAgentResult,
  toolCallId = '',
): ToolMessage {
  return new ToolMessage({
    content: formatDelegatedAgentResult(result),
    artifact: result,
    status: result.reason === 'error' ? 'error' : 'success',
    tool_call_id: toolCallId,
  });
}

export function formatDelegatedAgentResult(result: DelegatedAgentResult): string {
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

async function runDelegatedChild(
  childOptions: BootstrapAgentOptions,
  input: DelegatedChildInput,
) {
  const childConfig = {
    ...(input.maxTurns ? {recursionLimit: input.maxTurns} : {}),
  };

  if (input.resume) {
    return resumeDelegatedChild(childOptions, input.resume, childConfig);
  }

  const child = await bootstrapAgent(childOptions);
  return consumeAgentStream(child.stream({
    messages: [new HumanMessage(input.prompt)],
  }, childConfig));
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
  childOptions: BootstrapAgentOptions,
  resume: DelegatedResumeState,
  childConfig: Record<string, unknown>,
) {
  const checkpoint = await childOptions.checkpointer?.getLatest(resume.childSessionId);
  const child = await bootstrapAgent({
    ...childOptions,
    sessionId: resume.childSessionId,
    ...(checkpoint ? {checkpoint} : {}),
  });

  return consumeAgentStream(child.resumeStream(
    resume.payload,
    {resumeMode: 'tool', ...childConfig},
  ));
}

async function consumeAgentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): Promise<AgentResult> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

function mergeDelegatedSystemMessages(
  inheritedMessages: string[] | undefined,
  profileSystemPrompt: string | undefined,
  toolSystemPrompt: string | undefined,
): string[] {
  const merged = [profileSystemPrompt?.trim(), toolSystemPrompt?.trim()].filter(Boolean).join('\n\n');
  return [
    ...(inheritedMessages ?? []),
    ...(merged ? [merged] : []),
  ];
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

  const obj = tool as object;
  return DELEGATION_TOOL in obj && (obj as Record<PropertyKey, unknown>)[DELEGATION_TOOL] === true;
}

function sumChildTokens(messages: BaseMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (!AIMessage.isInstance(m) || !m.usage_metadata) continue;
    const meta = m.usage_metadata as Record<string, unknown>;
    const all = typeof meta.total_tokens === 'number' ? meta.total_tokens : 0;
    const input = typeof meta.input_tokens === 'number' ? meta.input_tokens : 0;
    const output = typeof meta.output_tokens === 'number' ? meta.output_tokens : 0;
    total += all > 0 ? all : input + output;
  }
  return total;
}

function createDelegatedReviewToolMessage(
  review: ReviewRequest,
  delegated: {
    childSessionId: string;
    parentToolName: string;
    recovery?: DelegatedPauseRecoverySpec;
  },
  parent: ParentReviewContext,
): ToolMessage {
  const request: ReviewRequest = {
    id: `${parent.execution.runId}:${parent.execution.turn}:${parent.execution.toolCallId}:delegated`,
    description: review.description,
    action: {
      toolCallId: parent.execution.toolCallId,
      toolName: delegated.parentToolName,
      toolArgs: {
        prompt: parent.prompt,
        ...(parent.subagentType ? {subagent_type: parent.subagentType} : {}),
        ...(typeof parent.maxTurns === 'number' ? {max_turns: parent.maxTurns} : {}),
      },
    },
    review: review.review,
    runtime: {
      runId: parent.execution.runId,
      turn: parent.execution.turn,
      requestId: parent.execution.requestId,
      toolIndex: parent.execution.toolIndex,
    },
    ...(review.channel ? {channel: review.channel} : {}),
    ...(review.ui ? {ui: review.ui} : {}),
    metadata: mergeDelegatedPauseMetadata(review.metadata, delegated),
  };

  const payload: ReviewToolMessagePayload = {
    type: 'review_pause',
    request,
  };

  return new ToolMessage({
    content: JSON.stringify(payload),
    tool_call_id: parent.execution.toolCallId,
    name: delegated.parentToolName,
  });
}

function buildDelegatedPauseRecoverySpec(
  childOptions: BootstrapAgentOptions,
  maxTurns: number | undefined,
): DelegatedPauseRecoverySpec | undefined {
  const recovery: DelegatedPauseRecoverySpec = {
    ...(childOptions.tools?.length ? {toolNames: childOptions.tools.map((tool) => tool.name)} : {}),
    ...(childOptions.systemMessage?.length ? {systemMessages: [...childOptions.systemMessage]} : {}),
    ...(typeof maxTurns === 'number' ? {maxTurns} : {}),
  };

  return Object.keys(recovery).length > 0 ? recovery : undefined;
}

function createActivityForwardMiddleware(callback: ChildToolActivityCallback): BaseMiddleware {
  return createMiddleware({
    name: 'ActivityForwardMiddleware',
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const summary = truncateStr(formatToolSummary(toolName, context.toolCall.args));
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

function truncateStr(value: string | undefined, max = 60): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
