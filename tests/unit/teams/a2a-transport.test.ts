import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { A2ATransport } from '@capability/team/transport/a2a-transport';

const REMOTE_URL = 'http://remote.codara.ai:8080';

/** Helper: build a successful JSON-RPC response for message/send. */
function sendResponse(taskId: string, state = 'working') {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { id: taskId, status: { state }, artifacts: [] },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Helper: build a successful JSON-RPC response for tasks/get. */
function getResponse(state: string, artifacts: unknown[] = []) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { status: { state }, artifacts },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('A2ATransport', () => {
  let transport: A2ATransport;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    transport = new A2ATransport({ url: REMOTE_URL });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Constructor ───────────────────────────────────────────────────

  describe('constructor', () => {
    it('stores the remote URL', () => {
      expect(transport.getUrl()).toBe(REMOTE_URL);
    });

    it('accepts optional authHeaders', () => {
      const t = new A2ATransport({
        url: REMOTE_URL,
        authHeaders: { Authorization: 'Bearer token' },
      });
      expect(t.getUrl()).toBe(REMOTE_URL);
    });

    it('starts in a connected state', () => {
      expect(transport.isConnected()).toBe(true);
    });
  });

  // ─── sendTask ──────────────────────────────────────────────────────

  describe('sendTask', () => {
    it('returns the remote task ID from the JSON-RPC response', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('remote-task-42'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Build feature', description: 'Do the thing' });
      expect(taskId).toBe('remote-task-42');
    });

    it('returns distinct IDs for successive calls', async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        return Promise.resolve(sendResponse(`task-${callCount}`));
      }) as typeof fetch;

      const id1 = await transport.sendTask({ title: 'Task 1', description: 'first' });
      const id2 = await transport.sendTask({ title: 'Task 2', description: 'second' });
      expect(id1).not.toBe(id2);
    });

    it('sends correct JSON-RPC payload', async () => {
      let capturedBody: unknown;
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(sendResponse('task-1'));
      }) as typeof fetch;

      await transport.sendTask({ title: 'My Task', description: 'Do stuff' });

      expect(capturedBody).toMatchObject({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Do stuff' }],
          },
          metadata: { title: 'My Task' },
        },
      });
    });

    it('includes auth headers in the request', async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = mock((_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Record<string, string>;
        return Promise.resolve(sendResponse('task-1'));
      }) as typeof fetch;

      const t = new A2ATransport({
        url: REMOTE_URL,
        authHeaders: { Authorization: 'Bearer secret' },
      });
      await t.sendTask({ title: 'Task', description: 'desc' });

      expect(capturedHeaders['Authorization']).toBe('Bearer secret');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });

    it('throws when transport has been disconnected', async () => {
      transport.disconnect();
      await expect(
        transport.sendTask({ title: 'late task', description: 'too late' }),
      ).rejects.toThrow(`A2ATransport: not connected to ${REMOTE_URL}`);
    });

    it('throws on network error', async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
      await expect(
        transport.sendTask({ title: 'Task', description: 'desc' }),
      ).rejects.toThrow('A2ATransport: sendTask failed');
    });

    it('throws on non-200 HTTP response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })),
      ) as typeof fetch;
      await expect(
        transport.sendTask({ title: 'Task', description: 'desc' }),
      ).rejects.toThrow('A2ATransport: sendTask failed');
    });

    it('throws on JSON-RPC error response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'req-1',
              error: { code: -32600, message: 'Invalid Request' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ) as typeof fetch;
      await expect(
        transport.sendTask({ title: 'Task', description: 'desc' }),
      ).rejects.toThrow('remote error');
    });

    it('stores completed status when remote responds immediately', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'req-1',
              result: {
                id: 'instant-task',
                status: { state: 'completed' },
                artifacts: [{ parts: [{ type: 'text', text: 'Done!' }] }],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ) as typeof fetch;

      const taskId = await transport.sendTask({ title: 'Fast', description: 'instant' });
      expect(taskId).toBe('instant-task');

      // getResult should return immediately without another HTTP call
      const result = await transport.getResult(taskId);
      expect(result).toEqual({ output: 'Done!' });
    });
  });

  // ─── getResult ─────────────────────────────────────────────────────

  describe('getResult', () => {
    it('returns undefined (pending) when remote says working', async () => {
      // sendTask mock
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('task-1', 'working'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Pending', description: 'waiting' });

      // getResult mock — still working
      globalThis.fetch = mock(() => Promise.resolve(getResponse('working'))) as typeof fetch;
      const result = await transport.getResult(taskId);
      expect(result).toBeUndefined();
    });

    it('returns output when remote completes', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('task-1'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Task', description: 'desc' });

      globalThis.fetch = mock(() =>
        Promise.resolve(
          getResponse('completed', [{ parts: [{ type: 'text', text: 'Result here' }] }]),
        ),
      ) as typeof fetch;

      const result = await transport.getResult(taskId);
      expect(result).toEqual({ output: 'Result here' });
    });

    it('returns error when remote task fails', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('task-1'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Task', description: 'desc' });

      globalThis.fetch = mock(() => Promise.resolve(getResponse('failed'))) as typeof fetch;
      const result = await transport.getResult(taskId);
      expect(result).toEqual({ error: 'task failed on remote' });
    });

    it('returns error result on network failure (does not throw)', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('task-1'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Task', description: 'desc' });

      globalThis.fetch = mock(() => Promise.reject(new Error('network down'))) as typeof fetch;
      const result = await transport.getResult(taskId);
      expect(result).toEqual({ error: `A2ATransport: failed to poll task ${taskId}` });
    });

    it('throws for an unknown task ID', async () => {
      await expect(transport.getResult('a2a-task-99999999')).rejects.toThrow(
        'A2ATransport: unknown task a2a-task-99999999',
      );
    });

    it('throws for a completely arbitrary unknown ID', async () => {
      await expect(transport.getResult('no-such-task')).rejects.toThrow(
        'A2ATransport: unknown task no-such-task',
      );
    });
  });

  // ─── pollResult ──────────────────────────────────────────────────

  describe('pollResult', () => {
    it('returns immediately if task is already completed', async () => {
      // sendTask returns a completed task
      globalThis.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'req-1',
              result: {
                id: 'fast-task',
                status: { state: 'completed' },
                artifacts: [{ parts: [{ type: 'text', text: 'Instant' }] }],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      ) as typeof fetch;

      const taskId = await transport.sendTask({ title: 'Fast', description: 'desc' });
      const result = await transport.pollResult(taskId, 50, 500);
      expect(result).toEqual({ output: 'Instant' });
    });

    it('polls until completed', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('poll-task'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Slow', description: 'desc' });

      let pollCount = 0;
      globalThis.fetch = mock(() => {
        pollCount++;
        if (pollCount >= 3) {
          return Promise.resolve(
            getResponse('completed', [{ parts: [{ type: 'text', text: 'Finally!' }] }]),
          );
        }
        return Promise.resolve(getResponse('working'));
      }) as typeof fetch;

      const result = await transport.pollResult(taskId, 50, 5000);
      expect(result).toEqual({ output: 'Finally!' });
      expect(pollCount).toBeGreaterThanOrEqual(3);
    });

    it('returns timeout error when deadline exceeded', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('slow-task'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Slow', description: 'desc' });

      // Always return working
      globalThis.fetch = mock(() => Promise.resolve(getResponse('working'))) as typeof fetch;

      const result = await transport.pollResult(taskId, 50, 200);
      expect('error' in result).toBe(true);
      expect((result as { error: string }).error).toContain('timed out');
    });
  });

  // ─── disconnect ────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('sets isConnected to false', () => {
      transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });

    it('clears pending results — getResult throws after disconnect', async () => {
      globalThis.fetch = mock(() => Promise.resolve(sendResponse('task-1'))) as typeof fetch;
      const taskId = await transport.sendTask({ title: 'Task', description: 'desc' });
      transport.disconnect();
      await expect(transport.getResult(taskId)).rejects.toThrow(
        `A2ATransport: unknown task ${taskId}`,
      );
    });

    it('is idempotent — calling disconnect twice does not throw', () => {
      expect(() => {
        transport.disconnect();
        transport.disconnect();
      }).not.toThrow();
    });

    it('preserves the remote URL after disconnect', () => {
      transport.disconnect();
      expect(transport.getUrl()).toBe(REMOTE_URL);
    });
  });

  // ─── isConnected / getUrl ──────────────────────────────────────────

  describe('isConnected', () => {
    it('returns true on a freshly constructed transport', () => {
      expect(transport.isConnected()).toBe(true);
    });

    it('returns false after disconnect', () => {
      transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('getUrl', () => {
    it('reflects the URL passed to the constructor', () => {
      const t = new A2ATransport({ url: 'https://example.com/a2a' });
      expect(t.getUrl()).toBe('https://example.com/a2a');
    });
  });
});
