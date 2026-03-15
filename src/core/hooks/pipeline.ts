import type {HookRegistry} from '@core/hooks/registry';
import type {HookExecutionStrategy} from '@core/hooks/executor';
import type {
  HookEventType,
  HookDefinition,
  HookContextBase,
  HookOutput,
  HookEntry,
  HookInterceptResult,
  HookNotifyResult,
  SessionLifecycleHooks,
  AgentLifecycleHooks,
  ToolLifecycleHooks,
  SessionStartContext,
  SessionEndContext,
  PromptSubmitContext,
  CompactContext,
  AgentStopContext,
  SubagentStopContext,
  ToolUseContext,
  ToolResultContext,
} from '@core/hooks/types';

export interface HookExecutorFactory {
  createStrategy(hook: HookDefinition): HookExecutionStrategy;
}

export class HookPipeline implements SessionLifecycleHooks, AgentLifecycleHooks, ToolLifecycleHooks {
  constructor(
    private registry: HookRegistry,
    private executorFactory: HookExecutorFactory,
    private emitEvent?: (label: string, phase: 'start' | 'end') => void,
  ) {}

  // ── Session Lifecycle ──

  async onSessionStart(ctx: SessionStartContext): Promise<HookNotifyResult> {
    return this.runNotify('SessionStart', ctx);
  }

  async onSessionEnd(ctx: SessionEndContext): Promise<HookNotifyResult> {
    return this.runNotify('SessionEnd', ctx);
  }

  async onUserPromptSubmit(ctx: PromptSubmitContext): Promise<HookInterceptResult> {
    return this.runInterceptChain('UserPromptSubmit', ctx);
  }

  async onPreCompact(ctx: CompactContext): Promise<HookInterceptResult> {
    return this.runInterceptChain('PreCompact', ctx);
  }

  async onPostCompact(ctx: CompactContext): Promise<HookNotifyResult> {
    return this.runNotify('PostCompact', ctx);
  }

  // ── Agent Lifecycle ──

  async onStop(ctx: AgentStopContext): Promise<HookInterceptResult> {
    return this.runInterceptChain('Stop', ctx);
  }

  async onSubagentStop(ctx: SubagentStopContext): Promise<HookInterceptResult> {
    return this.runInterceptChain('SubagentStop', ctx);
  }

  // ── Tool Lifecycle ──

  async onPreToolUse(ctx: ToolUseContext): Promise<HookInterceptResult> {
    return this.runInterceptChain('PreToolUse', ctx, {
      toolName: ctx.toolName,
      commandText: ctx.toolName === 'Bash' ? String(ctx.toolInput.command ?? '') : undefined,
    });
  }

  async onPostToolUse(ctx: ToolResultContext): Promise<HookNotifyResult> {
    return this.runNotify('PostToolUse', ctx);
  }

  // ── Chain of Responsibility (Intercept) ──

  private async runInterceptChain(
    eventType: HookEventType,
    context: HookContextBase,
    filter?: {toolName?: string; commandText?: string},
  ): Promise<HookInterceptResult> {
    const entries = filter
      ? this.registry.getMatchedHooks(eventType, filter)
      : this.registry.getHooks(eventType);

    const result: HookInterceptResult = {vetoed: false, systemMessages: []};

    for (const entry of entries) {
      try {
        this.emitEvent?.(this.hookLabel(entry), 'start');
        const strategy = this.executorFactory.createStrategy(entry.definition);
        const output = await strategy.execute(entry.definition, context);
        this.emitEvent?.(this.hookLabel(entry), 'end');

        this.applyOutput(output, result);

        if (output.decision === 'deny') {
          result.vetoed = true;
          result.vetoReason = output.systemMessage ?? `Denied by hook [${entry.source.kind}]`;
          break;
        }
      } catch {
        // Fail-open: treat as pass
        this.emitEvent?.(this.hookLabel(entry), 'end');
      }
    }

    return result;
  }

  // ── Observer (Notify) ──

  private async runNotify(
    eventType: HookEventType,
    context: HookContextBase,
  ): Promise<HookNotifyResult> {
    const entries = this.registry.getHooks(eventType);

    const settled = await Promise.allSettled(
      entries.map(async (entry) => {
        this.emitEvent?.(this.hookLabel(entry), 'start');
        const strategy = this.executorFactory.createStrategy(entry.definition);
        const output = await strategy.execute(entry.definition, context);
        this.emitEvent?.(this.hookLabel(entry), 'end');
        return output;
      }),
    );

    const systemMessages: string[] = [];
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value?.systemMessage) {
        systemMessages.push(s.value.systemMessage);
      }
    }

    return {systemMessages};
  }

  // ── Helpers ──

  private applyOutput(output: HookOutput, result: HookInterceptResult): void {
    if (output.systemMessage) {
      result.systemMessages.push(output.systemMessage);
    }
    if (output.updatedInput) {
      result.modifiedInput = {...result.modifiedInput, ...output.updatedInput};
    }
  }

  private hookLabel(entry: HookEntry): string {
    const cmd = entry.definition.command ?? entry.definition.prompt ?? '';
    const short = cmd.length > 40 ? cmd.slice(0, 37) + '...' : cmd;
    return `${entry.eventType} hook: ${short}`;
  }
}
