import {randomUUID} from 'node:crypto';
import type {ToolMessage} from '@langchain/core/messages';
import {
  createMiddleware,
  readExecutionMetadata,
  type BaseExecutionContext,
  type ToolCallContext,
} from '@engine/pipeline/types';
import {parseHILToolMessagePayload} from '@engine/pipeline/hil';
import {readDelegatedAgentResult} from '@shared/delegation-result';

export type CodaraRuntimeEventKind = 'turn' | 'model' | 'tool' | 'task' | 'hil' | 'command' | 'summary' | 'hook' | 'team';
export type CodaraRuntimeEventPhase = 'start' | 'update' | 'end';
export type CodaraRuntimeEventStatus = 'running' | 'done' | 'paused' | 'error';

export interface CodaraRuntimeEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  kind: CodaraRuntimeEventKind;
  phase: CodaraRuntimeEventPhase;
  status: CodaraRuntimeEventStatus;
  label: string;
  detail?: string;
  parentId?: string;
}

export type CodaraRuntimeEventListener = (event: CodaraRuntimeEvent) => void;

interface EmitRuntimeEventInput {
  id?: string;
  kind: CodaraRuntimeEventKind;
  phase: CodaraRuntimeEventPhase;
  status: CodaraRuntimeEventStatus;
  label: string;
  detail?: string;
  parentId?: string;
}

function turnKey(context: BaseExecutionContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}`;
}

function toolKey(context: ToolCallContext): string {
  const execution = readExecutionMetadata(context);
  return `${execution.runId}:${execution.turn}:${execution.toolCallId ?? context.toolCall.id ?? context.toolIndex}`;
}

function formatToolLabel(context: ToolCallContext): string {
  const name = context.toolCall.name ?? 'tool';
  const summary = formatToolSummary(name, context.toolCall.args);
  return summary ? `${formatToolDisplayName(name)}(${summary})` : formatToolDisplayName(name);
}

function formatToolSummary(toolName: string, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  switch (toolName) {
    case 'bash':
      return readString(record.command) ?? readString(record.description);
    case 'read_file':
    case 'read':
    case 'write_file':
    case 'write':
    case 'edit_file':
    case 'edit':
      return readString(record.file_path) ?? readString(record.path);
    case 'fetch_url':
    case 'fetch':
      return readString(record.url);
    case 'web_search':
    case 'search':
      return readString(record.query);
    case 'Task':
      return readString(record.subagent_type)
        ? `Delegating ${readString(record.subagent_type)}`
        : 'Delegating task';
    case 'TaskCreate':
    case 'TaskUpdate':
      return readString(record.subject) ?? readString(record.taskId);
    case 'AskUserQuestion':
      return readString(record.summary)
        ? `summary: ${readString(record.summary)}`
        : undefined;
    default:
      return undefined;
  }
}

function formatToolDisplayName(toolName: string): string {
  switch (toolName) {
    case 'bash':
      return 'Running Bash';
    case 'read_file':
    case 'read':
      return 'Reading';
    case 'write_file':
    case 'write':
      return 'Writing';
    case 'edit_file':
    case 'edit':
      return 'Editing';
    case 'fetch_url':
    case 'fetch':
      return 'Fetching';
    case 'web_search':
    case 'search':
      return 'Searching';
    case 'Task':
      return 'Delegating task';
    case 'TaskCreate':
      return 'Creating task';
    case 'TaskUpdate':
      return 'Updating task';
    case 'TaskList':
      return 'Listing tasks';
    case 'AskUserQuestion':
      return 'AskUserQuestion';
    default:
      return toolName;
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

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
      listener(event);
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
          const taskCalls = toolCalls.filter((tc: {name?: string}) => tc.name === 'Task');
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

        if (context.toolCall.name === 'Task') {
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

          if (context.toolCall.name === 'Task') {
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

function summarizeToolMessage(message: ToolMessage): string | undefined {
  if (typeof message.content !== 'string') {
    return undefined;
  }

  const trimmed = message.content.trim();
  return trimmed || undefined;
}

function summarizeDelegatedTask(message: ToolMessage): string | undefined {
  const delegated = readDelegatedAgentResult(message.artifact);
  if (!delegated) {
    return summarizeToolMessage(message);
  }

  const parts: string[] = [];
  if (delegated.summary?.trim()) {
    parts.push(delegated.summary.trim());
  }
  const statParts: string[] = [];
  if (delegated.toolUseCount && delegated.toolUseCount > 0) {
    statParts.push(`${delegated.toolUseCount} tool uses`);
  }
  if (delegated.totalTokens && delegated.totalTokens > 0) {
    statParts.push(`${formatDelegatedTokens(delegated.totalTokens)} tokens`);
  }
  if (statParts.length > 0) {
    parts.push(statParts.join(' · '));
  }
  return parts.join('\n') || summarizeToolMessage(message);
}

function formatDelegatedTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatTaskStartLabel(args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return 'Delegating task';
  }

  const record = args as Record<string, unknown>;
  const subagentType = readString(record.subagent_type);
  const prompt = readString(record.prompt);
  if (subagentType && prompt) {
    return `Delegating ${subagentType}: ${prompt}`;
  }
  if (subagentType) {
    return `Delegating ${subagentType}`;
  }
  if (prompt) {
    return `Delegating task: ${prompt}`;
  }
  return 'Delegating task';
}

function summarizePauseLabel(description: string): string {
  const trimmed = description.trim();
  return trimmed || 'Waiting for review';
}
