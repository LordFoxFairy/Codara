export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'subagent_wait';

export interface AppState {
  // Session
  sessionId: string;
  messages: Array<{role: string; content: unknown; id?: string}>;

  // Agent
  agentStatus: AgentStatus;
  currentTurn: number;
  errorMessage?: string;

  // UI
  inputMode: 'compose' | 'review' | 'confirm';
  expandedView: boolean;

  // Tools
  activeToolCount: number;
  permissionPending: boolean;

  // Subagents
  runningSubagentCount: number;
}

export function createInitialAppState(sessionId: string): AppState {
  return {
    sessionId,
    messages: [],
    agentStatus: 'idle',
    currentTurn: 0,
    inputMode: 'compose',
    expandedView: false,
    activeToolCount: 0,
    permissionPending: false,
    runningSubagentCount: 0,
  };
}
