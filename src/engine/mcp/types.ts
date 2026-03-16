import {z} from 'zod';

// ── Server Configuration ──────────────────────────────────────────────

export const McpLocalServerConfigSchema = z.object({
  type: z.literal('local'),
  command: z.array(z.string()).min(1, 'command must have at least one element'),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional(),
});

export const McpRemoteServerConfigSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url('url must be a valid URL'),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
  enabled: z.boolean().optional(),
});

export const McpServerConfigSchema = z.union([
  McpLocalServerConfigSchema,
  McpRemoteServerConfigSchema,
]);

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema).default({}),
});

export type McpLocalServerConfig = z.infer<typeof McpLocalServerConfigSchema>;
export type McpRemoteServerConfig = z.infer<typeof McpRemoteServerConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

// ── Client Status ─────────────────────────────────────────────────────

export type McpClientStatus = 'connected' | 'connecting' | 'disconnected' | 'failed' | 'disabled';

export interface McpClientInfo {
  name: string;
  status: McpClientStatus;
  tools: McpToolDefinition[];
  lastError?: string;
}

// ── Tool ──────────────────────────────────────────────────────────────

export interface McpToolDefinition {
  /** Original tool name from the MCP server. */
  name: string;
  description?: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

// ── Manager ───────────────────────────────────────────────────────────

export interface McpManager {
  /** Initialize all configured servers (parallel, fail-isolated). */
  init(): Promise<void>;
  /** Get all tools from all connected servers. */
  getTools(): McpToolDefinition[];
  /** Call a tool on a specific server. */
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
  /** Get status of all servers. */
  status(): McpClientInfo[];
  /** Gracefully close all connections. */
  dispose(): Promise<void>;
}

/** Default timeout for MCP server connections (30 seconds). */
export const DEFAULT_MCP_TIMEOUT = 30_000;

/** Sanitize a name for use as a tool name prefix. */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
}

/** Create a namespaced tool name: `{server}_{tool}`. */
export function namespacedToolName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeToolName(serverName)}__${sanitizeToolName(toolName)}`;
}

/** Parse a namespaced tool name back to server + tool. */
export function parseNamespacedToolName(fullName: string): {serverName: string; toolName: string} | undefined {
  const match = fullName.match(/^mcp_(.+?)__(.+)$/);
  if (!match) return undefined;
  return {serverName: match[1], toolName: match[2]};
}
