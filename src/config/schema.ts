import {z} from 'zod';

// ── Permission mode ──────────────────────────────────────────────────

export const permissionModeSchema = z.enum([
  'default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk',
]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

// ── Permissions ──────────────────────────────────────────────────────

export const permissionsSchema = z.object({
  defaultMode: permissionModeSchema.optional(),
  alwaysAllow: z.array(z.string()).optional(),
  alwaysDeny: z.array(z.string()).optional(),
  alwaysAsk: z.array(z.string()).optional(),
  additionalDirectories: z.array(z.string()).optional(),
}).optional();

// ── Hooks ────────────────────────────────────────────────────────────

export const hookDefinitionSchema = z.object({
  matcher: z.object({
    toolName: z.union([z.string(), z.array(z.string())]).optional(),
    commandPattern: z.string().optional(),
  }).optional(),
  command: z.string().optional(),
  prompt: z.string().optional(),
  timeout: z.number().positive().optional(),
}).refine(
  (d) => d.command !== undefined || d.prompt !== undefined,
  {message: 'Hook must have either command or prompt'},
);

export const hookEventTypeSchema = z.enum([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'Stop',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'PostCompact',
  'PermissionRequest', 'TaskCreated', 'TaskCompleted',
  'ConfigChange', 'CwdChanged',
]);

export type HookEventType = z.infer<typeof hookEventTypeSchema>;

export const hooksSchema = z.record(
  hookEventTypeSchema,
  z.array(hookDefinitionSchema).optional(),
).optional();

// ── MCP servers ──────────────────────────────────────────────────────

export const mcpServerConfigSchema = z.object({
  type: z.enum(['stdio', 'sse']).optional().default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional().default(true),
});

// ── Top-level settings schema ────────────────────────────────────────
//
// Design notes (aligned with Claude Code SettingsSchema):
//   - All fields are optional — partial configs are valid.
//   - .passthrough() preserves unknown fields so future versions don't
//     reject configs written by newer versions.
//   - Env vars (CODARA_*) are a separate overlay handled by env.ts,
//     NOT embedded as a schema field. This differs from Claude Code's
//     `env: Record<string, string>` field which sets child-process env.

export const codaraSettingsSchema = z.object({
  // Core
  model: z.string().trim().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  defaultShell: z.enum(['bash', 'zsh', 'powershell']).optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),

  // Output & language
  outputStyle: z.string().optional(),
  language: z.string().optional(),

  // Environment variables injected into child processes (bash tool, hooks, etc.)
  env: z.record(z.string(), z.coerce.string()).optional(),

  // Permissions
  permissions: permissionsSchema,

  // Hooks
  hooks: hooksSchema,
  disableAllHooks: z.boolean().optional(),

  // MCP
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),

  // Skills & plugins
  skillSources: z.array(z.string()).optional(),
  plugins: z.object({
    installGlobal: z.boolean().optional(),
  }).optional(),

  // Attribution
  attribution: z.object({
    commit: z.string().optional(),
    pr: z.string().optional(),
  }).optional(),
  includeCoAuthoredBy: z.boolean().optional(),
  includeGitInstructions: z.boolean().optional(),

  // Session
  cleanupPeriodDays: z.number().nonnegative().int().optional(),
}).passthrough();

export type CodaraSettings = z.infer<typeof codaraSettingsSchema>;
