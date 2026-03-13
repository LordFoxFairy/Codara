import type {AgentResult, AgentState} from '@core/agents';
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
  } | {
    type: 'resume_session';
    sessionId: string;
  };
}

export interface CodaraCommandAgent {
  compactConversation(options?: {
    instructions?: string;
  }): Promise<AgentState>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  getAvailableToolNames(): string[];
  hydrate(): Promise<AgentState>;
  getAgentState(): AgentState;
  getState(): {
    sessionId: string;
    sessionStatus: string;
    metadata?: {
      title?: string;
      lastMessage?: string;
      messageCount?: number;
      lastActivity?: string;
      usage?: {
        modelCalls?: number;
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      contextWindow?: {
        maxInputTokens: number;
        availableInputTokens: number;
        estimatedInputTokens: number;
        usagePercent: number;
        overBudget: boolean;
      };
    };
  };
  invoke(input: string): Promise<AgentResult>;
  reloadSources(): Promise<void>;
  reset(): Promise<void>;
}

export interface CodaraCommandEnvironment {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  modelAlias?: string;
}

export interface CodaraCommandContext {
  command: ParsedCodaraCommand;
  registry: readonly CodaraCommandDefinition[];
  agent: CodaraCommandAgent;
  environment: CodaraCommandEnvironment;
}

export interface CodaraCommandDefinition extends CodaraCommandSpec {
  execute(context: CodaraCommandContext): Promise<CodaraCommandResult> | CodaraCommandResult;
}
