import {describe, expect, it} from 'bun:test';
import {createMcpManager, namespacedToolName, parseNamespacedToolName, type McpConfig} from '@mcp';

describe('MCP manager', () => {
  it('creates a manager with empty config', () => {
    const manager = createMcpManager({mcpServers: {}});
    expect(manager.status()).toEqual([]);
    expect(manager.getTools()).toEqual([]);
  });

  it('reports disabled servers correctly', async () => {
    const config: McpConfig = {
      mcpServers: {
        disabled_server: {
          type: 'local',
          command: ['echo', 'hello'],
          enabled: false,
        },
      },
    };

    const manager = createMcpManager(config);
    await manager.init();

    const statuses = manager.status();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe('disabled_server');
    expect(statuses[0].status).toBe('disabled');
    expect(statuses[0].tools).toEqual([]);

    await manager.dispose();
  });

  it('isolates connection failures between servers', async () => {
    const config: McpConfig = {
      mcpServers: {
        bad_server: {
          type: 'local',
          command: ['nonexistent-binary-that-does-not-exist'],
        },
        disabled_server: {
          type: 'local',
          command: ['echo', 'hello'],
          enabled: false,
        },
      },
    };

    const manager = createMcpManager(config);
    await manager.init();

    const statuses = manager.status();
    const bad = statuses.find((s) => s.name === 'bad_server');
    const disabled = statuses.find((s) => s.name === 'disabled_server');

    expect(bad?.status).toBe('failed');
    expect(bad?.lastError).toBeDefined();
    expect(disabled?.status).toBe('disabled');

    await manager.dispose();
  });

  it('returns no tools when all servers are disconnected or failed', async () => {
    const config: McpConfig = {
      mcpServers: {
        bad: {type: 'local', command: ['nonexistent-binary']},
      },
    };

    const manager = createMcpManager(config);
    await manager.init();

    expect(manager.getTools()).toEqual([]);

    await manager.dispose();
  });

  it('throws when calling tool on unknown server', async () => {
    const manager = createMcpManager({mcpServers: {}});

    await expect(
      manager.callTool('nonexistent', 'some_tool', {}),
    ).rejects.toThrow('MCP server "nonexistent" not found');

    await manager.dispose();
  });

  it('cleans up after dispose', async () => {
    const config: McpConfig = {
      mcpServers: {
        test: {type: 'local', command: ['echo'], enabled: false},
      },
    };

    const manager = createMcpManager(config);
    await manager.init();
    expect(manager.status()).toHaveLength(1);

    await manager.dispose();
    expect(manager.status()).toEqual([]);
  });
});

describe('MCP tool routing', () => {
  it('roundtrips server+tool names through namespace', () => {
    const full = namespacedToolName('my_server', 'read_file');
    const parsed = parseNamespacedToolName(full);
    expect(parsed).toEqual({serverName: 'my_server', toolName: 'read_file'});
  });

  it('handles special characters in names', () => {
    const full = namespacedToolName('my-server.v2', 'list.files');
    expect(full).toBe('mcp__my_server_v2__list_files');

    const parsed = parseNamespacedToolName(full);
    expect(parsed?.serverName).toBe('my_server_v2');
    expect(parsed?.toolName).toBe('list_files');
  });
});
