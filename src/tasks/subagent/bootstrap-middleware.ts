/**
 * Subagent activity middleware — emits per-tool-call notifications so the
 * parent session can render "worker X is running tool Y" updates while a
 * subagent is executing.
 *
 * Two flavors:
 *  - fresh-spawn: uses a caller-provided callback.
 *  - recovery: routes activity through a long-lived SubagentRunManager by runId.
 *
 * @module
 */

import {createMiddleware, type BaseMiddleware} from '@core/pipeline-types';
import {formatToolSummary} from '@shared/tool-display';
import type {ChildToolActivityCallback} from '@events';
import type {SubagentRunManager} from './run-manager';

export function createSubagentActivityMiddleware(callback: ChildToolActivityCallback): BaseMiddleware {
  return createMiddleware({
    name: 'SubagentActivityMiddleware',
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const label = buildActivityLabel(toolName, context.toolCall.args);
      try {
        callback({toolName, label});
      } catch {
        // Best-effort only.
      }
      return handler(context);
    },
  });
}

export function createRecoveredSubagentActivityMiddleware(
  runManager: SubagentRunManager,
  runId: string,
): BaseMiddleware {
  return createMiddleware({
    name: `SubagentRecoveryActivityMiddleware:${runId}`,
    wrapToolCall: async (context, handler) => {
      const toolName = context.toolCall.name ?? 'tool';
      const label = buildActivityLabel(toolName, context.toolCall.args);
      runManager.recordActivity(runId, {toolName, label});
      return handler(context);
    },
  });
}

function buildActivityLabel(toolName: string, args: unknown): string {
  const summary = shortenToolActivityLabel(formatToolSummary(toolName, args));
  return summary ? `${toolName}(${summary})` : toolName;
}

function shortenToolActivityLabel(value: string | undefined, max = 60): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
