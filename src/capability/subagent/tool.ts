import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {readSkillsRuntimeData, resolveSubagentDefinition, normalizeSubagentType} from '@capability/skill';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {formatSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import {createSubagentRunManager, type SubagentRunManager} from '@capability/subagent/run-manager';
import {createSubagentRunMemoryStore} from '@capability/subagent/run-store';
import {
  buildRecoveredSubagentChildOptions,
  buildSubagentChildOptions,
  formatSubagentResult,
  type SubagentResult,
  type SubagentOptions,
} from '@capability/subagent/bootstrap';
import {
  readSubagentParentRuntimeMetadata,
  type SubagentParentRuntimeMetadata,
} from '@capability/subagent/review-metadata';
import type {SubagentRunRecord, SubagentRunStore} from '@capability/subagent/types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import {filterToolsByReferences} from '@tools';
import {formatSubagentDisplayName, type SubagentDefinition} from '@capability/skill';
import type {ApprovalStore} from '@durability/approval-store';

export const AGENT_TOOL_NAME = 'Agent';

export const AGENT_TOOL_DESCRIPTION = `Delegate a focused subproblem to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.
After calling Agent, do not post a second "agent started" confirmation, do not restate run metadata, and do not promise future updates.
Let the subagent/runtime UI carry launch and progress; only respond again with the child result or when review is required.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const SubagentToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the subagent'),
  subagent_type: z.string({
    error: 'subagent_type is required. Use "Agent" for the base child or a named profile such as "Explore".',
  }).trim().min(1).describe('Subagent profile name. Use "Agent" for the built-in baseline child, or a named profile such as "Explore" or "Plan".'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the subagent'),
});

const subagentToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();

type SubagentToolInput = z.infer<typeof SubagentToolInputSchema>;

interface PrepareSubagentLaunchInput {
  prompt: string;
  subagentType: string;
  maxTurns?: number;
  permissionMode?: string;
  configurable: Record<string, unknown>;
  toolOptions: CreateSubagentToolOptions;
  runStore: SubagentRunStore | undefined;
  checkpointer: AgentCheckpointer;
}

interface PreparedSubagentLaunch {
  runId: string;
  batchId: string;
  batchExpectedCount: number;
  toolCallId: string;
  parentSessionId: string;
  childSessionId: string;
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  runLabel: string;
  childMaxTurns: number | undefined;
  existingRunMessage?: ToolMessage;
  childOptions?: BootstrapAgentOptions;
}

interface CompiledSubagentLaunchSpec {
  agentName: string;
  subagentType?: string;
  permissionMode?: string;
  childMaxTurns?: number;
  childOptions: BootstrapAgentOptions;
}

export interface CreateSubagentToolOptions extends SubagentOptions {
  description?: string;
  runStore?: SubagentRunStore;
  approvalStore?: ApprovalStore;
  runManager?: SubagentRunManager;
}

export function createSubagentTool(options: CreateSubagentToolOptions): StructuredToolInterface {
  const subagentCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = options.runStore ?? createSubagentRunMemoryStore();
  const approvalStore = options.approvalStore;
  const runManager = options.runManager ?? createSubagentRunManager({runStore, approvalStore});
  runManager.registerRecoveryBuilder(async (run, approval) => buildRecoveredSubagentChildOptions(
    {...options, checkpointer: subagentCheckpointer},
    runManager,
    run,
    approval,
  ));

  // The outward Agent tool only validates input and prepares a child launch spec.
  // Actual child creation remains on the core bootstrap/createAgent path via the run manager.
  const subagentTool = tool(
    async ({prompt, subagent_type, max_turns}: SubagentToolInput, config) => {
      const configurable = subagentToolConfigSchema.parse(config).configurable ?? {};
      const prepared = await prepareSubagentLaunch({
        prompt,
        subagentType: subagent_type,
        ...(typeof max_turns === 'number' ? {maxTurns: max_turns} : {}),
        configurable,
        toolOptions: options,
        runStore,
        checkpointer: subagentCheckpointer,
      });

      if (prepared.existingRunMessage) {
        return prepared.existingRunMessage;
      }

      const launched = await runManager.launch({
        runId: prepared.runId,
        parentSessionId: prepared.parentSessionId,
        batchId: prepared.batchId,
        batchExpectedCount: prepared.batchExpectedCount,
        childSessionId: prepared.childSessionId,
        label: prepared.runLabel,
        agentName: prepared.agentName,
        ...(prepared.subagentType ? {subagentType: prepared.subagentType} : {}),
        ...(prepared.permissionMode ? {permissionMode: prepared.permissionMode} : {}),
        prompt,
        childOptions: prepared.childOptions!,
        ...(typeof prepared.childMaxTurns === 'number' ? {maxTurns: prepared.childMaxTurns} : {}),
      });
      return new ToolMessage({
        content: formatSubagentRunLaunchResult(launched),
        artifact: launched,
        status: 'success',
        tool_call_id: prepared.toolCallId,
      });
    },
    {
      name: AGENT_TOOL_NAME,
      description: options.description ?? AGENT_TOOL_DESCRIPTION,
      schema: SubagentToolInputSchema,
    },
  );

  return subagentTool;
}

async function prepareSubagentLaunch(input: PrepareSubagentLaunchInput): Promise<PreparedSubagentLaunch> {
  const {
    prompt,
    subagentType,
    maxTurns,
    configurable,
    toolOptions,
    runStore,
    checkpointer,
  } = input;
  const parentRuntime = readSubagentParentRuntimeMetadata(configurable);
  const runId = resolveSubagentRunId(runStore, parentRuntime.parentExecution.toolCallId);
  const batchId = parentRuntime.launchBatch?.batchId
    ?? `${parentRuntime.parentExecution.sessionId}:${parentRuntime.parentExecution.runId}:turn:${parentRuntime.parentExecution.turn}`;
  const batchExpectedCount = parentRuntime.launchBatch?.expectedCount ?? 1;
  const compiled = await compileSubagentLaunchSpec({
    prompt,
    subagentType,
    maxTurns,
    parentRuntime,
    toolOptions,
    checkpointer,
    runStore,
    runId,
    runtimeShared: configurable.runtimeShared,
  });
  const runLabel = `Delegating ${compiled.agentName}: ${prompt}`;
  const childSessionId = `${parentRuntime.parentExecution.sessionId}:agent:${runId}`;

  const existingRunMessage = readExistingSubagentRunMessage(
    runStore?.get(runId),
    parentRuntime.parentExecution.toolCallId,
    {
      runId,
      agentName: compiled.agentName,
      label: runLabel,
      childSessionId,
      parentSessionId: parentRuntime.parentExecution.sessionId,
    },
  );
  if (existingRunMessage) {
    return {
      runId,
      batchId,
      batchExpectedCount,
      toolCallId: parentRuntime.parentExecution.toolCallId,
      parentSessionId: parentRuntime.parentExecution.sessionId,
      childSessionId,
      agentName: compiled.agentName,
      ...(compiled.subagentType ? {subagentType: compiled.subagentType} : {}),
      ...(compiled.permissionMode ? {permissionMode: compiled.permissionMode} : {}),
      runLabel,
      childMaxTurns: compiled.childMaxTurns,
      existingRunMessage,
    };
  }

  return {
    runId,
    batchId,
    batchExpectedCount,
    toolCallId: parentRuntime.parentExecution.toolCallId,
    parentSessionId: parentRuntime.parentExecution.sessionId,
    childSessionId,
    agentName: compiled.agentName,
    ...(compiled.subagentType ? {subagentType: compiled.subagentType} : {}),
    ...(compiled.permissionMode ? {permissionMode: compiled.permissionMode} : {}),
    runLabel,
    childMaxTurns: compiled.childMaxTurns,
    childOptions: compiled.childOptions,
  };
}

function resolveSubagentRunId(
  runStore: SubagentRunStore | undefined,
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

  const prefix = `${baseRunId}__`;
  const usedRunIds = new Set(runStore.list().map((record) => record.runId));
  let suffix = 2;

  while (usedRunIds.has(`${prefix}${suffix}`)) {
    suffix += 1;
  }

  return `${prefix}${suffix}`;
}

function readExistingSubagentRunMessage(
  run: SubagentRunRecord | undefined,
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

  const completed = toSubagentResult(run);
  if (completed) {
    return new ToolMessage({
      content: formatSubagentResult(completed),
      artifact: completed,
      status: completed.reason === 'error' ? 'error' : 'success',
      tool_call_id: toolCallId,
    });
  }

  const sessionId = run.childSessionId?.trim() || fallback.childSessionId;
  const parentSessionId = run.parentSessionId.trim() || fallback.parentSessionId;
  const label = run.label?.trim() || fallback.label;
  const agentName = run.agentName?.trim() || fallback.agentName;
  const header = run.status === 'paused'
    ? 'Subagent is waiting for review.'
    : 'Subagent is already running in background.';
  const detail = run.latestActivity?.trim();

  return new ToolMessage({
    content: [
      header,
      'Do not restate launch metadata or promise follow-up.',
      ...(detail ? [`activity: ${detail}`] : []),
    ].join('\n'),
    artifact: {
      type: 'subagent_run_started',
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

function toSubagentResult(
  run: SubagentRunRecord,
): SubagentResult | undefined {
  if ((run.status !== 'completed' && run.status !== 'failed') || !run.childSessionId) {
    return undefined;
  }

  return {
    type: 'subagent_result',
    runId: run.runId,
    sessionId: run.childSessionId,
    turns: run.turns ?? 0,
    reason: run.reason ?? (run.status === 'failed' ? 'error' : 'complete'),
    ...(run.summary?.trim() ? {summary: run.summary.trim()} : {}),
    ...(run.errorMessage?.trim() ? {errorMessage: run.errorMessage.trim()} : {}),
    ...(typeof run.toolUseCount === 'number' ? {toolUseCount: run.toolUseCount} : {}),
    ...(typeof run.totalTokens === 'number' ? {totalTokens: run.totalTokens} : {}),
  };
}

async function compileSubagentLaunchSpec(input: {
  prompt: string;
  subagentType: string | undefined;
  maxTurns?: number;
  permissionMode?: string;
  parentRuntime: SubagentParentRuntimeMetadata;
  toolOptions: CreateSubagentToolOptions;
  checkpointer: AgentCheckpointer;
  runStore: SubagentRunStore | undefined;
  runId: string;
  runtimeShared: unknown;
}): Promise<CompiledSubagentLaunchSpec> {
  const requestedSubagentType = normalizeSubagentType(input.subagentType);
  const profile = resolveSubagentDefinition(
    readSkillsRuntimeData(input.runtimeShared),
    requestedSubagentType,
  );
  const childMaxTurns = input.maxTurns ?? profile.maxTurns;
  const onChildToolActivity = createChildToolActivityCallback(input.runId, input.toolOptions.runManager);
  const childOptions = await buildSubagentChildOptions({
    ...input.toolOptions,
    checkpointer: input.checkpointer,
    ...(onChildToolActivity ? {onChildToolActivity} : {}),
  }, {
    ...(requestedSubagentType ? {subagentType: requestedSubagentType} : {}),
    profileTools: resolveDefinitionTools(input.toolOptions.tools ?? [], profile),
    profileSystemPrompt: profile.systemPrompt,
    ...(profile.hints?.permissionMode ? {permissionMode: profile.hints.permissionMode} : {}),
  });

  return {
    agentName: normalizeSubagentName(requestedSubagentType, profile.name),
    ...(requestedSubagentType ? {subagentType: requestedSubagentType} : {}),
    ...(profile.hints?.permissionMode ? {permissionMode: profile.hints.permissionMode} : {}),
    ...(typeof childMaxTurns === 'number' ? {childMaxTurns} : {}),
    childOptions,
  };
}

function createChildToolActivityCallback(
  runId: string,
  runManager: SubagentRunManager | undefined,
) {
  if (!runManager) {
    return undefined;
  }

  return (info: {toolName: string; label: string}) => {
    try {
      runManager.recordActivity(runId, info);
    } catch {
      // Best-effort: run tracking must not block child execution.
    }
  };
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

function normalizeSubagentName(subagentType: string | undefined, fallback: string): string {
  const agentName = formatSubagentDisplayName(subagentType) || fallback.trim();
  return agentName || 'Agent';
}
