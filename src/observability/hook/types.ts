/**
 * Hook system types — configuration schemas, runtime contexts, and lifecycle contracts.
 *
 * The hook pipeline is modeled after Claude Code's settings-based hook system:
 * - Hooks are defined in JSON config files (project, user, plugin, skill scope)
 * - Each hook targets a specific event type (SessionStart, PreToolUse, etc.)
 * - Intercept hooks can veto or modify input; notify hooks are fire-and-forget
 * - Execution strategies: shell command or LLM prompt
 *
 * @module observability/hook/types
 */
import {z} from 'zod';

// ── Hook Event Types ──

export type HookEventType =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PermissionRequest'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'ConfigChange'
  | 'CwdChanged';

export const HOOK_EVENT_TYPES: readonly HookEventType[] = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreCompact', 'PostCompact',
  'Stop', 'SubagentStart', 'SubagentStop',
  'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'TaskCreated', 'TaskCompleted',
  'ConfigChange', 'CwdChanged',
] as const;

// ── Hook Definition (Configuration) ──

export const hookMatcherSchema = z.object({
  toolName: z.union([z.string(), z.array(z.string())]).optional(),
  commandPattern: z.string().optional(),
});

export type HookMatcher = z.infer<typeof hookMatcherSchema>;

export const hookDefinitionSchema = z.object({
  type: z.enum(['command', 'prompt']),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().positive().optional().default(10000),
  matcher: hookMatcherSchema.optional(),
}).refine(
  (h) => (h.type === 'command' ? !!h.command : !!h.prompt),
  {message: 'command hook requires "command" field; prompt hook requires "prompt" field'},
);

export type HookDefinition = z.infer<typeof hookDefinitionSchema>;

export const hookGroupSchema = z.object({
  hooks: z.array(hookDefinitionSchema),
});

export type HookGroup = z.infer<typeof hookGroupSchema>;

export const hooksConfigSchema = z.object({
  description: z.string().optional(),
  hooks: z.record(
    // z.enum() requires a mutable [string, ...string[]] tuple; HOOK_EVENT_TYPES is readonly.
    // This cast is safe because HOOK_EVENT_TYPES is a compile-time constant with ≥1 element.
    z.enum(HOOK_EVENT_TYPES as unknown as [string, ...string[]]),
    z.array(hookGroupSchema).optional(),
  ).optional().default({}),
});

export type HooksConfig = z.infer<typeof hooksConfigSchema>;

// ── Hook Sources & Registry Entries ──

export type HookSource =
  | {kind: 'project'; path: string}
  | {kind: 'user'; path: string}
  | {kind: 'plugin'; pluginName: string; path: string}
  | {kind: 'skill'; skillName: string; path: string};

export interface HookEntry {
  definition: HookDefinition;
  eventType: HookEventType;
  source: HookSource;
  priority: number;
}

export function hookSourcePriority(source: HookSource): number {
  switch (source.kind) {
    case 'user': return 300;
    case 'project': return 200;
    case 'plugin': return 100;
    case 'skill': return 50;
  }
}

// ── Hook Context (Runtime) ──

export interface HookContextBase {
  sessionId: string;
  hookEvent: HookEventType;
  timestamp: string;
}

// Session layer
export interface SessionStartContext extends HookContextBase {
  hookEvent: 'SessionStart';
  cwd: string;
  sessionMetadata?: Record<string, unknown>;
}

export interface SessionEndContext extends HookContextBase {
  hookEvent: 'SessionEnd';
  reason: 'user_exit' | 'auto_exit' | 'error';
}

export interface PromptSubmitContext extends HookContextBase {
  hookEvent: 'UserPromptSubmit';
  userPrompt: string;
}

export interface CompactContext extends HookContextBase {
  hookEvent: 'PreCompact' | 'PostCompact';
  messageCount: number;
  estimatedTokens?: number;
}

// Agent layer
export interface AgentStopContext extends HookContextBase {
  hookEvent: 'Stop';
  reason: 'complete' | 'error';
  reachedMaxTurns: boolean;
  turns: number;
  lastMessage?: string;
}

export interface SubagentStartContext extends HookContextBase {
  hookEvent: 'SubagentStart';
  agentName: string;
  subagentType: string;
  prompt: string;
}

export interface SubagentStopContext extends HookContextBase {
  hookEvent: 'SubagentStop';
  agentName: string;
  taskId?: string;
  reason: string;
}

// Tool layer
export interface ToolUseContext extends HookContextBase {
  hookEvent: 'PreToolUse';
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ToolResultContext extends HookContextBase {
  hookEvent: 'PostToolUse';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: string;
  durationMs: number;
}

// Permission layer
export interface PermissionRequestContext extends HookContextBase {
  hookEvent: 'PermissionRequest';
  toolName: string;
  args: Record<string, unknown>;
  decision?: string;
}

// Task layer
export interface TaskCreatedContext extends HookContextBase {
  hookEvent: 'TaskCreated';
  taskId: string;
  subject: string;
  description?: string;
}

export interface TaskCompletedContext extends HookContextBase {
  hookEvent: 'TaskCompleted';
  taskId: string;
  subject: string;
  status: string;
}

// Config layer
export interface ConfigChangeContext extends HookContextBase {
  hookEvent: 'ConfigChange';
  changedFiles: string[];
}

export interface CwdChangedContext extends HookContextBase {
  hookEvent: 'CwdChanged';
  oldCwd: string;
  newCwd: string;
}

export type HookContext =
  | SessionStartContext
  | SessionEndContext
  | PromptSubmitContext
  | CompactContext
  | AgentStopContext
  | SubagentStartContext
  | SubagentStopContext
  | ToolUseContext
  | ToolResultContext
  | PermissionRequestContext
  | TaskCreatedContext
  | TaskCompletedContext
  | ConfigChangeContext
  | CwdChangedContext;

// ── Hook Output & Aggregated Results ──

/** Raw output returned by a single hook execution (command or prompt strategy). */
export interface HookOutput {
  /** Explicit allow/deny decision — "deny" vetoes the intercepted action. */
  decision?: 'allow' | 'deny';
  /** Partial input overrides to merge into the tool's arguments. */
  updatedInput?: Record<string, unknown>;
  /** System message injected into the next model context. */
  systemMessage?: string;
  /** When false, short-circuits the intercept chain (same effect as deny). */
  continue?: boolean;
}

export interface HookInterceptResult {
  vetoed: boolean;
  vetoReason?: string;
  modifiedInput?: Record<string, unknown>;
  systemMessages: string[];
}

export interface HookNotifyResult {
  systemMessages: string[];
}

export function emptyInterceptResult(): HookInterceptResult {
  return {vetoed: false, systemMessages: []};
}

export function emptyNotifyResult(): HookNotifyResult {
  return {systemMessages: []};
}

// ── Lifecycle Contract Interfaces (Interface Segregation) ──

export interface SessionLifecycleHooks {
  onSessionStart(ctx: SessionStartContext): Promise<HookNotifyResult>;
  onSessionEnd(ctx: SessionEndContext): Promise<HookNotifyResult>;
  onUserPromptSubmit(ctx: PromptSubmitContext): Promise<HookInterceptResult>;
  onPreCompact(ctx: CompactContext): Promise<HookInterceptResult>;
  onPostCompact(ctx: CompactContext): Promise<HookNotifyResult>;
}

export interface AgentLifecycleHooks {
  onStop(ctx: AgentStopContext): Promise<HookInterceptResult>;
  onSubagentStop(ctx: SubagentStopContext): Promise<HookInterceptResult>;
}

export interface ToolLifecycleHooks {
  onPreToolUse(ctx: ToolUseContext): Promise<HookInterceptResult>;
  onPostToolUse(ctx: ToolResultContext): Promise<HookNotifyResult>;
}

export interface ExtendedAgentLifecycleHooks {
  onSubagentStart(ctx: SubagentStartContext): Promise<HookNotifyResult>;
}

export interface PermissionLifecycleHooks {
  onPermissionRequest(ctx: PermissionRequestContext): Promise<HookInterceptResult>;
}

export interface TaskLifecycleHooks {
  onTaskCreated(ctx: TaskCreatedContext): Promise<HookNotifyResult>;
  onTaskCompleted(ctx: TaskCompletedContext): Promise<HookNotifyResult>;
}

export interface ConfigLifecycleHooks {
  onConfigChange(ctx: ConfigChangeContext): Promise<HookNotifyResult>;
  onCwdChanged(ctx: CwdChangedContext): Promise<HookNotifyResult>;
}
