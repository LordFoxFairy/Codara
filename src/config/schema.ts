import {z} from 'zod';

export const permissionModeSchema = z.enum([
  'default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk',
]);

export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionsSchema = z.object({
  defaultMode: permissionModeSchema.optional(),
  alwaysAllow: z.array(z.string()).optional(),
  alwaysDeny: z.array(z.string()).optional(),
  alwaysAsk: z.array(z.string()).optional(),
}).optional();

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
  'SessionStart', 'SessionEnd', 'PromptSubmit',
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

export const mcpServerConfigSchema = z.object({
  type: z.enum(['stdio', 'sse']).optional().default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional().default(true),
});

export const codaraSettingsSchema = z.object({
  model: z.string().trim().min(1).optional(),
  maxTurns: z.number().int().positive().optional(),
  defaultShell: z.enum(['bash', 'zsh', 'powershell']).optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),
  permissions: permissionsSchema,
  hooks: hooksSchema,
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
  skillSources: z.array(z.string()).optional(),
  plugins: z.object({
    installGlobal: z.boolean().optional(),
  }).optional(),
}).passthrough();

export type CodaraSettings = z.infer<typeof codaraSettingsSchema>;
