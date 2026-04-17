/** MCP server initialization: config resolution, manager creation, tool wiring. */
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {CodaraSettings} from '@config/schema';
import {loadMcpConfig, createMcpManager, createMcpLangChainTools, type McpManager, type McpConfig, type McpServerConfig} from '@mcp';

export interface McpInfrastructure {
  mcpManager?: McpManager;
  mcpTools: StructuredToolInterface[];
}

/** Convert settings-format MCP server entries to McpConfig. */
function toMcpConfig(
  servers: NonNullable<CodaraSettings['mcpServers']>,
): McpConfig {
  const mcpServers: Record<string, McpServerConfig> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (entry.enabled === false) continue;
    if (entry.type === 'sse' || entry.url) {
      if (!entry.url) continue;
      mcpServers[name] = {
        type: 'remote',
        url: entry.url,
        ...(entry.headers ? {headers: entry.headers} : {}),
        ...(entry.timeout ? {timeout: entry.timeout} : {}),
      };
    } else {
      const command = entry.command
        ? [entry.command, ...(entry.args ?? [])]
        : entry.args ?? [];
      if (command.length === 0) continue;
      mcpServers[name] = {
        type: 'local',
        command,
        ...(entry.env ? {env: entry.env} : {}),
        ...(entry.cwd ? {cwd: entry.cwd} : {}),
        ...(entry.timeout ? {timeout: entry.timeout} : {}),
      };
    }
  }
  return {mcpServers};
}

/** Initialize MCP servers: resolve config, create manager, extract LangChain tools. */
export async function initMcp(
  mcpOption: false | McpConfig | undefined,
  settings: CodaraSettings,
  projectRoot: string,
  userHome: string,
): Promise<McpInfrastructure> {
  if (mcpOption === false) {
    return {mcpTools: []};
  }

  const mcpConfig = mcpOption
    ?? (settings.mcpServers && Object.keys(settings.mcpServers).length > 0
      ? toMcpConfig(settings.mcpServers)
      : await loadMcpConfig({projectRoot, userHome}));

  if (Object.keys(mcpConfig.mcpServers).length === 0) {
    return {mcpTools: []};
  }

  const mcpManager = createMcpManager(mcpConfig);
  await mcpManager.init();
  const mcpTools = createMcpLangChainTools(mcpManager);
  return {mcpManager, mcpTools};
}
