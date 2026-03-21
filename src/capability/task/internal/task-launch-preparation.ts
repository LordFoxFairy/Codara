import {ToolMessage} from '@langchain/core/messages';
import {readBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {readSkillsRuntimeData, resolveSubagentDefinition, normalizeSubagentType} from '@context/skills/runtime-shared';
import {buildDelegatedChildOptions, readDelegatedParentRuntimeMetadata} from '@capability/task/delegation';
import type {CreateTaskToolOptions} from '@capability/task/tool-types';
import type {TaskRunStore} from '@capability/task/types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import {
  normalizeAgentName,
  readChildActivityCallback,
  readExistingTaskRunMessage,
  resolveDefinitionTools,
  resolveTaskRunId,
  wrapDelegatedPrepareContext,
} from '@capability/task/internal/task-run-support';
import {type ChildToolActivityCallback} from '@observability/events';

export interface PrepareTaskLaunchInput {
  prompt: string;
  subagentType: string;
  maxTurns?: number;
  configurable: Record<string, unknown>;
  toolOptions: CreateTaskToolOptions;
  runStore: TaskRunStore | undefined;
  checkpointer: AgentCheckpointer;
}

export interface PreparedTaskLaunch {
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

export async function prepareTaskLaunch(input: PrepareTaskLaunchInput): Promise<PreparedTaskLaunch> {
  const {
    prompt,
    subagentType,
    maxTurns,
    configurable,
    toolOptions,
    runStore,
    checkpointer,
  } = input;
  const delegated = readDelegatedParentRuntimeMetadata(configurable, 'Task');
  const requestedSubagentType = normalizeSubagentType(subagentType);
  const profile = resolveSubagentDefinition(
    readSkillsRuntimeData(configurable.runtimeShared),
    requestedSubagentType,
  );
  const baseSystemMessage = readBaseSystemMessage(configurable.runtimeShared);
  const inheritedBaseMessageCount = baseSystemMessage?.systemMessage.length ?? 0;
  const childActivityCallback = readChildActivityCallback(configurable.runtimeShared);
  const runId = resolveTaskRunId(runStore, delegated.parentExecution.toolCallId);
  const agentName = normalizeAgentName(requestedSubagentType, profile.name);
  const runLabel = `Delegating ${agentName}: ${prompt}`;
  const childSessionId = `${delegated.parentExecution.sessionId}:task:${runId}`;
  const childMaxTurns = maxTurns ?? profile.maxTurns;

  const existingRunMessage = readExistingTaskRunMessage(
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
          systemMessages: mergeTaskSystemMessages(
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
    toolName: 'Task',
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
  runStore: TaskRunStore | undefined,
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
      // Best-effort: task run tracking must not block delegated execution.
    }

    childActivityCallback?.(info);
  };
}

function mergeTaskSystemMessages(
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
