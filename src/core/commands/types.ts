import type {AgentResult, AgentState, ResumePayload} from '@core/agents';
import type {AgentResumeConfig} from '@core/agents';
import type {AgentsFileOverview, AgentsFileScope} from '@core/instructions/guidelines';
import type {CompactOptions} from '@core/checkpoint';

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

export interface CodaraCommandAgent {
  compactConversation(options?: {
    instructions?: string;
  }): Promise<AgentState>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  hydrate(): Promise<AgentState>;
  getAgentState(): AgentState;
  inspectAgentsFiles(): Promise<AgentsFileOverview>;
  ensureAgentsFileTarget(scope: AgentsFileScope): Promise<string>;
  invoke(input: string): Promise<AgentResult>;
  reloadSources(): Promise<void>;
  resumePause(payload: ResumePayload, config?: AgentResumeConfig): Promise<AgentResult>;
}

export interface CodaraCommandContext {
  command: ParsedCodaraCommand;
  registry: readonly CodaraCommandDefinition[];
  agent: CodaraCommandAgent;
}

export interface CodaraCommandDefinition extends CodaraCommandSpec {
  execute(context: CodaraCommandContext): Promise<CodaraCommandResult> | CodaraCommandResult;
}
