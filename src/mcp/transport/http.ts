import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {McpRemoteServerConfig} from '../types';
import {raceWithTimeout} from '../race-timeout';

export interface HttpTransportResult {
  transport: Transport;
  client: Client;
}

/**
 * Create an HTTP transport for a remote MCP server and connect a Client to it.
 *
 * Following the MCP spec for backwards compatibility (same pattern as
 * the official SDK example `streamableHttpWithSseFallbackClient`):
 *   1. Create a StreamableHTTP transport and attempt `client.connect()`.
 *   2. If the connection fails (runtime error from the POST initialize
 *      request), fall back to the deprecated SSE transport.
 *
 * The constructor of StreamableHTTPClientTransport never throws — the
 * actual HTTP request happens inside `client.connect()` → `transport.start()`
 * → first `send()`, so we must probe at the connection level.
 *
 * Returns both the connected Client and Transport so the caller can skip
 * its own `client.connect()` call for HTTP servers.
 */
export async function connectHttpTransport(
  config: McpRemoteServerConfig,
  clientInfo: {name: string; version: string},
  connectTimeoutMs: number,
): Promise<HttpTransportResult> {
  const url = new URL(config.url);
  const headers: Record<string, string> = config.headers ?? {};
  const requestInit = {headers: new Headers(headers)};

  // --- Attempt 1: StreamableHTTP (preferred, bidirectional) ---
  const streamableTransport = new StreamableHTTPClientTransport(url, {requestInit});
  const streamableClient = new Client(clientInfo, {capabilities: {}});

  try {
    await raceWithTimeout(
      streamableClient.connect(streamableTransport),
      connectTimeoutMs,
      `StreamableHTTP connection to "${config.url}" timed out`,
    );
    return {transport: streamableTransport, client: streamableClient};
  } catch {
    // Connection failed — clean up before trying SSE
    try { await streamableClient.close(); } catch { /* best-effort */ }
  }

  // --- Attempt 2: SSE fallback (deprecated but widely supported) ---
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SSE fallback needed for servers that don't support StreamableHTTP
  const sseTransport = new SSEClientTransport(url, {requestInit});
  const sseClient = new Client(clientInfo, {capabilities: {}});

  await raceWithTimeout(
    sseClient.connect(sseTransport),
    connectTimeoutMs,
    `SSE connection to "${config.url}" timed out`,
  );
  return {transport: sseTransport, client: sseClient};
}

