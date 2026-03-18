import {describe, test, expect, beforeEach, afterEach, mock} from 'bun:test';
import {DiscordApi, DiscordApiError} from '@integration/channel/discord/api';

function mockFetch(response: unknown, status = 200) {
  return mock(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
    } as Response),
  );
}

describe('DiscordApi', () => {
  const token = 'test-bot-token';
  let api: DiscordApi;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    api = new DiscordApi(token);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendMessage', () => {
    test('sends message and returns result', async () => {
      const mockResult = {id: 'msg-1', channel_id: 'ch-1'};
      globalThis.fetch = mockFetch(mockResult);

      const result = await api.sendMessage('ch-1', 'Hello Discord');

      expect(result).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      const [url, opts] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/channels/ch-1/messages');
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.content).toBe('Hello Discord');
      expect((opts as RequestInit).headers).toHaveProperty('Authorization', `Bot ${token}`);
    });

    test('sends message with components', async () => {
      const mockResult = {id: 'msg-2', channel_id: 'ch-1'};
      globalThis.fetch = mockFetch(mockResult);

      const components = [{
        type: 1 as const,
        components: [{type: 2 as const, style: 3, label: 'Click', custom_id: 'btn-1'}],
      }];
      await api.sendMessage('ch-1', 'With buttons', {components});

      const [, opts] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.components).toHaveLength(1);
      expect(body.components[0].components[0].custom_id).toBe('btn-1');
    });
  });

  describe('createInteractionResponse', () => {
    test('sends deferred update response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({ok: true, status: 204} as Response),
      );

      await api.createInteractionResponse('int-1', 'int-token', 6);

      const [url, opts] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/interactions/int-1/int-token/callback');
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.type).toBe(6);
    });

    test('sends response with content', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({ok: true, status: 204} as Response),
      );

      await api.createInteractionResponse('int-1', 'int-token', 4, 'Done!');

      const [, opts] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.type).toBe(4);
      expect(body.data.content).toBe('Done!');
    });
  });

  describe('triggerTyping', () => {
    test('triggers typing indicator', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({ok: true, status: 204} as Response),
      );

      await api.triggerTyping('ch-1');

      const [url] = (globalThis.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toBe('https://discord.com/api/v10/channels/ch-1/typing');
    });
  });

  describe('error handling', () => {
    test('throws DiscordApiError on API failure', async () => {
      globalThis.fetch = mockFetch({message: 'Missing Permissions'}, 403);

      try {
        await api.sendMessage('ch-1', 'test');
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(DiscordApiError);
        const apiErr = err as DiscordApiError;
        expect(apiErr.method).toBe('sendMessage');
        expect(apiErr.statusCode).toBe(403);
        expect(apiErr.description).toBe('Missing Permissions');
      }
    });
  });
});
