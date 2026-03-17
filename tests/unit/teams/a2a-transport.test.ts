import { describe, it, expect, beforeEach } from 'bun:test';
import { A2ATransport } from '@capability/team/transport/a2a-transport';

const REMOTE_URL = 'http://remote.codara.ai:8080';

describe('A2ATransport', () => {
  let transport: A2ATransport;

  beforeEach(() => {
    transport = new A2ATransport({ url: REMOTE_URL });
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
    it('returns a task ID string', async () => {
      const taskId = await transport.sendTask({ title: 'Build feature', description: 'Do the thing' });
      expect(typeof taskId).toBe('string');
      expect(taskId.length).toBeGreaterThan(0);
    });

    it('returned task ID matches expected format', async () => {
      const taskId = await transport.sendTask({ title: 'Test task', description: 'desc' });
      expect(taskId).toMatch(/^a2a-task-\d+$/);
    });

    it('returns distinct IDs for successive calls', async () => {
      // Ensure at least 1 ms apart so Date.now() differs
      const id1 = await transport.sendTask({ title: 'Task 1', description: 'first' });
      await new Promise(r => setTimeout(r, 2));
      const id2 = await transport.sendTask({ title: 'Task 2', description: 'second' });
      expect(id1).not.toBe(id2);
    });

    it('throws when transport has been disconnected', async () => {
      transport.disconnect();
      await expect(
        transport.sendTask({ title: 'late task', description: 'too late' }),
      ).rejects.toThrow(`A2ATransport: not connected to ${REMOTE_URL}`);
    });
  });

  // ─── getResult ─────────────────────────────────────────────────────

  describe('getResult', () => {
    it('returns undefined (pending) immediately after sendTask', async () => {
      const taskId = await transport.sendTask({ title: 'Pending task', description: 'waiting' });
      const result = await transport.getResult(taskId);
      expect(result).toBeUndefined();
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

  // ─── disconnect ────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('sets isConnected to false', () => {
      transport.disconnect();
      expect(transport.isConnected()).toBe(false);
    });

    it('clears pending results — getResult throws after disconnect', async () => {
      const taskId = await transport.sendTask({ title: 'Task', description: 'desc' });
      transport.disconnect();
      // The task was registered before disconnect; after clear it is unknown
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
