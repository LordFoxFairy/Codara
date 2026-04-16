/** MCP server initialization: config resolution, manager creation, tool wiring. */
import type {StructuredToolInterface} from '@langchain/core/tools';
import type {CodaraSettings} from '@config/schema';
import {loadMcpConfig, createMcpManager, createMcpLangChainTools, type McpManager, type McpConfig} from '@integration/mcp';

export interface McpInfrastructure {
  mcpManager?: McpManager;
  mcpTools: StructuredToolInterface[];
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
      ? {mcpServers: settings.mcpServers} as unknown as McpConfig
      : await loadMcpConfig({projectRoot, userHome}));

  if (Object.keys(mcpConfig.mcpServers).length === 0) {
    return {mcpTools: []};
  }

  const mcpManager = createMcpManager(mcpConfig);
  await mcpManager.init();
  const mcpTools = createMcpLangChainTools(mcpManager);
  return {mcpManager, mcpTools};
}
