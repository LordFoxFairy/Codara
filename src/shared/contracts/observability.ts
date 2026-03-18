/**
 * Observability contracts — cross-context type definitions for events and hooks.
 */

export type {
  CodaraRuntimeEvent,
  CodaraRuntimeEventKind,
  CodaraRuntimeEventPhase,
  CodaraRuntimeEventStatus,
  CodaraRuntimeEventListener,
} from '@observability/events';

export type {
  HookEventType,
  HookDefinition,
  HookMatcher,
  HooksConfig,
} from '@observability/hook';
