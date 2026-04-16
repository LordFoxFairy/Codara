/**
 * Runtime event types for Codara's observability layer.
 *
 * Events form a tree structure (parentId → child) and track the lifecycle of
 * turns, model calls, tool calls, reviews, commands, and summaries.
 * CLI and desktop UIs subscribe to these events to render live activity.
 */

/** Discriminator for the event source. */
export type CodaraRuntimeEventKind = 'turn' | 'model' | 'tool' | 'agent' | 'review' | 'command' | 'summary' | 'hook';

/** Lifecycle phase within a single event kind. */
export type CodaraRuntimeEventPhase = 'start' | 'update' | 'end';

/** Outcome status of an event. */
export type CodaraRuntimeEventStatus = 'running' | 'done' | 'paused' | 'error';

/** A single runtime event emitted by the agent pipeline or CLI layer. */
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

/** Subscriber callback for runtime events. */
export type CodaraRuntimeEventListener = (event: CodaraRuntimeEvent) => void;

/** Input shape for `RuntimeEventsController.emit()`. */
export interface EmitRuntimeEventInput {
  id?: string;
  kind: CodaraRuntimeEventKind;
  phase: CodaraRuntimeEventPhase;
  status: CodaraRuntimeEventStatus;
  label: string;
  detail?: string;
  parentId?: string;
}

/** Callback for child agent tool activity — injected into delegated child middleware. */
export type ChildToolActivityCallback = (info: {toolName: string; label: string}) => void;
