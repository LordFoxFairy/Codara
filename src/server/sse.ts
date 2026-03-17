/**
 * SSE (Server-Sent Events) helper utilities for Codara HTTP server.
 *
 * Provides functions to create SSE-compatible Response objects and
 * format individual SSE frames from structured event data.
 */

export interface SSEEvent {
  event: string;
  data: unknown;
  id?: string;
}

/**
 * Format a single SSE frame string.
 *
 * Produces:
 *   event: <event>\n
 *   data: <json>\n\n
 */
export function formatSSE(event: SSEEvent): string {
  const lines: string[] = [];
  if (event.id) {
    lines.push(`id: ${event.id}`);
  }
  lines.push(`event: ${event.event}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/**
 * Create a streaming SSE Response from an async callback that writes events.
 *
 * The callback receives a `send` function and should call it for each event.
 * The stream closes automatically when the callback returns or throws.
 */
export function createSSEResponse(
  writer: (send: (event: SSEEvent) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const encoder = new TextEncoder();

      const send = (event: SSEEvent): void => {
        try {
          streamController.enqueue(encoder.encode(formatSSE(event)));
        } catch {
          // Stream already closed by client — ignore.
        }
      };

      try {
        await writer(send, controller.signal);
      } catch (error) {
        send({
          event: 'error',
          data: {message: error instanceof Error ? error.message : String(error)},
        });
      } finally {
        try {
          streamController.close();
        } catch {
          // Already closed.
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(),
    },
  });
}

/** Standard JSON response helper. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

/** Error JSON response. */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({error: message}, status);
}

/** CORS headers for local development (frontend on different port). */
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
