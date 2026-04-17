import {describe, test, expect} from 'bun:test';
import {Gateway} from '@gateway/gateway';
import type {GatewayConfig, InboundMessage, StopHandle} from '@gateway/types';
import type {ChannelPlugin, ChannelPluginCapabilities, GatewayListenContext} from '@channels/contracts';
import {z} from 'zod';

interface MockAccount {
  id: string;
}

function createMockPlugin(overrides: Partial<ChannelPlugin<MockAccount>> = {}): ChannelPlugin<MockAccount> & {
  sentTexts: Array<{to: string; text: string}>;
  typingSent: boolean;
} {
  const sentTexts: Array<{to: string; text: string}> = [];
  let typingSent = false;

  return {
    id: 'telegram',
    name: 'Telegram',
    capabilities: {
      chatTypes: ['direct', 'group'],
      streaming: false,
      threads: true,
      media: true,
      reactions: false,
      textLimit: 4096,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configSchema: z.object({}) as any,
    resolveAccount(_config, accountId) {
      return {id: accountId ?? 'default'};
    },
    async startListening(_ctx: GatewayListenContext<MockAccount>): Promise<StopHandle> {
      return {async stop() {}};
    },
    async sendText(_account, ctx) {
      sentTexts.push({to: ctx.to, text: ctx.text});
      return {ok: true, messageId: 'sent1'};
    },
    async sendTyping() {
      typingSent = true;
    },
    sentTexts,
    get typingSent() {
      return typingSent;
    },
    ...overrides,
  };
}

function makeConfig(): GatewayConfig {
  return {
    channels: {
      telegram: {
        enabled: true,
        accounts: {bot1: {}},
      },
    },
  };
}

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    channel: 'telegram',
    accountId: 'bot1',
    messageId: 'msg1',
    sender: {id: 'user1', name: 'Alice'},
    peer: {kind: 'direct', id: 'user1'},
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Gateway', () => {
  test('handleInbound sends response via plugin', async () => {
    const plugin = createMockPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          return 'Hi there!';
        },
        async *stream() {
          yield 'Hi there!';
          return 'Hi there!';
        },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    expect(plugin.sentTexts.length).toBe(1);
    expect(plugin.sentTexts[0]!.text).toBe('Hi there!');
    expect(plugin.sentTexts[0]!.to).toBe('user1');

    await gw.stop();
  });

  test('handleInbound rejects disallowed message', async () => {
    const plugin = createMockPlugin();
    const config = makeConfig();
    config.channels.telegram!.enabled = false;

    const gw = new Gateway({
      config,
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          return 'should not reach';
        },
        async *stream() {
          yield '';
          return '';
        },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    expect(plugin.sentTexts.length).toBe(0);
    await gw.stop();
  });

  test('handleInbound skips group message requiring mention', async () => {
    const plugin = createMockPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          return 'should not reach';
        },
        async *stream() {
          yield '';
          return '';
        },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg({peer: {kind: 'group', id: 'group1'}}));

    expect(plugin.sentTexts.length).toBe(0);
    await gw.stop();
  });

  test('handleInbound sends error message on session failure', async () => {
    const plugin = createMockPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          throw new Error('LLM timeout');
        },
        // eslint-disable-next-line require-yield
        async *stream(): AsyncGenerator<string, string, void> {
          throw new Error('LLM timeout');
        },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    expect(plugin.sentTexts.length).toBe(1);
    expect(plugin.sentTexts[0]!.text).toContain('[Error]');
    expect(plugin.sentTexts[0]!.text).toContain('LLM timeout');

    await gw.stop();
  });

  test('debouncer merges rapid messages from plugin listener', async () => {
    let capturedOnMessage: ((msg: InboundMessage) => void) | undefined;
    const plugin = createMockPlugin({
      async startListening(ctx) {
        capturedOnMessage = ctx.onMessage;
        return {async stop() {}};
      },
    });
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke(text: string) {
          return `Echo: ${text}`;
        },
        async *stream(text: string) {
          const result = `Echo: ${text}`;
          yield result;
          return result;
        },
        async dispose() {},
      }),
    });

    await gw.start();
    expect(capturedOnMessage).toBeDefined();

    // Simulate rapid messages via the captured listener callback (goes through debouncer)
    capturedOnMessage!(makeMsg({text: 'part1', messageId: 'm1', timestamp: 1}));
    capturedOnMessage!(makeMsg({text: 'part2', messageId: 'm2', timestamp: 2}));

    // No immediate processing — debouncer is buffering
    expect(plugin.sentTexts.length).toBe(0);

    // Wait for debounce window to fire (default 1500ms)
    await new Promise((r) => setTimeout(r, 2000));

    // Should have sent ONE merged response
    expect(plugin.sentTexts.length).toBe(1);
    expect(plugin.sentTexts[0]!.text).toBe('Echo: part1\npart2');

    await gw.stop();
  });

  test('handleInbound chunks long responses', async () => {
    const plugin = createMockPlugin({
      capabilities: {
        chatTypes: ['direct'],
        streaming: false,
        threads: false,
        media: false,
        reactions: false,
        textLimit: 10,
      } as ChannelPluginCapabilities,
    });
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          return 'abcdefghij klmnopqrst';
        },
        async *stream() {
          yield 'abcdefghij klmnopqrst';
          return 'abcdefghij klmnopqrst';
        },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    expect(plugin.sentTexts.length).toBe(2);
    await gw.stop();
  });
});
