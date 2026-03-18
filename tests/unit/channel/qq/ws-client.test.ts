import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {OneBotWsClient} from '@integration/channel/qq/ws-client';

/**
 * Mock WebSocket that simulates the OneBot server.
 * We replace globalThis.WebSocket to intercept connections.
 */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  private listeners = new Map<string, Function[]>();
  sent: string[] = [];

  constructor(public url: string) {
    // Auto-open after microtask (simulates async connect)
    queueMicrotask(() => {
      if (MockWebSocket.shouldFail) {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('error', new Event('error'));
        this.emit('close', new CloseEvent('close'));
      } else {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open', new Event('open'));
      }
    });
    MockWebSocket.instances.push(this);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
  }

  removeEventListener(event: string, handler: Function) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close', new CloseEvent('close'));
  }

  // Test helpers
  emit(event: string, data: unknown) {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(data);
    }
  }

  simulateMessage(data: unknown) {
    this.emit('message', {data: JSON.stringify(data)});
  }

  static instances: MockWebSocket[] = [];
  static shouldFail = false;
  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.shouldFail = false;
  }
}

describe('OneBotWsClient', () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    MockWebSocket.reset();
    (globalThis as any).WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  function lastMockWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  describe('connect', () => {
    test('connects to the WebSocket URL', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      expect(lastMockWs().url).toBe('ws://127.0.0.1:3001');
      expect(client.connected).toBe(true);

      await client.disconnect();
    });

    test('appends access_token as query param', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001', 'my-secret');
      await client.connect();

      expect(lastMockWs().url).toBe('ws://127.0.0.1:3001?access_token=my-secret');

      await client.disconnect();
    });

    test('appends access_token with & when URL has existing params', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001?foo=bar', 'my-secret');
      await client.connect();

      expect(lastMockWs().url).toBe('ws://127.0.0.1:3001?foo=bar&access_token=my-secret');

      await client.disconnect();
    });
  });

  describe('callApi', () => {
    test('sends request and resolves on matching echo response', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      const ws = lastMockWs();
      const resultPromise = client.callApi('get_login_info', {});

      // Parse the sent request
      expect(ws.sent).toHaveLength(1);
      const request = JSON.parse(ws.sent[0]);
      expect(request.action).toBe('get_login_info');
      expect(request.echo).toBeDefined();

      // Simulate response
      ws.simulateMessage({
        status: 'ok',
        retcode: 0,
        data: {user_id: 12345, nickname: 'Bot'},
        echo: request.echo,
      });

      const result = await resultPromise;
      expect(result).toEqual({user_id: 12345, nickname: 'Bot'});

      await client.disconnect();
    });

    test('rejects on failed API response', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      const ws = lastMockWs();
      const resultPromise = client.callApi('send_msg', {message: 'test'});

      const request = JSON.parse(ws.sent[0]);
      ws.simulateMessage({
        status: 'failed',
        retcode: 100,
        data: null,
        echo: request.echo,
      });

      await expect(resultPromise).rejects.toThrow('OneBot API error: retcode=100');

      await client.disconnect();
    });

    test('throws when not connected', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      // Not connected
      await expect(client.callApi('test', {})).rejects.toThrow('WebSocket is not connected');
    });
  });

  describe('onEvent', () => {
    test('dispatches inbound events to handler', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      const events: unknown[] = [];
      client.onEvent((event) => events.push(event));

      await client.connect();

      const ws = lastMockWs();
      ws.simulateMessage({
        post_type: 'message',
        message_type: 'private',
        user_id: 111,
        message: [{type: 'text', data: {text: 'hello'}}],
        raw_message: 'hello',
        time: 1617243423,
        self_id: 999,
      });

      expect(events).toHaveLength(1);
      expect((events[0] as any).post_type).toBe('message');

      await client.disconnect();
    });

    test('does not dispatch API responses as events', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      const events: unknown[] = [];
      client.onEvent((event) => events.push(event));

      await client.connect();

      const ws = lastMockWs();
      // Send a request first to register echo
      const resultPromise = client.callApi('test', {});
      const request = JSON.parse(ws.sent[0]);

      // Response with echo — should NOT be dispatched as event
      ws.simulateMessage({
        status: 'ok',
        retcode: 0,
        data: {ok: true},
        echo: request.echo,
      });

      await resultPromise;
      expect(events).toHaveLength(0);

      await client.disconnect();
    });
  });

  describe('convenience methods', () => {
    test('sendPrivateMsg calls send_private_msg', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      const ws = lastMockWs();
      const promise = client.sendPrivateMsg(12345, [{type: 'text', data: {text: 'hi'}}]);

      const request = JSON.parse(ws.sent[0]);
      expect(request.action).toBe('send_private_msg');
      expect(request.params.user_id).toBe(12345);

      ws.simulateMessage({status: 'ok', retcode: 0, data: {message_id: 67890}, echo: request.echo});

      const msgId = await promise;
      expect(msgId).toBe(67890);

      await client.disconnect();
    });

    test('sendGroupMsg calls send_group_msg', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      const ws = lastMockWs();
      const promise = client.sendGroupMsg(100200, [{type: 'text', data: {text: 'hi'}}]);

      const request = JSON.parse(ws.sent[0]);
      expect(request.action).toBe('send_group_msg');
      expect(request.params.group_id).toBe(100200);

      ws.simulateMessage({status: 'ok', retcode: 0, data: {message_id: 11111}, echo: request.echo});

      const msgId = await promise;
      expect(msgId).toBe(11111);

      await client.disconnect();
    });
  });

  describe('disconnect', () => {
    test('clears pending requests on disconnect', async () => {
      const client = new OneBotWsClient('ws://127.0.0.1:3001');
      await client.connect();

      const resultPromise = client.callApi('slow_action', {});
      await client.disconnect();

      await expect(resultPromise).rejects.toThrow('Client disconnecting');
      expect(client.connected).toBe(false);
    });
  });
});
