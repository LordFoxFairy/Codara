import {ToolMessage} from '@langchain/core/messages';
import {
  createMiddleware,
  MIDDLEWARE_NAMES,
  type BaseMiddleware,
  type ToolCallContext,
  type ToolCallHandler,
} from '@core/pipeline/types';
import type {ProgressiveInstructionSource} from '@context/instructions/progressive-source';

/** Tools that access files and may trigger path-scoped instruction projection. */
const FILE_TOOL_NAMES = new Set(['read_file', 'edit_file', 'write_file', 'grep', 'glob']);

export interface PathInstructionsMiddlewareOptions {
  guidelinesSource?: ProgressiveInstructionSource;
  promptSource?: ProgressiveInstructionSource;
}

/**
 * Dynamic context bridge for path-scoped instructions.
 *
 * This middleware resolves nearby AGENTS.md / codara.md content after file
 * access and projects it back into the current turn as <system-reminder>.
 * It runs inside the unified pipeline chain, but it is not a permission or
 * security policy owner.
 */
export function createPathInstructionsMiddleware(
  options: PathInstructionsMiddlewareOptions,
): BaseMiddleware {
  return createMiddleware({
    name: MIDDLEWARE_NAMES.PathInstructions,

    async wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
      const result = await handler(context);

      if (!FILE_TOOL_NAMES.has(context.toolCall.name)) {
        return result;
      }

      const filePath = extractFilePath(context.toolCall.name, context.toolCall.args);
      if (!filePath) {
        return result;
      }

      const reminders: string[] = [];
      if (options.guidelinesSource) {
        const resolved = await options.guidelinesSource.resolve(filePath);
        if (resolved) {
          reminders.push(resolved);
        }
      }
      if (options.promptSource) {
        const resolved = await options.promptSource.resolve(filePath);
        if (resolved) {
          reminders.push(resolved);
        }
      }

      if (reminders.length === 0) {
        return result;
      }

      const reminder = `\n<system-reminder>\n${reminders.join('\n')}\n</system-reminder>`;
      const content = typeof result.content === 'string'
        ? result.content + reminder
        : Array.isArray(result.content)
          ? [...result.content, {type: 'text' as const, text: reminder}]
          : String(result.content) + reminder;

      return new ToolMessage({
        content,
        tool_call_id: result.tool_call_id,
        ...(result.name ? {name: result.name} : {}),
      });
    },
  });
}

function extractFilePath(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;

  switch (toolName) {
    case 'read_file':
    case 'edit_file':
    case 'write_file':
      return typeof record.file_path === 'string' ? record.file_path : undefined;
    case 'grep':
    case 'glob':
      return typeof record.path === 'string' ? record.path : undefined;
    default:
      return undefined;
  }
}
