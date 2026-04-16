/**
 * Tool hooks bridge — middleware adapter that connects the hook pipeline
 * to the agent's tool execution layer.
 *
 * Intercepts every tool call with PreToolUse (can veto or modify input),
 * then fires PostToolUse as a best-effort notification after execution.
 * Also detects task tool calls (create/update) and fires TaskCreated/TaskCompleted hooks.
 */
import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware, type ToolCallContext, type ToolCallHandler} from '@core/pipeline-types';
import type {TaskLifecycleHooks, ToolLifecycleHooks} from '@observability/hook/types';
import {TASK_CREATE_TOOL_NAME, TASK_UPDATE_TOOL_NAME} from '@capability/task/tools';

/** Create a middleware that bridges tool lifecycle hooks into the agent pipeline. */
export function createToolHooksBridge(lifecycle: ToolLifecycleHooks & Partial<TaskLifecycleHooks>): BaseMiddleware {
  return createMiddleware({
    name: 'ToolHooksMiddleware',

    async wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
      // 1. PreToolUse — intercept chain
      const preResult = await lifecycle.onPreToolUse({
        hookEvent: 'PreToolUse',
        sessionId: context.execution.sessionId,
        toolName: context.toolCall.name,
        toolInput: (context.toolCall.args ?? {}) as Record<string, unknown>,
        timestamp: new Date().toISOString(),
      });

      // Veto -> deny message
      if (preResult.vetoed) {
        return new ToolMessage({
          content: `Hook denied: ${preResult.vetoReason ?? 'Denied by hook'}`,
          tool_call_id: context.execution.toolCallId ?? context.toolCall.id ?? '',
        });
      }

      // Apply modified input
      if (preResult.modifiedInput) {
        context = {
          ...context,
          toolCall: {
            ...context.toolCall,
            args: {...(context.toolCall.args as Record<string, unknown>), ...preResult.modifiedInput},
          },
        };
      }

      // Store systemMessages in runtime.shared for next model call
      if (preResult.systemMessages.length > 0) {
        const shared = (context.runtime.shared ?? {}) as Record<string, unknown>;
        const existing = (shared.pendingHookMessages as string[]) ?? [];
        shared.pendingHookMessages = [...existing, ...preResult.systemMessages];
        context.runtime.shared = shared;
      }

      // 2. Execute tool
      const startMs = Date.now();
      const result = await handler(context);
      const durationMs = Date.now() - startMs;

      // 3. PostToolUse — notify (fire-and-forget, errors absorbed)
      lifecycle.onPostToolUse({
        hookEvent: 'PostToolUse',
        sessionId: context.execution.sessionId,
        toolName: context.toolCall.name,
        toolInput: (context.toolCall.args ?? {}) as Record<string, unknown>,
        toolResult: truncateForHook(String(result.content), 2000),
        durationMs,
        timestamp: new Date().toISOString(),
      }).catch(() => { /* PostToolUse hooks are best-effort */ });

      // 4. Task lifecycle hooks — fire-and-forget after task tool calls
      fireTaskHooks(lifecycle, context, result).catch(() => { /* Task hooks are best-effort */ });

      return result;
    },
  });
}

async function fireTaskHooks(
  lifecycle: ToolLifecycleHooks & Partial<TaskLifecycleHooks>,
  context: ToolCallContext,
  result: ToolMessage,
): Promise<void> {
  const toolName = context.toolCall.name;
  const args = (context.toolCall.args ?? {}) as Record<string, unknown>;
  const resultText = String(result.content);

  if (toolName === TASK_CREATE_TOOL_NAME && lifecycle.onTaskCreated) {
    const taskId = parseFieldFromResult(resultText, 'id');
    if (taskId) {
      await lifecycle.onTaskCreated({
        hookEvent: 'TaskCreated',
        sessionId: context.execution.sessionId,
        taskId,
        subject: String(args.subject ?? ''),
        description: args.description ? String(args.description) : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (toolName === TASK_UPDATE_TOOL_NAME && lifecycle.onTaskCompleted) {
    if (args.status === 'completed') {
      const taskId = String(args.taskId ?? '');
      const subject = parseFieldFromResult(resultText, 'subject') ?? '';
      if (taskId) {
        await lifecycle.onTaskCompleted({
          hookEvent: 'TaskCompleted',
          sessionId: context.execution.sessionId,
          taskId,
          subject,
          status: 'completed',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

function parseFieldFromResult(text: string, field: string): string | undefined {
  // Task result format: "- id: <value> | subject: <value> | ..."
  const pattern = new RegExp(`${field}:\\s*([^|\\n]+)`);
  const match = text.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function truncateForHook(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '... [truncated]';
}
