import {describe, expect, it} from 'bun:test';
import {mcpCommand} from '@commands/builtin/mcp';
import type {CodaraCommandContext, CodaraCommandAgent} from '@commands/runtime/types';
import type {McpClientInfo} from '@mcp';

function createMockContext(overrides: Partial<CodaraCommandAgent> = {}): CodaraCommandContext {
  return {
    command: {raw: '/mcp', name: 'mcp', args: [], argsText: ''},
    registry: [],
    agent: {
      compactConversation: async () => ({} as never),
      compactCheckpoints: async () => {},
      updateContext: async () => ({} as never),
      getAvailableToolNames: () => [],
      hydrate: async () => ({} as never),
      getAgentState: () => ({} as never),
      getState: () => ({sessionId: 'test', sessionStatus: 'active'}),
      invoke: async () => ({} as never),
      reloadSources: async () => {},
      reset: async () => {},
      ...overrides,
    },
    environment: {},
  };
}

describe('/mcp command', () => {
  it('returns "no servers configured" when getMcpStatus is not available', async () => {
    const ctx = createMockContext();
    const result = await mcpCommand.execute(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('No MCP servers configured');
  });

  it('returns "no servers configured" when status list is empty', async () => {
    const ctx = createMockContext({getMcpStatus: () => []});
    const result = await mcpCommand.execute(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('No MCP servers configured');
  });

  it('lists connected servers with tool counts', async () => {
    const statuses: McpClientInfo[] = [
      {
        name: 'filesystem',
        status: 'connected',
        tools: [
          {name: 'read_file', inputSchema: {}},
          {name: 'write_file', inputSchema: {}},
        ],
      },
      {
        name: 'git',
        status: 'connected',
        tools: [
          {name: 'git_status', inputSchema: {}},
        ],
      },
    ];
    const ctx = createMockContext({getMcpStatus: () => statuses});
    const result = await mcpCommand.execute(ctx);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('[+] filesystem');
    expect(result.output).toContain('2 tools');
    expect(result.output).toContain('[+] git');
    expect(result.output).toContain('1 tool');
    expect(result.output).toContain('2/2 connected');
  });

  it('shows failed servers with error messages', async () => {
    const statuses: McpClientInfo[] = [
      {
        name: 'broken',
        status: 'failed',
        tools: [],
        lastError: 'Connection refused',
      },
      {
        name: 'ok',
        status: 'connected',
        tools: [{name: 't', inputSchema: {}}],
      },
    ];
    const ctx = createMockContext({getMcpStatus: () => statuses});
    const result = await mcpCommand.execute(ctx);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('[x] broken');
    expect(result.output).toContain('Connection refused');
    expect(result.output).toContain('1/2 connected');
  });

  it('shows disabled servers', async () => {
    const statuses: McpClientInfo[] = [
      {name: 'off', status: 'disabled', tools: []},
    ];
    const ctx = createMockContext({getMcpStatus: () => statuses});
    const result = await mcpCommand.execute(ctx);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('[-] off');
    expect(result.output).toContain('0/1 connected');
  });
});
