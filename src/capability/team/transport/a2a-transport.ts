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
   * The real A2AClient HTTP call will be wired once agent-card verification
   * is in place. Currently returns a deterministic placeholder task ID.
   */
  async sendTask(task: { title: string; description: string }): Promise<string> {
    if (!this.connected) {
      throw new Error(`A2ATransport: not connected to ${this.config.url}`);
    }
    const taskId = `a2a-task-${Date.now()}`;
    this.results.set(taskId, { status: 'pending' });
    // TODO: POST to this.config.url with JSON-RPC message/send payload
    return taskId;
  }

  /**
   * Poll the result of a previously submitted task.
   * Returns undefined while the task is still pending.
   */
  async getResult(taskId: string): Promise<{ output: string } | { error: string } | undefined> {
    const result = this.results.get(taskId);
    if (!result) throw new Error(`A2ATransport: unknown task ${taskId}`);
    if (result.status === 'pending') return undefined;
    if (result.status === 'failed') return { error: result.error ?? 'unknown error' };
    return { output: result.output ?? '' };
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
}
