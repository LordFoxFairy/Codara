import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {createStdioTransport} from './transport/stdio';
import {connectHttpTransport} from './transport/http';
import type {McpClientInfo, McpClientStatus, McpServerConfig, McpToolDefinition} from './types';
import {DEFAULT_MCP_TIMEOUT, MAX_MCP_DESCRIPTION_LENGTH, getMcpToolTimeoutMs} from './types';
import {raceWithTimeout} from './race-timeout';

/** Progress callback fired at the start and end of each MCP tool call. */
export type McpProgressCallback = (event: {
  phase: 'start' | 'end';
  toolName: string;
  serverName: string;
}) => void;

/**
 * Default maximum reconnection attempts for transient failures.
 */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

/**
 * McpClient wraps the MCP SDK Client for a single server connection.
 *
 * Handles connection lifecycle, tool discovery, tool invocation,
 * and automatic reconnection on transient failures.
 */
export class McpClient {
  private client: Client | undefined;
  private transport: Transport | undefined;
  private _status: McpClientStatus = 'disconnected';
  private _tools: McpToolDefinition[] = [];
  private _lastError: string | undefined;
  private readonly config: McpServerConfig;
  private reconnectAttempt = 0;

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
   *
   * For HTTP/remote servers, follows the MCP spec backwards-compatibility
   * pattern: try StreamableHTTP first, fall back to SSE on failure.
   * The probe happens at connection time (not constructor time) because
   * StreamableHTTP only fails on the first real POST request.
   */
  async connect(): Promise<void> {
    if (this._status === 'disabled') return;

    this._status = 'connecting';
    const connectTimeout = this.config.timeout ?? DEFAULT_MCP_TIMEOUT;
    const clientInfo = {name: `codara-${this.name}`, version: '1.0.0'};

    try {
      if (this.config.type === 'local') {
        // Stdio: create transport, then connect normally
        this.transport = createStdioTransport(this.config);
        this.client = new Client(clientInfo, {capabilities: {}});
        await raceWithTimeout(
          this.client.connect(this.transport),
          connectTimeout,
          `MCP server "${this.name}" connection timed out after ${connectTimeout}ms`,
        );
      } else {
        // HTTP: connectHttpTransport does StreamableHTTP->SSE fallback
        // and returns an already-connected client + transport pair
        const result = await connectHttpTransport(this.config, clientInfo, connectTimeout);
        this.client = result.client;
        this.transport = result.transport;
      }

      await this.discoverTools();
      this._status = 'connected';
      this._lastError = undefined;
      this.reconnectAttempt = 0;
    } catch (error) {
      this._status = 'failed';
      this._lastError = error instanceof Error ? error.message : String(error);
      try { await this.client?.close(); } catch { /* best effort cleanup */ }
      this.client = undefined;
      this.transport = undefined;
    }
  }

  /**
   * Attempt to reconnect after a transient failure.
   * Returns true if reconnection succeeded.
   */
  async reconnect(): Promise<boolean> {
    if (this._status === 'disabled') return false;
    if (this.reconnectAttempt >= DEFAULT_MAX_RECONNECT_ATTEMPTS) return false;

    this.reconnectAttempt++;

    // Clean up existing connection
    try { await this.client?.close(); } catch { /* best-effort */ }
    this.client = undefined;
    this.transport = undefined;

    await this.connect();
    return this._status === 'connected';
  }

  /**
   * Call a tool on this server.
   *
   * Uses the configurable MCP tool timeout (env: MCP_TOOL_TIMEOUT),
   * which defaults to ~27.8 hours (effectively infinite), matching Claude Code.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client || this._status !== 'connected') {
      throw new Error(`MCP server "${this.name}" is not connected (status: ${this._status})`);
    }

    const timeout = getMcpToolTimeoutMs();
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

  private async discoverTools(): Promise<void> {
    if (!this.client) return;

    try {
      const response = await this.client.listTools();
      this._tools = (response.tools ?? []).map((tool) => ({
        name: tool.name,
        description: truncateDescription(tool.description),
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
      }));
    } catch {
      this._tools = [];
    }
  }
}

/**
 * Truncate tool description to MAX_MCP_DESCRIPTION_LENGTH.
 * OpenAPI-generated MCP servers can dump huge descriptions (15-60KB).
 */
function truncateDescription(description: string | undefined): string | undefined {
  if (!description) return description;
  if (description.length <= MAX_MCP_DESCRIPTION_LENGTH) return description;
  return description.slice(0, MAX_MCP_DESCRIPTION_LENGTH - 3) + '...';
}
