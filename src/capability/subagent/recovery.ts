import type {StructuredToolInterface} from '@langchain/core/tools';
import {z} from 'zod';
import {createAgentMemoryCheckpointer} from '@durability/checkpoint/agent';
import {resolveModel} from '@core/agent/bootstrap';
import {createMiddleware, type BaseMiddleware} from '@core/pipeline/types';
import {formatToolSummary} from '@shared/tool-display';
import type {ApprovalRecord} from '@durability/approval-store';
import {deepClone} from '@shared/clone';
import type {DelegatedAgentOptions} from '@capability/subagent/delegated-child';
import type {AgentRuntime, AgentRuntimeRecoverySpec} from '@capability/subagent/runtime';
import type {AgentRunRecord} from '@capability/subagent/types';

export async function buildRecoveredAgentChildOptions(
  options: DelegatedAgentOptions,
  runtime: AgentRuntime,
  run: AgentRunRecord,
  approval: ApprovalRecord | undefined,
): Promise<AgentRuntimeRecoverySpec | undefined> {
  const recovered = readRecoveredAgentRecoverySpec(approval);
  if (!recovered) {
    return undefined;
  }

  const recoveredTools = filterRecoveredAgentTools(options.tools ?? [], recovered.toolNames);
  return {
    childOptions: {
      model: await resolveModel(options.model),
      agentType: 'subagent',
      ...(recovered.systemMessages?.length ? {systemMessage: [...recovered.systemMessages]} : {}),
      ...(recoveredTools.length ? {tools: recoveredTools} : {}),
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
