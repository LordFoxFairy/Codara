/**
 * Team API routes for the Desktop client.
 *
 * Thin HTTP layer over TeamRegistry / TeamRuntime / RemotePool.
 * Returns `null` for unmatched routes so the main router can fall through.
 */

import {jsonResponse, errorResponse, formatSSE, corsHeaders} from './sse';
import type {SSEEvent} from './sse';

// ── Dependency injection ─────────────────────────────────────────────

export interface TeamsApiDependencies {
  /** Resolve team registry instance (lazy — may not be available yet). */
  getTeamRegistry?: () => any;
  /** Resolve team runtime instance. */
  getTeamRuntime?: () => any;
  /** Resolve remote agent pool instance. */
  getRemotePool?: () => any;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Guard: return 503 if registry is not available. */
function requireRegistry(deps: TeamsApiDependencies): any | Response {
  const registry = deps.getTeamRegistry?.();
  if (!registry) {
    return errorResponse('Team system not initialized', 503);
  }
  return registry;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

// ── Handler factory ──────────────────────────────────────────────────

export function createTeamsApiHandler(deps: TeamsApiDependencies = {}) {
  /**
   * Match an incoming request against teams-related routes.
   * Returns a Response for matched routes, or `null` if the path is unrelated.
   */
  return async function handleTeamsRequest(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // ── REST: Team CRUD ────────────────────────────────────────────

    // GET /api/teams — List all teams
    if (method === 'GET' && path === '/api/teams') {
      const registry = requireRegistry(deps);
      if (isResponse(registry)) return registry;

      const status = url.searchParams.get('status') ?? undefined;
      const teams = registry.listTeams(status ? {status} : undefined);
      return jsonResponse({teams});
    }

    // POST /api/teams — Create a team
    if (method === 'POST' && path === '/api/teams') {
      const registry = requireRegistry(deps);
      if (isResponse(registry)) return registry;

      let body: {goal?: string; name?: string; config?: Record<string, unknown>};
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid request body');
      }

      if (!body.goal) {
        return errorResponse('Missing required field: goal');
      }

      try {
        const team = registry.createTeam({
          name: body.name ?? `team-${Date.now()}`,
          goal: body.goal,
          config: body.config,
        });
        return jsonResponse(team, 201);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 409);
      }
    }

    // ── SSE: Real-time event streams ───────────────────────────────
    // NOTE: SSE routes checked before :id catch-all to avoid regex conflicts.

    // GET /api/teams/events — All team events (global fan-out)
    if (method === 'GET' && path === '/api/teams/events') {
      return createTeamSSEResponse(deps);
    }

    // GET /api/teams/:id/events — Single team event stream
    const eventsMatch = path.match(/^\/api\/teams\/([^/]+)\/events$/);
    if (method === 'GET' && eventsMatch) {
      return createTeamSSEResponse(deps, eventsMatch[1]);
    }

    // GET /api/teams/:id — Team detail
    const teamDetailMatch = path.match(/^\/api\/teams\/([^/]+)$/);
    if (method === 'GET' && teamDetailMatch) {
      const registry = requireRegistry(deps);
      if (isResponse(registry)) return registry;

      const teamId = teamDetailMatch[1];
      const team = registry.getTeam(teamId);
      if (!team) {
        return errorResponse(`Team not found: ${teamId}`, 404);
      }
      return jsonResponse(team);
    }

    // ── REST: Team actions ─────────────────────────────────────────

    // POST /api/teams/:id/message — Send message to team
    const messageMatch = path.match(/^\/api\/teams\/([^/]+)\/message$/);
    if (method === 'POST' && messageMatch) {
      const runtime = deps.getTeamRuntime?.();
      if (!runtime) return errorResponse('Team runtime not initialized', 503);

      const teamId = messageMatch[1];
      let body: {content?: string; from?: string};
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid request body');
      }

      const transport = runtime.getTransport(teamId);
      if (!transport) {
        return errorResponse(`Team not started or transport unavailable: ${teamId}`, 404);
      }

      try {
        await transport.send('broadcast', {
          from: body.from ?? 'user',
          content: body.content ?? '',
          timestamp: new Date().toISOString(),
        });
        return jsonResponse({ok: true, teamId});
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
      }
    }

    // POST /api/teams/:id/pause
    const pauseMatch = path.match(/^\/api\/teams\/([^/]+)\/pause$/);
    if (method === 'POST' && pauseMatch) {
      const runtime = deps.getTeamRuntime?.();
      if (!runtime) return errorResponse('Team runtime not initialized', 503);

      const teamId = pauseMatch[1];
      try {
        runtime.pauseTeam(teamId);
        return jsonResponse({ok: true, teamId, action: 'paused'});
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
      }
    }

    // POST /api/teams/:id/resume
    const resumeMatch = path.match(/^\/api\/teams\/([^/]+)\/resume$/);
    if (method === 'POST' && resumeMatch) {
      const runtime = deps.getTeamRuntime?.();
      if (!runtime) return errorResponse('Team runtime not initialized', 503);

      const teamId = resumeMatch[1];
      try {
        runtime.resumeTeam(teamId);
        return jsonResponse({ok: true, teamId, action: 'resumed'});
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
      }
    }

    // POST /api/teams/:id/kill
    const killMatch = path.match(/^\/api\/teams\/([^/]+)\/kill$/);
    if (method === 'POST' && killMatch) {
      const runtime = deps.getTeamRuntime?.();
      if (!runtime) return errorResponse('Team runtime not initialized', 503);

      const teamId = killMatch[1];
      try {
        await runtime.killTeam(teamId);
        return jsonResponse({ok: true, teamId, action: 'killed'});
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500);
      }
    }

    // ── REST: Team sub-resources ───────────────────────────────────

    // GET /api/teams/:id/jobs — JobBoard state
    const jobsMatch = path.match(/^\/api\/teams\/([^/]+)\/jobs$/);
    if (method === 'GET' && jobsMatch) {
      const registry = requireRegistry(deps);
      if (isResponse(registry)) return registry;

      const teamId = jobsMatch[1];
      const board = registry.getJobBoard(teamId);
      const jobs = board.getAllJobs();
      const progress = board.getProgress();
      return jsonResponse({teamId, jobs, progress});
    }

    // GET /api/teams/:id/members — Member list
    const membersMatch = path.match(/^\/api\/teams\/([^/]+)\/members$/);
    if (method === 'GET' && membersMatch) {
      const registry = requireRegistry(deps);
      if (isResponse(registry)) return registry;

      const teamId = membersMatch[1];
      const members = registry.getMembersByTeam(teamId);
      return jsonResponse({teamId, members});
    }

    // GET /api/teams/:id/messages — Message history
    const messagesMatch = path.match(/^\/api\/teams\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesMatch) {
      // Message log not wired yet — return empty array.
      return jsonResponse({teamId: messagesMatch[1], messages: []});
    }

    // ── REST: Remote agent pool ────────────────────────────────────

    // GET /api/remotes
    if (method === 'GET' && path === '/api/remotes') {
      const pool = deps.getRemotePool?.();
      if (!pool) return jsonResponse({remotes: []});

      return jsonResponse({remotes: pool.listRemotes()});
    }

    // POST /api/remotes
    if (method === 'POST' && path === '/api/remotes') {
      const pool = deps.getRemotePool?.();
      if (!pool) return errorResponse('Remote pool not initialized', 503);

      let body: {name?: string; url?: string; capabilities?: string[]; auth?: Record<string, unknown>};
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid request body');
      }

      if (!body.name || !body.url) {
        return errorResponse('Missing required fields: name, url');
      }

      try {
        await pool.addRemote(body);
        return jsonResponse({ok: true, name: body.name}, 201);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 409);
      }
    }

    // DELETE /api/remotes/:name
    const deleteRemoteMatch = path.match(/^\/api\/remotes\/([^/]+)$/);
    if (method === 'DELETE' && deleteRemoteMatch) {
      const pool = deps.getRemotePool?.();
      if (!pool) return errorResponse('Remote pool not initialized', 503);

      const name = decodeURIComponent(deleteRemoteMatch[1]);
      try {
        await pool.removeRemote(name);
        return jsonResponse({ok: true, name, action: 'removed'});
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err), 404);
      }
    }

    // Not a teams API route — let the main router handle it.
    return null;
  };
}

// ── SSE helper ───────────────────────────────────────────────────────

/**
 * Create an SSE response that streams team events.
 *
 * When `teamId` is provided, events are filtered to that team only.
 * Subscribes to the TeamEventEmitter from the runtime; if no runtime
 * is available, keeps the connection alive with periodic heartbeats.
 */
function createTeamSSEResponse(deps: TeamsApiDependencies, teamId?: string): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial keep-alive comment (not a named event — just a connection probe).
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Track active subscriptions for cleanup.
      const unsubscribers: Array<() => void> = [];

      const runtime = deps.getTeamRuntime?.();

      if (runtime && teamId) {
        // Subscribe to a specific team's emitter.
        const emitter = runtime.getEmitter(teamId);
        if (emitter) {
          const unsub = emitter.subscribe((event: {type: string; data: {teamId?: string}}) => {
            try {
              const sse: SSEEvent = {event: event.type, data: event.data};
              controller.enqueue(encoder.encode(formatSSE(sse)));
            } catch {
              // Stream closed by client — cleanup will happen via cancel().
            }
          });
          unsubscribers.push(unsub);
        }
      } else if (runtime) {
        // Global fan-out: subscribe to all current team emitters.
        // Also poll for new teams periodically.
        const subscribedTeams = new Set<string>();

        const subscribeToTeam = (tid: string) => {
          if (subscribedTeams.has(tid)) return;
          const emitter = runtime.getEmitter(tid);
          if (!emitter) return;
          subscribedTeams.add(tid);
          const unsub = emitter.subscribe((event: {type: string; data: {teamId?: string}}) => {
            try {
              const sse: SSEEvent = {event: event.type, data: event.data};
              controller.enqueue(encoder.encode(formatSSE(sse)));
            } catch {
              // Stream closed.
            }
          });
          unsubscribers.push(unsub);
        };

        // Subscribe to all currently known teams.
        const registry = deps.getTeamRegistry?.();
        if (registry) {
          for (const team of registry.listTeams()) {
            subscribeToTeam(team.teamId);
          }
        }

        // Re-scan for new teams every 5 seconds.
        const scanInterval = setInterval(() => {
          const reg = deps.getTeamRegistry?.();
          if (reg) {
            for (const team of reg.listTeams()) {
              subscribeToTeam(team.teamId);
            }
          }
        }, 5_000);
        unsubscribers.push(() => clearInterval(scanInterval));
      }

      // Heartbeat every 30 s to keep proxies / load-balancers from closing the connection.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // Store cleanup function on the controller for the cancel() callback.
      (controller as any).__teamSSECleanup = () => {
        clearInterval(heartbeat);
        for (const unsub of unsubscribers) {
          unsub();
        }
      };
    },
    cancel(controller) {
      (controller as any)?.__teamSSECleanup?.();
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
