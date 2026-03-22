import {describe, test, expect} from 'bun:test';
import {Gateway} from '@gateway/gateway';
import type {GatewayConfig, InboundMessage, StopHandle, ReviewPromptContext} from '@gateway/types';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import {z} from 'zod';

interface MockAccount {
  id: string;
}

function createReviewPlugin(): ChannelPlugin<MockAccount> & {
  sentTexts: Array<{to: string; text: string}>;
  sentReviews: Array<{to: string; reviewId: string; actions: ReviewPromptContext['actions']}>;
  capturedOnReviewResponse?: (reviewId: string, payload: unknown) => void;
} {
  const sentTexts: Array<{to: string; text: string}> = [];
  const sentReviews: Array<{to: string; reviewId: string; actions: ReviewPromptContext['actions']}> = [];
  let capturedOnReviewResponse: ((reviewId: string, payload: unknown) => void) | undefined;

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
    async startListening(ctx: GatewayListenContext<MockAccount>): Promise<StopHandle> {
      capturedOnReviewResponse = ctx.onReviewResponse;
      return {async stop() {}};
    },
    async sendText(_account, ctx) {
      sentTexts.push({to: ctx.to, text: ctx.text});
      return {ok: true, messageId: `msg-${sentTexts.length}`};
    },
    async sendReviewPrompt(_account, ctx: ReviewPromptContext) {
      sentReviews.push({to: ctx.to, reviewId: ctx.review.id, actions: ctx.actions});
      return {ok: true, messageId: `review-msg-${sentReviews.length}`};
    },
    sentTexts,
    sentReviews,
    get capturedOnReviewResponse() {
      return capturedOnReviewResponse;
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

describe('Gateway review Integration', () => {
  test('creates a ChannelRegistry and exposes it', () => {
    const plugin = createReviewPlugin();
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
    const plugin = createReviewPlugin();
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

  test('handleReviewResponse resolves pending review in the correct bridge', async () => {
    const plugin = createReviewPlugin();
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

    // Simulate a review request through the bridge
    const reviewPromise = bridge!.showReviewRequest({
      id: 'review-42',
      description: 'Run bash command',
      action: {toolCallId: 'tc1', toolName: 'bash', toolArgs: {command: 'ls'}},
      review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
      runtime: {runId: 'r1', turn: 1, requestId: 'rq1', toolIndex: 0},
    });

    // The plugin should have sent the review prompt
    expect(plugin.sentReviews.length).toBe(1);
    expect(plugin.sentReviews[0]!.reviewId).toBe('review-42');

    // Simulate user clicking "approve" via Gateway's handleReviewResponse
    const handled = gw.handleReviewResponse('review-42', 'approve');
    expect(handled).toBe(true);

    const result = await reviewPromise;
    expect(result).toEqual({decision: 'approve'});

    // Let the session complete
    sessionInvokeResolve?.('completed after review');
    await inboundPromise;

    await gw.stop();
  });

  test('onReviewResponse callback wired to plugins routes correctly', async () => {
    const plugin = createReviewPlugin();

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

    // Get the bridge and simulate a pending review
    const registry = gw.getChannelRegistry();
    const bridge = registry.get('gateway:telegram:bot1:user1')!;
    const reviewPromise = bridge.showReviewRequest({
      id: 'review-99',
      description: 'Write file',
      action: {toolCallId: 'tc2', toolName: 'write_file', toolArgs: {path: '/tmp/test'}},
      review: {actionName: 'write_file', allowedDecisions: ['approve', 'reject', 'edit']},
      runtime: {runId: 'r2', turn: 1, requestId: 'rq2', toolIndex: 0},
    });

    // Use the plugin's captured onReviewResponse callback (wired during start)
    expect(plugin.capturedOnReviewResponse).toBeDefined();
    plugin.capturedOnReviewResponse!('review-99', 'reject');

    const result = await reviewPromise;
    expect(result).toEqual({decision: 'reject'});

    await gw.stop();
  });

  test('handleReviewResponse returns false when no bridge has the review', async () => {
    const plugin = createReviewPlugin();
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
    const handled = gw.handleReviewResponse('nonexistent', 'approve');
    expect(handled).toBe(false);

    await gw.stop();
  });

  test('stop disposes all bridges and the ChannelRegistry', async () => {
    const plugin = createReviewPlugin();
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
