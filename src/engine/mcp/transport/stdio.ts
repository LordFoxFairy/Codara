import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {McpLocalServerConfig} from '../types';

/**
 * Create a stdio transport for a local MCP server.
 *
 * Spawns the command as a child process with stdin/stdout piped.
 */
export function createStdioTransport(config: McpLocalServerConfig): StdioClientTransport {
  const [command, ...args] = config.command;
  return new StdioClientTransport({
    command,
    args,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
      ...config.env,
    },
    cwd: config.cwd,
    // Note: timeout handled at callTool level, not transport level
  });
}
