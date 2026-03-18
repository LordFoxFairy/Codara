import {AIMessage, HumanMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {
  type AgentInputBudget,
  type AgentRuntimeContext,
  type AgentContextPreparer,
  type AgentRuntimeValues,
  type PauseRequest,
  type ResumePayload,
  type ToolErrorHandler,
} from '@core/agent/models/agent';
import type {AgentResult, AgentStreamOutput} from '@core/agent/models/agent';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import {bootstrapAgent, resolveModel} from '@core/agent/bootstrap';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import type {ChildToolActivityCallback} from '@observability/events/runtime-events';
import type {HILToolMessagePayload} from '@core/middleware/hil';
import type {ExecutionContextMetadata} from '@core/pipeline/types';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import type {AgentLifecycleHooks} from '@observability/hook/types';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import {readLatestAssistantText} from '@shared/messages';
import type {DelegatedAgentResult} from '@shared/delegation-result';
export {readDelegatedAgentResult, type DelegatedAgentResult} from '@shared/delegation-result';

export type DelegatedAgentModelResolver =
  | BaseChatModel
  | Promise<BaseChatModel>
  | (() => BaseChatModel | Promise<BaseChatModel>);

const parentExecutionSchema = z.object({
  sessionId: z.string().trim().min(1),
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
      childSessionId: z.string().trim().min(1),
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
  model: DelegatedAgentModelResolver;
  tools?: StructuredToolInterface[];
  middleware?: BaseMiddleware[];
  handleToolErrors?: ToolErrorHandler;
  checkpointer?: AgentCheckpointer;
  inputBudget?: AgentInputBudget;
  context?: AgentRuntimeContext;
  values?: AgentRuntimeValues;
  prepareContext?: AgentContextPreparer;
  systemMessages?: string[];
  systemPrompt?: string;
  blockedToolNames?: string[];
  lifecycle?: AgentLifecycleHooks;
  /** Optional callback for forwarding child tool activity to parent runtime events. */
  onChildToolActivity?: ChildToolActivityCallback;
}

interface DelegatedPauseMetadata {
  childSessionId: string;
  parentToolName: string;
}

interface ParentExecution {
  sessionId: string;
  runId: string;
  requestId: string;
  toolCallId: string;
  turn: number;
  maxTurns: number;
  toolIndex: number;
}

interface DelegatedResumeState {
  childSessionId: string;
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
  profileModel?: DelegatedAgentModelResolver;
  profileMiddleware?: BaseMiddleware[];
  profileContext?: AgentRuntimeContext;
  profileTools?: StructuredToolInterface[];
  profileSystemPrompt?: string;
  resume?: DelegatedResumeState;
  /** 当前委托深度（0 = 主 agent）。 */
  delegationDepth?: number;
}

interface ParentPauseContext {
  execution: ParentExecution;
  prompt: string;
  subagentType?: string;
  maxTurns?: number;
}

export const MAX_DELEGATION_DEPTH = 1;

/**
 * 校验委托深度是否在允许范围内。
 * @throws 超过 MAX_DELEGATION_DEPTH 时抛出错误。
 */
export function assertDelegationDepth(depth: number | undefined): void {
  const effective = depth ?? 0;
  if (effective >= MAX_DELEGATION_DEPTH) {
    throw new Error(
      `Delegation depth limit reached (${effective}/${MAX_DELEGATION_DEPTH}). ` +
      'Subagents cannot delegate further to prevent infinite recursion.',
    );
  }
}

const DELEGATION_TOOL = Symbol.for('codara.tasks.delegation.tool');

export async function runDelegatedAgent(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): Promise<ToolMessage> {
  assertDelegationDepth(input.delegationDepth);
  const childOptions = await buildDelegatedChildOptions(options, input);
  const result = await runDelegatedChild(childOptions, input);

  // SubagentStop hook — best-effort notification after delegated agent completes
  if (options.lifecycle && !result.state.pendingPause) {
    try {
      await options.lifecycle.onSubagentStop({
        hookEvent: 'SubagentStop',
        sessionId: input.parentExecution.sessionId,
        agentName: input.subagentType ?? 'general-purpose',
        taskId: result.state.sessionId,
        reason: result.reason,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Fail-open: SubagentStop hooks are best-effort
    }
  }

  if (result.state.pendingPause) {
    return createDelegatedPauseToolMessage(result.state.pendingPause, {
      childSessionId: result.state.sessionId,
      parentToolName: input.toolName,
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

// readDelegatedAgentResult is re-exported from @shared/delegation-result above.

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

function createDelegatedAgentInput(prompt: string): BaseMessage[] {
  const messages: BaseMessage[] = [];
  messages.push(new HumanMessage(prompt));
  return messages;
}

async function buildDelegatedChildOptions(
  options: DelegatedAgentOptions,
  input: DelegatedChildInput,
): Promise<BootstrapAgentOptions> {
  const mergedContext = mergeRuntimeContext(options.context, input.profileContext);
  const baseMiddleware = [...(input.profileMiddleware ?? options.middleware ?? [])];

  // Inject activity forward middleware if parent provided a callback
  if (options.onChildToolActivity) {
    baseMiddleware.push(createActivityForwardMiddleware(options.onChildToolActivity));
  }

  return {
    model: await resolveModel(input.profileModel ?? options.model),
    agentType: 'subagent',
    ...(mergeDelegatedSystemMessages(options.systemMessages, input.profileSystemPrompt, options.systemPrompt).length > 0
      ? {systemMessage: mergeDelegatedSystemMessages(options.systemMessages, input.profileSystemPrompt, options.systemPrompt)}
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
    prepareContext: options.prepareContext,
    ...(mergedContext ? {context: mergedContext} : {}),
    ...(options.values ? {values: deepClone(options.values)} : {}),
  };
}

async function runDelegatedChild(
  childOptions: BootstrapAgentOptions,
  input: DelegatedChildInput,
) {
  if (input.resume) {
    return resumeDelegatedChild(childOptions, input.resume, input.maxTurns);
  }

  const child = await bootstrapAgent(childOptions);
  const messages = createDelegatedAgentInput(input.prompt);
  return consumeAgentStream(child.stream(
    {messages},
    {...(input.maxTurns ? {recursionLimit: input.maxTurns} : {})},
  ));
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
  maxTurns: number | undefined,
) {
  const checkpoint = await childOptions.checkpointer?.getLatest(resume.childSessionId);
  const child = await bootstrapAgent({
    ...childOptions,
    sessionId: resume.childSessionId,
    ...(checkpoint ? {checkpoint} : {}),
  });

  return consumeAgentStream(child.resumeStream(
    resume.payload,
    {resumeMode: 'tool', ...(maxTurns ? {recursionLimit: maxTurns} : {})},
  ));
}

/**
 * Drain an AsyncGenerator produced by agent.stream() / agent.resumeStream(),
 * discarding intermediate chunks (middleware already handles them in real-time),
 * and return the final AgentResult.
 */
async function consumeAgentStream(
  gen: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): Promise<AgentResult> {
  let result: IteratorResult<AgentStreamOutput, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

function mergeSystemPrompt(profileSystemPrompt: string | undefined, toolSystemPrompt: string | undefined): string | undefined {
  const parts = [profileSystemPrompt?.trim(), toolSystemPrompt?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function mergeDelegatedSystemMessages(
  inheritedMessages: string[] | undefined,
  profileSystemPrompt: string | undefined,
  toolSystemPrompt: string | undefined,
): string[] {
  const merged = mergeSystemPrompt(profileSystemPrompt, toolSystemPrompt);
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

function createDelegatedAgentResult(
  sessionId: string,
  turns: number,
  reason: 'complete' | 'error' | 'max_turns',
  error: Error | undefined,
  messages: BaseMessage[],
): DelegatedAgentResult {
  const summary = readLatestAssistantSummary(messages);
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

function sumChildTokens(messages: BaseMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (!AIMessage.isInstance(m) || !m.usage_metadata) continue;
    const meta = m.usage_metadata as Record<string, unknown>;
    const t = typeof meta.total_tokens === 'number' ? meta.total_tokens : 0;
    const input = typeof meta.input_tokens === 'number' ? meta.input_tokens : 0;
    const output = typeof meta.output_tokens === 'number' ? meta.output_tokens : 0;
    total += t > 0 ? t : input + output;
  }
  return total;
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
      `delegate_id: ${result.sessionId}`,
      `turns: ${result.turns}`,
      `error: ${result.errorMessage ?? 'Unknown error'}`,
      ...(result.summary ? [`summary:\n${result.summary}`] : []),
    ].join('\n');
  }

  return [
    'Delegated task completed.',
    `delegate_id: ${result.sessionId}`,
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
    childSessionId: delegated.childSessionId,
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
        childSessionId: delegated.childSessionId,
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
  const childSessionId = delegated?.childSessionId;
  const parentToolName = delegated?.parentToolName;

  if (!childSessionId || !parentToolName || parentToolName !== toolName) {
    return undefined;
  }

  return {
    childSessionId,
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

/**
 * Lightweight middleware that forwards child tool call activity to the parent via callback.
 * Injected into delegated child agents so the parent transcript can display real-time sub-tool activity.
 */
function createActivityForwardMiddleware(callback: ChildToolActivityCallback): BaseMiddleware {
  return createMiddleware({
    name: 'ActivityForwardMiddleware',
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const args = context.toolCall.args;
      const summary = formatChildToolSummary(toolName, args);
      const label = summary ? `${toolName}(${summary})` : toolName;
      try {
        callback({toolName, label});
      } catch { /* best-effort — don't break child execution */ }
      return handler(context);
    },
  });
}

function formatChildToolSummary(toolName: string, args: unknown): string | undefined {
  return truncateStr(formatToolSummary(toolName, args));
}

function truncateStr(value: string | undefined, max = 60): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

