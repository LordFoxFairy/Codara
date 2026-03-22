import {ToolMessage} from '@langchain/core/messages';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {resolveModel, type BootstrapAgentOptions} from '@core/agent/bootstrap';
import {CHILD_ACTIVITY_CALLBACK_KEY, type ChildToolActivityCallback} from '@observability/events';
import {
  createDelegatedAgentToolMessage,
  type DelegatedAgentResult,
} from '@capability/subagent/agent';
import type {SubagentDefinition} from '@context/skills/contracts';
import {formatSubagentDisplayName} from '@context/skills/runtime-shared';
import {filterToolsByReferences} from '@integration/tool';
import type {AgentRuntime} from '@capability/subagent/runtime';
import type {AgentRunRecord, AgentRunStore} from '@capability/subagent/types';
import {deepClone} from '@shared/clone';
import {formatToolSummary} from '@shared/tool-display';
import type {CreateAgentToolOptions} from '@capability/subagent/tool-types';

const AGENT_RUN_STORE_REBOUND = Symbol.for('codara.subagent.runStore.rebound');

export function resolveDefinitionTools(
  tools: StructuredToolInterface[],
  definition: SubagentDefinition,
): StructuredToolInterface[] {
  if (!definition.tools?.length) {
    return [...tools];
  }

  return filterToolsByReferences(tools, definition.tools);
}

export function readChildActivityCallback(runtimeShared: unknown): ChildToolActivityCallback | undefined {
  if (!runtimeShared || typeof runtimeShared !== 'object') {
    return undefined;
  }
  const shared = runtimeShared as Record<string, unknown>;
  const callback = shared[CHILD_ACTIVITY_CALLBACK_KEY];
  return typeof callback === 'function' ? callback as ChildToolActivityCallback : undefined;
}

export function resolveAgentRunId(
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

export function normalizeAgentName(subagentType: string | undefined, fallback: string): string {
  const agentName = formatSubagentDisplayName(subagentType) || fallback.trim();
  return agentName || 'Agent';
}

export function rebindAgentRunStore(runStore: AgentRunStore | undefined): AgentRunStore | undefined {
  if (!runStore) {
    return undefined;
  }

  const record = runStore as AgentRunStore & {[AGENT_RUN_STORE_REBOUND]?: boolean};
  if (record[AGENT_RUN_STORE_REBOUND]) {
    return record;
  }

  const list = runStore.list.bind(runStore);
  const get = runStore.get.bind(runStore);
  const start = runStore.start.bind(runStore);
  const update = runStore.update.bind(runStore);
  const resume = runStore.resume.bind(runStore);
  const pause = runStore.pause.bind(runStore);
  const finish = runStore.finish.bind(runStore);

  record.list = (...args) => list(...args);
  record.get = (...args) => get(...args);
  record.start = (...args) => start(...args);
  record.update = (...args) => update(...args);
  record.resume = (...args) => resume(...args);
  record.pause = (...args) => pause(...args);
  record.finish = (...args) => finish(...args);
  record[AGENT_RUN_STORE_REBOUND] = true;
  return record;
}

export function wrapDelegatedPrepareContext(
  prepareContext: CreateAgentToolOptions['prepareContext'],
  inheritedBaseMessageCount: number,
): CreateAgentToolOptions['prepareContext'] {
  if (!prepareContext) {
    return undefined;
  }

  return async (context) => {
    const preservedExtras = context.systemMessage.slice(inheritedBaseMessageCount);
    await prepareContext(context);
    if (preservedExtras.length > 0) {
      context.systemMessage.push(...preservedExtras);
    }
  };
}

export function readExistingAgentRunMessage(
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
  const parentSessionId = run.parentSessionId?.trim() || run.sessionId?.trim() || fallback.parentSessionId;
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

export async function buildRecoveredAgentChildOptions(
  options: CreateAgentToolOptions,
  runtime: AgentRuntime,
  run: AgentRunRecord,
): Promise<BootstrapAgentOptions | undefined> {
  if (!run.childSessionId) {
    return undefined;
  }

  const recoveryTools = filterRecoveredAgentTools(options.tools ?? [], run.toolNames);
  const recoveryMiddleware = [
    ...(options.middleware ?? []),
    createRecoveredAgentActivityMiddleware(runtime, run.runId),
  ];

  return {
    model: await resolveModel(options.model),
    agentType: 'subagent',
    ...(run.systemMessages?.length ? {systemMessage: [...run.systemMessages]} : {}),
    ...(recoveryTools.length > 0 ? {tools: recoveryTools} : {}),
    ...(recoveryMiddleware.length > 0 ? {middleware: recoveryMiddleware} : {}),
    handleToolErrors: options.handleToolErrors,
    checkpointer: options.checkpointer,
    inputBudget: options.inputBudget,
    prepareContext: options.prepareContext,
    ...(options.context ? {context: deepClone(options.context)} : {}),
    ...(options.values ? {values: deepClone(options.values)} : {}),
    ...(options.lifecycle ? {lifecycle: options.lifecycle} : {}),
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
