/**
 * Team API routes for the Desktop client.
 *
 * Thin HTTP layer over TeamRegistry / TeamRuntime / RemotePool.
 * Returns `null` for unmatched routes so the main router can fall through.
 */

import {jsonResponse, errorResponse, createSSEResponse, corsHeaders} from './sse';

// ── Dependency injection ─────────────────────────────────────────────

export interface TeamsApiDependencies {
  /** Resolve team registry instance (lazy — may not be available yet). */
  getTeamRegistry?: () => any;
  /** Resolve team runtime instance. */
  getTeamRuntime?: () => any;
  /** Resolve remote agent pool instance. */
  getRemotePool?: () => any;
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
      return jsonResponse({
        teams: [],
        message: 'TeamRegistry integration pending',
      });
    }

    // POST /api/teams — Create a team
    if (method === 'POST' && path === '/api/teams') {
      let body: {goal?: string; [k: string]: unknown};
      try {
        body = await req.json();
      } catch {
        return errorResponse('Invalid request body');
      }
      return jsonResponse({
        ok: true,
        teamId: `team-${Date.now()}`,
        goal: body.goal ?? '',
        message: 'Team creation pending TeamRuntime integration',
      }, 201);
    }

    // GET /api/teams/:id — Team detail
    const teamDetailMatch = path.match(/^\/api\/teams\/([^/]+)$/);
    if (method === 'GET' && teamDetailMatch) {
      const teamId = teamDetailMatch[1];
      return jsonResponse({
        teamId,
        name: teamId,
        status: 'unknown',
        message: 'TeamRegistry integration pending',
      });
    }

    // ── REST: Team actions ─────────────────────────────────────────

    // POST /api/teams/:id/message — Send message to team
    const messageMatch = path.match(/^\/api\/teams\/([^/]+)\/message$/);
    if (method === 'POST' && messageMatch) {
      return jsonResponse({ok: true, teamId: messageMatch[1], message: 'Message delivery pending'});
    }

    // POST /api/teams/:id/pause
    const pauseMatch = path.match(/^\/api\/teams\/([^/]+)\/pause$/);
    if (method === 'POST' && pauseMatch) {
      return jsonResponse({ok: true, teamId: pauseMatch[1], action: 'paused'});
    }

    // POST /api/teams/:id/resume
    const resumeMatch = path.match(/^\/api\/teams\/([^/]+)\/resume$/);
    if (method === 'POST' && resumeMatch) {
      return jsonResponse({ok: true, teamId: resumeMatch[1], action: 'resumed'});
    }

    // POST /api/teams/:id/kill
    const killMatch = path.match(/^\/api\/teams\/([^/]+)\/kill$/);
    if (method === 'POST' && killMatch) {
      return jsonResponse({ok: true, teamId: killMatch[1], action: 'killed'});
    }

    // ── REST: Team sub-resources ───────────────────────────────────

    // GET /api/teams/:id/jobs — JobBoard state
    const jobsMatch = path.match(/^\/api\/teams\/([^/]+)\/jobs$/);
    if (method === 'GET' && jobsMatch) {
      return jsonResponse({teamId: jobsMatch[1], jobs: [], progress: {done: 0, total: 0}});
    }

    // GET /api/teams/:id/members — Member list
    const membersMatch = path.match(/^\/api\/teams\/([^/]+)\/members$/);
    if (method === 'GET' && membersMatch) {
      return jsonResponse({teamId: membersMatch[1], members: []});
    }

    // GET /api/teams/:id/messages — Message history
    const messagesMatch = path.match(/^\/api\/teams\/([^/]+)\/messages$/);
    if (method === 'GET' && messagesMatch) {
      return jsonResponse({teamId: messagesMatch[1], messages: []});
    }

    // ── SSE: Real-time event streams ───────────────────────────────

    // GET /api/teams/events — All team events (global fan-out)
    if (method === 'GET' && path === '/api/teams/events') {
      return createTeamSSEResponse();
    }

    // GET /api/teams/:id/events — Single team event stream
    const eventsMatch = path.match(/^\/api\/teams\/([^/]+)\/events$/);
    if (method === 'GET' && eventsMatch) {
      return createTeamSSEResponse(eventsMatch[1]);
    }

    // ── REST: Remote agent pool ────────────────────────────────────

    // GET /api/remotes
    if (method === 'GET' && path === '/api/remotes') {
      return jsonResponse({remotes: []});
    }

    // POST /api/remotes
    if (method === 'POST' && path === '/api/remotes') {
      return jsonResponse({ok: true, message: 'Remote added (pending)'}, 201);
    }

    // DELETE /api/remotes/:name
    const deleteRemoteMatch = path.match(/^\/api\/remotes\/([^/]+)$/);
    if (method === 'DELETE' && deleteRemoteMatch) {
      return jsonResponse({ok: true, name: deleteRemoteMatch[1], action: 'removed'});
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
 * In the real implementation this will subscribe to CodaraBus team events;
 * for now it keeps the connection alive with periodic heartbeats.
 */
function createTeamSSEResponse(_teamId?: string): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial keep-alive comment (not a named event — just a connection probe).
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Heartbeat every 30 s to keep proxies / load-balancers from closing the connection.
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 30_000);
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
