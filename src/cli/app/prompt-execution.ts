import type {CliRunState} from './view-state';

export interface RunCliPromptExecutionInput {
  rawPrompt: string;
  isRunning: boolean;
  setRunState: (state: CliRunState) => void;
  clearRuntimeEvents: () => void;
  clearCommandOutput: () => void;
  clearActiveTurn: () => void;
  runSlashCommand: (prompt: string) => Promise<void>;
  runAgentPrompt: (prompt: string) => Promise<void>;
  reportError: (error: unknown) => string;
  refreshCoreState: () => Promise<unknown>;
}

export interface RunCliPromptExecutionResult {
  started: boolean;
  prompt?: string;
  mode?: 'slash-command' | 'agent-prompt';
}

export function normalizeCliPrompt(rawPrompt: string): string {
  return rawPrompt.trim();
}

export function resolveCliPromptMode(prompt: string): 'slash-command' | 'agent-prompt' {
  return prompt.startsWith('/') ? 'slash-command' : 'agent-prompt';
}

// 这里专门负责“一个 prompt 发出去时，控制层要按什么顺序收尾”。
// controller 自己只保留锁和依赖注入，不再把整条执行链铺在一个 callback 里。
export async function runCliPromptExecution(input: RunCliPromptExecutionInput): Promise<RunCliPromptExecutionResult> {
  const prompt = normalizeCliPrompt(input.rawPrompt);
  if (!prompt || input.isRunning) {
    return {started: false};
  }

  const mode = resolveCliPromptMode(prompt);
  input.setRunState({status: 'running'});
  input.clearRuntimeEvents();
  input.clearCommandOutput();

  try {
    if (mode === 'slash-command') {
      await input.runSlashCommand(prompt);
    } else {
      await input.runAgentPrompt(prompt);
    }
  } catch (error) {
    input.clearActiveTurn();
    input.reportError(error);
    await input.refreshCoreState().catch(() => undefined);
  }

  return {
    started: true,
    prompt,
    mode,
  };
}
