/**
 * CLI event types for the interaction lifecycle.
 *
 * These events are dispatched by hooks during prompt submission, agent
 * completion, review resolution, etc. The dispatchEvent callback is
 * currently a no-op (the old state machine was replaced by CliRunState
 * in view-state.ts), but the type is retained so hooks can declare the
 * callback in their dependency interfaces.
 */

export type CliEvent =
  | {type: 'PROMPT_SUBMITTED'}
  | {type: 'AGENT_COMPLETED'}
  | {type: 'AGENT_ERROR'; error: string}
  | {type: 'PERMISSION_REQUESTED'}
  | {type: 'PERMISSION_RESOLVED'}
  | {type: 'USER_CANCELLED'}
  | {type: 'SUBAGENT_LAUNCHED'}
  | {type: 'SUBAGENT_COMPLETED'}
  | {type: 'ALL_SUBAGENTS_COMPLETED'}
  | {type: 'REENTRY_COMPLETED'}
  | {type: 'ERROR_ACKNOWLEDGED'}
  | {type: 'RETRY'};
