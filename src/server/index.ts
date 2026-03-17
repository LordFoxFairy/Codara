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

import path from 'node:path';
import {CodaraBus} from '../bus/bus';
import type {BusRequest, BusEvent, ClientId} from '../bus/types';
import {createSSEResponse, jsonResponse, errorResponse, corsHeaders, type SSEEvent} from './sse';
import {createAgentFileCheckpointer} from '../infra/checkpoint/agent';
import {resolveCodaraPath} from '../infra/provider/config/loader';
import {resolveWorkspaceRoot} from '../infra/config/workspace';

// ── Configuration ────────────────────────────────────────────────────

const PORT = Number(process.env.CODARA_SERVER_PORT) || 23981;

// ── Bus Singleton ────────────────────────────────────────────────────

let bus: CodaraBus | undefined;
let busInitPromise: Promise<CodaraBus> | undefined;

async function getBus(): Promise<CodaraBus> {
  if (bus) return bus;
  if (!busInitPromise) {
    busInitPromise = (async () => {
      const instance = new CodaraBus();
      await instance.init();
      bus = instance;
      return instance;
    })();
  }
  return busInitPromise;
}

// ── Helper: generate request IDs ─────────────────────────────────────

function generateRequestId(): string {
  return crypto.randomUUID();
}

// ── Helper: collect bus events for a request into SSE ────────────────

/**
 * Subscribe to bus events filtered by requestId and forward them as SSE.
 * Resolves when a `done` or `error` event for this request is received.
 */
function pipeBusEventsToSSE(
  busInstance: CodaraBus,
  requestId: string,
  send: (event: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsubscribe = busInstance.subscribe((event: BusEvent) => {
      if (signal.aborted) {
        unsubscribe();
        resolve();
        return;
      }

      // Filter events that belong to this request or are session-scoped
      // streaming events (token, thinking, tool_call, runtime_event).
      // Request-correlated events carry requestId; streaming events don't
      // but belong to the active session which was triggered by this request.
      if (!matchesRequest(event, requestId)) return;

      // Map BusEvent types to SSE event names.
      switch (event.type) {
        case 'token':
          send({event: 'token', data: {text: event.text}});
          break;
        case 'thinking':
          send({event: 'thinking', data: {text: event.text}});
          break;
        case 'tool_call':
          send({event: 'tool_call', data: {name: event.name, args: event.args}});
          break;
        case 'runtime_event':
          send({event: 'runtime_event', data: {kind: event.kind, label: event.label}});
          break;
        case 'paused':
          send({event: 'paused', data: {request: event.request, actions: event.actions}});
          break;
        case 'done':
          send({event: 'done', data: {sessionId: event.sessionId, requestId: event.requestId}});
          unsubscribe();
          resolve();
          break;
        case 'error':
          send({event: 'error', data: {message: event.message}});
          unsubscribe();
          resolve();
          break;
        default:
          // Other event types are not relevant for SSE streaming.
          break;
      }
    });

    signal.addEventListener('abort', () => {
      unsubscribe();
      resolve();
    }, {once: true});
  });
}

/**
 * Check if a BusEvent is relevant to the given requestId.
 * Stream events (token, thinking, tool_call, runtime_event) don't always
 * carry a requestId — they belong to the session that was triggered.
 * Request-correlated events (done, error, paused, result types) carry requestId.
 */
function matchesRequest(event: BusEvent, requestId: string): boolean {
  // Events with explicit requestId — match directly.
  if ('requestId' in event && event.requestId !== undefined) {
    return event.requestId === requestId;
  }
  // Stream events without requestId are forwarded (they belong to the current
  // active request on the session). This is safe because each SSE connection
  // has its own dedicated bus client with only one active request at a time.
  if (
    event.type === 'token' ||
    event.type === 'thinking' ||
    event.type === 'tool_call' ||
    event.type === 'runtime_event'
  ) {
    return true;
  }
  return false;
}

// ── HTTP+SSE Route Handlers ──────────────────────────────────────────

async function handleChat(req: Request): Promise<Response> {
  let body: {prompt?: string; sessionId?: string};
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const prompt = body.prompt;
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return errorResponse('Missing or empty "prompt" field');
  }

  return createSSEResponse(async (send, signal) => {
    const busInstance = await getBus();
    const clientId = busInstance.registerClient({name: 'http-sse', type: 'desktop'});
    const requestId = generateRequestId();

    try {
      const request: BusRequest = {
        type: 'chat',
        requestId,
        prompt: prompt.trim(),
        ...(body.sessionId ? {sessionId: body.sessionId} : {}),
      };

      // Start listening before sending the request to avoid race conditions.
      const pipePromise = pipeBusEventsToSSE(busInstance, requestId, send, signal);
      await busInstance.handleRequest(clientId, request);
      await pipePromise;
    } finally {
      busInstance.unregisterClient(clientId);
    }
  });
}

async function handleResume(req: Request): Promise<Response> {
  let body: {sessionId?: string; action?: string; input?: string};
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!body.action || typeof body.action !== 'string') {
    return errorResponse('Missing or invalid "action" field');
  }

  return createSSEResponse(async (send, signal) => {
    const busInstance = await getBus();
    const clientId = busInstance.registerClient({name: 'http-sse', type: 'desktop'});
    const requestId = generateRequestId();

    try {
      const request: BusRequest = {
        type: 'resume',
        requestId,
        sessionId: body.sessionId ?? '',
        action: body.action!,
        ...(body.input !== undefined ? {input: body.input} : {}),
      };

      const pipePromise = pipeBusEventsToSSE(busInstance, requestId, send, signal);
      await busInstance.handleRequest(clientId, request);
      await pipePromise;
    } finally {
      busInstance.unregisterClient(clientId);
    }
  });
}

async function handleListSessions(_req: Request): Promise<Response> {
  const busInstance = await getBus();
  const clientId = busInstance.registerClient({name: 'http-json', type: 'desktop'});
  const requestId = generateRequestId();

  try {
    const result = await oneShot<BusEvent & {type: 'sessions.list.result'}>(
      busInstance, clientId,
      {type: 'sessions.list', requestId},
      requestId,
      'sessions.list.result',
    );
    return jsonResponse({sessions: result.sessions});
  } finally {
    busInstance.unregisterClient(clientId);
  }
}

async function handleCreateSession(req: Request): Promise<Response> {
  let body: {cwd?: string} = {};
  try {
    body = await req.json();
  } catch {
    // No body or invalid JSON — use defaults.
  }

  const busInstance = await getBus();
  const clientId = busInstance.registerClient({name: 'http-json', type: 'desktop'});
  const requestId = generateRequestId();

  try {
    const result = await oneShot<BusEvent & {type: 'sessions.create.result'}>(
      busInstance, clientId,
      {type: 'sessions.create', requestId, ...(body.cwd ? {cwd: body.cwd} : {})},
      requestId,
      'sessions.create.result',
    );
    return jsonResponse({sessionId: result.sessionId});
  } finally {
    busInstance.unregisterClient(clientId);
  }
}

async function handleExecuteCommand(req: Request): Promise<Response> {
  let body: {command?: string};
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const command = body.command;
  if (!command || typeof command !== 'string' || !command.trim()) {
    return errorResponse('Missing or empty "command" field');
  }

  const busInstance = await getBus();
  const clientId = busInstance.registerClient({name: 'http-json', type: 'desktop'});
  const requestId = generateRequestId();

  try {
    const result = await oneShot<BusEvent & {type: 'command.result'}>(
      busInstance, clientId,
      {type: 'command', requestId, command: command.trim()},
      requestId,
      'command.result',
    );
    return jsonResponse({output: result.output, ok: result.ok});
  } finally {
    busInstance.unregisterClient(clientId);
  }
}

/** Resolve the sessions directory from project root or home .codara. */
function resolveSessionsDir(): string {
  const projectRoot = resolveWorkspaceRoot();
  const projectPath = path.join(projectRoot, '.codara', 'sessions');
  try {
    const stat = Bun.file(projectPath).size;
    if (stat !== undefined) return projectPath;
  } catch { /* fallback */ }
  return path.join(resolveCodaraPath(), 'sessions');
}

let _checkpointer: ReturnType<typeof createAgentFileCheckpointer> | undefined;
function getCheckpointer() {
  if (!_checkpointer) {
    _checkpointer = createAgentFileCheckpointer({rootDir: resolveSessionsDir()});
  }
  return _checkpointer;
}

/**
 * GET /api/sessions/:id/messages — retrieve conversation history from checkpoint.
 * Returns messages in a simplified format for the desktop frontend.
 */
async function handleSessionMessages(sessionId: string): Promise<Response> {
  try {
    const checkpointer = getCheckpointer();
    const checkpoint = await checkpointer.getLatest(sessionId);

    if (!checkpoint) {
      return jsonResponse({messages: []});
    }

    // Convert LangChain BaseMessage[] to simple frontend-friendly format.
    const messages = checkpoint.state.messages.map((msg, i) => {
      const role = msg.getType() === 'human' ? 'user' as const : 'assistant' as const;
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((b): b is {type: 'text'; text: string} =>
            typeof b === 'object' && b !== null && 'type' in b && b.type === 'text')
          .map(b => b.text)
          .join('');
      }

      // Extract thinking from content blocks
      let thinking = '';
      if (Array.isArray(msg.content)) {
        thinking = msg.content
          .filter((b): b is {type: 'thinking'; thinking: string} =>
            typeof b === 'object' && b !== null && 'type' in b && b.type === 'thinking')
          .map(b => b.thinking)
          .join('');
      }

      return {
        id: `hist_${sessionId.slice(0, 8)}_${i}`,
        role,
        content,
        ...(thinking ? {thinking} : {}),
        timestamp: Date.parse(checkpoint.info.createdAt) || Date.now(),
      };
    }).filter(m => m.role === 'user' || m.role === 'assistant');

    return jsonResponse({messages});
  } catch (err) {
    return errorResponse(
      `Failed to load messages: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }
}

async function handleStatus(_req: Request): Promise<Response> {
  const busInstance = await getBus();
  const clientId = busInstance.registerClient({name: 'http-json', type: 'desktop'});
  const requestId = generateRequestId();

  try {
    const result = await oneShot<BusEvent & {type: 'status.result'}>(
      busInstance, clientId,
      {type: 'status', requestId},
      requestId,
      'status.result',
    );
    return jsonResponse(result.data);
  } finally {
    busInstance.unregisterClient(clientId);
  }
}

/**
 * Send a one-shot request and wait for a single matching result event.
 * Used for non-streaming HTTP endpoints (sessions, commands, status).
 */
function oneShot<T extends BusEvent>(
  busInstance: CodaraBus,
  clientId: ClientId,
  request: BusRequest,
  requestId: string,
  expectedType: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Bus request timed out: ${expectedType}`));
    }, 30_000);

    const unsubscribe = busInstance.subscribe((event: BusEvent) => {
      if ('requestId' in event && event.requestId === requestId) {
        if (event.type === expectedType) {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event as T);
        } else if (event.type === 'error') {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error((event as BusEvent & {type: 'error'}).message));
        }
      }
    });

    busInstance.handleRequest(clientId, request).catch((err) => {
      clearTimeout(timeout);
      unsubscribe();
      reject(err);
    });
  });
}

// ── WebSocket state ──────────────────────────────────────────────────

interface WSClientState {
  clientId: ClientId;
  unsubscribe: () => void;
}

// ── Router ───────────────────────────────────────────────────────────

function route(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> | Response {
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
  if (bus) {
    await bus.dispose();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
