import {spawn} from 'child_process';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {HumanMessage} from '@langchain/core/messages';
import type {HookDefinition, HookContextBase, HookOutput} from '@engine/hook/types';

const EMPTY_OUTPUT: HookOutput = {};

export interface HookExecutionStrategy {
  execute(hook: HookDefinition, context: HookContextBase): Promise<HookOutput>;
}

export interface HookExecutorDeps {
  projectRoot: string;
  createModel?: () => BaseChatModel;
}

// ── Strategy: Command ──

export class CommandExecutionStrategy implements HookExecutionStrategy {
  constructor(private deps: {projectRoot: string}) {}

  async execute(hook: HookDefinition, context: HookContextBase): Promise<HookOutput> {
    if (!hook.command) return EMPTY_OUTPUT;

    try {
      const stdout = await this.runCommand(hook.command, context, hook.timeout ?? 10000);
      return this.parseOutput(stdout);
    } catch {
      return EMPTY_OUTPUT; // fail-open: never block
    }
  }

  private runCommand(command: string, context: HookContextBase, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        CODARA_PROJECT_ROOT: this.deps.projectRoot,
        CODARA_SESSION_ID: context.sessionId,
        HOOK_EVENT: context.hookEvent,
      };

      const child = spawn('sh', ['-c', command], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let killed = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      // Write context as JSON to stdin
      const contextJson = JSON.stringify(context);
      child.stdin?.write(contextJson);
      child.stdin?.end();

      // Timeout: SIGTERM -> 2s grace -> SIGKILL
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 2000);
      }, timeout);

      child.on('close', (_code) => {
        clearTimeout(timer);
        if (killed) {
          reject(new Error('Hook timed out'));
        } else {
          resolve(stdout);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private parseOutput(stdout: string): HookOutput {
    const trimmed = stdout.trim();
    if (!trimmed) return EMPTY_OUTPUT;
    try {
      const parsed = JSON.parse(trimmed);
      return {
        decision: parsed.decision,
        updatedInput: parsed.updatedInput,
        systemMessage: parsed.systemMessage,
      };
    } catch {
      return EMPTY_OUTPUT;
    }
  }
}

// ── Strategy: Prompt ──

export class PromptExecutionStrategy implements HookExecutionStrategy {
  constructor(private createModel: () => BaseChatModel) {}

  async execute(hook: HookDefinition, context: HookContextBase): Promise<HookOutput> {
    if (!hook.prompt) return EMPTY_OUTPUT;

    try {
      const expandedPrompt = this.expandPrompt(hook.prompt, context);
      const model = this.createModel();

      const response = await Promise.race([
        model.invoke([new HumanMessage(expandedPrompt)]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Prompt hook timed out')), hook.timeout ?? 10000),
        ),
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseOutput(text);
    } catch {
      return EMPTY_OUTPUT;
    }
  }

  private expandPrompt(prompt: string, context: HookContextBase): string {
    let result = prompt;
    result = result.replace(/\$HOOK_EVENT/g, context.hookEvent);
    result = result.replace(/\$SESSION_ID/g, context.sessionId);

    // Tool-specific placeholders
    const record = context as unknown as Record<string, unknown>;
    if ('toolName' in context) {
      result = result.replace(/\$TOOL_NAME/g, String(record.toolName ?? ''));
      result = result.replace(/\$TOOL_INPUT/g, JSON.stringify(record.toolInput ?? {}));
    }
    if ('userPrompt' in context) {
      result = result.replace(/\$USER_PROMPT/g, String(record.userPrompt ?? ''));
    }

    return result;
  }

  private parseOutput(text: string): HookOutput {
    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY_OUTPUT;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        decision: parsed.decision,
        updatedInput: parsed.updatedInput,
        systemMessage: parsed.systemMessage,
      };
    } catch {
      return EMPTY_OUTPUT;
    }
  }
}

// ── Factory ──

export function createHookExecutor(
  hook: HookDefinition,
  deps: HookExecutorDeps,
): HookExecutionStrategy {
  if (hook.type === 'command') {
    return new CommandExecutionStrategy({projectRoot: deps.projectRoot});
  }
  if (!deps.createModel) {
    throw new Error('Prompt hook requires createModel dependency');
  }
  return new PromptExecutionStrategy(deps.createModel);
}
