import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {McpConfigSchema, type McpConfig, type McpServerConfig} from './types';

/**
 * Load and merge MCP configuration from project + global sources.
 *
 * Precedence (later wins):
 *   1. Global: ~/.codara/mcp.json
 *   2. Project: .codara/mcp.json
 *
 * Environment variables in values are expanded: `${VAR}` → `process.env.VAR`.
 */
export async function loadMcpConfig(options: {
  projectRoot?: string;
  userHome?: string;
}): Promise<McpConfig> {
  const userHome = options.userHome ?? homedir();
  const sources: string[] = [
    path.join(userHome, '.codara', 'mcp.json'),
  ];
  if (options.projectRoot) {
    sources.push(path.join(options.projectRoot, '.codara', 'mcp.json'));
  }

  const merged: Record<string, McpServerConfig> = {};

  for (const source of sources) {
    const config = await loadConfigFile(source);
    if (config) {
      for (const [name, server] of Object.entries(config.mcpServers)) {
        merged[name] = server as McpServerConfig;
      }
    }
  }

  return {mcpServers: merged};
}

async function loadConfigFile(filePath: string): Promise<McpConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    const expanded = expandEnvVars(parsed);
    return McpConfigSchema.parse(expanded);
  } catch {
    return undefined;
  }
}

/**
 * Recursively expand `${VAR_NAME}` in string values.
 */
function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)}/g, (_, envVar: string) => process.env[envVar] ?? '');
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = expandEnvVars(val);
    }
    return result;
  }
  return value;
}
