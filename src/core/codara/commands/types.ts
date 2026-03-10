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
  filePath?: string;
}

export interface CodaraCommandHost {
  compactConversation(): Promise<AgentState>;
  compactCheckpoints(keepLast?: number): Promise<void>;
  getAgentState(): AgentState;
  inspectMemory(): Promise<{
    globalPath: string;
    projectPath: string;
    loadedPaths: string[];
  }>;
  ensureMemoryTarget(scope: 'global' | 'project'): Promise<string>;
  reloadSources(): void;
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
