import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {readBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {readSkillsRuntimeData, resolveSubagentDefinition, normalizeSubagentType} from '@context/skills/runtime-shared';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {formatAgentRunLaunchResult} from '@shared/agent-run-launch';
import {createAgentRuntime} from '@capability/subagent/runtime';
import {createAgentRunMemoryStore} from '@capability/subagent/store';
import {
  buildDelegatedChildOptions,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
} from '@capability/subagent/agent';
import type {CreateAgentToolOptions} from '@capability/subagent/tool-types';
import {
  buildRecoveredAgentChildOptions,
  normalizeAgentName,
  readChildActivityCallback,
  readExistingAgentRunMessage,
  rebindAgentRunStore,
  resolveDefinitionTools,
  resolveAgentRunId,
  wrapDelegatedPrepareContext,
} from '@capability/subagent/support';
import type {AgentRunStore} from '@capability/subagent/types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import {type ChildToolActivityCallback} from '@observability/events';

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
  runLabel: string;
  childMaxTurns: number | undefined;
  existingRunMessage?: ToolMessage;
  childOptions?: BootstrapAgentOptions;
}

export function createAgentTool(options: CreateAgentToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = rebindAgentRunStore(options.runStore ?? createAgentRunMemoryStore());
  const approvalStore = options.approvalStore;
  const runtime = options.runtime ?? createAgentRuntime({runStore, approvalStore});
  runtime.registerRecoveryBuilder(async (run) => buildRecoveredAgentChildOptions(
    {...options, checkpointer: delegatedCheckpointer},
    runtime,
    run,
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
  const requestedSubagentType = normalizeSubagentType(subagentType);
  const profile = resolveSubagentDefinition(
    readSkillsRuntimeData(configurable.runtimeShared),
    requestedSubagentType,
  );
  const baseSystemMessage = readBaseSystemMessage(configurable.runtimeShared);
  const inheritedBaseMessageCount = baseSystemMessage?.systemMessage.length ?? 0;
  const childActivityCallback = readChildActivityCallback(configurable.runtimeShared);
  const runId = resolveAgentRunId(runStore, delegated.parentExecution.toolCallId);
  const agentName = normalizeAgentName(requestedSubagentType, profile.name);
  const runLabel = `Delegating ${agentName}: ${prompt}`;
  const childSessionId = `${delegated.parentExecution.sessionId}:agent:${runId}`;
  const childMaxTurns = maxTurns ?? profile.maxTurns;

  const existingRunMessage = readExistingAgentRunMessage(
    runStore?.get(runId),
    delegated.parentExecution.toolCallId,
    {
      runId,
      agentName,
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
      agentName,
      runLabel,
      childMaxTurns,
      existingRunMessage,
    };
  }

  const onChildToolActivity = createChildToolActivityCallback(runId, runStore, childActivityCallback);
  const childOptions = await buildDelegatedChildOptions({
    ...toolOptions,
    ...(baseSystemMessage?.systemMessage?.length || toolOptions.systemMessages?.length || toolOptions.systemPrompt
      ? {
          systemMessages: mergeAgentSystemMessages(
            baseSystemMessage?.systemMessage,
            toolOptions.systemMessages,
            toolOptions.systemPrompt,
          ),
        }
      : {}),
    prepareContext: wrapDelegatedPrepareContext(toolOptions.prepareContext, inheritedBaseMessageCount),
    checkpointer,
    ...(onChildToolActivity ? {onChildToolActivity} : {}),
  }, {
    prompt,
    ...(requestedSubagentType ? {subagentType: requestedSubagentType} : {}),
    maxTurns: childMaxTurns,
    toolName: 'Agent',
    parentExecution: delegated.parentExecution,
    profileTools: resolveDefinitionTools(toolOptions.tools ?? [], profile),
    profileSystemPrompt: profile.systemPrompt,
  });

  return {
    runId,
    toolCallId: delegated.parentExecution.toolCallId,
    parentSessionId: delegated.parentExecution.sessionId,
    childSessionId,
    agentName,
    runLabel,
    childMaxTurns,
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
