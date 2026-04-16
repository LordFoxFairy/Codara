import {describe, test, expect, beforeEach} from 'bun:test';
import {ChannelRegistry} from '@integration/channel/registry';
import type {Channel} from '@shared/channel-types';
import type {ReviewRequest} from '@shared/agent-types';

function createMockChannel(id: string, type: Channel['type'] = 'cli'): Channel & {
  lastReview?: ReviewRequest;
  disposeCount: number;
} {
  const mock = {
    id,
    type,
    lastReview: undefined as ReviewRequest | undefined,
    disposeCount: 0,
    async sendMessage() {},
    async showReviewRequest(request: ReviewRequest) {
      mock.lastReview = request;
      return {decision: 'approve'};
    },
    async dispose() {
      mock.disposeCount++;
    },
  };
  return mock;
}

function createReviewRequest(channel?: string): ReviewRequest {
  return {
    id: 'review-1',
    description: 'Test review',
    action: {toolCallId: 'tc-1', toolName: 'bash', toolArgs: {command: 'echo hi'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
    ...(channel ? {channel} : {}),
  };
}

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  test('register and get channel', () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    expect(registry.get('cli-1')).toBe(ch);
  });

  test('first registered channel becomes default', () => {
    const ch1 = createMockChannel('cli-1');
    const ch2 = createMockChannel('web-1', 'web');
    registry.register(ch1);
    registry.register(ch2);
    expect(registry.getDefault()).toBe(ch1);
  });

  test('duplicate registration throws', () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    expect(() => registry.register(ch)).toThrow(/already registered/);
  });

  test('unregister channel', () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    registry.unregister('cli-1');
    expect(registry.get('cli-1')).toBeUndefined();
  });

  test('unregister default promotes next', () => {
    const ch1 = createMockChannel('cli-1');
    const ch2 = createMockChannel('web-1', 'web');
    registry.register(ch1);
    registry.register(ch2);
    registry.unregister('cli-1');
    expect(registry.getDefault()).toBe(ch2);
  });

  test('setDefault', () => {
    const ch1 = createMockChannel('cli-1');
    const ch2 = createMockChannel('web-1', 'web');
    registry.register(ch1);
    registry.register(ch2);
    registry.setDefault('web-1');
    expect(registry.getDefault()).toBe(ch2);
  });

  test('setDefault throws for unregistered', () => {
    expect(() => registry.setDefault('nope')).toThrow(/not registered/);
  });

  test('list returns all channel ids', () => {
    registry.register(createMockChannel('a'));
    registry.register(createMockChannel('b'));
    expect(registry.list().sort()).toEqual(['a', 'b']);
  });

  test('listByType filters by type', () => {
    registry.register(createMockChannel('cli-1', 'cli'));
    registry.register(createMockChannel('web-1', 'web'));
    registry.register(createMockChannel('cli-2', 'cli'));
    expect(registry.listByType('cli').map(c => c.id).sort()).toEqual(['cli-1', 'cli-2']);
  });

  test('resolveChannel uses request.channel', () => {
    const ch1 = createMockChannel('cli-1');
    const ch2 = createMockChannel('web-1', 'web');
    registry.register(ch1);
    registry.register(ch2);
    expect(registry.resolveChannel(createReviewRequest('web-1'))).toBe(ch2);
  });

  test('resolveChannel falls back to default', () => {
    const ch1 = createMockChannel('cli-1');
    registry.register(ch1);
    expect(registry.resolveChannel(createReviewRequest())).toBe(ch1);
  });

  test('routeReview routes to correct channel', async () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    const result = await registry.routeReview(createReviewRequest());
    expect(result).toEqual({decision: 'approve'});
    expect(ch.lastReview?.id).toBe('review-1');
  });

  test('routeReview throws when no channel available', async () => {
    await expect(registry.routeReview(createReviewRequest('missing'))).rejects.toThrow(/No channel available/);
  });

  test('disposeAll disposes all channels', async () => {
    const ch1 = createMockChannel('cli-1');
    const ch2 = createMockChannel('web-1', 'web');
    registry.register(ch1);
    registry.register(ch2);
    await registry.disposeAll();
    expect(ch1.disposeCount).toBe(1);
    expect(ch2.disposeCount).toBe(1);
    expect(registry.list()).toEqual([]);
  });
});
