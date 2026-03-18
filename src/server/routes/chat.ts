/**
 * Chat-related routes: POST /api/chat, POST /api/resume
 */

import type {BusRequest} from '../../bus/types';
import {createSSEResponse, errorResponse} from '../sse';
import {getBus, generateRequestId, pipeBusEventsToSSE} from '../bus-manager';

export async function handleChat(req: Request): Promise<Response> {
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

      const pipePromise = pipeBusEventsToSSE(busInstance, requestId, send, signal);
      await busInstance.handleRequest(clientId, request);
      await pipePromise;
    } finally {
      busInstance.unregisterClient(clientId);
    }
  });
}

export async function handleResume(req: Request): Promise<Response> {
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
