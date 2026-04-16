import type {AgentResult, AgentState} from '@shared/contracts/agent-types';
import type {AgentRuntimeContext} from '@shared/contracts/agent-types';
import type {CompactOptions} from '@durability/checkpoint/types';
import type {ConversationCompactionResult} from '@durability/session';
import type {HookRegistry} from '@observability/hook/registry';
import type {CostSnapshot} from '@observability/cost';
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
  help?: CodaraCommandHelpMetadata;
}

export type CodaraCommandExecutionMode = 'runtime_command' | 'host_action' | 'agent_workflow';

export interface CodaraCommandHelpMetadata {
  executionMode: CodaraCommandExecutionMode;
  allowedTools?: string[];
  requiredShellCommands?: string[];
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
  } | {
    type: 'show_session_picker';
  } | {
    type: 'exit';
  };
}

export interface CodaraCommandAgent {
  compactConversation(options?: {
    instructions?: string;
  }): Promise<ConversationCompactionResult>;
  compactCheckpoints(options?: CompactOptions): Promise<void>;
  updateContext(context: AgentRuntimeContext): Promise<AgentState>;
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
  hookRegistry?: HookRegistry;
  getMcpStatus?(): import('@integration/mcp').McpClientInfo[];
  getCostSnapshot?(): CostSnapshot;
}

export interface CodaraCommandEnvironment {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  modelAlias?: string;
  /** 可用的模型别名列表（用于 /model 命令）。 */
  modelAliases?: string[];
  /** 切换模型的回调（用于 /model 命令）。 */
  onModelSwitch?: (alias: string) => Promise<void> | void;
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
