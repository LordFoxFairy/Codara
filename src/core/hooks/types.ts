import {z} from 'zod';

// ── Hook Event Types ──

export type HookEventType =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'SubagentStop'
  | 'PreToolUse'
  | 'PostToolUse';

export const HOOK_EVENT_TYPES: readonly HookEventType[] = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreCompact', 'PostCompact',
  'Stop', 'SubagentStop',
  'PreToolUse', 'PostToolUse',
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

export type HookContext =
  | SessionStartContext
  | SessionEndContext
  | PromptSubmitContext
  | CompactContext
  | AgentStopContext
  | SubagentStopContext
  | ToolUseContext
  | ToolResultContext;

// ── Hook Output & Aggregated Results ──

export interface HookOutput {
  decision?: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  systemMessage?: string;
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
