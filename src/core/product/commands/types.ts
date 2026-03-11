import type {AgentResult, AgentState} from '@core/agents';
import type {AgentsFileOverview, AgentsFileScope} from '@core/sessions';

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
  source: CodaraCommandSource;
}

export type CodaraCommandSource =
  | {
      type: 'builtin';
    }
  | {
      type: 'skill';
      skillName: string;
      skillPath: string;
    };

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
  hydrate(): Promise<AgentState>;
  getAgentState(): AgentState;
  inspectAgentsFiles(): Promise<AgentsFileOverview>;
  ensureAgentsFileTarget(scope: AgentsFileScope): Promise<string>;
  invokePrompt(input: string): Promise<AgentResult>;
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
