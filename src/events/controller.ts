/**
 * Runtime events controller — the central hub for emitting and subscribing to
 * structured lifecycle events during an agent session.
 *
 * Events form a parent-child tree: turn → model / tool → review.
 * CLI and desktop UIs subscribe via `controller.subscribe()` to render live activity.
 *
 * Also provides a middleware factory (`createMiddleware()`) that instruments
 * the agent pipeline with automatic turn/model/tool event emission.
 */
import {randomUUID} from 'node:crypto';
import {
  createMiddleware,
  readExecutionMetadata,
} from '@core/pipeline-types';
import {parseReviewToolMessagePayload} from '@core/middleware/review';

import type {
  CodaraRuntimeEvent,
  CodaraRuntimeEventListener,
  CodaraRuntimeEventStatus,
  EmitRuntimeEventInput,
} from './types';
import {
  turnKey,
  toolKey,
  formatToolLabel,
  summarizeToolMessage,
  summarizePauseLabel,
} from './formatters';

/**
 * Session-scoped runtime event emitter.
 *
 * Maintains Maps of turn/model/tool root event IDs for parent-child linking.
 * Automatically prunes stale entries when maps exceed 1 000 entries.
 */
export class RuntimeEventsController {
  private readonly listeners = new Set<CodaraRuntimeEventListener>();
  private readonly turnRoots = new Map<string, string>();
  private readonly modelRoots = new Map<string, string>();
  private readonly toolRoots = new Map<string, string>();

  constructor(private readonly sessionId: string) {}

  subscribe(listener: CodaraRuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Remove oldest entries when Maps exceed the threshold to prevent unbounded growth. */
  private pruneStaleEntries(): void {
    const MAX_ENTRIES = 1000;
    for (const map of [this.turnRoots, this.modelRoots, this.toolRoots]) {
      if (map.size > MAX_ENTRIES) {
        const excess = map.size - MAX_ENTRIES;
        let count = 0;
        for (const key of map.keys()) {
          if (count++ >= excess) break;
          map.delete(key);
        }
      }
    }
  }

  emit(input: EmitRuntimeEventInput): CodaraRuntimeEvent {
    this.pruneStaleEntries();
    const event: CodaraRuntimeEvent = {
      id: input.id ?? randomUUID(),
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      kind: input.kind,
      phase: input.phase,
      status: input.status,
      label: input.label,
      ...(input.detail ? {detail: input.detail} : {}),
      ...(input.parentId ? {parentId: input.parentId} : {}),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[RuntimeEvents] Listener error:', error);
      }
    }

    return event;
  }

  commandStarted(label: string, detail?: string): string {
    const id = randomUUID();
    this.emit({
      id,
      kind: 'command',
      phase: 'start',
      status: 'running',
      label,
      detail,
    });
    return id;
  }

  commandFinished(parentId: string, status: CodaraRuntimeEventStatus, label: string, detail?: string): void {
    this.emit({
      kind: 'command',
      phase: 'end',
      status,
      label,
      detail,
      parentId,
    });
  }

  summaryStarted(label: string, detail?: string): string {
    const id = randomUUID();
    this.emit({
      id,
      kind: 'summary',
      phase: 'start',
      status: 'running',
      label,
      detail,
    });
    return id;
  }

  summaryFinished(parentId: string, status: CodaraRuntimeEventStatus, label: string, detail?: string): void {
    this.emit({
      kind: 'summary',
      phase: 'end',
      status,
      label,
      detail,
      parentId,
    });
  }

  reviewResumeStarted(label: string, detail?: string): string {
    const id = randomUUID();
    this.emit({
      id,
      kind: 'review',
      phase: 'start',
      status: 'running',
      label,
      detail,
    });
    return id;
  }

  reviewResumeFinished(parentId: string, status: CodaraRuntimeEventStatus, label: string, detail?: string): void {
    this.emit({
      kind: 'review',
      phase: 'end',
      status,
      label,
      detail,
      parentId,
    });
  }

  modelResponding(runId: string, turn: number): void {
    const parentId = this.modelRoots.get(`${runId}:${turn}`);
    if (!parentId) {
      return;
    }

    this.emit({
      kind: 'model',
      phase: 'update',
      status: 'running',
      label: 'Responding',
      parentId,
    });
  }

  createMiddleware() {
    return createMiddleware({
      name: 'RuntimeEventsMiddleware',
      beforeModel: (context) => {
        const execution = readExecutionMetadata(context);
        const currentTurnKey = turnKey(context);
        if (!this.turnRoots.has(currentTurnKey)) {
          const turnRootId = randomUUID();
          this.turnRoots.set(currentTurnKey, turnRootId);
          this.emit({
            id: turnRootId,
            kind: 'turn',
            phase: 'start',
            status: 'running',
            label: `Turn ${execution.turn}`,
          });
        }
      },
      wrapModelCall: async (context, handler) => {
        const currentTurnKey = turnKey(context);
        const modelRootId = randomUUID();
        this.modelRoots.set(currentTurnKey, modelRootId);
        this.emit({
          id: modelRootId,
          kind: 'model',
          phase: 'start',
          status: 'running',
          label: 'Thinking',
          parentId: this.turnRoots.get(currentTurnKey),
        });

        try {
          const response = await handler(context);
          this.emit({
            kind: 'model',
            phase: 'end',
            status: 'done',
            label: response.text?.trim() ? 'Model response ready' : 'Model step complete',
            parentId: modelRootId,
          });

          return response;
        } catch (error) {
          this.emit({
            kind: 'model',
            phase: 'end',
            status: 'error',
            label: 'Model step failed',
            detail: error instanceof Error ? error.message : String(error),
            parentId: modelRootId,
          });
          throw error;
        }
      },
      wrapToolCall: async (context, handler) => {
        const currentToolKey = toolKey(context);
        const toolRootId = randomUUID();
        this.toolRoots.set(currentToolKey, toolRootId);
        this.emit({
          id: toolRootId,
          kind: 'tool',
          phase: 'start',
          status: 'running',
          label: formatToolLabel(context),
          detail: context.toolCall.name,
          parentId: this.turnRoots.get(turnKey(context)),
        });

        try {
          const message = await handler(context);
          const reviewPayload = parseReviewToolMessagePayload(message.content);
          const status = reviewPayload?.type === 'review_pause'
            ? 'paused'
            : message.status === 'error'
              ? 'error'
              : 'done';
          this.emit({
            kind: 'tool',
            phase: 'end',
            status,
            label: status === 'paused' ? 'Tool waiting for approval' : status === 'error' ? 'Tool failed' : 'Tool completed',
            detail: summarizeToolMessage(message),
            parentId: toolRootId,
          });
          if (reviewPayload?.type === 'review_pause') {
            this.emit({
              kind: 'review',
              phase: 'start',
              status: 'paused',
              label: summarizePauseLabel(reviewPayload.request.description),
              detail: reviewPayload.request.action.toolName,
              parentId: toolRootId,
            });
          }

          this.toolRoots.delete(currentToolKey);
          return message;
        } catch (error) {
          this.emit({
            kind: 'tool',
            phase: 'end',
            status: 'error',
            label: 'Tool failed',
            detail: error instanceof Error ? error.message : String(error),
            parentId: toolRootId,
          });
          this.toolRoots.delete(currentToolKey);
          throw error;
        }
      },
      afterAgent: (context) => {
        const currentTurnKey = turnKey(context);
        const turnRootId = this.turnRoots.get(currentTurnKey);
        this.emit({
          kind: 'turn',
          phase: 'end',
          status: context.result.reason === 'error' ? 'error' : context.result.reason === 'continue' ? 'running' : 'done',
          label: context.result.reason === 'error'
            ? `Turn ${context.result.turns} failed`
            : context.result.reason === 'continue'
              ? `Turn ${context.result.turns} continuing`
              : `Turn ${context.result.turns} complete`,
          ...(turnRootId ? {parentId: turnRootId} : {}),
          ...(context.result.error?.message ? {detail: context.result.error.message} : {}),
        });
        this.turnRoots.delete(currentTurnKey);
        this.modelRoots.delete(currentTurnKey);
      },
    });
  }
}
