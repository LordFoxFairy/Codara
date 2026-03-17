import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {McpRemoteServerConfig} from '../types';

/**
 * Create an HTTP transport for a remote MCP server.
 *
 * Tries StreamableHTTP first, falls back to SSE on failure.
 */
export async function createHttpTransport(config: McpRemoteServerConfig): Promise<Transport> {
  const url = new URL(config.url);
  const headers: Record<string, string> = config.headers ?? {};

  // Try StreamableHTTP first (preferred for bidirectional communication)
  try {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {headers: new Headers(headers)},
    });
    return transport;
  } catch {
    // Fall back to SSE
  }

  return new SSEClientTransport(url, {
    requestInit: {headers: new Headers(headers)},
  });
}
