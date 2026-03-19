import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {createStdioTransport} from './transport/stdio';
import {createHttpTransport} from './transport/http';
import type {McpClientInfo, McpClientStatus, McpServerConfig, McpToolDefinition} from './types';
import {DEFAULT_MCP_TIMEOUT} from './types';

/** Progress callback fired at the start and end of each MCP tool call. */
export type McpProgressCallback = (event: {
  phase: 'start' | 'end';
  toolName: string;
  serverName: string;
}) => void;

/**
 * McpClient wraps the MCP SDK Client for a single server connection.
 *
 * Handles connection lifecycle, tool discovery, and tool invocation.
 */
export class McpClient {
  private client: Client | undefined;
  private transport: Transport | undefined;
  private _status: McpClientStatus = 'disconnected';
  private _tools: McpToolDefinition[] = [];
  private _lastError: string | undefined;
  private readonly config: McpServerConfig;
  constructor(
    readonly name: string,
    config: McpServerConfig,
    _onProgress?: McpProgressCallback,
  ) {
    this.config = config;
    if (config.enabled === false) {
      this._status = 'disabled';
    }
  }

  get status(): McpClientStatus {
    return this._status;
  }

  get tools(): McpToolDefinition[] {
    return this._tools;
  }

  get info(): McpClientInfo {
    return {
      name: this.name,
      status: this._status,
      tools: [...this._tools],
      lastError: this._lastError,
    };
  }

  /**
   * Connect to the MCP server and discover tools.
   */
  async connect(): Promise<void> {
    if (this._status === 'disabled') return;

    this._status = 'connecting';
    const connectTimeout = this.config.timeout ?? DEFAULT_MCP_TIMEOUT;
    try {
      this.transport = await this.createTransport();
      this.client = new Client(
        {name: `codara-${this.name}`, version: '1.0.0'},
        {capabilities: {}},
      );

      await raceWithTimeout(
        this.client.connect(this.transport),
        connectTimeout,
        `MCP server "${this.name}" connection timed out after ${connectTimeout}ms`,
      );
      await this.discoverTools();
      this._status = 'connected';
      this._lastError = undefined;
    } catch (error) {
      this._status = 'failed';
      this._lastError = error instanceof Error ? error.message : String(error);
      try { await this.client?.close(); } catch { /* best effort cleanup */ }
      this.client = undefined;
      this.transport = undefined;
    }
  }

  /**
   * Call a tool on this server.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP server "${this.name}" is not connected (status: ${this._status})`);
    }

    const timeout = this.config.timeout ?? DEFAULT_MCP_TIMEOUT;
    return raceWithTimeout(
      this.client.callTool({name: toolName, arguments: args}),
      timeout,
      `MCP tool call "${toolName}" timed out after ${timeout}ms`,
    );
  }

  /**
   * Gracefully close the connection.
   */
  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // Best effort
    }
    this.client = undefined;
    this.transport = undefined;
    this._status = 'disconnected';
    this._tools = [];
  }

  private async createTransport(): Promise<Transport> {
    if (this.config.type === 'local') {
      return createStdioTransport(this.config);
    }
    return createHttpTransport(this.config);
  }

  private async discoverTools(): Promise<void> {
    if (!this.client) return;

    try {
      const response = await this.client.listTools();
      this._tools = (response.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
      }));
    } catch {
      this._tools = [];
    }
  }
}

/** Race a promise against a timeout, cleaning up the timer on completion. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
