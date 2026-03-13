import type {GuidelinesSource} from '@core/context/instructions/guidelines';
import type {PromptSource} from '@core/context/instructions/prompt';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {createMiddleware, type BaseMiddleware} from '@core/middleware/types';

export interface InstructionLoadingMiddlewareOptions {
  promptSource?: Pick<PromptSource, 'activateTarget'>;
  guidelinesSource?: Pick<GuidelinesSource, 'activateTarget'>;
  name?: string;
}

export function createInstructionLoadingMiddleware(
  options: InstructionLoadingMiddlewareOptions,
): BaseMiddleware | undefined {
  if (!options.promptSource && !options.guidelinesSource) {
    return undefined;
  }

  return createMiddleware({
    name: options.name?.trim() || 'InstructionLoadingMiddleware',
    async wrapToolCall(context, handler) {
      const result = await handler(context);
      if (context.toolCall.name !== 'read_file' || result.status === 'error' || parseHILToolMessagePayload(result.content)) {
        return result;
      }

      const filePath = readInstructionReadPath(context.toolCall.args);
      if (!filePath) {
        return result;
      }

      await options.promptSource?.activateTarget({path: filePath, kind: 'file'});
      await options.guidelinesSource?.activateTarget({path: filePath, kind: 'file'});
      return result;
    },
  });
}

function readInstructionReadPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const filePath = typeof record.file_path === 'string' ? record.file_path.trim() : '';
  if (filePath) {
    return filePath;
  }

  const pathValue = typeof record.path === 'string' ? record.path.trim() : '';
  return pathValue || undefined;
}
