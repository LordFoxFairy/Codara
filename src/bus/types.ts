/** Unique client identifier. */
export type ClientId = string;

/** Client -> Bus requests. */
export type BusRequest =
  | { type: 'chat'; requestId: string; prompt: string; sessionId?: string }
  | { type: 'resume'; requestId: string; sessionId: string; action: string; input?: string }
  | { type: 'command'; requestId: string; command: string }
  | { type: 'sessions.list'; requestId: string }
  | { type: 'sessions.create'; requestId: string; cwd?: string }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'unsubscribe'; sessionId: string }
  | { type: 'status'; requestId: string };

/** Bus -> Client events. */
export type BusEvent =
  // Streaming events (scoped to a session)
  | { type: 'token'; sessionId: string; text: string }
  | { type: 'thinking'; sessionId: string; text: string }
  | { type: 'tool_call'; sessionId: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; sessionId: string; name: string; output: string }
  | { type: 'runtime_event'; sessionId: string; kind: string; phase: string; status: string; label: string; detail?: string }
  | { type: 'done'; sessionId: string; requestId: string }
  | { type: 'error'; sessionId: string; requestId: string; message: string }
  | { type: 'review_required'; sessionId: string; requestId: string; request: unknown; actions: unknown[] }
  // Response events
  | { type: 'sessions.list.result'; requestId: string; sessions: unknown[] }
  | { type: 'sessions.create.result'; requestId: string; sessionId: string }
  | { type: 'command.result'; requestId: string; output: string; ok: boolean }
  | { type: 'status.result'; requestId: string; data: unknown }
  // Lifecycle events (broadcast to ALL clients)
  | { type: 'client.joined'; clientId: ClientId; metadata?: Record<string, unknown> }
  | { type: 'client.left'; clientId: ClientId }
  | { type: 'session.updated'; sessionId: string }
  | { type: 'agent.spawned'; agentId: string; sessionId: string; task: string }
  | { type: 'agent.completed'; agentId: string; sessionId: string };

/** Client metadata for registration. */
export interface BusClientInfo {
  id: ClientId;
  name: string;
  type: 'cli' | 'desktop' | 'agent';
  connectedAt: number;
  /** Sessions this client is subscribed to. */
  subscriptions: Set<string>;
}

/** Bus configuration. */
export interface BusConfig {
  cwd?: string;
  port?: number;
}
