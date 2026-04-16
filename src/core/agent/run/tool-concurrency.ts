import type {ToolCall} from '@langchain/core/messages';
import {getToolMetadata, type ToolMetadata} from '@shared/tool-metadata';

/** @deprecated Use ToolMetadata from '@shared/tool-metadata' instead. */
export type ToolConcurrencyMeta = Pick<ToolMetadata, 'isReadOnly'>;

export interface PartitionedToolCalls {
  /** Read-only tools that can execute concurrently via Promise.all */
  readOnly: ToolCall[];
  /** Writable + separable tools that must execute serially */
  serial: ToolCall[];
}

/**
 * Partition tool calls into concurrent (read-only) and serial (writable) batches.
 * Read-only tools run in parallel for speed. All others run serially for safety.
 *
 * When a registry override is provided, it takes precedence over the global
 * tool-metadata registry (useful for tests). Otherwise, metadata is resolved
 * from the global registry with fail-closed defaults.
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  registry?: Map<string, ToolConcurrencyMeta>,
): PartitionedToolCalls {
  const readOnly: ToolCall[] = [];
  const serial: ToolCall[] = [];

  for (const call of toolCalls) {
    const isReadOnly = registry
      ? registry.get(call.name)?.isReadOnly ?? false
      : getToolMetadata(call.name).isReadOnly;

    if (isReadOnly) {
      readOnly.push(call);
    } else {
      serial.push(call);
    }
  }

  return {readOnly, serial};
}
