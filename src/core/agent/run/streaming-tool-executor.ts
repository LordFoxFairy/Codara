import type {ToolMessage} from '@langchain/core/messages';
import {isToolReadOnly} from '@integration/tool/builtin';

export type ToolProgressEvent = {
  toolCallId: string;
  toolName: string;
  status: 'queued' | 'executing' | 'completed' | 'failed' | 'aborted';
  result?: ToolMessage;
  error?: string;
};

interface ToolCallDescriptor {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface TrackedTool {
  toolCall: ToolCallDescriptor;
  status: ToolProgressEvent['status'];
  result?: ToolMessage;
  error?: string;
}

/**
 * Executes a batch of tool calls with concurrency control:
 * - Read-only tools run in parallel (Phase 1)
 * - Writable tools run serially (Phase 2)
 * - Bash errors abort remaining sibling tools
 *
 * Emits progress events for UI streaming.
 */
export class StreamingToolExecutor {
  private tracked: TrackedTool[] = [];
  private abortController = new AbortController();
  private progressListeners = new Set<(event: ToolProgressEvent) => void>();

  addTool(toolCall: ToolCallDescriptor): void {
    this.tracked.push({toolCall, status: 'queued'});
  }

  onProgress(listener: (event: ToolProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async executeAll(context: {
    execute: (toolCall: ToolCallDescriptor) => Promise<ToolMessage>;
  }): Promise<ToolMessage[]> {
    const readOnly = this.tracked.filter(t => isToolReadOnly(t.toolCall));
    const serial = this.tracked.filter(t => !isToolReadOnly(t.toolCall));
    const results: ToolMessage[] = [];

    // Phase 1: Read-only tools in parallel
    if (readOnly.length > 0) {
      const parallel = readOnly.map(async (tracked) => {
        if (this.abortController.signal.aborted) {
          tracked.status = 'aborted';
          this.emit(tracked);
          return;
        }
        tracked.status = 'executing';
        this.emit(tracked);
        try {
          const result = await context.execute(tracked.toolCall);
          tracked.status = 'completed';
          tracked.result = result;
          this.emit(tracked);
          results.push(result);
        } catch (err) {
          tracked.status = 'failed';
          tracked.error = err instanceof Error ? err.message : String(err);
          this.emit(tracked);
        }
      });
      await Promise.allSettled(parallel);
    }

    // Phase 2: Serial (writable) tools one by one
    for (const tracked of serial) {
      if (this.abortController.signal.aborted) {
        tracked.status = 'aborted';
        this.emit(tracked);
        continue;
      }
      tracked.status = 'executing';
      this.emit(tracked);
      try {
        const result = await context.execute(tracked.toolCall);
        tracked.status = 'completed';
        tracked.result = result;
        this.emit(tracked);
        results.push(result);

        // Bash error → abort remaining siblings
        if (isBashTool(tracked.toolCall.name) && isErrorResult(result)) {
          this.abortController.abort('bash_error');
        }
      } catch (err) {
        tracked.status = 'failed';
        tracked.error = err instanceof Error ? err.message : String(err);
        this.emit(tracked);
        if (isBashTool(tracked.toolCall.name)) {
          this.abortController.abort('bash_error');
        }
      }
    }

    return results;
  }

  getStatus(): ToolProgressEvent[] {
    return this.tracked.map(t => ({
      toolCallId: t.toolCall.id,
      toolName: t.toolCall.name,
      status: t.status,
      result: t.result,
      error: t.error,
    }));
  }

  private emit(tracked: TrackedTool): void {
    const event: ToolProgressEvent = {
      toolCallId: tracked.toolCall.id,
      toolName: tracked.toolCall.name,
      status: tracked.status,
      result: tracked.result,
      error: tracked.error,
    };
    for (const listener of this.progressListeners) {
      try { listener(event); } catch { /* listener errors must not break execution */ }
    }
  }
}

function isBashTool(name: string): boolean {
  return name.toLowerCase().includes('bash');
}

function isErrorResult(result: ToolMessage): boolean {
  return (result as any).status === 'error' ||
    (typeof result.content === 'string' && result.content.includes('Error'));
}
