/**
 * Bus singleton lifecycle & shared helpers for HTTP/WS routes.
 */

import {CodaraBus} from '../bus/bus';
import type {BusRequest, BusEvent, ClientId} from '../bus/types';
import type {SSEEvent} from './sse';

// ── Bus Singleton ────────────────────────────────────────────────────

let bus: CodaraBus | undefined;
let busInitPromise: Promise<CodaraBus> | undefined;

export async function getBus(): Promise<CodaraBus> {
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

/** For graceful shutdown — dispose the bus if it was initialised. */
export async function disposeBus(): Promise<void> {
  if (bus) {
    await bus.dispose();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Subscribe to bus events filtered by requestId and forward them as SSE.
 * Resolves when a `done` or `error` event for this request is received.
 *
 * When `sessionId` is provided, streaming events without a `requestId`
 * (token, thinking, tool_call, runtime_event) are scoped to that session,
 * preventing multi-client crosstalk. When omitted, the session is inferred
 * from the first event that carries both `sessionId` and `requestId`.
 */
export function pipeBusEventsToSSE(
  busInstance: CodaraBus,
  requestId: string,
  send: (event: SSEEvent) => void,
  signal: AbortSignal,
  sessionId?: string,
): Promise<void> {
  // Track the resolved sessionId — filled from the first scoped event if not provided.
  let resolvedSessionId = sessionId;

  return new Promise<void>((resolve, _reject) => {
    const unsubscribe = busInstance.subscribe((event: BusEvent) => {
      if (signal.aborted) {
        unsubscribe();
        resolve();
        return;
      }

      if (!matchesRequest(event, requestId, resolvedSessionId)) return;

      // Capture sessionId from the first event that has both requestId and sessionId.
      if (!resolvedSessionId && 'requestId' in event && event.requestId === requestId && 'sessionId' in event) {
        resolvedSessionId = (event as {sessionId: string}).sessionId;
      }

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
          send({event: 'runtime_event', data: {kind: event.kind, phase: event.phase, status: event.status, label: event.label, detail: event.detail}});
          break;
        case 'paused':
          send({event: 'paused', data: {request: event.request, actions: event.actions}});
          unsubscribe();
          resolve();
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
 *
 * For events that carry a `requestId`, match exactly.
 * For streaming events without `requestId` (token, thinking, tool_call,
 * runtime_event, tool_result), require a matching `sessionId` to prevent
 * multi-client crosstalk. If no `sessionId` is resolved yet, these events
 * are accepted (first-request bootstrap).
 */
function matchesRequest(event: BusEvent, requestId: string, sessionId?: string): boolean {
  if ('requestId' in event && event.requestId !== undefined) {
    return event.requestId === requestId;
  }
  if (
    event.type === 'token' ||
    event.type === 'thinking' ||
    event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    event.type === 'runtime_event'
  ) {
    // If we have a resolved sessionId, only match events from that session.
    if (sessionId && 'sessionId' in event) {
      return (event as {sessionId: string}).sessionId === sessionId;
    }
    // No sessionId resolved yet — accept to bootstrap the first request.
    return true;
  }
  return false;
}

/**
 * Send a one-shot request and wait for a single matching result event.
 * Used for non-streaming HTTP endpoints (sessions, commands, status).
 */
export function oneShot<T extends BusEvent>(
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
