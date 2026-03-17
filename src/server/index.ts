/**
 * Codara HTTP+SSE server — wraps the Codara engine for desktop app consumption.
 *
 * Start with: bun src/server/index.ts
 * Port: env.CODARA_SERVER_PORT || 23981
 */

import {AIMessageChunk} from '@langchain/core/messages';
import type {BaseMessage} from '@langchain/core/messages';
import {createCodaraRuntime, type Codara} from '../codara/facade';
import type {CodaraRuntimeEvent} from '../engine/session/runtime-events';
import type {AgentStreamOutput, AgentStreamCustomChunk, AgentResult} from '../engine/agent/models/agent';
import type {SessionState} from '../engine/session/types';
import {createSSEResponse, jsonResponse, errorResponse, corsHeaders, type SSEEvent} from './sse';

// ── Configuration ────────────────────────────────────────────────────

const PORT = Number(process.env.CODARA_SERVER_PORT) || 23981;
const CWD = process.env.CODARA_CWD || process.cwd();

// ── Singleton Runtime ────────────────────────────────────────────────

let codara: Codara | undefined;
let initPromise: Promise<Codara> | undefined;

async function getRuntime(): Promise<Codara> {
  if (codara) {
    return codara;
  }
  if (!initPromise) {
    initPromise = createCodaraRuntime({cwd: CWD}).then((instance) => {
      codara = instance;
      return instance;
    });
  }
  return initPromise;
}

// ── Stream helpers ───────────────────────────────────────────────────

/**
 * Classify an `AgentStreamOutput` chunk and emit the appropriate SSE events.
 *
 * The stream yields several union variants:
 *   - `AIMessageChunk` — incremental text / thinking tokens from the model
 *   - `{model: {messages: [AIMessage]}}` — full model response (ignored; we stream chunks)
 *   - `{tools: {messages: [ToolMessage]}}` — tool execution result
 *   - `AgentStreamCustomChunk` — HIL pause events
 *   - `[mode, payload]` — tagged tuple (unwrap and recurse)
 *   - `{messages: BaseMessage[]}` — batch messages (rarely used in streaming)
 */
function emitStreamChunk(
  chunk: AgentStreamOutput,
  send: (event: SSEEvent) => void,
): void {
  // Tagged tuple — unwrap and recurse with the payload.
  if (Array.isArray(chunk) && chunk.length === 2 && typeof chunk[0] === 'string') {
    emitStreamChunk(chunk[1] as AgentStreamOutput, send);
    return;
  }

  // AIMessageChunk — incremental text/thinking tokens.
  if (AIMessageChunk.isInstance(chunk)) {
    const aiChunk = chunk as AIMessageChunk;

    // Check for thinking blocks in content array.
    if (Array.isArray(aiChunk.content)) {
      for (const block of aiChunk.content) {
        if (
          block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'thinking' &&
          'thinking' in block &&
          typeof block.thinking === 'string' &&
          block.thinking
        ) {
          send({event: 'thinking', data: {text: block.thinking}});
        }
      }
    }

    // Emit text token if present.
    const text = typeof aiChunk.text === 'string' ? aiChunk.text : '';
    if (text) {
      send({event: 'token', data: {text}});
    }

    // Check for tool_calls in the chunk.
    if (aiChunk.tool_call_chunks && aiChunk.tool_call_chunks.length > 0) {
      for (const tc of aiChunk.tool_call_chunks) {
        if (tc.name) {
          send({
            event: 'tool_call',
            data: {
              name: tc.name,
              args: tc.args ?? '',
              id: tc.id,
              index: tc.index,
            },
          });
        }
      }
    }

    return;
  }

  // Custom chunk — HIL pause event.
  if (isCustomChunk(chunk)) {
    if (chunk.type === 'hil_event' && chunk.payload) {
      const payload = chunk.payload;
      if ('type' in payload && payload.type === 'hil_pause') {
        send({
          event: 'paused',
          data: {
            request: (payload as {type: string; request: unknown}).request,
          },
        });
      }
    }
    return;
  }

  // Tool result messages.
  if (isToolResult(chunk)) {
    const toolMsg = chunk.tools.messages[0];
    send({
      event: 'tool_call',
      data: {
        name: toolMsg.name ?? 'unknown',
        result: typeof toolMsg.content === 'string'
          ? toolMsg.content.slice(0, 2000)
          : String(toolMsg.content).slice(0, 2000),
        status: toolMsg.status,
        tool_call_id: toolMsg.tool_call_id,
      },
    });
    return;
  }

  // Full model response — we already stream incremental chunks, so skip.
  // {model: {messages: [AIMessage]}} and {messages: BaseMessage[]} are ignored.
}

function isCustomChunk(chunk: unknown): chunk is AgentStreamCustomChunk {
  return (
    chunk !== null &&
    typeof chunk === 'object' &&
    'type' in chunk &&
    (chunk as Record<string, unknown>).type === 'hil_event'
  );
}

function isToolResult(
  chunk: unknown,
): chunk is {tools: {messages: [{name?: string; content: unknown; status?: string; tool_call_id?: string}]}} {
  return (
    chunk !== null &&
    typeof chunk === 'object' &&
    'tools' in chunk &&
    typeof (chunk as Record<string, unknown>).tools === 'object'
  );
}

/**
 * Pipe a Codara stream generator into SSE events.
 * Subscribes to runtime events for the duration of the stream and forwards them.
 */
async function pipeStreamToSSE(
  runtime: Codara,
  generator: AsyncGenerator<AgentStreamOutput, AgentResult, void>,
  send: (event: SSEEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  // Subscribe to runtime events (tool progress, turns, etc.) and forward them.
  const unsubscribe = runtime.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
    send({
      event: 'runtime_event',
      data: {
        kind: event.kind,
        phase: event.phase,
        status: event.status,
        label: event.label,
        detail: event.detail,
        parentId: event.parentId,
        id: event.id,
      },
    });
  });

  try {
    while (!signal.aborted) {
      const next = await generator.next();
      if (next.done) {
        const result: AgentResult = next.value;
        const sessionState = runtime.getState();

        // If the agent paused (has pendingPause), emit paused event.
        if (result.state.pendingPause) {
          send({
            event: 'paused',
            data: {
              request: result.state.pendingPause,
            },
          });
        }

        send({
          event: 'done',
          data: {
            sessionId: sessionState.sessionId,
            reason: result.reason,
            turns: result.turns,
            ...(result.error ? {error: result.error.message} : {}),
          },
        });
        break;
      }

      emitStreamChunk(next.value, send);
    }
  } finally {
    unsubscribe();
  }
}

// ── Route handlers ───────────────────────────────────────────────────

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
    const runtime = await getRuntime();
    const generator = runtime.stream(prompt.trim());
    await pipeStreamToSSE(runtime, generator, send, signal);
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
    const runtime = await getRuntime();

    // Build the resume payload — the exact shape depends on the middleware
    // that paused the agent. The common pattern is a decision string or
    // an object with {decision, editedArgs, input}.
    const payload: Record<string, unknown> = {decision: body.action};
    if (body.input !== undefined) {
      payload.input = body.input;
    }

    const generator = runtime.resumePauseStream(payload);
    await pipeStreamToSSE(runtime, generator, send, signal);
  });
}

async function handleListSessions(_req: Request): Promise<Response> {
  const runtime = await getRuntime();
  const sessions: SessionState[] = await runtime.listSessions({
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  return jsonResponse({sessions});
}

async function handleCreateSession(req: Request): Promise<Response> {
  let body: {cwd?: string} = {};
  try {
    body = await req.json();
  } catch {
    // No body or invalid JSON — use defaults.
  }

  // For now, the server manages a single runtime instance.
  // Creating a "new session" resets the current session and returns the new ID.
  const runtime = await getRuntime();
  await runtime.reset();
  const state = runtime.getState();
  return jsonResponse({sessionId: state.sessionId});
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

  const runtime = await getRuntime();
  const result = await runtime.executeCommand(command.trim());
  return jsonResponse({output: result.output, ok: result.ok});
}

async function handleStatus(_req: Request): Promise<Response> {
  const runtime = await getRuntime();
  const state = runtime.getState();
  const mcpStatus = runtime.getMcpStatus();

  return jsonResponse({
    sessionId: state.sessionId,
    status: state.sessionStatus,
    metadata: state.metadata,
    mcp: mcpStatus,
  });
}

// ── Router ───────────────────────────────────────────────────────────

function route(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const path = url.pathname;

  // Handle CORS preflight.
  if (method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: corsHeaders()});
  }

  // Route matching.
  if (method === 'POST' && path === '/api/chat') {
    return handleChat(req);
  }
  if (method === 'POST' && path === '/api/resume') {
    return handleResume(req);
  }
  if (method === 'GET' && path === '/api/sessions') {
    return handleListSessions(req);
  }
  if (method === 'POST' && path === '/api/sessions') {
    return handleCreateSession(req);
  }
  if (method === 'POST' && path === '/api/commands') {
    return handleExecuteCommand(req);
  }
  if (method === 'GET' && path === '/api/status') {
    return handleStatus(req);
  }

  return errorResponse('Not Found', 404);
}

// ── Server ───────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  fetch: route,
});

console.log(`Codara server listening on http://localhost:${server.port}`);

// ── Graceful Shutdown ────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('Shutting down Codara server...');
  server.stop(true);
  if (codara) {
    await codara.dispose();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
