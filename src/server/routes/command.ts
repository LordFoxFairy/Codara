/**
 * Command execution route: POST /api/commands
 */

import type {BusEvent} from '../../bus/types';
import {jsonResponse, errorResponse} from '../sse';
import {getBus, generateRequestId, oneShot} from '../bus-manager';

export async function handleExecuteCommand(req: Request): Promise<Response> {
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

export async function handleStatus(_req: Request): Promise<Response> {
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
