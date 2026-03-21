import {ToolMessage} from '@langchain/core/messages';
import {tool, type StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {readBaseSystemMessage} from '@context/session-bundle/base-system-message';
import {readSkillsRuntimeData, resolveSubagentDefinition, normalizeSubagentType} from '@context/skills/runtime-shared';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {formatTaskRunLaunchResult} from '@shared/task-run-launch';
import {createTaskRuntime} from '@capability/task/delegation/runtime';
import {createTaskRunMemoryStore} from '@capability/task/delegation/store';
import {
  buildDelegatedChildOptions,
  markDelegationTool,
  readDelegatedParentRuntimeMetadata,
} from '@capability/task/delegation/agent';
import type {CreateTaskToolOptions} from '@capability/task/tool-types';
import {
  buildRecoveredTaskChildOptions,
  normalizeAgentName,
  readChildActivityCallback,
  readExistingTaskRunMessage,
  rebindTaskRunStore,
  resolveDefinitionTools,
  resolveTaskRunId,
  wrapDelegatedPrepareContext,
} from '@capability/task/delegation/support';
import type {TaskRunStore} from '@capability/task/types';
import type {BootstrapAgentOptions} from '@core/agent/bootstrap';
import type {AgentCheckpointer} from '@durability/checkpoint/agent';
import {type ChildToolActivityCallback} from '@observability/events';

export const TASK_TOOL_NAME = 'Task';

export const TASK_TOOL_DESCRIPTION = `Delegate a focused task to an isolated subagent.
Use this tool when a sub-problem should run in a fresh context window and return only a concise summary.
After calling Task, do not post a second "task started" confirmation, do not restate run metadata, and do not promise future updates.
Let the task/runtime UI carry launch and progress; only respond again with the delegated result or when review is required.

Subagent definitions are loaded from markdown files such as .codara/skills/*/agents/*.md or explicit subagent roots.
Use TaskCreate/TaskUpdate/TaskList for shared task coordination, not this delegation tool.`;

const TaskToolInputSchema = z.object({
  prompt: z.string().min(1).describe('The task for the delegated subagent'),
  subagent_type: z.string({
    error: 'subagent_type is required. Use "Agent" for the base child or a named profile such as "Explore".',
  }).trim().min(1).describe('Subagent profile name. Use "Agent" for the built-in baseline child, or a named profile such as "Explore" or "Plan".'),
  max_turns: z.number().int().positive().max(100).optional().describe('Optional max turns for the delegated subagent'),
});

const taskToolConfigSchema = z.object({
  configurable: z.record(z.string(), z.unknown()).optional(),
}).loose();

const TASK_TOOL_OPTIONS = Symbol.for('codara.task.tool.options');

type TaskToolInput = z.infer<typeof TaskToolInputSchema>;

interface PrepareTaskLaunchInput {
  prompt: string;
  subagentType: string;
  maxTurns?: number;
  configurable: Record<string, unknown>;
  toolOptions: CreateTaskToolOptions;
  runStore: TaskRunStore | undefined;
  checkpointer: AgentCheckpointer;
}

interface PreparedTaskLaunch {
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

export function createTaskTool(options: CreateTaskToolOptions): StructuredToolInterface {
  const delegatedCheckpointer = options.checkpointer ?? createAgentMemoryCheckpointer();
  const runStore = rebindTaskRunStore(options.runStore ?? createTaskRunMemoryStore());
  const approvalStore = options.approvalStore;
  const runtime = options.runtime ?? createTaskRuntime({runStore, approvalStore});
  runtime.registerRecoveryBuilder(async (run) => buildRecoveredTaskChildOptions(
    {...options, checkpointer: delegatedCheckpointer},
    runtime,
    run,
  ));

  const taskTool = markDelegationTool(tool(
    async ({prompt, subagent_type, max_turns}: TaskToolInput, config) => {
      const configurable = taskToolConfigSchema.parse(config).configurable ?? {};
      const prepared = await prepareTaskLaunch({
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
        content: formatTaskRunLaunchResult(launched),
        artifact: launched,
        status: 'success',
        tool_call_id: prepared.toolCallId,
      });
    },
    {
      name: TASK_TOOL_NAME,
      description: options.description ?? TASK_TOOL_DESCRIPTION,
      schema: TaskToolInputSchema,
    },
  ));

  Object.defineProperty(taskTool, TASK_TOOL_OPTIONS, {
    value: {...options},
    enumerable: false,
    configurable: true,
    writable: false,
  });

  return taskTool;
}

export function readTaskToolOptions(tool: StructuredToolInterface): CreateTaskToolOptions | undefined {
  const record = tool as StructuredToolInterface & {[TASK_TOOL_OPTIONS]?: CreateTaskToolOptions};
  return record[TASK_TOOL_OPTIONS];
}

async function prepareTaskLaunch(input: PrepareTaskLaunchInput): Promise<PreparedTaskLaunch> {
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
