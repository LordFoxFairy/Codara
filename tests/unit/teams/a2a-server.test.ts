import { describe, test, expect, beforeEach } from 'bun:test';
import * as os from 'os';
import {
  CodaraA2AServer,
  buildCodaraAgentCard,
  type A2AServerConfig,
} from '../../../src/capability/team/a2a-server.js';

const BASE_CONFIG: A2AServerConfig = { port: 9000 };

function jsonRpcRequest(method: string, params?: unknown, id: number = 1): Request {
  return new Request('http://localhost:9000/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

describe('buildCodaraAgentCard', () => {
  test('returns valid card with correct fields', () => {
    const card = buildCodaraAgentCard(BASE_CONFIG);
    expect(card.protocolVersion).toBe('0.3.0');
    expect(card.name).toContain('Codara Agent');
    expect(card.url).toBe('http://localhost:9000');
    expect(card.preferredTransport).toBe('JSONRPC');
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.defaultInputModes).toEqual(['text']);
    expect(card.defaultOutputModes).toEqual(['text']);
  });

  test('uses os.hostname() when machineName not provided', () => {
    const card = buildCodaraAgentCard(BASE_CONFIG);
    expect(card.name).toBe(`Codara Agent (${os.hostname()})`);
  });

  test('uses custom machineName when provided', () => {
    const card = buildCodaraAgentCard({ port: 9000, machineName: 'my-box' });
    expect(card.name).toBe('Codara Agent (my-box)');
  });

  test('has 3 skills: code-edit, code-review, testing', () => {
    const card = buildCodaraAgentCard(BASE_CONFIG);
    expect(card.skills).toHaveLength(3);
    const ids = card.skills.map((s) => s.id);
    expect(ids).toEqual(['code-edit', 'code-review', 'testing']);
  });
});

describe('CodaraA2AServer', () => {
  let server: CodaraA2AServer;

  beforeEach(() => {
    server = new CodaraA2AServer(BASE_CONFIG);
  });

  test('GET /.well-known/agent-card.json returns card', async () => {
    const req = new Request('http://localhost:9000/.well-known/agent-card.json');
    const resp = server.handleRequest(req);
    const resolved = resp instanceof Promise ? await resp : resp;
    expect(resolved.status).toBe(200);
    const card = await resolved.json();
    expect(card.name).toContain('Codara Agent');
    expect(card.protocolVersion).toBe('0.3.0');
  });

  test('POST / with valid message/send returns task', async () => {
    const req = jsonRpcRequest('message/send', { message: { role: 'user', parts: [{ text: 'hello' }] } });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.status.state).toBe('submitted');
    expect(body.result.id).toMatch(/^task-/);
  });

  test('POST / with invalid JSON-RPC returns error -32600', async () => {
    const req = new Request('http://localhost:9000/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', method: 'foo' }),
    });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe(-32600);
  });

  test('POST / with unknown method returns -32601', async () => {
    const req = jsonRpcRequest('unknown/method');
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(404);
    const body = await resp.json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toContain('unknown/method');
  });

  test('GET /unknown returns 404', async () => {
    const req = new Request('http://localhost:9000/unknown');
    const resp = server.handleRequest(req);
    const resolved = resp instanceof Promise ? await resp : resp;
    expect(resolved.status).toBe(404);
  });

  test('POST / with malformed JSON returns parse error -32700', async () => {
    const req = new Request('http://localhost:9000/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.code).toBe(-32700);
  });

  test('tasks/get returns result with task id', async () => {
    const req = jsonRpcRequest('tasks/get', { id: 'task-123' });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.result.id).toBe('task-123');
    expect(body.result.status.state).toBe('unknown');
  });

  test('tasks/cancel returns canceled state', async () => {
    const req = jsonRpcRequest('tasks/cancel', { id: 'task-456' });
    const resp = await server.handleRequest(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.result.id).toBe('task-456');
    expect(body.result.status.state).toBe('canceled');
  });

  test('getAgentCard() returns the same card', () => {
    const card = server.getAgentCard();
    expect(card.name).toContain('Codara Agent');
    expect(card.skills).toHaveLength(3);
  });
});
