import {describe, test, expect, beforeEach} from 'bun:test';
import {GatewayChannelBridge} from '@gateway/channel-bridge';
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {ReviewRequest} from '@shared/contracts/agent-types';
import {z} from 'zod';

function createMockPlugin(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin & {
  sentTexts: Array<{to: string; text: string}>;
  sentReviews: Array<{to: string; text: string; reviewId: string}>;
} {
  const sentTexts: Array<{to: string; text: string}> = [];
  const sentReviews: Array<{to: string; text: string; reviewId: string}> = [];

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
    resolveAccount: () => ({id: 'acc1'}),
    startListening: async () => ({async stop() {}}),
    async sendText(_account, ctx) {
      sentTexts.push({to: ctx.to, text: ctx.text});
      return {ok: true};
    },
    async sendReviewPrompt(_account, ctx) {
      sentReviews.push({to: ctx.to, text: ctx.text, reviewId: ctx.review.id});
      return {ok: true};
    },
    sentTexts,
    sentReviews,
    ...overrides,
  };
}

function makeReviewRequest(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: 'review-1',
    description: 'Execute bash command',
    action: {toolCallId: 'tc1', toolName: 'bash', toolArgs: {command: 'ls -la'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run1', turn: 1, requestId: 'req1', toolIndex: 0},
    ...overrides,
  };
}

describe('GatewayChannelBridge', () => {
  let plugin: ReturnType<typeof createMockPlugin>;
  let bridge: GatewayChannelBridge;

  beforeEach(() => {
    plugin = createMockPlugin();
    bridge = new GatewayChannelBridge(plugin, {id: 'acc1'}, 'user1', 'bot1', 'telegram');
  });

  test('has correct id and type', () => {
    expect(bridge.id).toBe('gateway:telegram:bot1:user1');
    expect(bridge.type).toBe('telegram');
  });

  test('sendMessage delegates to plugin.sendText', async () => {
    await bridge.sendMessage({type: 'text', content: 'Hello!'});

    expect(plugin.sentTexts.length).toBe(1);
    expect(plugin.sentTexts[0]!.to).toBe('user1');
    expect(plugin.sentTexts[0]!.text).toBe('Hello!');
  });

  test('showReviewRequest sends prompt via plugin.sendReviewPrompt', async () => {
    const request = makeReviewRequest();

    // Don't await — the promise waits for handleReviewResponse
    const resultPromise = bridge.showReviewRequest(request);

    // Verify the review prompt was sent
    expect(plugin.sentReviews.length).toBe(1);
    expect(plugin.sentReviews[0]!.reviewId).toBe('review-1');
    expect(plugin.sentReviews[0]!.to).toBe('user1');
    expect(bridge.hasPendingReviews()).toBe(true);

    // Resolve the review
    bridge.handleReviewResponse('review-1', 'approve');

    const result = await resultPromise;
    expect(result).toEqual({decision: 'approve'});
    expect(bridge.hasPendingReviews()).toBe(false);
  });

  test('showReviewRequest falls back to sendText when sendReviewPrompt is missing', async () => {
    const plainPlugin = createMockPlugin({sendReviewPrompt: undefined});
    const plainBridge = new GatewayChannelBridge(plainPlugin, {id: 'acc1'}, 'user1', 'bot1', 'telegram');

    const request = makeReviewRequest();
    const resultPromise = plainBridge.showReviewRequest(request);

    // Should fall back to sendText
    expect(plainPlugin.sentTexts.length).toBe(1);
    expect(plainPlugin.sentTexts[0]!.text).toContain('bash');

    plainBridge.handleReviewResponse('review-1', 'reject');
    const result = await resultPromise;
    expect(result).toEqual({decision: 'reject'});
  });

  test('handleReviewResponse returns false for unknown reviewId', () => {
    expect(bridge.handleReviewResponse('nonexistent', 'approve')).toBe(false);
  });

  test('handleReviewResponse returns true and resolves for known reviewId', async () => {
    const request = makeReviewRequest({id: 'review-2'});
    const resultPromise = bridge.showReviewRequest(request);

    const handled = bridge.handleReviewResponse('review-2', 'edit');
    expect(handled).toBe(true);

    const result = await resultPromise;
    expect(result).toEqual({decision: 'edit'});
  });

  test('dispose rejects all pending reviews', async () => {
    const request1 = makeReviewRequest({id: 'p1'});
    const request2 = makeReviewRequest({id: 'p2'});

    const p1 = bridge.showReviewRequest(request1);
    const p2 = bridge.showReviewRequest(request2);

    await bridge.dispose();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({decision: 'reject', reason: 'Channel disposed'});
    expect(r2).toEqual({decision: 'reject', reason: 'Channel disposed'});
    expect(bridge.hasPendingReviews()).toBe(false);
  });

  test('builds default actions when review.allowedDecisions is empty', async () => {
    const request = makeReviewRequest({
      review: {actionName: 'bash', allowedDecisions: []},
    });

    const resultPromise = bridge.showReviewRequest(request);

    // The review prompt should still be sent with default actions
    expect(plugin.sentReviews.length).toBe(1);

    bridge.handleReviewResponse(request.id, 'approve');
    await resultPromise;
  });

  test('builds actions for all decision types', async () => {
    const request = makeReviewRequest({
      review: {actionName: 'bash', allowedDecisions: ['approve', 'edit', 'reject']},
    });

    const resultPromise = bridge.showReviewRequest(request);
    expect(plugin.sentReviews.length).toBe(1);

    bridge.handleReviewResponse(request.id, 'approve');
    await resultPromise;
  });
});
