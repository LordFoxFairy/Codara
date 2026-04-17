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
  url: z.url('url must be a valid URL'),
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

/**
 * Default timeout for MCP tool calls (~27.8 hours — effectively infinite).
 *
 * Matches Claude Code: MCP tools should not time out during normal operation;
 * external servers may legitimately run long-running tasks.
 * Override via `MCP_TOOL_TIMEOUT` environment variable (milliseconds).
 */
export const DEFAULT_MCP_TOOL_TIMEOUT = 100_000_000;

/** Get the configured MCP tool call timeout in milliseconds. */
export function getMcpToolTimeoutMs(): number {
  return parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10) || DEFAULT_MCP_TOOL_TIMEOUT;
}

/**
 * Cap on MCP tool descriptions sent to the model.
 * OpenAPI-generated MCP servers may dump 15-60KB of endpoint docs
 * into tool.description; this caps the p95 tail without losing intent.
 * Matches Claude Code's MAX_MCP_DESCRIPTION_LENGTH.
 */
export const MAX_MCP_DESCRIPTION_LENGTH = 2048;

/** Sanitize a name for use as a tool name prefix. */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
}

/**
 * Create a namespaced tool name: `mcp__{server}__{tool}`.
 *
 * Uses double underscore (`__`) as delimiter, matching Claude Code's convention.
 * Server and tool names are sanitized to be safe identifiers.
 */
export function namespacedToolName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeToolName(serverName)}__${sanitizeToolName(toolName)}`;
}

/**
 * Parse a namespaced tool name back to server + tool.
 *
 * Known limitation (shared with Claude Code): if a server name contains `__`,
 * parsing will be incorrect. This is rare in practice.
 */
export function parseNamespacedToolName(fullName: string): {serverName: string; toolName: string} | undefined {
  const parts = fullName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') return undefined;
  const serverName = parts[1];
  // Join remaining parts to preserve `__` in tool names
  const toolName = parts.slice(2).join('__');
  if (!serverName || !toolName) return undefined;
  return {serverName, toolName};
}
