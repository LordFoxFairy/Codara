import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {loadMcpConfig} from '@integration/mcp';

describe('MCP config loading', () => {
  it('returns empty config when no files exist', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcp-config-'));
    const config = await loadMcpConfig({
      projectRoot: path.join(root, 'project'),
      userHome: path.join(root, 'home'),
    });
    expect(config.mcpServers).toEqual({});
  });

  it('loads global config from ~/.codara/mcp.json', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcp-config-'));
    const userHome = path.join(root, 'home');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await writeFile(
      path.join(userHome, '.codara', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          global_fs: {
            type: 'local',
            command: ['npx', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
        },
      }),
      'utf8',
    );

    const config = await loadMcpConfig({userHome});
    expect(config.mcpServers).toHaveProperty('global_fs');
    expect((config.mcpServers.global_fs as any).type).toBe('local');
  });

  it('merges project config over global config', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcp-config-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    await writeFile(
      path.join(userHome, '.codara', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          shared: {type: 'remote', url: 'https://global.example.com'},
          global_only: {type: 'remote', url: 'https://global-only.example.com'},
        },
      }),
      'utf8',
    );

    await writeFile(
      path.join(projectRoot, '.codara', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          shared: {type: 'remote', url: 'https://project.example.com'},
          project_only: {type: 'local', command: ['node', 'server.js']},
        },
      }),
      'utf8',
    );

    const config = await loadMcpConfig({projectRoot, userHome});

    // Project overrides global for 'shared'
    expect((config.mcpServers.shared as any).url).toBe('https://project.example.com');
    // Global-only server preserved
    expect(config.mcpServers).toHaveProperty('global_only');
    // Project-only server preserved
    expect(config.mcpServers).toHaveProperty('project_only');
  });

  it('expands environment variables in config values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcp-config-'));
    const userHome = path.join(root, 'home');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});

    process.env.TEST_MCP_TOKEN = 'secret123';
    try {
      await writeFile(
        path.join(userHome, '.codara', 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            api: {
              type: 'remote',
              url: 'https://mcp.example.com',
              headers: {Authorization: 'Bearer ${TEST_MCP_TOKEN}'},
            },
          },
        }),
        'utf8',
      );

      const config = await loadMcpConfig({userHome});
      expect((config.mcpServers.api as any).headers.Authorization).toBe('Bearer secret123');
    } finally {
      delete process.env.TEST_MCP_TOKEN;
    }
  });

  it('ignores malformed JSON files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mcp-config-'));
    const userHome = path.join(root, 'home');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await writeFile(path.join(userHome, '.codara', 'mcp.json'), '{invalid json', 'utf8');

    const config = await loadMcpConfig({userHome});
    expect(config.mcpServers).toEqual({});
  });
});
