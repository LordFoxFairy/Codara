import {randomUUID} from 'node:crypto';
import {
  createMiddleware,
  readExecutionMetadata,
} from '@core/pipeline/types';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import {readDelegatedAgentResult} from '@shared/delegation-result';
import {TOOL_NAMES} from '@shared/tool-display';

import type {
  CodaraRuntimeEvent,
  CodaraRuntimeEventListener,
  CodaraRuntimeEventStatus,
  EmitRuntimeEventInput,
  ChildToolActivityCallback,
} from './types';
import {
  turnKey,
  toolKey,
  formatToolLabel,
  formatTaskStartLabel,
  summarizeToolMessage,
  summarizeDelegatedTask,
  summarizePauseLabel,
} from './formatters';

/** Key used to store child activity callback in runtimeShared. */
export const CHILD_ACTIVITY_CALLBACK_KEY = '__taskActivityCallback';

export class RuntimeEventsController {
  private readonly listeners = new Set<CodaraRuntimeEventListener>();
  private readonly turnRoots = new Map<string, string>();
  private readonly modelRoots = new Map<string, string>();
  private readonly toolRoots = new Map<string, string>();
  /** Track pending task IDs (pre-registered before execution) to emit end events when real task starts. */
  private readonly pendingTaskIds = new Set<string>();

  constructor(private readonly sessionId: string) {}

  subscribe(listener: CodaraRuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(input: EmitRuntimeEventInput): CodaraRuntimeEvent {
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

  hilResumeStarted(label: string, detail?: string): string {
    const id = randomUUID();
    this.emit({
      id,
      kind: 'hil',
      phase: 'start',
      status: 'running',
      label,
      detail,
    });
    return id;
  }

  hilResumeFinished(parentId: string, status: CodaraRuntimeEventStatus, label: string, detail?: string): void {
    this.emit({
      kind: 'hil',
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

          // Pre-register pending Task tool calls so the panel shows all tasks immediately
          const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
          const taskCalls = toolCalls.filter((tc: {name?: string}) => tc.name === TOOL_NAMES.TASK);
          if (taskCalls.length > 1) {
            const turnId = this.turnRoots.get(currentTurnKey);
            for (let i = 0; i < taskCalls.length; i++) {
              const tc = taskCalls[i]!;
              const tcId = typeof tc.id === 'string' ? tc.id : `pending-task-${i}`;
              const args = tc.args as Record<string, unknown> | undefined;
              const subagentType = typeof args?.subagent_type === 'string' ? args.subagent_type : 'general-purpose';
              const prompt = typeof args?.prompt === 'string' ? args.prompt.split('\n')[0]!.slice(0, 50) : '';
              this.pendingTaskIds.add(tcId);
              this.emit({
                id: `pending-${tcId}`,
                kind: 'task',
                phase: 'start',
                status: 'running',
                label: `Delegating ${subagentType}: ${prompt}`,
                detail: 'pending',
                parentId: turnId,
              });
            }
          }

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

        if (context.toolCall.name === TOOL_NAMES.TASK) {
          // End the matching pending task event (pre-registered from afterModel)
          const tcId = typeof context.toolCall.id === 'string' ? context.toolCall.id : '';
          if (tcId && this.pendingTaskIds.has(tcId)) {
            this.pendingTaskIds.delete(tcId);
            this.emit({
              kind: 'task',
              phase: 'end',
              status: 'done',
              label: 'Task started',
              parentId: `pending-${tcId}`,
            });
          }

          const taskRootId = randomUUID();
          this.emit({
            id: taskRootId,
            kind: 'task',
            phase: 'start',
            status: 'running',
            label: formatTaskStartLabel(context.toolCall.args),
            parentId: toolRootId,
          });
          this.toolRoots.set(`${currentToolKey}:task`, taskRootId);

          // Inject child activity callback so delegated agent tool calls bubble up as task:update events
          const activityCallback: ChildToolActivityCallback = (info) => {
            this.emit({
              kind: 'task',
              phase: 'update',
              status: 'running',
              label: info.label,
              detail: info.toolName,
              parentId: taskRootId,
            });
          };
          if (context.runtime?.shared) {
            context.runtime.shared[CHILD_ACTIVITY_CALLBACK_KEY] = activityCallback;
          }
        }

        try {
          const message = await handler(context);
          const hilPayload = parseHILToolMessagePayload(message.content);
          const status = hilPayload?.type === 'hil_pause'
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

          if (context.toolCall.name === TOOL_NAMES.TASK) {
            const taskRootId = this.toolRoots.get(`${currentToolKey}:task`);
            const delegated = readDelegatedAgentResult(message.artifact);
            this.emit({
              kind: 'task',
              phase: 'end',
              status: delegated?.reason === 'error' ? 'error' : hilPayload?.type === 'hil_pause' ? 'paused' : 'done',
              label: delegated?.reason === 'error'
                ? 'Delegated task failed'
                : hilPayload?.type === 'hil_pause'
                  ? 'Delegated task waiting for review'
                  : 'Delegated task completed',
              detail: summarizeDelegatedTask(message),
              parentId: taskRootId,
            });
            this.toolRoots.delete(`${currentToolKey}:task`);
          }

          if (hilPayload?.type === 'hil_pause') {
            this.emit({
              kind: 'hil',
              phase: 'start',
              status: 'paused',
              label: summarizePauseLabel(hilPayload.request.description),
              detail: hilPayload.request.action.toolName,
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
          this.toolRoots.delete(`${currentToolKey}:task`);
          throw error;
        }
      },
      afterAgent: (context) => {
        const currentTurnKey = turnKey(context);
        const turnRootId = this.turnRoots.get(currentTurnKey);
        const modelRootId = this.modelRoots.get(currentTurnKey);
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
        if (modelRootId) {
          void modelRootId;
        }
      },
    });
  }
}
