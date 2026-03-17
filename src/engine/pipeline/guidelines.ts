import {ToolMessage} from '@langchain/core/messages';
import {createMiddleware, type BaseMiddleware, type ToolCallContext, type ToolCallHandler} from '@engine/pipeline/types';
import type {ProgressiveInstructionSource} from '@infra/context/instructions/progressive-source';

/** Tools that access files and may trigger guideline discovery. */
const FILE_TOOL_NAMES = new Set(['read_file', 'edit_file', 'write_file', 'grep', 'glob']);

export interface GuidelinesMiddlewareOptions {
  guidelinesSource?: ProgressiveInstructionSource;
  promptSource?: ProgressiveInstructionSource;
}

/**
 * GuidelinesMiddleware — lazy loading of subdirectory AGENTS.md / codara.md.
 *
 * When file tools (read, edit, write, grep, glob) access files,
 * this middleware resolves nearby instruction files and appends
 * them as <system-reminder> to the tool result.
 *
 * Matches Claude Code's InstructionPrompt.resolve() behavior.
 */
export function createGuidelinesMiddleware(options: GuidelinesMiddlewareOptions): BaseMiddleware {
  return createMiddleware({
    name: 'GuidelinesMiddleware',

    async wrapToolCall(context: ToolCallContext, handler: ToolCallHandler): Promise<ToolMessage> {
      const result = await handler(context);

      // Only process file-related tools
      if (!FILE_TOOL_NAMES.has(context.toolCall.name)) {
        return result;
      }

      // Extract file path from tool args
      const filePath = extractFilePath(context.toolCall.name, context.toolCall.args);
      if (!filePath) {
        return result;
      }

      // Resolve nearby instruction files (AGENTS.md, codara.md)
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

      // Append as <system-reminder> to tool result (like Claude Code)
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
