export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'subagent_wait';

export interface AppState {
  sessionId: string;
  agentStatus: AgentStatus;
  currentTurn: number;
  activeToolCount: number;
  runningSubagentCount: number;
  permissionPending: boolean;
  errorMessage?: string;
}

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

// Valid transitions map
const TRANSITIONS: Record<AgentStatus, Partial<Record<CliEvent['type'], AgentStatus>>> = {
  idle: {
    PROMPT_SUBMITTED: 'running',
  },
  running: {
    AGENT_COMPLETED: 'idle', // no subagents → idle
    AGENT_ERROR: 'error',
    PERMISSION_REQUESTED: 'paused',
    SUBAGENT_LAUNCHED: 'running', // stay running
    ALL_SUBAGENTS_COMPLETED: 'idle', // re-entry done
  },
  paused: {
    PERMISSION_RESOLVED: 'running',
    USER_CANCELLED: 'idle',
  },
  error: {
    ERROR_ACKNOWLEDGED: 'idle',
    RETRY: 'running',
  },
  subagent_wait: {
    SUBAGENT_COMPLETED: 'subagent_wait', // stay until all done
    ALL_SUBAGENTS_COMPLETED: 'running', // re-entry
    REENTRY_COMPLETED: 'idle',
    AGENT_ERROR: 'error',
  },
};

export function transition(state: AppState, event: CliEvent): AppState {
  const currentStatus = state.agentStatus;
  const validTransitions = TRANSITIONS[currentStatus];

  // Special case: running → subagent_wait when agent completes but subagents running
  if (event.type === 'AGENT_COMPLETED' && currentStatus === 'running' && state.runningSubagentCount > 0) {
    return {...state, agentStatus: 'subagent_wait'};
  }

  const nextStatus = validTransitions?.[event.type];
  if (!nextStatus) {
    // Invalid transition — return unchanged (fail-safe, don't crash)
    return state;
  }

  // Apply event-specific side effects
  switch (event.type) {
    case 'PROMPT_SUBMITTED':
      return {...state, agentStatus: nextStatus, currentTurn: state.currentTurn + 1, errorMessage: undefined};
    case 'AGENT_ERROR':
      return {...state, agentStatus: nextStatus, errorMessage: event.error};
    case 'PERMISSION_REQUESTED':
      return {...state, agentStatus: nextStatus, permissionPending: true};
    case 'PERMISSION_RESOLVED':
      return {...state, agentStatus: nextStatus, permissionPending: false};
    case 'SUBAGENT_LAUNCHED':
      return {...state, agentStatus: nextStatus, runningSubagentCount: state.runningSubagentCount + 1};
    case 'SUBAGENT_COMPLETED':
      return {...state, agentStatus: nextStatus, runningSubagentCount: Math.max(0, state.runningSubagentCount - 1)};
    case 'ALL_SUBAGENTS_COMPLETED':
      return {...state, agentStatus: nextStatus, runningSubagentCount: 0};
    case 'ERROR_ACKNOWLEDGED':
      return {...state, agentStatus: nextStatus, errorMessage: undefined};
    default:
      return {...state, agentStatus: nextStatus};
  }
}

export function isValidTransition(from: AgentStatus, eventType: CliEvent['type']): boolean {
  if (eventType === 'AGENT_COMPLETED' && from === 'running') return true; // special case
  return TRANSITIONS[from]?.[eventType] !== undefined;
}
