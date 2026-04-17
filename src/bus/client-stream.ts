/**
 * Streaming + one-shot request helpers for BusClient.
 *
 * Encapsulates the buffer/signal dance used to turn inbound WebSocket events
 * into either an async generator (chat/resume) or a single-shot Promise
 * (command/status/etc). Split from client.ts so that file stays focused on
 * connection management and the public API surface.
 *
 * @module
 */

import type {BusEvent, BusRequest} from './types';

export type BusEventListener = (event: BusEvent) => void;

export interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const STREAM_EVENT_TYPES = new Set([
  'token',
  'thinking',
  'tool_call',
  'runtime_event',
]);

export interface OneShotContext {
  request: BusRequest;
  requestId: string;
  expectedType: string;
  timeoutMs: number;
  send: (request: BusRequest) => void;
  on: (type: string, listener: BusEventListener) => () => void;
  pending: Map<string, PendingRequest>;
}

export function awaitOneShotEvent(ctx: OneShotContext): Promise<BusEvent> {
  const {request, requestId, expectedType, timeoutMs, send, on, pending} = ctx;
  return new Promise<BusEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      off();
      reject(new Error(`Request timed out waiting for ${expectedType}`));
    }, timeoutMs);

    pending.set(requestId, {resolve: resolve as (value: unknown) => void, reject, timer});

    const off = on('*', (event) => {
      if (!('requestId' in event) || event.requestId !== requestId) return;
      if (event.type === expectedType) {
        clearTimeout(timer);
        pending.delete(requestId);
        off();
        resolve(event);
      } else if (event.type === 'error') {
        clearTimeout(timer);
        pending.delete(requestId);
        off();
        reject(new Error(readBusErrorMessage(event)));
      }
    });

    try {
      send(request);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(requestId);
      off();
      reject(err as Error);
    }
  });
}

export interface StreamContext {
  request: BusRequest;
  requestId: string;
  send: (request: BusRequest) => void;
  on: (type: string, listener: BusEventListener) => () => void;
}

export async function* iterateBusEventStream(ctx: StreamContext): AsyncGenerator<BusEvent> {
  const {request, requestId, send, on} = ctx;
  const buffer: BusEvent[] = [];
  let finished = false;
  let notifyResolve: (() => void) | null = null;

  const notify = (): void => {
    if (notifyResolve) {
      const r = notifyResolve;
      notifyResolve = null;
      r();
    }
  };

  const waitForEvent = (): Promise<void> => {
    if (buffer.length > 0 || finished) return Promise.resolve();
    return new Promise<void>((r) => {
      notifyResolve = r;
    });
  };

  const off = on('*', (event) => {
    const hasRequestId = 'requestId' in event && event.requestId === requestId;
    const isStreamEvent = STREAM_EVENT_TYPES.has(event.type);
    if (!hasRequestId && !isStreamEvent) return;

    buffer.push(event);
    if (hasRequestId && (event.type === 'done' || event.type === 'error')) {
      finished = true;
    }
    notify();
  });

  try {
    send(request);

    while (true) {
      await waitForEvent();

      while (buffer.length > 0) {
        yield buffer.shift()!;
      }

      if (finished) break;
    }
  } finally {
    off();
  }
}

function readBusErrorMessage(event: BusEvent): string {
  return (event as BusEvent & Record<string, unknown>).message as string ?? 'Unknown bus error';
}
