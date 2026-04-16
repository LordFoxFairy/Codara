import {describe, test, expect, beforeEach} from 'bun:test';
import {ChannelRegistry} from '@integration/channel/registry';
import {createChannelReviewOptions} from '@integration/channel/review-adapter';
import type {Channel} from '@shared/channel-types';
import type {ReviewRequest} from '@shared/agent-types';
import type {ToolCallContext} from '@core/pipeline-types';

function createMockChannel(id: string): Channel & {
  reviewRequests: ReviewRequest[];
  events: unknown[];
} {
  const mock = {
    id,
    type: 'cli' as const,
    reviewRequests: [] as ReviewRequest[],
    events: [] as unknown[],
    async sendMessage() {},
    async showReviewRequest(request: ReviewRequest) {
      mock.reviewRequests.push(request);
      return {decision: 'approve'};
    },
    emitEvent(event: unknown) {
      mock.events.push(event);
    },
  };
  return mock;
}

function createReviewRequest(channel?: string): ReviewRequest {
  return {
    id: 'review-1',
    description: 'Confirm bash execution',
    action: {toolCallId: 'tc-1', toolName: 'bash', toolArgs: {command: 'echo hi'}},
    review: {actionName: 'bash', allowedDecisions: ['approve', 'reject']},
    runtime: {runId: 'run-1', turn: 1, requestId: 'req-1', toolIndex: 0},
    ...(channel ? {channel} : {}),
  };
}

const stubContext = {} as ToolCallContext;

describe('createChannelReviewOptions', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry();
  });

  test('onReview emits event to resolved channel', async () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    const options = createChannelReviewOptions(registry);
    await options.onPause!(createReviewRequest(), stubContext);
    expect(ch.events.length).toBe(1);
    expect((ch.events[0] as {kind: string}).kind).toBe('review');
  });

  test('onReview is silent when no channel available', async () => {
    const options = createChannelReviewOptions(registry);
    // Should not throw
    await options.onPause!(createReviewRequest(), stubContext);
  });

  test('resolveResume routes to channel.showReviewRequest', async () => {
    const ch = createMockChannel('cli-1');
    registry.register(ch);
    const options = createChannelReviewOptions(registry);
    const result = await options.resolveResume!(createReviewRequest(), stubContext);
    expect(result).toEqual({decision: 'approve'});
    expect(ch.reviewRequests.length).toBe(1);
  });

  test('resolveResume returns undefined when no channel', async () => {
    const options = createChannelReviewOptions(registry);
    const result = await options.resolveResume!(createReviewRequest(), stubContext);
    expect(result).toBeUndefined();
  });

  test('resolveResume routes to specific channel via request.channel', async () => {
    const cli = createMockChannel('cli-1');
    const web = createMockChannel('web-1');
    registry.register(cli);
    registry.register(web);
    const options = createChannelReviewOptions(registry);
    await options.resolveResume!(createReviewRequest('web-1'), stubContext);
    expect(web.reviewRequests.length).toBe(1);
    expect(cli.reviewRequests.length).toBe(0);
  });
});
