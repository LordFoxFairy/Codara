import {McpClient} from './client';
import type {McpClientInfo, McpConfig, McpManager, McpServerConfig, McpToolDefinition} from './types';
import {namespacedToolName, parseNamespacedToolName} from './types';

/**
 * Create an MCP manager that handles multiple server connections.
 *
 * Design principles (matching Claude Code):
 * - Lazy initialization: clients created on first init()
 * - Failure isolation: one server failing doesn't block others
 * - Tool namespacing: `mcp_{server}__{tool}` prevents name collisions
 * - Graceful cleanup: dispose() closes all connections + kills child processes
 */
export function createMcpManager(config: McpConfig): McpManager {
  const clients = new Map<string, McpClient>();

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    clients.set(name, new McpClient(name, serverConfig as McpServerConfig));
  }

  return {
    async init(): Promise<void> {
      const connectPromises = Array.from(clients.values())
        .filter((client) => client.status !== 'disabled')
        .map((client) => client.connect());

      // Parallel connect — failures are isolated per client
      await Promise.allSettled(connectPromises);
    },

    getTools(): McpToolDefinition[] {
      const tools: McpToolDefinition[] = [];
      for (const [serverName, client] of clients) {
        if (client.status !== 'connected') continue;
        for (const tool of client.tools) {
          tools.push({
            name: namespacedToolName(serverName, tool.name),
            description: tool.description ? `[${serverName}] ${tool.description}` : `[${serverName}] ${tool.name}`,
            inputSchema: tool.inputSchema,
          });
        }
      }
      return tools;
    },

    async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
      const client = clients.get(serverName);
      if (!client) {
        throw new Error(`MCP server "${serverName}" not found`);
      }
      return client.callTool(toolName, args);
    },

    status(): McpClientInfo[] {
      return Array.from(clients.values()).map((client) => client.info);
    },

    async dispose(): Promise<void> {
      await Promise.allSettled(
        Array.from(clients.values()).map((client) => client.close()),
      );
      clients.clear();
    },
  };
}

/**
 * Route a namespaced tool call to the correct MCP server.
 *
 * Given a full tool name like `mcp_filesystem__read_file`,
 * parses the server name and tool name, then calls the manager.
 */
export async function routeMcpToolCall(
  manager: McpManager,
  fullToolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const parsed = parseNamespacedToolName(fullToolName);
  if (!parsed) {
    throw new Error(`Invalid MCP tool name: ${fullToolName}`);
  }
  return manager.callTool(parsed.serverName, parsed.toolName, args);
}
