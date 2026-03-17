/**
 * A2ATransport — instance-level transport for cross-Codara communication.
 *
 * This class is NOT a TeamTransport. It does NOT handle intra-team messaging
 * between local members. Instead it connects one Codara instance (typically
 * the Team Leader's machine) to a *remote* Codara instance exposed via the
 * A2A protocol (see `CodaraA2AServer`).
 *
 * Topology:
 *   [Local Codara Instance]  ←─ A2ATransport ─→  [Remote Codara Instance]
 *
 * Intra-team messaging (leader ↔ local workers) uses LocalTransport / TransportRouter.
 */

export interface A2AConnectionConfig {
  url: string;
  authHeaders?: Record<string, string>;
}

interface PendingResult {
  status: 'pending' | 'completed' | 'failed';
  output?: string;
  error?: string;
}

/** Default request timeout in milliseconds (30 seconds). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Default poll interval in milliseconds (2 seconds). */
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** Default poll timeout in milliseconds (2 minutes). */
const DEFAULT_POLL_TIMEOUT_MS = 120_000;

/**
 * Generates a unique JSON-RPC request ID.
 */
function makeRequestId(): string {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class A2ATransport {
  private config: A2AConnectionConfig;
  private results = new Map<string, PendingResult>();
  private connected = true;

  constructor(config: A2AConnectionConfig) {
    this.config = config;
  }

  /**
   * Send a task to the remote Codara instance via A2A `message/send`.
   * Returns the remote task ID that can be polled with `getResult`.
   *
   * Makes a real HTTP POST using the JSON-RPC envelope. Includes a 30-second
   * timeout via AbortController so callers are never blocked indefinitely.
   *
   * @throws Error if the transport is disconnected.
   */
  async sendTask(task: { title: string; description: string }): Promise<string> {
    if (!this.connected) {
      throw new Error(`A2ATransport: not connected to ${this.config.url}`);
    }

    const requestId = makeRequestId();
    const body = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: requestId,
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: task.description }],
        },
        metadata: {
          title: task.title,
        },
      },
    };

    let json: Record<string, unknown>;
    try {
      json = await this.post(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`A2ATransport: sendTask failed — ${msg}`);
    }

    // Validate JSON-RPC response
    const result = json.result as
      | { id?: string; status?: { state?: string }; artifacts?: unknown[] }
      | undefined;

    if (json.error) {
      const rpcErr = json.error as { message?: string; code?: number };
      throw new Error(
        `A2ATransport: remote error ${rpcErr.code ?? '?'} — ${rpcErr.message ?? 'unknown'}`,
      );
    }

    if (!result?.id) {
      throw new Error('A2ATransport: malformed response — missing result.id');
    }

    const taskId = result.id;
    const state = result.status?.state;

    // Store initial status based on server response
    if (state === 'completed') {
      const output = this.extractArtifactText(result.artifacts);
      this.results.set(taskId, { status: 'completed', output });
    } else if (state === 'failed') {
      this.results.set(taskId, { status: 'failed', error: 'task failed on remote' });
    } else {
      this.results.set(taskId, { status: 'pending' });
    }

    return taskId;
  }

  /**
   * Poll the result of a previously submitted task via A2A `tasks/get`.
   *
   * - Returns `undefined` while the task is still working.
   * - Returns `{ output: string }` on completion.
   * - Returns `{ error: string }` on failure (never throws).
   */
  async getResult(taskId: string): Promise<{ output: string } | { error: string } | undefined> {
    const cached = this.results.get(taskId);
    if (!cached) throw new Error(`A2ATransport: unknown task ${taskId}`);

    // If already resolved locally, return immediately without an HTTP call.
    if (cached.status === 'completed') return { output: cached.output ?? '' };
    if (cached.status === 'failed') return { error: cached.error ?? 'unknown error' };

    // Still pending — ask the remote for an update.
    const requestId = makeRequestId();
    const body = {
      jsonrpc: '2.0',
      method: 'tasks/get',
      id: requestId,
      params: { id: taskId },
    };

    let json: Record<string, unknown>;
    try {
      json = await this.post(body);
    } catch {
      // Network errors should not crash the caller — return an error result.
      return { error: `A2ATransport: failed to poll task ${taskId}` };
    }

    if (json.error) {
      const rpcErr = json.error as { message?: string };
      const errResult: PendingResult = {
        status: 'failed',
        error: rpcErr.message ?? 'remote error',
      };
      this.results.set(taskId, errResult);
      return { error: errResult.error! };
    }

    const result = json.result as
      | { status?: { state?: string }; artifacts?: unknown[] }
      | undefined;

    const state = result?.status?.state;

    if (state === 'completed') {
      const output = this.extractArtifactText(result?.artifacts);
      this.results.set(taskId, { status: 'completed', output });
      return { output };
    }

    if (state === 'failed') {
      const error = 'task failed on remote';
      this.results.set(taskId, { status: 'failed', error });
      return { error };
    }

    // Still working — keep as pending.
    return undefined;
  }

  /**
   * Convenience method that polls `getResult` at regular intervals until the
   * task reaches a terminal state (completed / failed) or the timeout expires.
   *
   * @param taskId      - The task ID returned by `sendTask`.
   * @param intervalMs  - Polling interval in ms (default 2 000).
   * @param timeoutMs   - Maximum wait time in ms (default 120 000).
   * @returns The final result, or an error if the timeout is exceeded.
   */
  async pollResult(
    taskId: string,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  ): Promise<{ output: string } | { error: string }> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const result = await this.getResult(taskId);
      if (result !== undefined) return result;

      // Wait before polling again, but don't exceed the deadline.
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(intervalMs, remaining));
    }

    return { error: `A2ATransport: pollResult timed out after ${timeoutMs}ms for task ${taskId}` };
  }

  /** Disconnect from the remote instance and clear pending state. */
  disconnect(): void {
    this.connected = false;
    this.results.clear();
  }

  /** Whether the transport is currently connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /** The endpoint URL this transport is connected to. */
  getUrl(): string {
    return this.config.url;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Low-level POST helper — sends a JSON-RPC body to the configured endpoint
   * with auth headers and a 30-second abort timeout.
   */
  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.authHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = (await response.json()) as Record<string, unknown>;
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extract text content from A2A artifacts array.
   * Artifacts are arrays of objects that may contain `parts` with text.
   */
  private extractArtifactText(artifacts: unknown[] | undefined): string {
    if (!Array.isArray(artifacts) || artifacts.length === 0) return '';

    const parts: string[] = [];
    for (const artifact of artifacts) {
      const art = artifact as { parts?: Array<{ type?: string; text?: string }> };
      if (Array.isArray(art.parts)) {
        for (const part of art.parts) {
          if (part.type === 'text' && part.text) {
            parts.push(part.text);
          }
        }
      }
    }
    return parts.join('\n');
  }
}

/** Promise-based sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
