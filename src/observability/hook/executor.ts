import {spawn} from 'child_process';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {HumanMessage} from '@langchain/core/messages';
import type {HookDefinition, HookContextBase, HookOutput} from '@observability/hook/types';

const EMPTY_OUTPUT: HookOutput = {};

const DEFAULT_TIMEOUT = 10_000;

/**
 * Event-specific timeout overrides.
 * Cleanup and stop hooks get shorter timeouts to avoid blocking shutdown.
 */
const EVENT_TIMEOUT_OVERRIDES: Partial<Record<string, number>> = {
  SessionEnd: 1500,    // 1.5s for cleanup hooks
  Stop: 5000,          // 5s for stop hooks
  SubagentStop: 5000,  // 5s for subagent stop
};

/** Resolve the effective timeout for a hook execution. */
export function resolveTimeout(hook: HookDefinition, eventType: string): number {
  return hook.timeout ?? EVENT_TIMEOUT_OVERRIDES[eventType] ?? DEFAULT_TIMEOUT;
}

const MAX_COMMAND_LENGTH = 10_000;

/**
 * Lightweight validation for hook commands.
 * Hooks come from semi-trusted config files, so this is a safety net — not a sandbox.
 */
export function validateHookCommand(command: string): void {
  if (!command || command.trim().length === 0) {
    throw new Error('Hook command must not be empty');
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Hook command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`);
  }
  if (command.includes('\0')) {
    throw new Error('Hook command must not contain null bytes');
  }
}

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
      const stdout = await this.runCommand(hook.command, context, resolveTimeout(hook, context.hookEvent));
      return this.parseOutput(stdout);
    } catch {
      return EMPTY_OUTPUT; // fail-open: never block
    }
  }

  private runCommand(command: string, context: HookContextBase, timeout: number): Promise<string> {
    validateHookCommand(command);
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

      const response = await raceWithTimeout(
        model.invoke([new HumanMessage(expandedPrompt)]),
        resolveTimeout(hook, context.hookEvent),
        'Prompt hook timed out',
      );

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

    // Tool-specific placeholders — use `in` narrowing to access event-specific fields
    if ('toolName' in context) {
      const toolCtx = context as HookContextBase & {toolName: string; toolInput?: Record<string, unknown>};
      result = result.replace(/\$TOOL_NAME/g, toolCtx.toolName);
      result = result.replace(/\$TOOL_INPUT/g, JSON.stringify(toolCtx.toolInput ?? {}));
    }
    if ('userPrompt' in context) {
      const promptCtx = context as HookContextBase & {userPrompt: string};
      result = result.replace(/\$USER_PROMPT/g, promptCtx.userPrompt);
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

/** Race a promise against a timeout, cleaning up the timer on completion. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
