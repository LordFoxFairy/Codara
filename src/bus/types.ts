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
  | { type: 'runtime_event'; sessionId: string; kind: string; label: string }
  | { type: 'done'; sessionId: string; requestId: string }
  | { type: 'error'; sessionId: string; requestId: string; message: string }
  | { type: 'paused'; sessionId: string; requestId: string; request: unknown; actions: unknown[] }
  // Response events
  | { type: 'sessions.list.result'; requestId: string; sessions: unknown[] }
  | { type: 'sessions.create.result'; requestId: string; sessionId: string }
  | { type: 'command.result'; requestId: string; output: string; ok: boolean }
  | { type: 'status.result'; requestId: string; data: unknown }
  // Lifecycle events (broadcast to ALL clients)
  | { type: 'client.joined'; clientId: ClientId; metadata?: Record<string, unknown> }
  | { type: 'client.left'; clientId: ClientId }
  | { type: 'session.updated'; sessionId: string }
  // Future: Teams
  | { type: 'agent.spawned'; agentId: string; sessionId: string; task: string }
  | { type: 'agent.completed'; agentId: string; sessionId: string }
  // Future: A2A federation
  | { type: 'a2a.forward'; from: string; to: string; payload: unknown }
  // Team lifecycle
  | { type: 'team.created'; data: { teamId: string; name: string; goal: string; depth: number } }
  | { type: 'team.running'; data: { teamId: string } }
  | { type: 'team.paused'; data: { teamId: string; reason: string } }
  | { type: 'team.completing'; data: { teamId: string } }
  | { type: 'team.completed'; data: { teamId: string; summary: string } }
  | { type: 'team.failed'; data: { teamId: string; error: string } }
  | { type: 'team.archived'; data: { teamId: string } }
  // Member lifecycle
  | { type: 'member.joined'; data: { teamId: string; memberId: string; name: string; role: string; mode: 'local' | 'remote' } }
  | { type: 'member.idle'; data: { teamId: string; memberId: string } }
  | { type: 'member.working'; data: { teamId: string; memberId: string; jobId: string } }
  | { type: 'member.paused'; data: { teamId: string; memberId: string } }
  | { type: 'member.disconnected'; data: { teamId: string; memberId: string; reason: string } }
  | { type: 'member.failed'; data: { teamId: string; memberId: string; error: string } }
  | { type: 'member.left'; data: { teamId: string; memberId: string; reason: string } }
  // Job lifecycle
  | { type: 'job.created'; data: { teamId: string; jobId: string; title: string; priority: number } }
  | { type: 'job.ready'; data: { teamId: string; jobId: string } }
  | { type: 'job.claimed'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.in_progress'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.submitted'; data: { teamId: string; jobId: string; memberId: string } }
  | { type: 'job.reviewed'; data: { teamId: string; jobId: string; approved: boolean; reviewerId: string } }
  | { type: 'job.done'; data: { teamId: string; jobId: string } }
  | { type: 'job.failed'; data: { teamId: string; jobId: string; error: string } }
  // Team message
  | { type: 'team.message'; data: { teamId: string; message: unknown } }
  // Budget
  | { type: 'team.budget.warning'; data: { teamId: string; usedPercent: number; remaining: number } }
  | { type: 'team.budget.exceeded'; data: { teamId: string; action: 'pause' | 'warn' | 'shutdown' } };

/** Client metadata for registration. */
export interface BusClientInfo {
  id: ClientId;
  name: string;
  type: 'cli' | 'desktop' | 'agent' | 'a2a';
  connectedAt: number;
  /** Sessions this client is subscribed to. */
  subscriptions: Set<string>;
}

/** Bus configuration. */
export interface BusConfig {
  cwd?: string;
  port?: number;
}
