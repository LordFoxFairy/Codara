/**
 * Session CRUD routes:
 *   GET  /api/sessions
 *   POST /api/sessions
 *   GET  /api/sessions/:id/messages
 */

import path from 'node:path';
import type {BusEvent} from '../../bus/types';
import {jsonResponse, errorResponse} from '../sse';
import {getBus, generateRequestId, oneShot} from '../bus-manager';
import {createAgentFileCheckpointer} from '@durability/checkpoint';
import {resolveCodaraPath} from '@integration/provider/config/loader';
import {resolveWorkspaceRoot} from '@config/workspace';

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

export async function handleListSessions(_req: Request): Promise<Response> {
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

export async function handleCreateSession(req: Request): Promise<Response> {
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

/**
 * GET /api/sessions/:id/messages — retrieve conversation history from checkpoint.
 * Returns messages in a simplified format for the desktop frontend.
 */
export async function handleSessionMessages(sessionId: string): Promise<Response> {
  try {
    const checkpointer = getCheckpointer();
    const checkpoint = await checkpointer.getLatest(sessionId);

    if (!checkpoint) {
      return jsonResponse({messages: []});
    }

    // Convert LangChain BaseMessage[] to simple frontend-friendly format.
    const messages = checkpoint.state.messages.map((msg, i) => {
      const role = msg.type === 'human' ? 'user' as const : 'assistant' as const;
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
