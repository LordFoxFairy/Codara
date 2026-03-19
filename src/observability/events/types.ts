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
