import type {AgentState} from '@core/agents';

export interface ParsedCodaraCommand {
  raw: string;
  name: string;
  args: string[];
  argsText: string;
}

export interface CodaraCommandSpec {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
}

export interface CodaraCommandResult {
  ok: boolean;
  command: string;
  output: string;
  state?: AgentState;
  action?: {
    type: 'open_file';
    path: string;
  };
}

export interface CodaraCommandHost {
  compactConversation(options?: {
    instructions?: string;
  }): Promise<AgentState>;
  compactCheckpoints(keepLast?: number): Promise<void>;
  getAgentState(): AgentState;
  inspectAgentsFiles(): Promise<{
    globalPath: string;
    projectPath: string;
    loadedPaths: string[];
  }>;
  ensureAgentsFileTarget(scope: 'global' | 'project'): Promise<string>;
  reloadSources(): Promise<void>;
  resumePause(payload: {
    decision: 'approve' | 'reject';
    feedback?: string;
  }): Promise<AgentState>;
}

export interface CodaraCommandContext {
  command: ParsedCodaraCommand;
  registry: readonly CodaraCommandDefinition[];
  host: CodaraCommandHost;
}

export interface CodaraCommandDefinition extends CodaraCommandSpec {
  execute(context: CodaraCommandContext): Promise<CodaraCommandResult> | CodaraCommandResult;
}
