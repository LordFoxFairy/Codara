import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {readSkillsRuntimeData, resolveSubagentDefinition, normalizeSubagentType} from '@context/skills/runtime-shared';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {formatAgentRunLaunchResult} from '@shared/agent-run-launch';
import {createAgentRuntime} from '@capability/subagent/runtime';
import {createAgentRunMemoryStore} from '@capability/subagent/run-store';
import {
  buildDelegatedChildOptions,
  createDelegatedAgentToolMessage,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
  type DelegatedParentRuntimeMetadata,
  type DelegatedAgentOptions,
  type DelegatedAgentResult,
} from '@capability/subagent/agent';
import type {AgentRunRecord, AgentRunStore} from '@capability/subagent/types';
import {resolveModel, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import {AGENT_ACTIVITY_CALLBACK_KEY, type ChildToolActivityCallback} from '@observability/events';
import type {AgentRuntime, AgentRuntimeRecoverySpec} from '@capability/subagent/runtime';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import type {SubagentDefinition} from '@context/skills/contracts';
import {filterToolsByReferences} from '@integration/tool';
import {formatSubagentDisplayName} from '@context/skills/runtime-shared';
import {formatToolSummary} from '@shared/tool-display';
import type {ApprovalRecord, ApprovalStore} from '@durability/approval-store';
import {deepClone} from '@shared/clone';

export const AGENT_TOOL_NAME = 'Agent';

export const AGENT_TOOL_DESCRIPTION = `Delegate a focused subproblem to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.
After calling Agent, do not post a second "agent started" confirmation, do not restate run metadata, and do not promise future updates.
Let the subagent/runtime UI carry launch and progress; only respond again with the delegated result or when review is required.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const AgentToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string({
    error: 'subagent_type is required. Use "Agent" for the base child or a named profile such as "Explore".',
  }).trim().min(1).describe('Subagent profile name. Use "Agent" for the built-in baseline child, or a named profile such as "Explore" or "Plan".'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});

const agentToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();

const AGENT_TOOL_OPTIONS = Symbol.for('codara.subagent.tool.options');

type AgentToolInput = z.infer<typeof AgentToolInputSchema>;

interface PrepareAgentLaunchInput {
  prompt: string;
  subagentType: string;
  maxTurns?: number;
  configurable: Record<string, unknown>;
  toolOptions: CreateAgentToolOptions;
  runStore: AgentRunStore | undefined;
  checkpointer: AgentCheckpointer;
}

interface PreparedAgentLaunch {
  runId: string;
  toolCallId: string;
  parentSessionId: string;
  childSessionId: string;
  agentName: string;
  subagentType?: string;
  runLabel: string;
  childMaxTurns: number | undefined;
  existingRunMessage?: ToolMessage;
  childOptions?: BootstrapAgentOptions;
}

interface CompiledAgentLaunchSpec {
  agentName: string;
  subagentType?: string;
  childMaxTurns?: number;
  childOptions: BootstrapAgentOptions;
}

export interface CreateAgentToolOptions extends DelegatedAgentOptions {
  description?: string;
  runStore?: AgentRunStore;
  approvalStore?: ApprovalStore;
  runtime?: AgentRuntime;
}

export function createAgentTool(options: CreateAgentToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = options.runStore ?? createAgentRunMemoryStore();
  const approvalStore = options.approvalStore;
  const runtime = options.runtime ?? createAgentRuntime({runStore, approvalStore});
  runtime.registerRecoveryBuilder(async (run, approval) => buildRecoveredAgentChildOptions(
    {...options, checkpointer: delegatedCheckpointer},
    runtime,
    run,
    approval,
  ));

  const agentTool = markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: AgentToolInput, config) => {
      const configurable = agentToolConfigSchema.parse(config).configurable ?? {};
      const prepared = await prepareAgentLaunch({
        prompt,
        subagentType: subagent_type,
        ...(typeof max_turns === 'number' ? {maxTurns: max_turns} : {}),
        configurable,
        toolOptions: options,
        runStore,
        checkpointer: delegatedCheckpointer,
      });

      if (prepared.existingRunMessage) {
        return prepared.existingRunMessage;
      }

      const launched = await runtime.launch({
        runId: prepared.runId,
        parentSessionId: prepared.parentSessionId,
        childSessionId: prepared.childSessionId,
        label: prepared.runLabel,
        agentName: prepared.agentName,
        ...(prepared.subagentType ? {subagentType: prepared.subagentType} : {}),
        prompt,
        childOptions: prepared.childOptions!,
        ...(typeof prepared.childMaxTurns === 'number' ? {maxTurns: prepared.childMaxTurns} : {}),
      });

      return new ToolMessage({
        content: formatAgentRunLaunchResult(launched),
        artifact: launched,
        status: 'success',
        tool_call_id: prepared.toolCallId,
      });
    },
    {
      name: AGENT_TOOL_NAME,
      description: options.description ?? AGENT_TOOL_DESCRIPTION,
      schema: AgentToolInputSchema,
    },
  ));

  Object.defineProperty(agentTool, AGENT_TOOL_OPTIONS, {
    value: {...options},
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return agentTool;
}

export function readAgentToolOptions(tool: StructuredToolInterface): CreateAgentToolOptions | undefined {
  const record = tool as StructuredToolInterface & {[AGENT_TOOL_OPTIONS]?: CreateAgentToolOptions};
  return record[AGENT_TOOL_OPTIONS];
}

async function prepareAgentLaunch(input: PrepareAgentLaunchInput): Promise<PreparedAgentLaunch> {
  const {
    prompt,
    subagentType,
    maxTurns,
    configurable,
    toolOptions,
    runStore,
    checkpointer,
  } = input;
  const delegated = readDelegatedParentRuntimeMetadata(configurable, 'Agent');
  const runId = resolveAgentRunId(runStore, delegated.parentExecution.toolCallId);
  const compiled = await compileAgentLaunchSpec({
    prompt,
    subagentType,
    maxTurns,
    delegated,
    toolOptions,
    checkpointer,
    runStore,
    runId,
    runtimeShared: configurable.runtimeShared,
  });
  const runLabel = `Delegating ${compiled.agentName}: ${prompt}`;
  const childSessionId = `${delegated.parentExecution.sessionId}:agent:${runId}`;

  const existingRunMessage = readExistingAgentRunMessage(
    runStore?.get(runId),
    delegated.parentExecution.toolCallId,
    {
      runId,
      agentName: compiled.agentName,
      label: runLabel,
      childSessionId,
      parentSessionId: delegated.parentExecution.sessionId,
    },
  );
  if (existingRunMessage) {
    return {
      runId,
      toolCallId: delegated.parentExecution.toolCallId,
      parentSessionId: delegated.parentExecution.sessionId,
      childSessionId,
      agentName: compiled.agentName,
      ...(compiled.subagentType ? {subagentType: compiled.subagentType} : {}),
      runLabel,
      childMaxTurns: compiled.childMaxTurns,
      existingRunMessage,
    };
  }

  return {
    runId,
    toolCallId: delegated.parentExecution.toolCallId,
    parentSessionId: delegated.parentExecution.sessionId,
    childSessionId,
    agentName: compiled.agentName,
    ...(compiled.subagentType ? {subagentType: compiled.subagentType} : {}),
    runLabel,
    childMaxTurns: compiled.childMaxTurns,
    childOptions: compiled.childOptions,
  };
}

async function compileAgentLaunchSpec(input: {
  prompt: string;
  subagentType: string | undefined;
  maxTurns?: number;
  delegated: DelegatedParentRuntimeMetadata;
  toolOptions: CreateAgentToolOptions;
  checkpointer: AgentCheckpointer;
  runStore: AgentRunStore | undefined;
  runId: string;
  runtimeShared: unknown;
}): Promise<CompiledAgentLaunchSpec> {
  const requestedSubagentType = normalizeSubagentType(input.subagentType);
  const profile = resolveSubagentDefinition(
    readSkillsRuntimeData(input.runtimeShared),
    requestedSubagentType,
  );
  const childActivityCallback = readChildActivityCallback(input.runtimeShared);
  const childMaxTurns = input.maxTurns ?? profile.maxTurns;
  const onChildToolActivity = createChildToolActivityCallback(input.runId, input.runStore, childActivityCallback);
  const childOptions = await buildDelegatedChildOptions({
    ...input.toolOptions,
    ...(input.toolOptions.childSystemMessages?.length || input.toolOptions.childSystemPrompt
      ? {
          childSystemMessages: mergeAgentSystemMessages(
            input.toolOptions.childSystemMessages,
            input.toolOptions.childSystemPrompt,
          ),
        }
      : {}),
    checkpointer: input.checkpointer,
    ...(onChildToolActivity ? {onChildToolActivity} : {}),
  }, {
    prompt: input.prompt,
    ...(requestedSubagentType ? {subagentType: requestedSubagentType} : {}),
    maxTurns: childMaxTurns,
    toolName: AGENT_TOOL_NAME,
    parentExecution: input.delegated.parentExecution,
    profileTools: resolveDefinitionTools(input.toolOptions.tools ?? [], profile),
    profileSystemPrompt: profile.systemPrompt,
  });

  return {
    agentName: normalizeAgentName(requestedSubagentType, profile.name),
    ...(requestedSubagentType ? {subagentType: requestedSubagentType} : {}),
    ...(typeof childMaxTurns === 'number' ? {childMaxTurns} : {}),
    childOptions,
  };
}

function createChildToolActivityCallback(
  runId: string,
  runStore: AgentRunStore | undefined,
  childActivityCallback: ChildToolActivityCallback | undefined,
): ChildToolActivityCallback | undefined {
  if (!runStore && !childActivityCallback) {
    return undefined;
  }

  return (info: {toolName: string; label: string}) => {
    try {
      const nextToolUseCount = (() => {
        const existing = runStore?.get(runId);
        return (existing?.toolUseCount ?? 0) + 1;
      })();
      runStore?.update(runId, {
        latestActivity: info.label,
        toolUseCount: nextToolUseCount,
      });
    } catch {
      // Best-effort: subagent-run tracking must not block delegated execution.
    }

    childActivityCallback?.(info);
  };
}

function mergeAgentSystemMessages(
  providedMessages: string[] | undefined,
  baseSystemPrompt: string | undefined,
): string[] {
  return [
    ...(providedMessages ?? []),
    ...(baseSystemPrompt?.trim() ? [baseSystemPrompt.trim()] : []),
  ];
}

function resolveDefinitionTools(
  tools: StructuredToolInterface[],
  definition: SubagentDefinition,
): StructuredToolInterface[] {
  if (!definition.tools?.length) {
    return [...tools];
  }

  return filterToolsByReferences(tools, definition.tools);
}

function readChildActivityCallback(runtimeShared: unknown): ChildToolActivityCallback | undefined {
  if (!runtimeShared || typeof runtimeShared !== 'object') {
    return undefined;
  }
  const shared = runtimeShared as Record<string, unknown>;
  const callback = shared[AGENT_ACTIVITY_CALLBACK_KEY];
  return typeof callback === 'function' ? callback as ChildToolActivityCallback : undefined;
}

function resolveAgentRunId(
  runStore: AgentRunStore | undefined,
  toolCallId: string,
): string {
  const baseRunId = toolCallId.trim();
  if (!runStore) {
    return baseRunId;
  }

  const existing = runStore.get(baseRunId);
  if (!existing || existing.status === 'running' || existing.status === 'paused') {
    return baseRunId;
  }

  return createDetachedAgentRunId(runStore, baseRunId);
}

function normalizeAgentName(subagentType: string | undefined, fallback: string): string {
  const agentName = formatSubagentDisplayName(subagentType) || fallback.trim();
  return agentName || 'Agent';
}

function readExistingAgentRunMessage(
  run: AgentRunRecord | undefined,
  toolCallId: string,
  fallback: {
    runId: string;
    agentName: string;
    label: string;
    childSessionId: string;
    parentSessionId: string;
  },
): ToolMessage | undefined {
  if (!run) {
    return undefined;
  }

  const completed = toDelegatedAgentResult(run);
  if (completed) {
    return createDelegatedAgentToolMessage(completed, toolCallId);
  }

  const sessionId = run.childSessionId?.trim() || fallback.childSessionId;
  const parentSessionId = run.parentSessionId.trim() || fallback.parentSessionId;
  const label = run.label?.trim() || fallback.label;
  const agentName = normalizeAgentName(run.agentName?.trim(), fallback.agentName);
  const header = run.status === 'paused'
    ? 'Delegated agent is waiting for review.'
    : 'Delegated agent is already running in background.';
  const detail = run.latestActivity?.trim();

  return new ToolMessage({
    content: [
      header,
      'Do not restate launch metadata or promise follow-up.',
      ...(detail ? [`activity: ${detail}`] : []),
    ].join('\n'),
    artifact: {
      type: 'agent_run_started',
      runId: run.runId,
      parentSessionId,
      sessionId,
      agentName,
      label,
    },
    status: 'success',
    tool_call_id: toolCallId,
  });
}

async function buildRecoveredAgentChildOptions(
  options: CreateAgentToolOptions,
  runtime: AgentRuntime,
  run: AgentRunRecord,
  approval: ApprovalRecord | undefined,
): Promise<AgentRuntimeRecoverySpec | undefined> {
  const recovered = readRecoveredAgentRecoverySpec(approval);
  if (!recovered) {
    return undefined;
  }

  return {
    childOptions: {
      model: await resolveModel(options.model),
      agentType: 'subagent',
      ...(recovered.systemMessages?.length ? {systemMessage: [...recovered.systemMessages]} : {}),
      ...(filterRecoveredAgentTools(options.tools ?? [], recovered.toolNames).length
        ? {tools: filterRecoveredAgentTools(options.tools ?? [], recovered.toolNames)}
        : {}),
      middleware: [
        ...(options.childMiddleware ?? []),
        createRecoveredAgentActivityMiddleware(runtime, run.runId),
      ],
      handleToolErrors: options.handleToolErrors,
      checkpointer: options.checkpointer ?? createAgentMemoryCheckpointer(),
      inputBudget: options.inputBudget,
      ...(options.childPrepareContext ? {prepareContext: options.childPrepareContext} : {}),
      ...(options.childContext ? {context: options.childContext} : {}),
      ...(options.childValues ? {values: deepClone(options.childValues)} : {}),
      ...(options.childLifecycle ? {lifecycle: options.childLifecycle} : {}),
    },
    ...(typeof recovered.maxTurns === 'number' ? {maxTurns: recovered.maxTurns} : {}),
  };
}

function createDetachedAgentRunId(runStore: AgentRunStore, baseRunId: string): string {
  const prefix = `${baseRunId}__`;
  const usedRunIds = new Set(runStore.list().map((record) => record.runId));
  let suffix = 2;

  while (usedRunIds.has(`${prefix}${suffix}`)) {
    suffix += 1;
  }

  return `${prefix}${suffix}`;
}

function toDelegatedAgentResult(run: AgentRunRecord): DelegatedAgentResult | undefined {
  if ((run.status !== 'completed' && run.status !== 'failed') || !run.childSessionId) {
    return undefined;
  }

  return {
    type: 'delegated_agent_result',
    sessionId: run.childSessionId,
    turns: run.turns ?? 0,
    reason: run.reason ?? (run.status === 'failed' ? 'error' : 'complete'),
    ...(run.summary?.trim() ? {summary: run.summary.trim()} : {}),
    ...(run.errorMessage?.trim() ? {errorMessage: run.errorMessage.trim()} : {}),
    ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
    ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
  };
}

function filterRecoveredAgentTools(
  tools: StructuredToolInterface[],
  toolNames: string[] | undefined,
): StructuredToolInterface[] {
  if (!toolNames?.length) {
    return [...tools];
  }

  const allowed = new Set(toolNames);
  return tools.filter((tool) => allowed.has(tool.name));
}

function readRecoveredAgentRecoverySpec(
  approval: ApprovalRecord | undefined,
): {
  toolNames?: string[];
  systemMessages?: string[];
  maxTurns?: number;
} | undefined {
  const metadata = approval?.reviewRequest.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  const codara = 'codara' in metadata && metadata.codara && typeof metadata.codara === 'object'
    ? metadata.codara as Record<string, unknown>
    : undefined;
  const recovery = codara?.agentRecovery;
  if (!recovery || typeof recovery !== 'object') {
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

function createRecoveredAgentActivityMiddleware(
  runtime: AgentRuntime,
  runId: string,
): BaseMiddleware {
  return createMiddleware({
    name: `AgentRecoveryActivity:${runId}`,
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const summary = truncateAgentToolSummary(formatToolSummary(toolName, context.toolCall.args));
      const label = summary ? `${toolName}(${summary})` : toolName;
      runtime.recordActivity(runId, {toolName, label});
      return handler(context);
    },
  });
}

function truncateAgentToolSummary(value: string | undefined, max = 60): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
