import type {CodaraCommandDefinition} from '@commands/runtime/types';
import type {McpClientStatus} from '@mcp';
import {BUILTIN_SOURCE} from './formatters';

const STATUS_ICON: Record<McpClientStatus, string> = {
  connected: '+',
  connecting: '~',
  disconnected: '-',
  failed: 'x',
  disabled: '-',
};

export const mcpCommand: CodaraCommandDefinition = {
  name: 'mcp',
  usage: '/mcp',
  description: 'Show MCP server connection status and tool counts.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  execute({agent}) {
    const getMcpStatus = agent.getMcpStatus;
    if (!getMcpStatus) {
      return {
        ok: true,
        command: 'mcp',
        output: 'No MCP servers configured.',
      };
    }

    const statuses = getMcpStatus();
    if (statuses.length === 0) {
      return {
        ok: true,
        command: 'mcp',
        output: 'No MCP servers configured.',
      };
    }

    const lines: string[] = [`MCP servers: ${statuses.length} configured\n`];

    for (const server of statuses) {
      const icon = STATUS_ICON[server.status] ?? '?';
      const toolCount = server.tools.length;
      let line = `  [${icon}] ${server.name} — ${server.status}, ${toolCount} tool${toolCount === 1 ? '' : 's'}`;
      if (server.lastError) {
        line += ` (${server.lastError})`;
      }
      lines.push(line);
    }

    const connected = statuses.filter((s) => s.status === 'connected').length;
    lines.push('');
    lines.push(`Summary: ${connected}/${statuses.length} connected`);

    return {
      ok: true,
      command: 'mcp',
      output: lines.join('\n'),
    };
  },
};
