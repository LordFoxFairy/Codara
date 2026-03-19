/**
 * Codara HTTP+SSE+WebSocket server — bridges network clients to the CodaraBus.
 *
 * Start with: bun src/server/index.ts
 * Port: env.CODARA_SERVER_PORT || 23981
 *
 * Supports two transport modes on the same port:
 *   - HTTP+SSE (browser/Desktop) — backwards-compatible REST API
 *   - WebSocket (CLI --connect, agents) — ws://localhost:23981/ws
 */

import type {BusEvent, BusRequest, ClientId} from '../bus/types';
import {corsHeaders, errorResponse} from './sse';
import {getBus, disposeBus} from './bus-manager';
import {createTeamsApiHandler} from './teams-api';

// Routes
import {handleChat, handleResume} from './routes/chat';
import {handleListSessions, handleCreateSession, handleSessionMessages} from './routes/sessions';
import {handleExecuteCommand, handleStatus} from './routes/command';

// ── Configuration ────────────────────────────────────────────────────

const PORT = Number(process.env.CODARA_SERVER_PORT) || 23981;

// ── Teams API handler (lazy singleton) ───────────────────────────────

const handleTeamsRequest = createTeamsApiHandler();

// ── WebSocket state ──────────────────────────────────────────────────

interface WSClientState {
  clientId: ClientId;
  unsubscribe: () => void;
}

// ── Router ───────────────────────────────────────────────────────────

async function route(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const pathname = url.pathname;

  // Handle CORS preflight.
  if (method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: corsHeaders()});
  }

  // WebSocket upgrade.
  if (pathname === '/ws') {
    const upgraded = server.upgrade(req, {data: {}});
    if (upgraded) {
      // Bun returns true on successful upgrade; the Response is handled internally.
      return new Response(null, {status: 101});
    }
    return errorResponse('WebSocket upgrade failed', 400);
  }

  // HTTP+SSE routes.
  if (method === 'POST' && pathname === '/api/chat') return handleChat(req);
  if (method === 'POST' && pathname === '/api/resume') return handleResume(req);
  if (method === 'GET' && pathname === '/api/sessions') return handleListSessions(req);
  if (method === 'POST' && pathname === '/api/sessions') return handleCreateSession(req);
  if (method === 'POST' && pathname === '/api/commands') return handleExecuteCommand(req);
  if (method === 'GET' && pathname === '/api/status') return handleStatus(req);

  // Session messages: GET /api/sessions/:id/messages
  const sessionsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (method === 'GET' && sessionsMatch) {
    return handleSessionMessages(sessionsMatch[1]);
  }

  // Teams / Remotes API — delegates to teams-api handler.
  if (pathname.startsWith('/api/teams') || pathname.startsWith('/api/remotes')) {
    const teamsResponse = await handleTeamsRequest(req);
    if (teamsResponse) return teamsResponse;
  }

  return errorResponse('Not Found', 404);
}

// ── Server ───────────────────────────────────────────────────────────

const server = Bun.serve<WSClientState>({
  port: PORT,
  idleTimeout: 255, // max value — SSE streams need long-lived connections

  fetch(req, server) {
    return route(req, server);
  },

  websocket: {
    async open(ws) {
      try {
        const busInstance = await getBus();
        const clientId = busInstance.registerClient({name: 'ws-client', type: 'cli'});

        // Subscribe to ALL bus events and forward to this WebSocket client.
        const unsubscribe = busInstance.subscribe((event: BusEvent) => {
          try {
            ws.send(JSON.stringify(event));
          } catch {
            // WebSocket already closed — ignore.
          }
        });

        ws.data = {clientId, unsubscribe};

        // Notify the client of successful registration.
        ws.send(JSON.stringify({type: 'client.joined', clientId}));
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          requestId: '',
          sessionId: '',
        }));
        ws.close(1011, 'Bus initialization failed');
      }
    },

    async message(ws, message) {
      const {clientId} = ws.data;
      if (!clientId) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Client not registered',
          requestId: '',
          sessionId: '',
        }));
        return;
      }

      let request: BusRequest;
      try {
        const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
        request = JSON.parse(raw) as BusRequest;
      } catch {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON message',
          requestId: '',
          sessionId: '',
        }));
        return;
      }

      try {
        const busInstance = await getBus();
        await busInstance.handleRequest(clientId, request);
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          requestId: 'requestId' in request ? request.requestId : '',
          sessionId: '',
        }));
      }
    },

    close(ws) {
      const {clientId, unsubscribe} = ws.data ?? {};
      if (unsubscribe) unsubscribe();
      if (clientId) {
        // Fire-and-forget unregister; bus may already be disposed during shutdown.
        getBus()
          .then((b) => b.unregisterClient(clientId))
          .catch(() => {});
      }
    },
  },
});

console.log(`Codara server listening on http://localhost:${server.port}`);
console.log(`WebSocket endpoint: ws://localhost:${server.port}/ws`);

// ── Graceful Shutdown ────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('Shutting down Codara server...');
  server.stop(true);
  await disposeBus();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
