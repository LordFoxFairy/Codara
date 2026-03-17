import {describe, expect, it} from 'bun:test';
import {createMcpLangChainTools, type McpManager, type McpToolDefinition} from '@engine/mcp';

function createMockManager(tools: McpToolDefinition[]): McpManager {
  return {
    async init() {},
    getTools: () => tools,
    async callTool(_server: string, _tool: string, _args: Record<string, unknown>) {
      return {content: [{type: 'text', text: 'mock result'}]};
    },
    status: () => [],
    async dispose() {},
  };
}

describe('MCP tool adapter', () => {
  it('converts MCP tools to LangChain tools', () => {
    const manager = createMockManager([
      {
        name: 'mcp_server__read_file',
        description: '[server] Read a file',
        inputSchema: {
          type: 'object',
          properties: {path: {type: 'string', description: 'File path'}},
          required: ['path'],
        },
      },
    ]);

    const tools = createMcpLangChainTools(manager);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp_server__read_file');
    expect(tools[0].description).toBe('[server] Read a file');
  });

  it('creates tools that call through manager', async () => {
    let calledWith: {server: string; tool: string; args: Record<string, unknown>} | undefined;

    const manager: McpManager = {
      async init() {},
      getTools: () => [{
        name: 'mcp_fs__list',
        description: '[fs] List files',
        inputSchema: {type: 'object', properties: {dir: {type: 'string'}}, required: ['dir']},
      }],
      async callTool(server, tool, args) {
        calledWith = {server, tool, args};
        return {content: [{type: 'text', text: '/tmp/a.txt\n/tmp/b.txt'}]};
      },
      status: () => [],
      async dispose() {},
    };

    const tools = createMcpLangChainTools(manager);
    const result = await tools[0].invoke({dir: '/tmp'});

    expect(calledWith).toEqual({server: 'fs', tool: 'list', args: {dir: '/tmp'}});
    expect(result).toContain('/tmp/a.txt');
  });

  it('handles MCP error results gracefully', async () => {
    const manager: McpManager = {
      async init() {},
      getTools: () => [{
        name: 'mcp_bad__fail',
        inputSchema: {type: 'object', properties: {}},
      }],
      async callTool() {
        return {content: [{type: 'text', text: 'something went wrong'}], isError: true};
      },
      status: () => [],
      async dispose() {},
    };

    const tools = createMcpLangChainTools(manager);
    const result = await tools[0].invoke({});

    expect(result).toContain('[MCP Error]');
    expect(result).toContain('something went wrong');
  });

  it('handles tool call exceptions', async () => {
    const manager: McpManager = {
      async init() {},
      getTools: () => [{
        name: 'mcp_crash__boom',
        inputSchema: {type: 'object', properties: {}},
      }],
      async callTool() {
        throw new Error('connection lost');
      },
      status: () => [],
      async dispose() {},
    };

    const tools = createMcpLangChainTools(manager);
    const result = await tools[0].invoke({});

    expect(result).toContain('MCP tool error');
    expect(result).toContain('connection lost');
  });

  it('returns empty array when no MCP tools available', () => {
    const manager = createMockManager([]);
    const tools = createMcpLangChainTools(manager);
    expect(tools).toEqual([]);
  });
});
