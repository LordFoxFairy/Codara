import {describe, test, expect} from 'bun:test';
import {Gateway} from '@gateway/gateway';
import type {GatewayConfig, InboundMessage, SendResult, StopHandle, PausePromptContext} from '@gateway/types';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import {z} from 'zod';

interface MockAccount {
  id: string;
}

function createHILPlugin(): ChannelPlugin<MockAccount> & {
  sentTexts: Array<{to: string; text: string}>;
  sentPauses: Array<{to: string; pauseId: string; actions: PausePromptContext['actions']}>;
  capturedOnPauseResponse?: (pauseId: string, payload: unknown) => void;
} {
  const sentTexts: Array<{to: string; text: string}> = [];
  const sentPauses: Array<{to: string; pauseId: string; actions: PausePromptContext['actions']}> = [];
  let capturedOnPauseResponse: ((pauseId: string, payload: unknown) => void) | undefined;

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
    configSchema: z.object({}),
    resolveAccount(_config, accountId) {
      return {id: accountId ?? 'default'};
    },
    async startListening(ctx: GatewayListenContext<MockAccount>): Promise<StopHandle> {
      capturedOnPauseResponse = ctx.onPauseResponse;
      return {async stop() {}};
    },
    async sendText(_account, ctx) {
      sentTexts.push({to: ctx.to, text: ctx.text});
      return {ok: true, messageId: `msg-${sentTexts.length}`};
    },
    async sendPausePrompt(_account, ctx: PausePromptContext) {
      sentPauses.push({to: ctx.to, pauseId: ctx.pause.id, actions: ctx.actions});
      return {ok: true, messageId: `pause-msg-${sentPauses.length}`};
    },
    sentTexts,
    sentPauses,
    get capturedOnPauseResponse() {
      return capturedOnPauseResponse;
    },
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
    text: 'run ls',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Gateway HIL Integration', () => {
  test('creates a ChannelRegistry and exposes it', () => {
    const plugin = createHILPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() { return 'ok'; },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    const registry = gw.getChannelRegistry();
    expect(registry).toBeDefined();
  });

  test('creates bridge for each conversation and registers with ChannelRegistry', async () => {
    const plugin = createHILPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() { return 'done'; },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    const registry = gw.getChannelRegistry();
    const bridgeId = 'gateway:telegram:bot1:user1';
    expect(registry.get(bridgeId)).toBeDefined();

    await gw.stop();
  });

  test('handlePauseResponse resolves pending pause in the correct bridge', async () => {
    const plugin = createHILPlugin();
    let sessionInvokeResolve: ((v: string) => void) | undefined;

    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() {
          return new Promise<string>((resolve) => {
            sessionInvokeResolve = resolve;
          });
        },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    await gw.start();

    // Start inbound handling (will wait for session.invoke to resolve)
    const inboundPromise = gw.handleInbound(makeMsg());

    // The bridge should now exist
    const registry = gw.getChannelRegistry();
    const bridgeId = 'gateway:telegram:bot1:user1';
    const bridge = registry.get(bridgeId);
    expect(bridge).toBeDefined();

    // Simulate a pause request through the bridge
    const pausePromise = bridge!.showPauseRequest({
      id: 'pause-42',
      description: 'Run bash command',
      action: {toolCallId: 'tc1', toolName: 'bash', toolArgs: {command: 'ls'}},
      review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
      runtime: {runId: 'r1', turn: 1, requestId: 'rq1', toolIndex: 0},
    });

    // The plugin should have sent the pause prompt
    expect(plugin.sentPauses.length).toBe(1);
    expect(plugin.sentPauses[0]!.pauseId).toBe('pause-42');

    // Simulate user clicking "approve" via Gateway's handlePauseResponse
    const handled = gw.handlePauseResponse('pause-42', 'approve');
    expect(handled).toBe(true);

    const result = await pausePromise;
    expect(result).toEqual({decision: 'approve'});

    // Let the session complete
    sessionInvokeResolve?.('completed after pause');
    await inboundPromise;

    await gw.stop();
  });

  test('onPauseResponse callback wired to plugins routes correctly', async () => {
    const plugin = createHILPlugin();

    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() { return 'ok'; },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    await gw.start();

    // Trigger inbound to create a bridge
    await gw.handleInbound(makeMsg());

    // Get the bridge and simulate a pending pause
    const registry = gw.getChannelRegistry();
    const bridge = registry.get('gateway:telegram:bot1:user1')!;
    const pausePromise = bridge.showPauseRequest({
      id: 'pause-99',
      description: 'Write file',
      action: {toolCallId: 'tc2', toolName: 'write_file', toolArgs: {path: '/tmp/test'}},
      review: {actionName: 'write_file', allowedDecisions: ['approve', 'reject', 'edit']},
      runtime: {runId: 'r2', turn: 1, requestId: 'rq2', toolIndex: 0},
    });

    // Use the plugin's captured onPauseResponse callback (wired during start)
    expect(plugin.capturedOnPauseResponse).toBeDefined();
    plugin.capturedOnPauseResponse!('pause-99', 'reject');

    const result = await pausePromise;
    expect(result).toEqual({decision: 'reject'});

    await gw.stop();
  });

  test('handlePauseResponse returns false when no bridge has the pause', async () => {
    const plugin = createHILPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() { return 'ok'; },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    // No bridges created yet
    const handled = gw.handlePauseResponse('nonexistent', 'approve');
    expect(handled).toBe(false);

    await gw.stop();
  });

  test('stop disposes all bridges and the ChannelRegistry', async () => {
    const plugin = createHILPlugin();
    const gw = new Gateway({
      config: makeConfig(),
      plugins: [plugin],
      createSession: async () => ({
        async invoke() { return 'ok'; },
        async *stream() { yield ''; return ''; },
        async dispose() {},
      }),
    });

    await gw.start();
    await gw.handleInbound(makeMsg());

    const registry = gw.getChannelRegistry();
    expect(registry.list().length).toBeGreaterThan(0);

    await gw.stop();

    // After stop, the registry should be empty
    expect(registry.list().length).toBe(0);
  });
});
