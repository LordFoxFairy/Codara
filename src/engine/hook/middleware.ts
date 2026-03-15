import {ToolMessage} from '@langchain/core/messages';
import type {BaseMiddleware, ToolCallContext, ToolCallHandler} from '@engine/pipeline/types';
import type {ToolLifecycleHooks} from '@engine/hook/types';

export class ToolHooksMiddleware implements BaseMiddleware {
  readonly name = 'ToolHooksMiddleware';

  constructor(private lifecycle: ToolLifecycleHooks) {}

  async wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
    // 1. PreToolUse — intercept chain
    const preResult = await this.lifecycle.onPreToolUse({
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
      context.runtime.shared = shared as any;
    }

    // 2. Execute tool
    const startMs = Date.now();
    const result = await handler(context);
    const durationMs = Date.now() - startMs;

    // 3. PostToolUse — notify (fire-and-forget)
    void this.lifecycle.onPostToolUse({
      hookEvent: 'PostToolUse',
      sessionId: context.execution.sessionId,
      toolName: context.toolCall.name,
      toolInput: (context.toolCall.args ?? {}) as Record<string, unknown>,
      toolResult: truncateForHook(String(result.content), 2000),
      durationMs,
      timestamp: new Date().toISOString(),
    });

    return result;
  }
}

function truncateForHook(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '... [truncated]';
}
