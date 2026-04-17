import {describe, expect, it} from 'bun:test';
import {
  McpConfigSchema,
  McpLocalServerConfigSchema,
  McpRemoteServerConfigSchema,
  namespacedToolName,
  parseNamespacedToolName,
  sanitizeToolName,
} from '@mcp';

describe('MCP types', () => {
  describe('McpLocalServerConfigSchema', () => {
    it('accepts valid local config', () => {
      const result = McpLocalServerConfigSchema.safeParse({
        type: 'local',
        command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts config with env and cwd', () => {
      const result = McpLocalServerConfigSchema.safeParse({
        type: 'local',
        command: ['node', 'server.js'],
        env: {NODE_ENV: 'production'},
        cwd: '/opt/mcp',
        timeout: 60000,
        enabled: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.env).toEqual({NODE_ENV: 'production'});
        expect(result.data.enabled).toBe(false);
      }
    });

    it('rejects empty command array', () => {
      const result = McpLocalServerConfigSchema.safeParse({
        type: 'local',
        command: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('McpRemoteServerConfigSchema', () => {
    it('accepts valid remote config', () => {
      const result = McpRemoteServerConfigSchema.safeParse({
        type: 'remote',
        url: 'https://mcp.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('accepts config with headers', () => {
      const result = McpRemoteServerConfigSchema.safeParse({
        type: 'remote',
        url: 'https://mcp.example.com/api',
        headers: {Authorization: 'Bearer token123'},
        timeout: 10000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid URL', () => {
      const result = McpRemoteServerConfigSchema.safeParse({
        type: 'remote',
        url: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('McpConfigSchema', () => {
    it('accepts config with multiple servers', () => {
      const result = McpConfigSchema.safeParse({
        mcpServers: {
          filesystem: {
            type: 'local',
            command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
          'remote-api': {
            type: 'remote',
            url: 'https://mcp.example.com',
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(Object.keys(result.data.mcpServers)).toEqual(['filesystem', 'remote-api']);
      }
    });

    it('defaults to empty servers when mcpServers not provided', () => {
      const result = McpConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mcpServers).toEqual({});
      }
    });
  });

  describe('sanitizeToolName', () => {
    it('removes non-alphanumeric characters', () => {
      expect(sanitizeToolName('my-tool.v2')).toBe('my_tool_v2');
    });

    it('collapses multiple underscores', () => {
      expect(sanitizeToolName('my--tool..name')).toBe('my_tool_name');
    });

    it('strips leading and trailing underscores', () => {
      expect(sanitizeToolName('-tool-')).toBe('tool');
    });

    it('preserves alphanumeric and underscore', () => {
      expect(sanitizeToolName('my_tool_123')).toBe('my_tool_123');
    });
  });

  describe('namespacedToolName', () => {
    it('creates namespaced name', () => {
      expect(namespacedToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
    });

    it('sanitizes server and tool names', () => {
      expect(namespacedToolName('my-server', 'list.files')).toBe('mcp__my_server__list_files');
    });
  });

  describe('parseNamespacedToolName', () => {
    it('parses valid namespaced name', () => {
      const result = parseNamespacedToolName('mcp__filesystem__read_file');
      expect(result).toEqual({serverName: 'filesystem', toolName: 'read_file'});
    });

    it('returns undefined for non-MCP names', () => {
      expect(parseNamespacedToolName('read_file')).toBeUndefined();
      expect(parseNamespacedToolName('mcp_nodelimiter')).toBeUndefined();
      expect(parseNamespacedToolName('mcp__nodelimiter')).toBeUndefined();
    });

    it('roundtrips with namespacedToolName', () => {
      const full = namespacedToolName('server', 'tool');
      const parsed = parseNamespacedToolName(full);
      expect(parsed).toEqual({serverName: 'server', toolName: 'tool'});
    });
  });
});
