import type {ToolCall} from '@langchain/core/messages';

export interface ToolConcurrencyMeta {
  isReadOnly?: boolean;
}

export interface PartitionedToolCalls {
  /** Read-only tools that can execute concurrently via Promise.all */
  readOnly: ToolCall[];
  /** Writable + separable tools that must execute serially */
  serial: ToolCall[];
}

/**
 * Partition tool calls into concurrent (read-only) and serial (writable) batches.
 * Read-only tools run in parallel for speed. All others run serially for safety.
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
  registry: Map<string, ToolConcurrencyMeta>,
): PartitionedToolCalls {
  const readOnly: ToolCall[] = [];
  const serial: ToolCall[] = [];

  for (const call of toolCalls) {
    const meta = registry.get(call.name);
    if (meta?.isReadOnly) {
      readOnly.push(call);
    } else {
      serial.push(call);
    }
  }

  return {readOnly, serial};
}
